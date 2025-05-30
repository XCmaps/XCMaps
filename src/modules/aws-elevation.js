/**
 * AWS Terrain-RGB Elevation Module
 * Handles querying elevation data from AWS Terrain-RGB tiles
 */

import fetch from 'node-fetch';
import sharp from 'sharp';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * AWS Terrain-RGB Elevation Module
 * This class provides methods to query elevation data from AWS Terrain-RGB tiles
 */
class AwsElevation {
  constructor(dbPool) {
    this.dbPool = dbPool;
    
    // In-memory cache for elevation data to reduce API calls
    this.elevationCache = new Map();
    this.cacheMaxSize = 10000; // Maximum number of entries in the cache
    
    // Statistics counters
    this.stats = {
      apiRequests: 0,
      memoryCacheHits: 0,
      dbElevationCacheHits: 0,
      dbTileCacheHits: 0,
      lastReset: Date.now()
    };
    
    // Start stats logging timer
    this.statsTimer = setInterval(() => this.logStats(), 60000); // Log every minute
    
    // Initialize database table for tile caching
    this.initDatabase();
  }
  
  /**
   * Log statistics about cache hits and API requests
   */
  logStats() {
    const now = Date.now();
    const elapsedMinutes = ((now - this.stats.lastReset) / 60000).toFixed(1);
    
    console.log(`[AWS Elevation Stats - Last ${elapsedMinutes} min] ` +
      `Memory cache hits: ${this.stats.memoryCacheHits}, ` +
      `DB elevation cache hits: ${this.stats.dbElevationCacheHits}, ` +
      `DB tile cache hits: ${this.stats.dbTileCacheHits}, ` +
      `API requests: ${this.stats.apiRequests}`);
    
    // Reset counters
    this.stats.apiRequests = 0;
    this.stats.memoryCacheHits = 0;
    this.stats.dbElevationCacheHits = 0;
    this.stats.dbTileCacheHits = 0;
    this.stats.lastReset = now;
  }
  
  /**
   * Initialize database table for caching AWS tiles
   */
  async initDatabase() {
    const client = await this.dbPool.connect();
    try {
      await client.query('BEGIN');
      
      // First check if tables already exist to avoid sequence conflicts
      const tableCheckResult = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = 'aws_terrain_tiles'
        ) AS terrain_exists,
        EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = 'aws_elevation_cache'
        ) AS elevation_exists;
      `);
      
      const { terrain_exists, elevation_exists } = tableCheckResult.rows[0];
      
      // Create terrain tiles table if it doesn't exist
      if (!terrain_exists) {
        console.log('Creating aws_terrain_tiles table...');
        // Use BIGINT instead of SERIAL to avoid sequence creation issues
        await client.query(`
          CREATE TABLE aws_terrain_tiles (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            zoom INTEGER NOT NULL,
            tile_x INTEGER NOT NULL,
            tile_y INTEGER NOT NULL,
            tile_data BYTEA NOT NULL,
            last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(zoom, tile_x, tile_y)
          )
        `);
        
        // Create index for faster lookups
        await client.query(`
          CREATE INDEX idx_aws_terrain_tiles_coords ON aws_terrain_tiles(zoom, tile_x, tile_y);
        `);
      }
      
      // Create elevation cache table if it doesn't exist
      if (!elevation_exists) {
        console.log('Creating aws_elevation_cache table...');
        // Use BIGINT instead of SERIAL to avoid sequence creation issues
        await client.query(`
          CREATE TABLE aws_elevation_cache (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            lat DOUBLE PRECISION NOT NULL,
            lon DOUBLE PRECISION NOT NULL,
            elevation INTEGER NOT NULL,
            last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(lat, lon)
          )
        `);
        
        // Create index for faster lookups
        await client.query(`
          CREATE INDEX idx_aws_elevation_cache_coords ON aws_elevation_cache(lat, lon);
        `);
      }
      
      await client.query('COMMIT');
      console.log('AWS elevation database tables initialized successfully');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error initializing AWS elevation database tables:', err);
    } finally {
      client.release();
    }
  }

  /**
   * Get elevation at a specific latitude and longitude
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {number} zoom - Zoom level (higher = more detailed, 14-15 recommended)
   * @returns {Promise<number|null>} - Elevation in meters or null if not found
   */
  async getElevation(lat, lon, zoom = 15) {
    try {
      // Validate input parameters
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(zoom)) {
        console.error(`Invalid input for getElevation: lat=${lat}, lon=${lon}, zoom=${zoom}. Skipping elevation lookup.`);
        return null;
      }

      // Round coordinates to 5 decimal places (~1m precision) to improve cache hits
      const roundedLat = parseFloat(lat.toFixed(5));
      const roundedLon = parseFloat(lon.toFixed(5));
      
      // Create a cache key based on coordinates
      const cacheKey = `${roundedLat},${roundedLon}`;
      
      // Check if we have this elevation in memory cache
      if (this.elevationCache.has(cacheKey)) {
        this.stats.memoryCacheHits++;
        return this.elevationCache.get(cacheKey);
      }
      
      // Check if we have this elevation in database cache
      const dbElevation = await this.getElevationFromDb(roundedLat, roundedLon);
      if (dbElevation !== null) {
        this.stats.dbElevationCacheHits++;
        // Store in memory cache too
        this.elevationCache.set(cacheKey, dbElevation);
        return dbElevation;
      }

      // Convert geo coordinates to tile coordinates
      const n = Math.pow(2, zoom);
      const tileX = Math.floor((lon + 180) / 360 * n);
      const tileY = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
      
      // Validate calculated tile coordinates
      if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) {
        console.error(`Invalid tile coordinates calculated: tileX=${tileX}, tileY=${tileY} for lat=${lat}, lon=${lon}. Skipping elevation lookup.`);
        // Return null or a default value if tile coordinates are invalid
        return null;
      }

      // Calculate the precise position within the tile (256x256 pixels)
      const pixelX = Math.floor(((lon + 180) / 360 * n - tileX) * 256);
      const pixelY = Math.floor(((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n - tileY) * 256);
      
      // Try to get the tile from database cache
      let buffer = await this.getTileFromDb(zoom, tileX, tileY);
      
      // If not in cache, fetch from AWS API
      if (!buffer) {
        this.stats.apiRequests++;
        // Request the Terrain-RGB tile from AWS
        // AWS elevation tiles URL format: https://s3.amazonaws.com/elevation-tiles-prod/normal/{z}/{x}/{y}.png
        const url = `https://s3.amazonaws.com/elevation-tiles-prod/normal/${zoom}/${tileX}/${tileY}.png`;
        
        const maxRetries = 3;
        let attempt = 0;
        let fetchError = null;

        while (attempt < maxRetries) {
          try {
            const response = await fetch(url);
            
            // Only log non-200 responses
            if (response.status !== 200) {
              console.log(`AWS Elevation: Fetch response status: ${response.status} ${response.statusText}`);
            }

            if (!response.ok) {
              // Don't retry on non-OK HTTP status codes (like 4xx, 5xx) unless specifically needed
              // For now, throw error immediately for non-OK responses
              throw new Error(`Failed to fetch terrain data: ${response.status} ${response.statusText}`);
            }

            buffer = await response.buffer();
            // No need to log successful fetches
            fetchError = null; // Reset error on success
            break; // Exit loop on success
          } catch (error) {
            fetchError = error; // Store the error
            // Check if it's a retryable error and we haven't exceeded max retries
            if ((error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') && attempt < maxRetries - 1) {
              const delay = Math.pow(2, attempt) * 1000; // Exponential backoff (1s, 2s)
              console.warn(`Attempt ${attempt + 1} failed for tile ${zoom}/${tileX}/${tileY} (${error.code}). Retrying in ${delay / 1000}s...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              attempt++;
            } else {
              // Not a retryable error or max retries reached, re-throw the last error
              console.error(`Final attempt failed or non-retryable error (${error.code || 'HTTP Error'}) for tile ${zoom}/${tileX}/${tileY}.`);
              throw fetchError; // Re-throw the captured error to be caught by the outer try/catch
            }
          }
        }

        // Store the tile in database cache only if successfully fetched
        if (buffer) {
            await this.storeTileInDb(zoom, tileX, tileY, buffer);
        } else {
            // This case should not be reached if errors are thrown correctly, but added for safety
            console.error(`Failed to fetch buffer for tile ${zoom}/${tileX}/${tileY} after ${maxRetries} attempts.`);
            // Ensure the outer catch block handles this
            throw fetchError || new Error('Unknown error fetching tile after retries');
        }
      } else {
        this.stats.dbTileCacheHits++;
      }
      
      // Extract the RGB values at the specific pixel using sharp
      // AWS elevation tiles are PNG images with RGB values
      const { data, info } = await sharp(buffer)
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      // Only log image info if there's an issue
      if (info.width !== 256 || info.height !== 256 || info.channels < 3) {
        console.log(`AWS Elevation: Unusual image info - width: ${info.width}, height: ${info.height}, channels: ${info.channels}, format: ${info.format}`);
      }
      
      // Calculate the position in the buffer (R,G,B for each pixel)
      const idx = (pixelY * info.width + pixelX) * info.channels;
      
      if (idx < 0 || idx >= data.length - 2) {
        console.error(`AWS Elevation: Invalid pixel index ${idx} for image size ${data.length}, pixel coordinates: ${pixelX},${pixelY}`);
        return null;
      }
      
      // Get RGB values
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      
      // After analyzing the logs and researching further, we found that
      // AWS elevation tiles use the same formula as Mapbox:
      // height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
      
      // Calculate elevation using the correct formula
      const rawElevation = -10000 + ((r * 256 * 256 + g * 256 + b) * 0.1);
      
      const elevation = Math.round(rawElevation);
      
      console.log(`AWS Elevation: Selected rawElevation=${rawElevation}, final elevation=${elevation}`);
      
      // Check if elevation is reasonable (Earth's elevation range is roughly -430m to 8850m)
      if (elevation < -500 || elevation > 9000) {
        console.warn(`AWS Elevation: Unreasonable elevation value ${elevation} for lat=${lat}, lon=${lon}, using 0 instead`);
        // Use a reasonable default elevation (0 meters, sea level)
        return 0;
      }
      
      // Only log final elevation for debugging purposes if needed
      // console.log(`AWS Elevation: Final elevation for lat=${lat}, lon=${lon}: ${elevation}m`);
      
      // Store in memory cache
      this.elevationCache.set(cacheKey, elevation);
      
      // Store in database cache
      await this.storeElevationInDb(roundedLat, roundedLon, elevation);
      
      // If memory cache is too large, remove oldest entries
      if (this.elevationCache.size > this.cacheMaxSize) {
        const keysToDelete = Array.from(this.elevationCache.keys()).slice(0, 1000);
        keysToDelete.forEach(key => this.elevationCache.delete(key));
      }
      
      return elevation;
    } catch (error) {
      console.error(`Error getting elevation data:`, error);
      return null;
    }
  }
  
  /**
   * Get elevation from database cache
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @returns {Promise<number|null>} - Elevation in meters or null if not found
   */
  async getElevationFromDb(lat, lon) {
    const client = await this.dbPool.connect();
    try {
      // Query with a small tolerance to account for floating point precision
      const result = await client.query(`
        SELECT elevation FROM aws_elevation_cache
        WHERE lat BETWEEN $1 - 0.00001 AND $1 + 0.00001
        AND lon BETWEEN $2 - 0.00001 AND $2 + 0.00001
        LIMIT 1
      `, [lat, lon]);
      
      if (result.rows.length > 0) {
        return result.rows[0].elevation;
      }
      
      return null;
    } catch (err) {
      console.error('Error getting elevation from database:', err);
      return null;
    } finally {
      client.release();
    }
  }
  
  /**
   * Store elevation in database cache
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {number} elevation - Elevation in meters
   */
  async storeElevationInDb(lat, lon, elevation) {
    // Only store valid elevation values
    if (elevation === null || isNaN(elevation)) {
      console.warn(`AWS Elevation: Not storing invalid elevation value for lat=${lat}, lon=${lon}`);
      return;
    }
    
    const client = await this.dbPool.connect();
    try {
      // No need to log every database operation
      await client.query(`
        INSERT INTO aws_elevation_cache (lat, lon, elevation, last_updated)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (lat, lon) DO UPDATE SET
          elevation = EXCLUDED.elevation,
          last_updated = NOW()
      `, [lat, lon, elevation]);
    } catch (err) {
      console.error('Error storing elevation in database:', err);
    } finally {
      client.release();
    }
  }
  
  /**
   * Get tile from database cache
   * @param {number} zoom - Zoom level
   * @param {number} tileX - Tile X coordinate
   * @param {number} tileY - Tile Y coordinate
   * @returns {Promise<Buffer|null>} - Tile data as Buffer or null if not found
   */
  async getTileFromDb(zoom, tileX, tileY) {
    const client = await this.dbPool.connect();
    try {
      const result = await client.query(`
        SELECT tile_data FROM aws_terrain_tiles
        WHERE zoom = $1 AND tile_x = $2 AND tile_y = $3
        LIMIT 1
      `, [zoom, tileX, tileY]);
      
      if (result.rows.length > 0) {
        return result.rows[0].tile_data;
      }
      
      return null;
    } catch (err) {
      console.error('Error getting tile from database:', err);
      return null;
    } finally {
      client.release();
    }
  }
  
  /**
   * Store tile in database cache
   * @param {number} zoom - Zoom level
   * @param {number} tileX - Tile X coordinate
   * @param {number} tileY - Tile Y coordinate
   * @param {Buffer} tileData - Tile data as Buffer
   */
  async storeTileInDb(zoom, tileX, tileY, tileData) {
    const client = await this.dbPool.connect();
    try {
      await client.query(`
        INSERT INTO aws_terrain_tiles (zoom, tile_x, tile_y, tile_data, last_updated)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (zoom, tile_x, tile_y) DO UPDATE SET
          tile_data = EXCLUDED.tile_data,
          last_updated = NOW()
      `, [zoom, tileX, tileY, tileData]);
    } catch (err) {
      console.error('Error storing tile in database:', err);
    } finally {
      client.release();
    }
  }
}

export default AwsElevation;
/**
 * Terrain-RGB Elevation Module
 * Handles querying elevation data from Terrain-RGB tiles (AWS or Mapbox)
 */

import fetch from 'node-fetch';
import sharp from 'sharp';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Terrain-RGB Elevation Module
 * This class provides methods to query elevation data from Terrain-RGB tiles
 */
class TerrainRgbElevation {
  constructor(dbPool) {
    this.dbPool = dbPool;
    
    // AWS Terrain-RGB tiles endpoint
    // There are two formats available:
    // 1. Terrarium: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
    // 2. Normal: https://s3.amazonaws.com/elevation-tiles-prod/normal/{z}/{x}/{y}.png
    this.tileEndpoint = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
    this.tileFormat = 'terrarium'; // Always use terrarium format as normal format seems incompatible
    
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
    // Reset counters
    const now = Date.now();
    this.stats.apiRequests = 0;
    this.stats.memoryCacheHits = 0;
    this.stats.dbElevationCacheHits = 0;
    this.stats.dbTileCacheHits = 0;
    this.stats.lastReset = now;
  }
  
  /**
   * Initialize database table for caching terrain tiles
   */
  async initDatabase() {
    const client = await this.dbPool.connect();
    try {
      await client.query('BEGIN');
      
      // First check if tables already exist to avoid sequence conflicts
      const tableCheckResult = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'terrain_rgb_tiles'
        ) AS terrain_exists,
        EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'terrain_rgb_elevation_cache'
        ) AS elevation_exists;
      `);
      
      const { terrain_exists, elevation_exists } = tableCheckResult.rows[0];
      
      // Create terrain tiles table if it doesn't exist
      if (!terrain_exists) {
        // Use a composite primary key instead of an auto-incrementing ID to avoid sequence issues
        await client.query(`
          CREATE TABLE terrain_rgb_tiles (
            zoom INTEGER NOT NULL,
            tile_x INTEGER NOT NULL,
            tile_y INTEGER NOT NULL,
            tile_data BYTEA NOT NULL,
            last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(zoom, tile_x, tile_y)
          )
        `);
      }
      
      // Create elevation cache table if it doesn't exist
      if (!elevation_exists) {
        // Use a composite primary key instead of an auto-incrementing ID to avoid sequence issues
        await client.query(`
          CREATE TABLE terrain_rgb_elevation_cache (
            lat DOUBLE PRECISION NOT NULL,
            lon DOUBLE PRECISION NOT NULL,
            elevation INTEGER NOT NULL,
            last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(lat, lon)
          )
        `);
      }
      
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
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
  /**
   * Try to get elevation using both formats if needed
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {number} zoom - Zoom level
   * @returns {Promise<number|null>} - Elevation in meters or null if not found
   */
  async getElevation(lat, lon, zoom = 15) {
    try {
      // Validate input parameters
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(zoom)) {
        return null;
      }
      
      // Always try with terrarium format
      let elevation = await this._getElevationWithFormat(lat, lon, zoom, 'terrarium');
      
      // If terrarium format failed, set elevation to 0 as a default
      if (elevation === null) {
        elevation = 0;
      }
      
      // Ensure elevation is never 0 or negative based on business rule
      return Math.max(1, elevation);
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Get elevation at a specific latitude and longitude with a specific format
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {number} zoom - Zoom level
   * @param {string} format - Tile format ('terrarium' or 'normal')
   * @returns {Promise<number|null>} - Elevation in meters or null if not found
   */
  async _getElevationWithFormat(lat, lon, zoom = 15, format) {
    try {
      // Set the endpoint based on format
      const endpoint = `https://s3.amazonaws.com/elevation-tiles-prod/${format}`;

      // Round coordinates to 5 decimal places (~1m precision) to improve cache hits
      const roundedLat = parseFloat(lat.toFixed(5));
      const roundedLon = parseFloat(lon.toFixed(5));
      
      // Create a cache key based on coordinates
      const cacheKey = `${roundedLat},${roundedLon}`;
      
      // Check if we have this elevation in memory cache
      if (this.elevationCache.has(cacheKey)) {
        this.stats.memoryCacheHits++;
        // console.log(`[TerrainRgbElevation] Memory cache hit for ${cacheKey}`);
        return this.elevationCache.get(cacheKey);
      }
      
      // Check if we have this elevation in database cache
      const dbElevation = await this.getElevationFromDb(roundedLat, roundedLon);
      if (dbElevation !== null) {
        this.stats.dbElevationCacheHits++;
        // console.log(`[TerrainRgbElevation] Database elevation cache hit for ${cacheKey}`);
        // Store in memory cache too
        this.elevationCache.set(cacheKey, dbElevation);
        return dbElevation;
      }

      // Convert geo coordinates to tile coordinates
      const tileCoords = this.latLonToTile(lat, lon, zoom);
      const { tileX, tileY, pixelX, pixelY } = tileCoords;
      
      // Try to get the tile from database cache
      let buffer = await this.getTileFromDb(zoom, tileX, tileY);
      
      // If not in cache, fetch from API
      if (!buffer) {
        this.stats.apiRequests++;
        // console.log(`[TerrainRgbElevation] Fetching tile from API: Z${zoom} X${tileX} Y${tileY}`);
        
        // Format: {z}/{x}/{y}.png
        const url = `${endpoint}/${zoom}/${tileX}/${tileY}.png`;
        
        const maxRetries = 3;
        let attempt = 0;
        let fetchError = null;

        while (attempt < maxRetries) {
          try {
            const response = await fetch(url);

            if (!response.ok) {
              if (response.status === 404) {
                // For 404 errors, throw a specific error that can be caught and ignored by the outer try/catch
                throw new Error(`Terrain tile not found: ${response.status} ${response.statusText}`);
              } else {
                // For other HTTP errors, throw a general error
                if (response.status === 404) {
                  // Log a warning for 404 errors, including coordinates and URL
                  console.warn(`[TerrainRgbElevation] Terrain tile not found (404) for lat=${lat}, lon=${lon}, zoom=${zoom}, url=${url}`);
                  throw new Error(`Terrain tile not found: ${response.status} ${response.statusText}`);
                } else {
                  // For other HTTP errors, throw a general error
                  throw new Error(`Failed to fetch terrain data: ${response.status} ${response.statusText}`);
                }
              }
            }

            buffer = await response.buffer();
            fetchError = null; // Reset error on success
            break; // Exit loop on success
          } catch (error) {
            fetchError = error; // Store the error
            // Check if it's a retryable error and we haven't exceeded max retries
            if ((error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') && attempt < maxRetries - 1) {
              console.warn(`[TerrainRgbElevation] Retrying fetch for Z${zoom} X${tileX} Y${tileY} (attempt ${attempt + 1}/${maxRetries}). Error: ${error.message}`);
              const delay = Math.pow(2, attempt) * 1000; // Exponential backoff (1s, 2s)
              await new Promise(resolve => setTimeout(resolve, delay));
              attempt++;
            } else {
              // Not a retryable error or max retries reached, re-throw the last error
              console.error(`[TerrainRgbElevation] Failed to fetch tile for Z${zoom} X${tileX} Y${tileY} after ${attempt + 1} attempts. Error: ${fetchError.message}`);
              throw fetchError; // Re-throw the captured error to be caught by the outer try/catch
            }
          }
        }

        // Store the tile in database cache only if successfully fetched
        if (buffer) {
            await this.storeTileInDb(zoom, tileX, tileY, buffer);
            // console.log(`[TerrainRgbElevation] Stored tile Z${zoom} X${tileX} Y${tileY} in database cache.`);
        } else {
            throw fetchError || new Error('Unknown error fetching tile after retries');
        }
      } else {
        this.stats.dbTileCacheHits++;
        // console.log(`[TerrainRgbElevation] Database tile cache hit for Z${zoom} X${tileX} Y${tileY}`);
      }
      
      // Extract the RGB values at the specific pixel using sharp
      const { data, info } = await sharp(buffer)
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      // Check image dimensions
      if (info.width !== 256 || info.height !== 256 || info.channels < 3) {
        console.warn(`[TerrainRgbElevation] Invalid tile dimensions or channels for Z${zoom} X${tileX} Y${tileY}.`);
        return null;
      }
      
      // Calculate the position in the buffer (R,G,B for each pixel)
      const idx = (pixelY * info.width + pixelX) * info.channels;
      
      if (idx < 0 || idx >= data.length - 2) {
        console.warn(`[TerrainRgbElevation] Pixel index out of bounds for Z${zoom} X${tileX} Y${tileY} at pixelX=${pixelX}, pixelY=${pixelY}.`);
        return null;
      }
      
      // Get RGB values
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      
      let elevation;
      let rawValue; // Declare rawValue here
      
      // Calculate elevation based on the format
      if (format === 'terrarium') {
        // Terrarium format: height(m) = (R * 256 + G + B / 256) - 32768
        rawValue = (r * 256 + g + b / 256);
        elevation = Math.round(rawValue - 32768);
      } else {
        // Normal/Mapbox format: height(m) = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
        rawValue = (r * 256 * 256 + g * 256 + b);
        elevation = Math.round(-10000 + (rawValue * 0.1));
      }
      
      // Log raw RGB and calculated elevation before validation
      // console.log(`[TerrainRgbElevation] Raw RGB for ${lat},${lon} (Z${zoom}, X${tileX}, Y${tileY}, Px${pixelX}, Py${pixelY}): R=${r}, G=${g}, B=${b}. Format: ${format}. RawValue: ${rawValue}. Calculated Elevation: ${elevation}m.`);

      // Check if elevation is reasonable (Earth's elevation range is roughly -430m to 8850m)
      if (elevation < -500 || elevation > 9000) {
        console.warn(`[TerrainRgbElevation] Unreasonable elevation value (${elevation}m) for lat=${lat}, lon=${lon}, zoom=${zoom}. Trying other format.`);
        return null; // Return null so we can try the other format
      }
      
      // Store in memory cache
      this.elevationCache.set(cacheKey, elevation);
      // console.log(`[TerrainRgbElevation] Stored elevation ${elevation}m for ${cacheKey} in memory cache.`);
      
      try {
        // Store in database cache
        await this.storeElevationInDb(roundedLat, roundedLon, elevation);
        // console.log(`[TerrainRgbElevation] Stored elevation ${elevation}m for ${cacheKey} in database elevation cache.`);
      } catch (err) {
        console.error(`[TerrainRgbElevation] Error storing elevation in database cache for ${cacheKey}:`, err.message);
        // Ignore database errors - the elevation value is still valid
      }
      
      // If memory cache is too large, remove oldest entries
      if (this.elevationCache.size > this.cacheMaxSize) {
        const keysToDelete = Array.from(this.elevationCache.keys()).slice(0, 1000);
        keysToDelete.forEach(key => this.elevationCache.delete(key));
        // console.log(`[TerrainRgbElevation] Cleaned memory cache. Removed ${keysToDelete.length} entries.`);
      }
      
      return elevation;
    } catch (error) {
      // Only log errors that are not "Terrain tile not found"
      if (error.message.includes('Terrain tile not found')) {
        console.warn(`[TerrainRgbElevation] ${error.message} for lat=${lat}, lon=${lon}, zoom=${zoom}.`);
      } else {
        console.error(`[TerrainRgbElevation] Error getting elevation data for lat=${lat}, lon=${lon}, zoom=${zoom}:`, error);
      }
      return null;
    }
  }
  
  /**
   * Convert latitude, longitude to tile coordinates
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {number} zoom - Zoom level
   * @returns {Object} - Tile coordinates and pixel position
   */
  latLonToTile(lat, lon, zoom) {
    const n = Math.pow(2, zoom);
    const tileX = Math.floor((lon + 180) / 360 * n);
    const tileY = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
    
    // Calculate the precise position within the tile (256x256 pixels)
    const pixelX = Math.floor(((lon + 180) / 360 * n - tileX) * 256);
    const pixelY = Math.floor(((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n - tileY) * 256);
    
    return { tileX, tileY, pixelX, pixelY };
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
        SELECT elevation FROM terrain_rgb_elevation_cache
        WHERE lat BETWEEN $1 - 0.00001 AND $1 + 0.00001
        AND lon BETWEEN $2 - 0.00001 AND $2 + 0.00001
        LIMIT 1
      `, [lat, lon]);
      
      if (result.rows.length > 0) {
        return result.rows[0].elevation;
      }
      
      return null;
    } catch (err) {
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
      return;
    }
    
    const client = await this.dbPool.connect();
    try {
      await client.query(`
        INSERT INTO terrain_rgb_elevation_cache (lat, lon, elevation, last_updated)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (lat, lon) DO UPDATE SET
          elevation = EXCLUDED.elevation,
          last_updated = NOW()
      `, [lat, lon, elevation]);
    } catch (err) {
      // Ignore database errors
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
        SELECT tile_data FROM terrain_rgb_tiles
        WHERE zoom = $1 AND tile_x = $2 AND tile_y = $3
        LIMIT 1
      `, [zoom, tileX, tileY]);
      
      if (result.rows.length > 0) {
        return result.rows[0].tile_data;
      }
      
      return null;
    } catch (err) {
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
        INSERT INTO terrain_rgb_tiles (zoom, tile_x, tile_y, tile_data, last_updated)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (zoom, tile_x, tile_y) DO UPDATE SET
          tile_data = EXCLUDED.tile_data,
          last_updated = NOW()
      `, [zoom, tileX, tileY, tileData]);
    } catch (err) {
      // Ignore database errors
    } finally {
      client.release();
    }
  }
}

export default TerrainRgbElevation;
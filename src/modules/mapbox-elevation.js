/**
 * Mapbox Terrain-RGB Elevation Module
 * Handles querying elevation data from Mapbox Terrain-RGB tiles
 */

import fetch from 'node-fetch';
import sharp from 'sharp';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Get Mapbox access token from environment variables
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;

/**
 * Mapbox Terrain-RGB Elevation Module
 * This class provides methods to query elevation data from Mapbox Terrain-RGB tiles
 */
class MapboxElevation {
  constructor(dbPool) {
    if (!MAPBOX_ACCESS_TOKEN) {
      console.error('MAPBOX_ACCESS_TOKEN is not defined in environment variables');
    }
    
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
    
    console.log(`[Mapbox Elevation Stats - Last ${elapsedMinutes} min] ` +
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
   * Initialize database table for caching Mapbox tiles
   */
  async initDatabase() {
    const client = await this.dbPool.connect();
    try {
      await client.query('BEGIN');
      
      // Create table for caching Mapbox tiles
      await client.query(`
        CREATE TABLE IF NOT EXISTS mapbox_terrain_tiles (
          id SERIAL PRIMARY KEY,
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
        CREATE INDEX IF NOT EXISTS idx_mapbox_terrain_tiles_coords ON mapbox_terrain_tiles(zoom, tile_x, tile_y);
      `);
      
      // Create table for caching individual elevation points
      await client.query(`
        CREATE TABLE IF NOT EXISTS mapbox_elevation_cache (
          id SERIAL PRIMARY KEY,
          lat DOUBLE PRECISION NOT NULL,
          lon DOUBLE PRECISION NOT NULL,
          elevation INTEGER NOT NULL,
          last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(lat, lon)
        )
      `);
      
      // Create index for faster lookups
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_mapbox_elevation_cache_coords ON mapbox_elevation_cache(lat, lon);
      `);
      
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error initializing Mapbox elevation database tables:', err);
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
   * Get elevation at a specific latitude and longitude
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {number} zoom - Zoom level (higher = more detailed, 14-15 recommended)
   * @returns {Promise<number|null>} - Elevation in meters or null if not found
   */
  async getElevation(lat, lon, zoom = 14) {
    try {
      if (!MAPBOX_ACCESS_TOKEN) {
        console.error('Cannot get elevation: MAPBOX_ACCESS_TOKEN is not defined');
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
      
      // Calculate the precise position within the tile (256x256 pixels)
      const pixelX = Math.floor(((lon + 180) / 360 * n - tileX) * 256);
      const pixelY = Math.floor(((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n - tileY) * 256);
      
      // Try to get the tile from database cache
      let buffer = await this.getTileFromDb(zoom, tileX, tileY);
      
      // If not in cache, fetch from Mapbox API
      if (!buffer) {
        this.stats.apiRequests++;
        // Request the Terrain-RGB tile
        const url = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${zoom}/${tileX}/${tileY}.pngraw?access_token=${MAPBOX_ACCESS_TOKEN}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch terrain data: ${response.statusText}`);
        }
        
        buffer = await response.buffer();
        
        // Store the tile in database cache
        await this.storeTileInDb(zoom, tileX, tileY, buffer);
      } else {
        this.stats.dbTileCacheHits++;
      }
      
      // Extract the RGB values at the specific pixel using sharp
      const { data, info } = await sharp(buffer)
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      // Calculate the position in the buffer (R,G,B for each pixel)
      const idx = (pixelY * info.width + pixelX) * info.channels;
      
      if (idx < 0 || idx >= data.length - 2) {
        return null;
      }
      
      // Get RGB values
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      
      // Use the exact formula from Mapbox documentation:
      // elevation = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
      const rawElevation = -10000 + ((r * 256 * 256 + g * 256 + b) * 0.1);
      const elevation = Math.round(rawElevation);
      
      // Check if elevation is reasonable (Earth's elevation range is roughly -430m to 8850m)
      if (elevation < -500 || elevation > 9000) {
        // Use a reasonable default elevation (0 meters, sea level)
        return 0;
      }
      
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
        SELECT elevation FROM mapbox_elevation_cache
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
    const client = await this.dbPool.connect();
    try {
      await client.query(`
        INSERT INTO mapbox_elevation_cache (lat, lon, elevation, last_updated)
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
        SELECT tile_data FROM mapbox_terrain_tiles
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
        INSERT INTO mapbox_terrain_tiles (zoom, tile_x, tile_y, tile_data, last_updated)
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

export default MapboxElevation;
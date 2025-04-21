/**
 * SRTM Elevation Module
 * Handles querying NASA SRTM elevation data
 *
 * Note: Data import is now handled by the scripts/import-srtm.js or scripts/import-srtm-raster2pgsql.js scripts
 */

import pkg from 'pg';
const { Pool } = pkg;

/**
 * SRTM Elevation Module
 * This class provides methods to query elevation data from the SRTM database
 * and calculate AGL (Above Ground Level) heights.
 */
class SrtmElevation {
  constructor(dbPool) {
    this.dbPool = dbPool;
  }

  /**
   * Initialize database table if it doesn't exist
   */
  async initDatabase() {
    const client = await this.dbPool.connect();
    try {
      await client.query('BEGIN');

      // Create elevation table if it doesn't exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS srtm_elevation (
          id SERIAL PRIMARY KEY,
          lon DOUBLE PRECISION NOT NULL,
          lat DOUBLE PRECISION NOT NULL,
          elevation INTEGER NOT NULL,
          CONSTRAINT elevation_check CHECK (elevation > 0 AND elevation < 8848 AND elevation != 32767)
        )
      `);

      // Check if PostGIS extension is installed
      const postgisResult = await client.query(`
        SELECT 1 FROM pg_extension WHERE extname = 'postgis'
      `);
      
      if (postgisResult.rowCount > 0) {
        // Create spatial index if it doesn't exist
        const indexResult = await client.query(`
          SELECT 1 FROM pg_indexes WHERE indexname = 'srtm_elevation_idx'
        `);
        
        if (indexResult.rowCount === 0) {
          await client.query(`
            CREATE INDEX srtm_elevation_idx ON srtm_elevation USING gist (
              ST_SetSRID(ST_MakePoint(lon, lat), 4326)
            )
          `);
        }
      } else {
        // Fall back to regular index if PostGIS is not available
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_srtm_elevation_lat_lon ON srtm_elevation(lat, lon);
        `);
      }

      await client.query('COMMIT');
      console.log('SRTM elevation database table initialized successfully');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error initializing SRTM elevation database table:', err);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get elevation at a specific latitude and longitude
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @returns {Promise<number|null>} - Elevation in meters or null if not found
   */
  async getElevation(lat, lon) {
    const client = await this.dbPool.connect();
    try {
      // Check if PostGIS is available
      const postgisResult = await client.query(`
        SELECT 1 FROM pg_extension WHERE extname = 'postgis'
      `);
      
      let query;
      let params;
      
      if (postgisResult.rowCount > 0) {
        // Use PostGIS spatial functions for better performance
        query = `
          SELECT elevation
          FROM srtm_elevation
          ORDER BY ST_SetSRID(ST_MakePoint(lon, lat), 4326) <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
          LIMIT 1
        `;
        params = [lon, lat]; // Note: PostGIS uses (lon, lat) order
      } else {
        // Fall back to simple nearest neighbor approach
        query = `
          SELECT elevation
          FROM srtm_elevation
          ORDER BY (lat - $1)^2 + (lon - $2)^2 ASC
          LIMIT 1
        `;
        params = [lat, lon];
      }
      
      const result = await client.query(query, params);
      
      if (result.rows.length > 0) {
        return result.rows[0].elevation;
      }
      
      return null;
    } catch (err) {
      console.error('Error getting elevation:', err);
      return null;
    } finally {
      client.release();
    }
  }
}

export default SrtmElevation;
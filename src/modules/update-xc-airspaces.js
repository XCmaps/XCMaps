import axios from 'axios';
import pgFormat from 'pg-format';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config(); // Load environment variables from .env file

// Database connection configuration
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

/**
 * Formats a date as YYYY-M-D-SR for the API
 * @param {Date} date - The date to format
 * @returns {string} Formatted date string
 */
function formatDateForApi(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/**
 * Formats a date as YYYY-MM-DD for the database
 * @param {Date} date - The date to format
 * @returns {string} Formatted date string
 */
function formatDateForDb(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Creates the necessary airspaces table if it doesn't exist
 * @param {Object} pool - Database connection pool
 */
async function ensureAirspacesTableExists(pool) {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS postgis;
      
      CREATE TABLE IF NOT EXISTS xcairspaces (
        id SERIAL PRIMARY KEY,
        name TEXT,
        airspace_class TEXT,
        check_type TEXT,
        upper_limit TEXT,
        lower_limit TEXT,
        upper_limit_data JSONB,
        lower_limit_data JSONB,
        stroke_color TEXT,
        stroke_weight INTEGER,
        fill_color TEXT,
        fill_opacity FLOAT,
        country_code TEXT,
        fetch_date DATE,
        descriptions JSONB,
        activations JSONB,
        geometry GEOMETRY(POLYGON, 4326)
      );
      
      CREATE INDEX IF NOT EXISTS xcairspaces_geometry_idx ON xcairspaces USING GIST (geometry);
      CREATE INDEX IF NOT EXISTS xcairspaces_fetch_date_idx ON xcairspaces (fetch_date);

      -- Add the descriptions column if it doesn't exist
      DO $$ 
      BEGIN 
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'xcairspaces' AND column_name = 'descriptions'
        ) THEN
          ALTER TABLE xcairspaces ADD COLUMN descriptions JSONB;
        END IF;
      END $$;
      
      -- Add the activations column if it doesn't exist
      DO $$ 
      BEGIN 
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'xcairspaces' AND column_name = 'activations'
        ) THEN
          ALTER TABLE xcairspaces ADD COLUMN activations JSONB;
        END IF;
      END $$;
    `);
    console.log('Airspaces table checked/created successfully');
  } catch (err) {
    console.error('Error creating airspaces table:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Creates the necessary obstacles table if it doesn't exist
 * @param {Object} pool - Database connection pool
 */
async function ensureObstaclesTableExists(pool) {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS postgis;
      
      CREATE TABLE IF NOT EXISTS obstacles (
        id SERIAL PRIMARY KEY,
        feature_id INTEGER,
        name TEXT,
        type TEXT,
        description TEXT,
        stroke_color TEXT,
        stroke_weight INTEGER,
        persistent_id TEXT,
        tags JSONB,
        max_agl INTEGER,
        top_amsl FLOAT,
        country_code TEXT,
        fetch_date DATE,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        elevations FLOAT[]
      );
      
      CREATE INDEX IF NOT EXISTS obstacles_geometry_idx ON obstacles USING GIST (geometry);
      CREATE INDEX IF NOT EXISTS obstacles_fetch_date_idx ON obstacles (fetch_date);
      CREATE INDEX IF NOT EXISTS obstacles_country_code_idx ON obstacles (country_code);
      CREATE INDEX IF NOT EXISTS obstacles_feature_id_idx ON obstacles (feature_id);
    `);
    console.log('Obstacles table checked/created successfully');
  } catch (err) {
    console.error('Error creating obstacles table:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Removes airspace data older than the specified date
 * @param {Object} pool - Database connection pool
 * @param {string} currentDate - Date in YYYY-MM-DD format
 */
async function removeOldAirspaceData(pool, currentDate) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'DELETE FROM xcairspaces WHERE fetch_date < $1',
      [currentDate]
    );
    console.log(`Removed ${result.rowCount} old airspace records`);
  } catch (err) {
    console.error('Error removing old airspace data:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Removes obstacle data older than the specified date
 * @param {Object} pool - Database connection pool
 * @param {string} currentDate - Date in YYYY-MM-DD format
 */
async function removeOldObstacleData(pool, currentDate) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'DELETE FROM obstacles WHERE fetch_date < $1',
      [currentDate]
    );
    console.log(`Removed ${result.rowCount} old obstacle records`);
  } catch (err) {
    console.error('Error removing old obstacle data:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Fetches airspace data from the API for a specific country and date
 * @param {number} countryId - The country ID (1-50)
 * @param {string} dateStr - Formatted date string for the API
 * @returns {Object} GeoJSON data
 */
async function fetchAirspaceData(countryId, dateStr) {
  try {
    const url = `https://airspace.xcontest.org/web/country/${countryId}?start=${dateStr}&restrictlang=1&skip=&aircatpg=1&skip_alerts=1`;
    const response = await axios.get(url);
    return response.data;
  } catch (err) {
    console.error(`Error fetching airspace data for country ${countryId} on ${dateStr}:`, err.message);
    return null;
  }
}

/**
 * Fetches obstacle data from the API for a specific country
 * @param {number} countryId - The country ID (1-50)
 * @returns {Object} GeoJSON data
 */
async function fetchObstacleData(countryId) {
  try {
    const url = `https://airspace.xcontest.org/oweb/obstacle/country/${countryId}`;
    const response = await axios.get(url);
    return response.data;
  } catch (err) {
    console.error(`Error fetching obstacle data for country ${countryId}:`, err.message);
    return null;
  }
}

/**
 * Processes and stores GeoJSON features in the database - FIXED VERSION
 * @param {Object} pool - Database connection pool
 * @param {Array} features - GeoJSON features
 * @param {string} fetchDate - The date in YYYY-MM-DD format
 * @param {number} countryId - The country ID
 */
async function storeAirspaceData(pool, features, fetchDate, countryId) {
  if (!features || features.length === 0) {
    console.log(`No features to store for country ${countryId} on ${fetchDate}`);
    return;
  }

  const client = await pool.connect();
  try {
    // First, remove existing data for this country and date to avoid duplicates
    await client.query(
      'DELETE FROM xcairspaces WHERE fetch_date = $1 AND country_code = $2',
      [fetchDate, countryId.toString()]
    );

    // Process each feature individually to avoid batch processing issues
    for (const feature of features) {
      const { properties, geometry } = feature;
      
      // Ensure we have valid geometry
      if (!geometry || !geometry.coordinates || geometry.coordinates.length === 0) {
        console.warn('Skipping feature with invalid geometry:', properties?.name);
        continue;
      }

      // Skip unsupported geometry types
      if (geometry.type !== 'Polygon') {
        console.warn(`Unsupported geometry type: ${geometry.type} for feature: ${properties?.name}`);
        continue;
      }

      // Skip airspaces where "foreignisocode" is not null
      if (properties.foreignisocode !== null) {
        console.log(`Skipping airspace with foreignisocode: ${properties.foreignisocode} for feature: ${properties?.name}`);
        continue;
      }

      // Process each feature individually
      try {
        const geoJsonText = JSON.stringify(geometry);
        const descriptionsJson = JSON.stringify(properties.descriptions || []);
        const activationsJson = JSON.stringify(properties.activations || []);
        
        await client.query(`
          INSERT INTO xcairspaces (
            name, airspace_class, check_type, upper_limit, lower_limit,
            upper_limit_data, lower_limit_data, stroke_color, stroke_weight,
            fill_color, fill_opacity, country_code, fetch_date, descriptions, 
            activations, geometry
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
            $15, ST_GeomFromGeoJSON($16)
          )
        `, [
          properties.name || '',
          properties.airspaceClass || '',
          properties.airspaceCheckType || '',
          properties.upperLimit || '',
          properties.lowerLimit || '',
          JSON.stringify(properties.airupper_j || {}),
          JSON.stringify(properties.airlower_j || {}),
          properties.strokeColor || '',
          properties.strokeWeight || 1,
          properties.fillColor || '',
          properties.fillOpacity || 0.35,
          properties.foreignisocode || countryId.toString(),
          fetchDate,
          descriptionsJson,
          activationsJson,
          geoJsonText
        ]);
      } catch (insertErr) {
        console.error(`Error inserting feature "${properties?.name}":`, insertErr.message);
        // Continue with next feature instead of failing the entire batch
      }
    }

    console.log(`Stored airspace records for country ${countryId} on ${fetchDate}`);
  } catch (err) {
    console.error(`Error storing airspace data for country ${countryId} on ${fetchDate}:`, err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Processes and stores obstacle GeoJSON features in the database
 * @param {Object} pool - Database connection pool
 * @param {Array} features - GeoJSON features
 * @param {string} fetchDate - The date in YYYY-MM-DD format
 * @param {number} countryId - The country ID
 */
async function storeObstacleData(pool, features, fetchDate, countryId) {
  if (!features || features.length === 0) {
    console.log(`No obstacle features to store for country ${countryId} on ${fetchDate}`);
    return;
  }

  const client = await pool.connect();
  try {
    // First, remove existing data for this country and date to avoid duplicates
    await client.query(
      'DELETE FROM obstacles WHERE fetch_date = $1 AND country_code = $2',
      [fetchDate, countryId.toString()]
    );

    // Process each feature individually to avoid batch processing issues
    for (const feature of features) {
      const { properties, geometry, id } = feature;
      
      // Ensure we have valid geometry
      if (!geometry || !geometry.coordinates || geometry.coordinates.length === 0) {
        console.warn('Skipping obstacle with invalid geometry:', properties?.name);
        continue;
      }

      // Skip unsupported geometry types
      if (geometry.type !== 'LineString') {
        console.warn(`Unsupported geometry type: ${geometry.type} for obstacle: ${properties?.name}`);
        continue;
      }

      // Process each feature individually
      try {
        const geoJsonText = JSON.stringify(geometry);
        const tagsJson = JSON.stringify(properties.tags || {});
        
        await client.query(`
          INSERT INTO obstacles (
            feature_id, name, type, description, stroke_color, stroke_weight,
            persistent_id, tags, max_agl, top_amsl, country_code, fetch_date, geometry
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, ST_GeomFromGeoJSON($13)
          )
        `, [
          id || properties.oid || null,
          properties.name || '',
          properties.type || '',
          properties.description || '',
          properties.strokeColor || '',
          properties.strokeWeight || 1,
          properties.persistentId || '',
          tagsJson,
          properties.maxAgl || null,
          properties.topAmsl || null,
          countryId.toString(),
          fetchDate,
          geoJsonText
        ]);
      } catch (insertErr) {
        console.error(`Error inserting obstacle "${properties?.name}":`, insertErr.message);
        // Continue with next feature instead of failing the entire batch
      }
    }

    console.log(`Stored obstacle records for country ${countryId} on ${fetchDate}`);
  } catch (err) {
    console.error(`Error storing obstacle data for country ${countryId} on ${fetchDate}:`, err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Main function to fetch and store airspace data
 * @param {Object} pool - Database connection pool
 */
async function fetchAndStoreAirspaces(pool) {
  try {
    // Ensure the table exists
    await ensureAirspacesTableExists(pool);
    
    // Get today's date
    const today = new Date();
    const todayFormatted = formatDateForDb(today);
    
    // Remove data older than today
    await removeOldAirspaceData(pool, todayFormatted);
    
    // Fetch data for today and the next 6 days
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const currentDate = new Date(today);
      currentDate.setDate(today.getDate() + dayOffset);
      
      const apiDateFormat = formatDateForApi(currentDate);
      const dbDateFormat = formatDateForDb(currentDate);
      
      console.log(`Fetching airspace data for ${dbDateFormat}`);
      
      // Fetch data for countries 1-50
      for (let countryId = 1; countryId <= 50; countryId++) {
        console.log(`Fetching airspace data for country ${countryId} on ${dbDateFormat}`);
        const geoJsonData = await fetchAirspaceData(countryId, apiDateFormat);
        
        if (geoJsonData && geoJsonData.features) {
          await storeAirspaceData(pool, geoJsonData.features, dbDateFormat, countryId);
        } else {
          console.log(`No airspace data returned for country ${countryId} on ${dbDateFormat}`);
        }
        
        // Add a small delay between API calls to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log('Airspace data fetch and store operation completed successfully');
  } catch (err) {
    console.error('Error in fetchAndStoreAirspaces:', err);
  }
}

/**
 * Main function to fetch and store obstacle data
 * @param {Object} pool - Database connection pool
 */
async function fetchAndStoreObstacles(pool) {
  try {
    // Ensure the table exists
    await ensureObstaclesTableExists(pool);
    
    // Get today's date
    const today = new Date();
    const todayFormatted = formatDateForDb(today);
    
    // Remove data older than today
    await removeOldObstacleData(pool, todayFormatted);
    
    console.log(`Fetching obstacle data for ${todayFormatted}`);
    
    // Fetch data for countries 1-50
    for (let countryId = 1; countryId <= 50; countryId++) {
      console.log(`Fetching obstacle data for country ${countryId}`);
      const geoJsonData = await fetchObstacleData(countryId);
      
      if (geoJsonData && geoJsonData.features) {
        await storeObstacleData(pool, geoJsonData.features, todayFormatted, countryId);
      } else {
        console.log(`No obstacle data returned for country ${countryId}`);
      }
      
      // Add a small delay between API calls to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('Obstacle data fetch and store operation completed successfully');
  } catch (err) {
    console.error('Error in fetchAndStoreObstacles:', err);
  }
}

/**
 * Main function to fetch and store both airspace and obstacle data
 * @param {Object} pool - Database connection pool
 */
async function fetchAndStoreAll(pool) {
  try {
    await fetchAndStoreAirspaces(pool);
    await fetchAndStoreObstacles(pool);
    console.log('All data fetch and store operations completed successfully');
  } catch (err) {
    console.error('Error in fetchAndStoreAll:', err);
  }
}

/**
 * API function to get obstacles within specified boundaries
 * @param {Object} pool - Database connection pool
 * @param {number} nw_lat - Northwest latitude
 * @param {number} nw_lng - Northwest longitude
 * @param {number} se_lat - Southeast latitude
 * @param {number} se_lng - Southeast longitude
 * @returns {Object} GeoJSON data containing obstacles within boundaries
 */
async function getObstaclesWithinBoundaries(pool, nw_lat, nw_lng, se_lat, se_lng) {
  const client = await pool.connect();
  try {
    // Create a polygon from the boundaries
    const polygon = `POLYGON((
      ${nw_lng} ${nw_lat},
      ${se_lng} ${nw_lat},
      ${se_lng} ${se_lat},
      ${nw_lng} ${se_lat},
      ${nw_lng} ${nw_lat}
    ))`;

    // Query for obstacles that intersect with the polygon
    const result = await client.query(`
      SELECT
        id,
        feature_id,
        name,
        type,
        description,
        stroke_color,
        stroke_weight,
        persistent_id,
        tags,
        max_agl,
        top_amsl,
        country_code,
        fetch_date,
        ST_AsGeoJSON(geometry) as geometry
      FROM
        obstacles
      WHERE
        ST_Intersects(geometry, ST_GeomFromText($1, 4326))
    `, [polygon]);

    // Convert to GeoJSON format
    const features = result.rows.map(row => {
      return {
        type: 'Feature',
        id: row.feature_id,
        geometry: JSON.parse(row.geometry),
        properties: {
          name: row.name,
          type: row.type,
          description: row.description,
          strokeColor: row.stroke_color,
          strokeWeight: row.stroke_weight,
          persistentId: row.persistent_id,
          tags: row.tags,
          maxAgl: row.max_agl,
          topAmsl: row.top_amsl,
          countryCode: row.country_code,
          fetchDate: row.fetch_date
        }
      };
    });

    return {
      type: 'FeatureCollection',
      features: features
    };
  } catch (err) {
    console.error('Error fetching obstacles within boundaries:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Test function for a single country and date
 * @param {Object} pool - Database connection pool
 * @param {number} countryId - The country ID (default is 5)
 */
async function testSingleCountry(pool, countryId = 5) {
  try {
    // Ensure the table exists
    await ensureAirspacesTableExists(pool);
    
    // Get today's date
    const today = new Date();
    const apiDateFormat = formatDateForApi(today);
    const dbDateFormat = formatDateForDb(today);
    
    console.log(`Testing fetch for country ${countryId} on ${dbDateFormat}`);
    
    // Fetch the data
    const geoJsonData = await fetchAirspaceData(countryId, apiDateFormat);
    
    if (geoJsonData && geoJsonData.features) {
      console.log(`Fetched ${geoJsonData.features.length} features`);
      await storeAirspaceData(pool, geoJsonData.features, dbDateFormat, countryId);
      console.log('Test completed successfully');
    } else {
      console.log('No data returned from API');
    }
  } catch (err) {
    console.error('Test failed:', err);
  }
}

/**
 * Test function for a single country obstacle data
 * @param {Object} pool - Database connection pool
 * @param {number} countryId - The country ID (default is 12)
 */
async function testSingleCountryObstacles(pool, countryId = 12) {
  try {
    // Ensure the table exists
    await ensureObstaclesTableExists(pool);
    
    // Get today's date
    const today = new Date();
    const dbDateFormat = formatDateForDb(today);
    
    console.log(`Testing obstacle fetch for country ${countryId} on ${dbDateFormat}`);
    
    // Fetch the data
    const geoJsonData = await fetchObstacleData(countryId);
    
    if (geoJsonData && geoJsonData.features) {
      console.log(`Fetched ${geoJsonData.features.length} obstacle features`);
      await storeObstacleData(pool, geoJsonData.features, dbDateFormat, countryId);
      console.log('Obstacle test completed successfully');
    } else {
      console.log('No obstacle data returned from API');
    }
  } catch (err) {
    console.error('Obstacle test failed:', err);
  }
}

// Export the functions
export { 
  fetchAndStoreAirspaces, 
  fetchAndStoreObstacles, 
  fetchAndStoreAll,
  ensureAirspacesTableExists, 
  ensureObstaclesTableExists,
  fetchAirspaceData, 
  fetchObstacleData,
  storeAirspaceData, 
  storeObstacleData,
  getObstaclesWithinBoundaries,
  testSingleCountry,
  testSingleCountryObstacles
};
// Main execution block
(async () => {
  console.log('Starting update-xc-airspaces script...');
  try {
    await fetchAndStoreAll(pool);
    console.log('update-xc-airspaces script completed successfully.');
  } catch (error) {
    console.error('update-xc-airspaces script failed:', error);
  } finally {
    await pool.end(); // Close the database connection pool
    console.log('Database connection pool closed.');
    process.exit(0); // Exit the process cleanly
  }
})();
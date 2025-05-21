/**
 * OGN APRS Client Module
 * Connects to the Open Glider Network APRS server and processes aircraft data
 */

import net from 'net';
import { EventEmitter } from 'events';
import pkg from 'pg';
import fetch from 'node-fetch';
import iconv from 'iconv-lite'; // Added import
import fs from 'fs'; // Added for CSV logging
import path from 'path'; // Added for CSV path construction
import SrtmElevation from './srtm-elevation.js';
import MapboxElevation from './mapbox-elevation.js';
import * as FlarmnetParser from './flarmnet-parser.js';
import { TrackFilter } from './track-filter.js'; // Import TrackFilter
const { Pool } = pkg;

// Constants
const OGN_HOST = 'aprs.glidernet.org';
const OGN_PORT = 14580;
const OGN_PORT_FULL_FEED = 10152;
// const OGN_FILTER = 'r/48.0/6.0/1500 t/o';  // 1500km radius around Luxembourg, only aircraft
const OGN_FILTER = 'r/48.0/6.0/1500';  // 1500km radius around Luxembourg, only aircraft
const OGN_USER_AGENT = 'XCmaps v1.0';
const CLEANUP_INTERVAL = 3600000; // 1 hour in milliseconds
const DATA_RETENTION_HOURS = 12; // Keep data for 12 hours
const OGN_DDB_URL = 'https://ddb.glidernet.org/download/';
const OGN_DDB_REFRESH_INTERVAL = 86400000; // 24 hours in milliseconds
const FLARMNET_URL = 'https://www.flarmnet.org/static/files/wfn/data.fln';
const FLARMNET_REFRESH_INTERVAL = 86400000; // 24 hours in milliseconds
const PURETRACK_URL = 'https://puretrack.io/api/labels.json';
const PURETRACK_REFRESH_INTERVAL = 86400000; // 24 hours in milliseconds

// --- Pilot Status Calculation Constants ---
const AGL_GROUND_MAX = 20; // Max AGL considered 'on ground' (meters)
const AGL_FLYING_MIN = 30; // Min AGL considered 'flying' (meters)
const SPEED_RESTING_MAX_MS = 1.0; // m/s
const SPEED_HIKING_MAX_MS = 3.0; // m/s
const SPEED_TAKEOFF_MIN_MS = 5.0; // m/s
const SPEED_LANDING_MAX_MS = 4.0; // m/s
const VS_TAKEOFF_MIN = 0.3; // m/s (Optional, can be adjusted/removed)
const VS_LANDING_MAX = -0.3; // m/s (Optional, can be adjusted/removed)
const TIME_WINDOW_TRANSITION_MS = 10000; // 10 seconds
const TIME_WINDOW_LANDING_CONFIRM_MS = 15000; // 15 seconds
const STATUS_HISTORY_SIZE = 10; // Number of recent points for status calculation
// --- End Pilot Status Constants ---
 
// --- Skytraxx Default Location Filter Constants ---
const SKYTRAXX_DEFAULT_LAT = 47.91866666666667;
const SKYTRAXX_DEFAULT_LON = 8.186;
const SKYTRAXX_FILTER_RADIUS_M = 300; // Meters
// --- End Skytraxx Filter Constants ---

// --- Name Logging Constants ---
const NAME_MATCH_LOG_FILE = 'ogn_name_matches.csv';
const nameMatchLogPath = path.resolve(process.cwd(), NAME_MATCH_LOG_FILE);
// --- End Name Logging Constants ---

class OgnAprsClient extends EventEmitter {
  constructor(dbPool) {
    super();
    this.dbPool = dbPool;
    this.socket = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.cleanupTimer = null;
    this.ddbRefreshTimer = null; // Timer for OGN DDB refresh
    this.flarmnetRefreshTimer = null; // Timer for Flarmnet refresh
    this.puretrackRefreshTimer = null; // Timer for PureTrack refresh
    this.lastCleanup = Date.now();
    this.aircraftCache = new Map(); // Cache for current aircraft positions (keep this one)
    this.pilotStatusCache = new Map(); // Cache for pilot status calculation state
    this.flarmnetCache = new Map(); // Cache for Flarmnet data
    this.lastValidTrackCache = new Map(); // Cache for the last valid track point for each aircraft
    this.io = null; // Socket.IO instance (will be set externally)

    // Initialize elevation modules
    this.srtmElevation = new SrtmElevation(dbPool);
    this.mapboxElevation = new MapboxElevation(dbPool);

    // Database initialization and initial data load will be handled separately
  }

  /**
   * Initialize database tables if they don't exist
   */
  async initDatabase() {
    const client = await this.dbPool.connect();
    try {
      await client.query('BEGIN');

      // Create aircraft table if it doesn't exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS aircraft ( -- Use device_id as primary key
          device_id VARCHAR(50) PRIMARY KEY, -- Normalized 6-char ID, increased size for safety
          name VARCHAR(100),
          type SMALLINT,
          callsign VARCHAR(50), -- Store original APRS callsign
          last_seen TIMESTAMP WITH TIME ZONE,
          last_lat DOUBLE PRECISION,
          last_lon DOUBLE PRECISION,
          last_alt_msl INTEGER,
          last_alt_agl INTEGER,
          last_course SMALLINT,
          last_speed_kmh SMALLINT,
          last_vs REAL,
          last_turn_rate SMALLINT,
          raw_packet TEXT, -- Keep raw packet for debugging if needed
          pilot_name VARCHAR(100)
        )
      `);

      // Create tracks table if it doesn't exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS aircraft_tracks (
          id SERIAL PRIMARY KEY,
          aircraft_id VARCHAR(50) REFERENCES aircraft(device_id) ON DELETE CASCADE, -- Reference new PK
          timestamp TIMESTAMP WITH TIME ZONE,
          lat DOUBLE PRECISION,
          lon DOUBLE PRECISION,
          alt_msl INTEGER,
          alt_agl INTEGER,
          course SMALLINT,
          speed_kmh SMALLINT,
          vs REAL,
          turn_rate SMALLINT,
          status VARCHAR(20) -- Added pilot status column
        )
      `);

      // Create index on aircraft_id and timestamp for faster queries
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_aircraft_tracks_device_id ON aircraft_tracks(aircraft_id); -- Index the FK
        CREATE INDEX IF NOT EXISTS idx_aircraft_tracks_timestamp ON aircraft_tracks(timestamp);
      `);

      // Create OGN DDB pilots table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ogn_ddb_pilots (
          device_id VARCHAR(50) PRIMARY KEY,
          device_type VARCHAR(10),
          aircraft_model VARCHAR(100),
          registration VARCHAR(20),
          cn VARCHAR(10),
          tracked BOOLEAN,
          identified BOOLEAN,
          pilot_name VARCHAR(100),
          last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create Flarmnet pilots table (without pilot_name column)
      await client.query(`
        CREATE TABLE IF NOT EXISTS flarmnet_pilots (
          flarm_id VARCHAR(12) PRIMARY KEY,
          registration VARCHAR(20),
          aircraft_type VARCHAR(100),
          -- Assuming max 21 bytes ASCII for home_airfield and 7 for frequency
          home_airfield VARCHAR(100),
          frequency VARCHAR(20),
          last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create PureTrack pilots table
      await client.query(`
        CREATE TABLE IF NOT EXISTS puretrack_pilots (
          hex VARCHAR(12) PRIMARY KEY, -- Assuming hex is the device ID, adjust size if needed
          label VARCHAR(100),         -- Pilot name / label
          puretrack_id INTEGER,       -- PureTrack's internal ID
          puretrack_type SMALLINT,    -- PureTrack's aircraft type
          last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await client.query('COMMIT');
      console.log('OGN database tables (including pilot lookups from OGN, Flarmnet, PureTrack) initialized successfully');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error initializing OGN database tables:', err);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Initializes the database, performs initial data refresh, starts timers, and connects.
   */
  async initializeAndStart() {
    try {
      console.log('Initializing OGN APRS Client...');
      // 1. Initialize database schema
      await this.initDatabase();

      // 1.5 Initialize SRTM elevation database (import is now done via Python script)
      console.log('Initializing SRTM elevation database...');
      await this.srtmElevation.initDatabase();
      console.log('SRTM elevation database initialized. Use scripts/import_srtm.py to import data.');

      // 2. Perform initial pilot data refresh
      console.log('Performing initial pilot data refresh...');
      // Run refresh tasks sequentially to avoid potential lock contention
      console.log('Running OGN DDB refresh...');
      await this.refreshPilotDatabase();
      console.log('OGN DDB refresh complete.');
      console.log('Running Flarmnet refresh...');
      await this.refreshFlarmnetDatabase();
      console.log('Flarmnet refresh complete.');
      console.log('Running PureTrack refresh...');
      await this.refreshPureTrackDatabase(); // Add PureTrack refresh
      console.log('PureTrack refresh complete.');
      console.log('Initial pilot data refresh complete.');

      // 3. Start refresh timers
      console.log('Starting pilot data refresh timers...');
      if (this.ddbRefreshTimer) clearInterval(this.ddbRefreshTimer);
      this.ddbRefreshTimer = setInterval(() => {
        this.refreshPilotDatabase();
      }, OGN_DDB_REFRESH_INTERVAL);

      if (this.flarmnetRefreshTimer) clearInterval(this.flarmnetRefreshTimer);
      this.flarmnetRefreshTimer = setInterval(() => {
        this.refreshFlarmnetDatabase();
      }, FLARMNET_REFRESH_INTERVAL);

      if (this.puretrackRefreshTimer) clearInterval(this.puretrackRefreshTimer); // Add PureTrack timer
      this.puretrackRefreshTimer = setInterval(() => {
        this.refreshPureTrackDatabase();
      }, PURETRACK_REFRESH_INTERVAL);

      console.log('Pilot data refresh timers started.');

      // 4. Connect to APRS server (Re-enabled)
      this.connect();
      console.log('OGN APRS Client initialization complete.');
      // NOTE: Cleanup timer is started within connect()

    } catch (error) {
      console.error('FATAL: Failed to initialize OGN APRS Client:', error);
      // Depending on requirements, you might want to exit or retry here
      throw error; // Re-throw for upstream handling if necessary
    }
  }

  /**
   * NOTE: initPilotDatabase and initFlarmnetDatabase methods removed.
   * Initialization and refresh scheduling are handled by initializeAndStart.
   */

  /**
   * Refresh pilot database from OGN DDB
   */
  async refreshPilotDatabase() {
    let client; // Declare client outside the try block
    try {
      console.log('Refreshing OGN pilot database into DB...');

      // Fetch pilot data from OGN DDB
      const response = await fetch(OGN_DDB_URL, {
        headers: {
          'User-Agent': OGN_USER_AGENT
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch OGN DDB: ${response.status} ${response.statusText}`);
      }

      const data = await response.text();
      console.log(`OGN DDB: Fetched data size: ${data.length} characters.`); // Log data size
      if (data.length < 200) { // Log beginning if small
          console.log(`OGN DDB: Fetched data start: ${data.substring(0, 200)}`);
      }

      // Parse CSV data
      // Format: DEVICE_TYPE,DEVICE_ID,AIRCRAFT_MODEL,REGISTRATION,CN,TRACKED,IDENTIFIED,PILOT_NAME
      const lines = data.split('\n');
      console.log(`OGN DDB: Found ${lines.length} lines in fetched data.`); // Log line count
      client = await this.dbPool.connect();
      console.log("OGN DDB: DB client connected.");

      const batchSize = 1000; // Process 1000 records per transaction
      let processedCount = 0;
      let currentBatchCount = 0;

      await client.query('BEGIN'); // Start the first transaction
      console.log("OGN DDB: DB transaction started (Batch 1).");

      // Skip header line (index 0)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length === 0) continue;


        const fields = line.split(',');
        // Allow lines with 7 or 8 fields. Pilot name (8th field) might be missing.
        if (fields.length < 7) { // Check for at least 7 fields now
            if (i < 5) { // Log first few skipped lines
                 console.log(`OGN DDB: Skipping line ${i+1} due to insufficient fields (${fields.length}): ${line}`);
            }
            continue;
        }

        // Destructure carefully, pilotName might be undefined if fields.length is 7
        let [deviceType, deviceId, aircraftModel, registration, cn, trackedStr, identifiedStr] = fields;
        let pilotName = fields.length >= 8 ? fields[7] : null; // Assign null if 8th field is missing

        // Clean potential apostrophes from deviceId and registration
        if (deviceId && deviceId.startsWith("'") && deviceId.endsWith("'")) {
          deviceId = deviceId.substring(1, deviceId.length - 1);
        }
        if (registration && registration.startsWith("'") && registration.endsWith("'")) {
          registration = registration.substring(1, registration.length - 1);
        }
        // Also clean pilotName just in case
        if (pilotName && pilotName.startsWith("'") && pilotName.endsWith("'")) {
           pilotName = pilotName.substring(1, pilotName.length - 1);
        }

        if (i < 5) { // Log first few processed lines
            console.log(`OGN DDB: Processing line ${i+1}: Cleaned ID=${deviceId}, Cleaned Reg=${registration}, Name=${pilotName || '[None]'}`);
        }

        // Basic validation (deviceId is field 2, index 1)
        if (!deviceId || deviceId.length === 0) continue;

        const tracked = trackedStr === 'Y';
        const identified = identifiedStr === 'Y';

        // Insert or update the pilot data in the database
        const query = `
          INSERT INTO ogn_ddb_pilots (device_id, device_type, aircraft_model, registration, cn, tracked, identified, pilot_name, last_updated)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          ON CONFLICT (device_id) DO UPDATE SET
            device_type = EXCLUDED.device_type,
            aircraft_model = EXCLUDED.aircraft_model,
            registration = EXCLUDED.registration,
            cn = EXCLUDED.cn,
            tracked = EXCLUDED.tracked,
            identified = EXCLUDED.identified,
            pilot_name = EXCLUDED.pilot_name,
            last_updated = NOW();
        `;
        // Use cleaned values in the query
        await client.query(query, [deviceId, deviceType, aircraftModel, registration, cn, tracked, identified, pilotName || null]);
        processedCount++;
        currentBatchCount++;

        // Commit batch and start new transaction if batch size is reached
        if (currentBatchCount >= batchSize && i < lines.length - 1) {
          await client.query('COMMIT');
          console.log(`OGN DDB: Committed batch ending at line ${i+1} (${processedCount} total processed).`);
          await client.query('BEGIN');
          console.log(`OGN DDB: DB transaction started (Next Batch).`);
          currentBatchCount = 0; // Reset batch counter
        }
      }

      // Commit any remaining records in the last batch
      if (currentBatchCount > 0) {
        console.log("OGN DDB: Loop finished. Attempting final COMMIT.");
        await client.query('COMMIT');
        console.log(`OGN DDB: Final COMMIT successful. Loaded ${processedCount} valid records in total.`);
      } else {
         console.log("OGN DDB: Loop finished. No final commit needed.");
      }

    } catch (err) {
      // Log error with more context
      console.error('Error refreshing OGN pilot database:', err); // Consider adding line number/record ID if possible
      if (client) {
        await client.query('ROLLBACK'); // Rollback transaction on error
      }
    } finally {
      if (client) {
        client.release(); // Ensure client is always released
      }
    }
  }

  /**
   * Refresh Flarmnet database by fetching hex-encoded text file and parsing
   */
  async refreshFlarmnetDatabase() {
    try {
      console.log('Refreshing Flarmnet database...');
      const response = await fetch(FLARMNET_URL, {
        headers: { 'User-Agent': OGN_USER_AGENT }
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch Flarmnet database: ${response.status} ${response.statusText}`);
      }
      // Fetch as text, assuming hex-encoded lines
      const hexData = await response.text();
      // Pass the raw hex string data to the parser
      this.parseFlarmnetData(hexData);
      console.log(`Flarmnet database refresh initiated (parsing happens next).`);
    } catch (err) {
      console.error('Error refreshing Flarmnet database:', err);
    }
  }

  /**
   * Refresh pilot database from PureTrack API
   */
  async refreshPureTrackDatabase() {
    let client;
    try {
      console.log('Refreshing PureTrack pilot database into DB...');
      const response = await fetch(PURETRACK_URL, {
        headers: { 'User-Agent': OGN_USER_AGENT }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch PureTrack labels: ${response.status} ${response.statusText}`);
      }

      const data = await response.json(); // Expecting JSON data
      console.log(`PureTrack: Fetched ${data.length} records.`);

      if (!Array.isArray(data)) {
        throw new Error('PureTrack data is not an array.');
      }

      client = await this.dbPool.connect();
      console.log("PureTrack: DB client connected.");

      const batchSize = 1000; // Process 1000 records per transaction
      let processedCount = 0;
      let currentBatchCount = 0;

      await client.query('BEGIN'); // Start the first transaction
      console.log("PureTrack: DB transaction started (Batch 1).");

      for (let i = 0; i < data.length; i++) {
        const record = data[i];
        // Validate required fields
        if (!record || typeof record.hex !== 'string' || record.hex.length === 0) {
          console.warn(`PureTrack: Skipping invalid record at index ${i}:`, record);
          continue;
        }

        const hexId = record.hex.toUpperCase(); // Standardize hex ID
        const label = record.label || null;
        const puretrackId = record.id || null;
        const puretrackType = record.type || null;

        const query = `
          INSERT INTO puretrack_pilots (hex, label, puretrack_id, puretrack_type, last_updated)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (hex) DO UPDATE SET
            label = EXCLUDED.label,
            puretrack_id = EXCLUDED.puretrack_id,
            puretrack_type = EXCLUDED.puretrack_type,
            last_updated = NOW();
        `;
        await client.query(query, [hexId, label, puretrackId, puretrackType]);
        processedCount++;
        currentBatchCount++;

        if (processedCount <= 5) { // Log first few processed records
          console.log(`PureTrack: Processing record ${i}: HEX=${hexId}, Label=${label}`);
        }

        // Commit batch and start new transaction if batch size is reached
        if (currentBatchCount >= batchSize && i < data.length - 1) {
          await client.query('COMMIT');
          console.log(`PureTrack: Committed batch ending at record ${i} (${processedCount} total processed).`);
          await client.query('BEGIN');
          console.log(`PureTrack: DB transaction started (Next Batch).`);
          currentBatchCount = 0; // Reset batch counter
        }
      }

      // Commit any remaining records in the last batch
      if (currentBatchCount > 0) {
        console.log("PureTrack: Loop finished. Attempting final COMMIT.");
        await client.query('COMMIT');
        console.log(`PureTrack: Final COMMIT successful. Loaded ${processedCount} valid records in total.`);
      } else {
         console.log("PureTrack: Loop finished. No final commit needed.");
      }

    } catch (err) {
      // Log error with more context
      console.error('Error refreshing PureTrack pilot database:', err); // Consider adding index if possible
      if (client) {
        await client.query('ROLLBACK');
      }
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  /**
   * Parse Flarmnet data provided as a single string containing hex-encoded lines,
   * using logic derived from the provided example script with iconv-lite.
   * @param {string} hexData - String containing lines of hex-encoded Flarmnet records.
   */
  async parseFlarmnetData(hexData) {
    let client;
    let currentRecordIndex = -1;
    let currentFlarmId = 'N/A';

    try {
      console.log('Flarmnet: Starting to parse data using the new parser...');

      // Use the FlarmnetParser to decode the data
      const parsedData = FlarmnetParser.decode(hexData);
      const records = parsedData.records;

      console.log(`Flarmnet: Successfully parsed ${records.length} records. Processing into DB in batches...`);

      client = await this.dbPool.connect();
      console.log("Flarmnet: DB client connected.");

      const batchSize = 1000; // Process 1000 records per transaction
      let processedCount = 0;
      let currentBatchCount = 0;

      await client.query('BEGIN'); // Start the first transaction
      console.log("Flarmnet: DB transaction started (Batch 1).");

      for (let i = 0; i < records.length; i++) {
        currentRecordIndex = i;
        const record = records[i];

        // Skip invalid records
        if (!record) continue;

        // Extract fields from the record
        currentFlarmId = record.id;
        // We don't use pilot name anymore
        const homeAirfield = record.airfield;
        const aircraftType = record.plane_type;
        const registration = record.registration;
        const frequency = record.frequency;

        // Log for debugging
        if (i < 10) {
          console.log(`Flarmnet DEBUG Record ${i}: ID='${currentFlarmId}', Reg='${registration || '[null]'}', Type='${aircraftType || '[null]'}'`);
        }

        // Skip records with invalid FLARM ID
        if (!currentFlarmId || currentFlarmId === '000000') {
          if (i < 10) console.log(`Flarmnet SKIPPING Record ${i} (ID: ${currentFlarmId || 'null'}) due to invalid ID.`);
          continue;
        }

        // Add registration to the cache if available
        if (registration) {
          this.flarmnetCache.set(currentFlarmId, registration);
        }

        // Log successful inserts
        if (processedCount < 10) {
          console.log(`Flarmnet INSERTING Record ${i}: FLARM ID: ${currentFlarmId}, Reg: ${registration || '[None]'}, Type: ${aircraftType || '[None]'}`);
        }

        // Insert into database (without pilot_name)
        const query = `
          INSERT INTO flarmnet_pilots (flarm_id, registration, aircraft_type, home_airfield, frequency, last_updated)
          VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (flarm_id) DO UPDATE SET
            registration = EXCLUDED.registration,
            aircraft_type = EXCLUDED.aircraft_type,
            home_airfield = EXCLUDED.home_airfield,
            frequency = EXCLUDED.frequency,
            last_updated = NOW();
        `;

        await client.query(query, [currentFlarmId, registration, aircraftType, homeAirfield, frequency]);
        processedCount++;
        currentBatchCount++;

        // Commit batch and start new transaction if batch size is reached
        if (currentBatchCount >= batchSize && i < records.length - 1) {
          await client.query('COMMIT');
          console.log(`Flarmnet: Committed batch ending at record ${i} (${processedCount} total processed).`);
          await client.query('BEGIN');
          console.log(`Flarmnet: DB transaction started (Next Batch).`);
          currentBatchCount = 0; // Reset batch counter
        }
      }

      // Commit any remaining records in the last batch
      if (currentBatchCount > 0) {
        console.log("Flarmnet: Loop finished. Attempting final COMMIT.");
        await client.query('COMMIT');
        console.log(`Flarmnet: Final COMMIT successful. Loaded ${processedCount} valid records in total.`);
      } else {
        console.log("Flarmnet: Loop finished. No final commit needed.");
      }
    } catch (err) {
      // Log error with more context, including which record failed
      console.error(`Error parsing Flarmnet data around record index ${currentRecordIndex} (FLARM ID: ${currentFlarmId}):`, err);
      if (client) {
        console.error("Flarmnet: Attempting ROLLBACK due to error.");
        await client.query('ROLLBACK');
        console.error("Flarmnet: ROLLBACK successful.");
      }
    } finally {
      if (client) {
        console.log("Flarmnet: Releasing DB client.");
        client.release();
        console.log("Flarmnet: DB client released.");
      }
    }
  }

  /**
   * Look up pilot name from device ID
   * @param {string} deviceId - Device ID
   * @returns {string} - Pilot name found from sources, or the deviceId itself if not found.
   */
  async lookupPilotName(deviceId) {
    let client;
    try {
      client = await this.dbPool.connect();

      // First check the OGN DDB table
      // First check the OGN DDB table for registration
      let result = await client.query(
        'SELECT registration FROM ogn_ddb_pilots WHERE device_id = $1', // Select registration
        [deviceId]
      );
      if (result.rows.length > 0) { // Check if OGN record exists
        // Prioritize OGN registration, return it even if null/empty
        // console.log(`Pilot lookup (OGN): ID=${deviceId}, Registration=${result.rows[0].registration}`);
        return result.rows[0].registration; // Return registration from OGN DDB
      }
      // If no OGN record found, continue to other sources...

      // Then check the Flarmnet table (assuming deviceId might be a Flarm ID)
      // Flarm IDs can be of various formats, ensure uppercase for consistency
      const potentialFlarmId = deviceId.toUpperCase();
      // Always try to look up in Flarmnet table regardless of format

      // Try the specific lookup
      result = await client.query(
        'SELECT registration, aircraft_type FROM flarmnet_pilots WHERE flarm_id = $1',
        [potentialFlarmId]
      );

      // If no results, try with a wildcard search to see if similar IDs exist
      if (result.rows.length === 0) {
        const wildcardResult = await client.query(
          "SELECT flarm_id FROM flarmnet_pilots WHERE flarm_id LIKE $1 LIMIT 5",
          [potentialFlarmId.substring(0, 2) + '%']
        );
      }
      if (result.rows.length > 0) {
        const { registration, aircraft_type } = result.rows[0];

        // If registration is available, use it
        if (registration) {
          let pilotInfo = registration.trim();
          const typeTrimmed = aircraft_type?.trim();
          if (typeTrimmed) {
            pilotInfo += ` (${typeTrimmed})`;
          }
          return pilotInfo;
        }

        // If registration is null but aircraft_type is available, use aircraft_type
        if (aircraft_type) {
          return aircraft_type.trim();
        }

        // If all fields are null, return the deviceId
        return deviceId;
      }

      // Finally, check the PureTrack table (using deviceId as hex)
      const potentialHexId = deviceId.toUpperCase(); // PureTrack uses uppercase hex
      result = await client.query(
        'SELECT label FROM puretrack_pilots WHERE hex = $1 AND label IS NOT NULL AND label != \'\'',
        [potentialHexId]
      );
      if (result.rows.length > 0 && result.rows[0].label) {
        return result.rows[0].label; // Return the label directly
      }

      // If not found in any table, return the original deviceId as fallback
      // console.log(`Pilot name not found for deviceId ${deviceId}, returning ID as name.`);
      return deviceId;
    } catch (err) {
      console.error(`Error looking up pilot name in DB for deviceId ${deviceId}:`, err);
      return deviceId; // Return deviceId on error as well
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  /**
   * Connect to the OGN APRS server
   */
  connect() {
    if (this.connected) return;
    // consoloe.log with filter 
    // console.log(`Connecting to OGN APRS server ${OGN_HOST}:${OGN_PORT}...`);
    // consoloe.log without filter 
    console.log(`Connecting to OGN APRS server ${OGN_HOST}:${OGN_PORT_FULL_FEED}...`);

    this.socket = new net.Socket();

    this.socket.on('connect', () => {
      console.log('Connected to OGN APRS server');
      this.connected = true;

      // Send login command with filter
      // const loginCommand = `user XCmaps pass -1 vers ${OGN_USER_AGENT} filter ${OGN_FILTER}\r\n`;
      // Send login command without filter
      const loginCommand = `user XCmaps pass -1 vers ${OGN_USER_AGENT}\n`;
      this.socket.write(loginCommand);

      // Start cleanup timer
      this.startCleanupTimer();
    });

    this.socket.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim().length > 0) {
          this.processAprsData(line.trim());
        }
      }
    });

    this.socket.on('error', (err) => {
      console.error('OGN APRS socket error:', err);
      this.disconnect();
      this.scheduleReconnect();
    });

    this.socket.on('close', () => {
      console.log('Connection to OGN APRS server closed');
      this.connected = false;
      this.scheduleReconnect();
    });

    this.socket.connect(OGN_PORT_FULL_FEED, OGN_HOST);
  }

  /**
   * Disconnect from the OGN APRS server
   */
  disconnect() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    this.connected = false;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.ddbRefreshTimer) {
      clearInterval(this.ddbRefreshTimer);
      this.ddbRefreshTimer = null;
    }

    if (this.flarmnetRefreshTimer) {
      clearInterval(this.flarmnetRefreshTimer);
      this.flarmnetRefreshTimer = null;
    }

    if (this.puretrackRefreshTimer) { // Add PureTrack timer clearing
      clearInterval(this.puretrackRefreshTimer);
      this.puretrackRefreshTimer = null;
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      console.log('Attempting to reconnect to OGN APRS server...');
      this.connect();
    }, 30000); // Try to reconnect after 30 seconds
  }

  /**
   * Start the cleanup timer to remove old data
   */
  startCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupOldData();
    }, CLEANUP_INTERVAL);
  }

  /**
   * Clean up old data from the database
   */
  async cleanupOldData() {
    console.log('Running OGN data cleanup...');
    let client; // Define client here to ensure it's accessible in finally
    try {
      client = await this.dbPool.connect();

      const cutoffTime = new Date(Date.now() - (DATA_RETENTION_HOURS * 3600000));

      // Delete old track points
      await client.query(`
        DELETE FROM aircraft_tracks
        WHERE timestamp < $1
      `, [cutoffTime]);
 
      // Optionally, delete aircraft records not seen recently (be careful with this)
      // Schema is now using device_id as primary key, but the query remains the same
      // await client.query(`
      //   DELETE FROM aircraft
      //   WHERE last_seen < $1
      // `, [cutoffTime]);
 
      console.log(`Cleanup: Deleted tracks older than ${cutoffTime.toISOString()}`);
      // console.log('OGN data cleanup completed'); // Removed duplicate log
      this.lastCleanup = Date.now();
    } catch (err) {
      console.error('Error during old data cleanup:', err);
    } finally {
      if (client) {
        client.release();
      }
    }
  } // End of cleanupOldData method
 
  /**
   * Calculates the pilot status based on the latest track point and historical data.
   * Manages the in-memory state cache for each aircraft.
   * @param {string} aircraftId - The ID of the aircraft.
   * @param {object} newPointData - The latest track point data containing { timestamp, alt_agl, speed_kmh, vs }.
   * @returns {Promise<string>} The calculated pilot status (e.g., 'resting', 'flying').
   */
  async _calculatePilotStatus(aircraftId, newPointData) {
    // --- 1. Prepare New Point Data ---
    if (newPointData.alt_agl === null || newPointData.speed_kmh === null || newPointData.vs === null) {
      // Cannot calculate status without essential data
      // Return previous status from cache if available, otherwise 'unknown'
      const cachedState = this.pilotStatusCache.get(aircraftId);
      return cachedState ? cachedState.currentStatus : 'unknown';
    }
    const currentTimestamp = new Date(newPointData.timestamp).getTime();
    const currentSpeedMS = newPointData.speed_kmh / 3.6;
    const currentPoint = {
      timestampMs: currentTimestamp,
      alt_agl: newPointData.alt_agl,
      speed_ms: currentSpeedMS,
      vs: newPointData.vs
    };

    // --- 2. Get or Initialize Aircraft State from Cache ---
    let state = this.pilotStatusCache.get(aircraftId);
    if (!state) {
      // State not in cache, fetch recent history from DB to initialize
      console.log(`Status cache miss for ${aircraftId}. Initializing from DB...`);
      let client; // Define client within this scope
      try {
        client = await this.dbPool.connect(); // Connect here
        const historyRes = await client.query(
          `SELECT timestamp, alt_agl, speed_kmh, vs, status
           FROM aircraft_tracks
           WHERE aircraft_id = $1 AND alt_agl IS NOT NULL AND speed_kmh IS NOT NULL AND vs IS NOT NULL
           ORDER BY timestamp DESC
           LIMIT $2`,
          [aircraftId, STATUS_HISTORY_SIZE]
        );
        // Initialize state
        state = {
          currentStatus: 'unknown', // Default if no history
          recentPoints: [],
          landingConfirmationStart: null
        };
        if (historyRes.rows.length > 0) {
          // Reverse rows to be in chronological order
          const historyRows = historyRes.rows.reverse();
          state.currentStatus = historyRows[historyRows.length - 1].status || 'unknown'; // Use last known status
          state.recentPoints = historyRows.map(r => ({
            timestampMs: new Date(r.timestamp).getTime(),
            alt_agl: r.alt_agl,
            speed_ms: r.speed_kmh / 3.6,
            vs: r.vs
          }));
        }
        console.log(`Initialized status for ${aircraftId} to ${state.currentStatus} with ${state.recentPoints.length} historical points.`);
      } catch (dbError) {
        console.error(`Error fetching status history for ${aircraftId}:`, dbError);
        // Proceed with default empty state if DB query fails
        state = { currentStatus: 'unknown', recentPoints: [], landingConfirmationStart: null };
      } finally {
        if (client) client.release(); // Release client if connected
      }
    }

    // --- 3. Update Recent Points History ---
    state.recentPoints.push(currentPoint);
    if (state.recentPoints.length > STATUS_HISTORY_SIZE) {
      state.recentPoints.shift(); // Remove oldest point
    }

    // --- 4. Calculate Trends from History ---
    let nextStatus = state.currentStatus; // Assume status doesn't change
    const relevantHistory = state.recentPoints.filter(p => currentTimestamp - p.timestampMs <= TIME_WINDOW_TRANSITION_MS);
    let avgSpeed = 0;
    let altChange = 0;
    let avgVs = 0;
    let isConsistentlyAboveGround = false;
    let isConsistentlyBelowGround = false;

    if (relevantHistory.length >= 2) {
        const first = relevantHistory[0];
        const last = relevantHistory[relevantHistory.length - 1];
        // const timeDeltaS = (last.timestampMs - first.timestampMs) / 1000; // timeDeltaS not used currently
        avgSpeed = relevantHistory.reduce((sum, p) => sum + p.speed_ms, 0) / relevantHistory.length;
        altChange = last.alt_agl - first.alt_agl;
        avgVs = relevantHistory.reduce((sum, p) => sum + p.vs, 0) / relevantHistory.length;
        isConsistentlyAboveGround = relevantHistory.every(p => p.alt_agl > AGL_GROUND_MAX);
        isConsistentlyBelowGround = relevantHistory.every(p => p.alt_agl < AGL_GROUND_MAX);
    } else if (relevantHistory.length === 1) {
        avgSpeed = relevantHistory[0].speed_ms;
        avgVs = relevantHistory[0].vs;
        isConsistentlyAboveGround = relevantHistory[0].alt_agl > AGL_GROUND_MAX;
        isConsistentlyBelowGround = relevantHistory[0].alt_agl < AGL_GROUND_MAX;
    }


    // --- 5. State Machine Logic ---
    const currentAgl = currentPoint.alt_agl;

    if (state.currentStatus === 'flying') {
        // Check for Landing: Low AGL, low speed
        if (currentAgl < AGL_GROUND_MAX && currentSpeedMS < SPEED_LANDING_MAX_MS /* && avgVs < VS_LANDING_MAX */) {
            nextStatus = 'landed';
            state.landingConfirmationStart = currentTimestamp;
        }
    } else if (state.currentStatus === 'landed') {
        // Check if landing confirmed (stationary for duration)
        if (currentSpeedMS < SPEED_RESTING_MAX_MS && state.landingConfirmationStart && (currentTimestamp - state.landingConfirmationStart >= TIME_WINDOW_LANDING_CONFIRM_MS)) {
            nextStatus = 'resting';
            state.landingConfirmationStart = null;
        } else if (currentSpeedMS >= SPEED_RESTING_MAX_MS) {
            // Moved before confirmation timer elapsed, reset timer and determine ground status
            state.landingConfirmationStart = null;
            if (currentSpeedMS < SPEED_HIKING_MAX_MS) nextStatus = 'hiking';
            else nextStatus = 'driving';
        }
        // Check for immediate Takeoff after landing?
        else if (currentAgl > AGL_GROUND_MAX && currentSpeedMS > SPEED_TAKEOFF_MIN_MS /* && avgVs > VS_TAKEOFF_MIN */) {
             nextStatus = 'started';
             state.landingConfirmationStart = null;
        }
        // Else: Remain 'landed' while timer runs
    } else if (state.currentStatus === 'started') {
        // Check for Confirmed Flying: Consistently above min flying AGL
        if (currentAgl > AGL_FLYING_MIN && isConsistentlyAboveGround) {
             nextStatus = 'flying';
        }
        // Check if Takeoff Aborted (back below ground AGL)
        else if (currentAgl < AGL_GROUND_MAX) {
            if (currentSpeedMS < SPEED_RESTING_MAX_MS) nextStatus = 'resting';
            else if (currentSpeedMS < SPEED_HIKING_MAX_MS) nextStatus = 'hiking';
            else nextStatus = 'driving';
        }
        // Else: Remain 'started'
    } else { // Initial state ('unknown') or Ground states ('resting', 'hiking', 'driving')
        // Check for Takeoff: Sustained speed > takeoff min AND AGL increasing above ground max
        const takeoffSpeedCondition = relevantHistory.length > 1 && relevantHistory.every(p => p.speed_ms > SPEED_TAKEOFF_MIN_MS);
        const takeoffAltCondition = currentAgl > AGL_GROUND_MAX && altChange > 0; // Current AGL and positive trend
        // const takeoffVsCondition = avgVs > VS_TAKEOFF_MIN; // Optional

        if (takeoffSpeedCondition && takeoffAltCondition /* && takeoffVsCondition */) {
            nextStatus = 'started';
        } else if (currentAgl < AGL_GROUND_MAX) {
            // Update Ground Status based on current speed
            if (currentSpeedMS < SPEED_RESTING_MAX_MS) nextStatus = 'resting';
            else if (currentSpeedMS < SPEED_HIKING_MAX_MS) nextStatus = 'hiking';
            else nextStatus = 'driving';
        } else {
            // This block is entered if:
            // 1. Current status is 'unknown', 'resting', 'hiking', or 'driving'.
            // 2. Explicit takeoff conditions (speed & alt change trend) were NOT met.
            // 3. Current AGL is >= AGL_GROUND_MAX.

            // User requirement: only transition from ground to flying if AGL is above ground max
            // AND speed_kmh > 5 (which is 5/3.6 m/s).
            const MIN_SPEED_FOR_GROUND_TO_FLYING_MS = 5 / 3.6; // 5 km/h

            if (currentSpeedMS > MIN_SPEED_FOR_GROUND_TO_FLYING_MS) {
                // AGL is already >= AGL_GROUND_MAX (due to how we entered this block)
                // and speed condition is met.
                nextStatus = 'flying';
            } else {
                // AGL is >= AGL_GROUND_MAX, but speed is too low to transition to flying from a ground state.
                // Remain in the current ground/unknown state.
                nextStatus = state.currentStatus; // This correctly refers to the ground/unknown state
            }
        }
    }

    // --- 5.5 Check for status transition and delete old tracks ---
    const previousStatus = state.currentStatus; // Capture status before it's updated to nextStatus

    if (
      (previousStatus === 'resting' || previousStatus === 'hiking' || previousStatus === 'driving') &&
      nextStatus === 'flying'
    ) {
      console.log(`Aircraft ${aircraftId} transitioned from ${previousStatus} to flying. Attempting to delete old ground tracks.`);
      let deleteClient;
      try {
        deleteClient = await this.dbPool.connect();
        const deleteQuery = `
          DELETE FROM aircraft_tracks
          WHERE aircraft_id = $1
            AND status IN ('resting', 'hiking', 'driving')
            AND timestamp < NOW() - INTERVAL '10 minutes';
        `;
        const deleteResult = await deleteClient.query(deleteQuery, [aircraftId]);
        console.log(`Deleted ${deleteResult.rowCount} old ground tracks for ${aircraftId} (status: ${previousStatus} -> flying).`);
      } catch (deleteError) {
        console.error(`Error deleting old ground tracks for ${aircraftId} (status: ${previousStatus} -> flying):`, deleteError);
      } finally {
        if (deleteClient) deleteClient.release();
      }
    }

    // --- 6. Update Cache and Return Status ---
    state.currentStatus = nextStatus;
    this.pilotStatusCache.set(aircraftId, state); // Save updated state back to cache
    return nextStatus;
  } // End of _calculatePilotStatus method

  /**
   * Check if a device ID corresponds to an eligible aircraft type (Paraglider/Hang-glider)
   * based on ogn_ddb_pilots and flarmnet_pilots tables.
   * @param {string} deviceId - The device ID to check.
   * @returns {Promise<string>} - 'ELIGIBLE', 'INELIGIBLE', or 'UNKNOWN'
   */
  async checkDeviceEligibility(deviceId) {
    if (!deviceId) {
      return 'UNKNOWN'; // Cannot check eligibility without an ID
    }

    let client;
    try {
      client = await this.dbPool.connect();

      // Check OGN DDB
      const ognResult = await client.query(
        `SELECT aircraft_model FROM ogn_ddb_pilots WHERE UPPER(device_id) = UPPER($1)`, // Case-insensitive check
        [deviceId]
      );

      if (ognResult.rows.length > 0) {
        const model = ognResult.rows[0].aircraft_model;
        if (model && (model.toLowerCase() === 'paraglider' || model.toLowerCase() === 'hangglider')) {
          // console.log(`Device ${deviceId} ELIGIBLE via OGN DDB (Model: ${model})`);
          return 'ELIGIBLE';
        } else {
          // console.log(`Device ${deviceId} INELIGIBLE via OGN DDB (Model: ${model})`);
          return 'INELIGIBLE'; // Found but not the right type
        }
      }

      // Check Flarmnet (case-insensitive LIKE for type)
      // Flarm IDs are typically uppercase, but let's ensure the query uses the correct case from the DB if needed.
      // Assuming flarm_id in the DB is stored consistently (e.g., uppercase).
      const flarmResult = await client.query(
        `SELECT aircraft_type FROM flarmnet_pilots WHERE flarm_id = $1`,
        [deviceId.toUpperCase()] // Match against uppercase ID
      );

      if (flarmResult.rows.length > 0) {
        const type = flarmResult.rows[0].aircraft_type;
        if (type && (type.toLowerCase().includes('hang') || type.toLowerCase().includes('paraglider') || type.toLowerCase().includes('gleitschirm'))) {
          // console.log(`Device ${deviceId} ELIGIBLE via Flarmnet (Type: ${type})`);
          return 'ELIGIBLE';
        } else {
          // console.log(`Device ${deviceId} INELIGIBLE via Flarmnet (Type: ${type})`);
          return 'INELIGIBLE'; // Found but not the right type
        }
      }

      // Not found in either table
      // console.log(`Device ${deviceId} UNKNOWN (not found in DDB or Flarmnet)`);
      return 'UNKNOWN';

    } catch (err) {
      console.error(`Error checking device eligibility for ${deviceId}:`, err);
      return 'UNKNOWN'; // Treat errors as unknown to be safe
    } finally {
      if (client) {
        client.release();
      }
    }
  } // End of checkDeviceEligibility


  /**
   * Process APRS data line
   * @param {string} line - APRS data line
   */
  async processAprsData(line) {
    // --- Handle OGN Status Messages ---
    if (line.includes('>OGNFNT,qAS,') && line.includes('Name="')) {
      try {
        // Correctly extract sender callsign and then the device ID (last 6 chars)
        const senderMatch = line.match(/^([^>]+)>/);
        const nameMatch = line.match(/Name="([^"]+)"/);

        if (senderMatch && senderMatch[1] && senderMatch[1].length >= 6 && nameMatch) {
          const senderCallsign = senderMatch[1];
          // Extract the last 6 characters as the potential device ID
          const deviceId = senderCallsign.substring(senderCallsign.length - 6).toUpperCase();
          const aprsName = nameMatch[1].trim(); // Trim whitespace from name

          // Add a check to ensure the extracted ID looks like a hex ID (optional but good practice)
          if (!/^[A-F0-9]{6}$/.test(deviceId)) {
             console.warn(`Extracted potential device ID "${deviceId}" from sender "${senderCallsign}" doesn't look like a 6-char hex ID. Skipping status update for line: ${line}`);
             return; // Skip if the extracted ID is not a 6-char hex
          }

          // Log the extracted info for debugging
          console.log(`Processing status message: Sender = ${senderCallsign}, Device ID = ${deviceId}, APRS Name = ${aprsName}`);

          const client = await this.dbPool.connect();
          try {
            // Use INSERT ... ON CONFLICT (Upsert) to handle both new and existing devices
            const upsertQuery = `
              INSERT INTO aircraft (device_id, name, aprs_name, last_seen)
              VALUES ($1, $2, $2, NOW()) -- Insert device_id and name/aprs_name, set last_seen
              ON CONFLICT (device_id) DO UPDATE SET
                name = EXCLUDED.name,
                aprs_name = EXCLUDED.aprs_name,
                last_seen = NOW(); -- Update names and last_seen timestamp
            `;
            // We use aprsName ($2) for both name and aprs_name columns here
            const result = await client.query(upsertQuery, [deviceId, aprsName]);

            // Optional: Log the action (Insert or Update) - result.command might indicate this
            // console.log(`Upserted name/aprs_name for ${deviceId} to "${aprsName}". Command: ${result.command}`);

          } finally {
            client.release();
          }
          return; // Status message processed, no further action needed for this line
        } else {
          console.warn(`Could not extract device ID or name from status message: ${line}`);
        }
      } catch (err) {
        console.error(`Error processing OGN status message: ${line}`, err);
      }
      // Even if there's an error processing as status, might still be a regular packet?
      // Decide if we should return here or let it fall through. Returning for now.
      return;
    }
    // --- End Handle OGN Status Messages ---


    // --- Name Logging Check (Moved down, might still be useful for other name formats) ---
    if (line.includes('MaK') || line.includes('1988')) { // Keep this check for general logging if needed
      try {
        // Append the raw packet line to the CSV file
        fs.appendFileSync(nameMatchLogPath, line + '\n');
        // console.log(`Logged packet containing 'Gregor' or 'Name=' to ${NAME_MATCH_LOG_FILE}: ${line}`); // Adjusted log message
      } catch (err) {
        console.error(`Error writing to ${NAME_MATCH_LOG_FILE}:`, err);
      }
    }
    // --- End Name Logging Check ---

    try { // Start of try block for processAprsData
      // Skip server messages and comments
      if (line.startsWith('#') || line.startsWith('>')) {
        return;
      }

      // Early filter for ICAO aircraft based on callsign (redundant with parseAprsPacket but safe)
      if (line.startsWith('ICA')) {
        return;
      }

      // Parse APRS packet (now async)
      const parsedData = await this.parseAprsPacket(line);

      if (!parsedData) {
        // console.log(`Skipping invalid packet: ${line}`);
        return; // Skip invalid packets
      }

      // --- Blacklist Check ---
      if (parsedData.deviceId) {
        let client;
        try {
          client = await this.dbPool.connect();
          const blacklistCheck = await client.query(
            'SELECT 1 FROM aprs_blacklist WHERE device_id = $1',
            [parsedData.deviceId]
          );
          if (blacklistCheck.rows.length > 0) {
            console.log(`Device ${parsedData.deviceId} is blacklisted, skipping processing.`);
            return; // Device is blacklisted, stop processing
          }
        } catch (err) {
          console.error(`Error checking blacklist for device ${parsedData.deviceId}:`, err);
          // Continue processing even if blacklist check fails, to avoid dropping valid data on DB error
        } finally {
          if (client) {
            client.release();
          }
        }
      }
      // --- End Blacklist Check ---

      // Check for RND prefix in callsign (device ID); random ID devices are not eligible
      // The 'callsign' field from parseAprsPacket holds the sender ID.
      if (parsedData.callsign && parsedData.callsign.startsWith('RND')) {
        console.log(`OGN: Dropping packet from RND device: ${parsedData.callsign}`);
        return; // Skip processing this packet
      }

      // --- New Eligibility Check ---
      let storeData = false;
      if (parsedData.deviceId) {
        const eligibility = await this.checkDeviceEligibility(parsedData.deviceId);
        if (eligibility === 'ELIGIBLE') {
          // console.log(`Device ${parsedData.deviceId} is ELIGIBLE, storing.`);
          storeData = true; // Found and is PG/HG
        } else if (eligibility === 'INELIGIBLE') {
          // console.log(`Device ${parsedData.deviceId} is INELIGIBLE, dropping packet.`);
          return; // Found but NOT PG/HG, drop packet
        } else { // eligibility === 'UNKNOWN'
          // console.log(`Device ${parsedData.deviceId} is UNKNOWN, checking aircraft type.`);
          // Not found in DB, fall back to checking aircraft type from packet (now improved with sFx check)
          const allowedTypes = [3, 6, 7]; // Helicopter, Hang-Glider, Para-glider
          if (allowedTypes.includes(parsedData.aircraftType)) {
            // console.log(`Unknown device ${parsedData.deviceId} has allowed type ${parsedData.aircraftType}, storing.`);
            storeData = true;
          } else {
            // console.log(`Unknown device ${parsedData.deviceId} has disallowed type ${parsedData.aircraftType}, dropping.`);
            return; // Unknown device, disallowed type
          }
        }
      } else {
        // No deviceId in packet, fall back to checking aircraft type
        // console.log(`No deviceId in packet, checking aircraft type.`);
        const allowedTypes = [3, 6, 7]; // Helicopter, Hang-Glider, Para-glider
        if (allowedTypes.includes(parsedData.aircraftType)) {
          // console.log(`No deviceId, allowed type ${parsedData.aircraftType}, storing.`);
          storeData = true;
        } else {
          // console.log(`No deviceId, disallowed type ${parsedData.aircraftType}, dropping.`);
          return; // No deviceId, disallowed type
        }
      }
      // --- End Eligibility Check ---


      // Add check: Ensure aircraftType is valid AND pilotName is not null before proceeding
      const isValidType = typeof parsedData.aircraftType === 'number' && !isNaN(parsedData.aircraftType);
      const hasPilotName = parsedData.pilotName !== null;

      if (storeData && isValidType && hasPilotName) { // Only proceed if storeData is true, type is valid, AND pilotName exists
        // Calculate pilot status BEFORE storing/emitting
        const pilotStatus = await this._calculatePilotStatus(parsedData.deviceId, {
          timestamp: parsedData.timestamp,
          alt_agl: parsedData.altAgl, // Use the calculated/corrected AGL
          speed_kmh: parsedData.speedKmh,
          vs: parsedData.vs
        });
        parsedData.status = pilotStatus; // Add status to the data object

        // Store in database (now includes status)
        await this.storeAircraftData(parsedData);

        // Update cache (ensure parsedData includes status if needed here)
        this.aircraftCache.set(parsedData.id, parsedData); // Cache now includes status

        // Emit event for real-time updates (local event)
        this.emit('aircraft-update', parsedData);

        // Emit WebSocket event if Socket.IO is available
        if (this.io) {
          try {
            const ognNamespace = this.io.of('/ogn');

            // Get all clients in the aircraft-updates room
            const sockets = await ognNamespace.in('aircraft-updates').fetchSockets();

            // RE-ADDED: Fetch the current name from the database to ensure we send the correct one
            let currentDbName = parsedData.name; // Default to parsed name in case DB lookup fails
            const client = await this.dbPool.connect();
            try {
              // Fetch name specifically from aircraft table using deviceId
              const nameResult = await client.query('SELECT name FROM aircraft WHERE device_id = $1', [parsedData.deviceId]);
              if (nameResult.rows.length > 0 && nameResult.rows[0].name) {
                // Use the name from the database if found
                currentDbName = nameResult.rows[0].name;
              } else {
                 // If not found in DB (shouldn't happen after storeAircraftData), keep parsedData.name
                 console.warn(`Device ${parsedData.deviceId} not found in aircraft table when preparing WS update, using parsed name: ${parsedData.name}`);
              }
            } catch (dbError) {
              console.error(`Error fetching current name for ${parsedData.deviceId} from DB for WS update:`, dbError);
              // Keep the default parsed name if DB query fails
            } finally {
              client.release();
            }

            // Format the data for WebSocket transmission
            const wsData = {
            	id: parsedData.id, // This is now the normalized deviceId
            	name: currentDbName, // Use the name fetched from DB (or default)
            	last_lat: parsedData.lat,
            	last_lon: parsedData.lon, // Corrected typo from last_lon to lon
            	last_alt_msl: parsedData.altMsl,
            	last_alt_agl: parsedData.altAgl,
            	last_course: parsedData.course,
            	last_speed_kmh: parsedData.speedKmh,
            	last_vs: parsedData.vs,
            	last_turn_rate: parsedData.turnRate,
                status: parsedData.status, // Include calculated pilot status
            	type: parsedData.aircraftType,
            	pilot_name: parsedData.pilotName,
            	last_seen: parsedData.timestamp,
            	// Add a unique timestamp to help client identify duplicates
            	update_timestamp: Date.now()
            };

            // Send updates only to clients whose bounds contain this aircraft
            for (const socket of sockets) {
              if (socket.bounds && this._isAircraftInBounds(parsedData, socket.bounds)) {
                socket.emit('aircraft-update', wsData);
              }
            }
          } catch (err) {
            console.error('Error emitting WebSocket event:', err);
          }
        }
      } else if (storeData && (!isValidType || !hasPilotName)) {
          // Log if we intended to store but the type was invalid OR pilotName was null
          if (!isValidType) {
              console.log(`Skipping store/update for device ${parsedData.deviceId} due to invalid aircraftType: ${parsedData.aircraftType}`);
          }
          if (!hasPilotName) {
              // console.log(`Skipping store/update for device ${parsedData.deviceId} (Name: ${parsedData.name}) because pilotName is null.`);
          }
      }
    } catch (err) { // End of try, start of catch for processAprsData
      console.error('Error processing APRS data:', err, 'Line:', line);
    }
  } // End of processAprsData

  /**
   * Parse APRS packet
   * @param {string} packet - APRS packet string
   * @returns {Promise<Object|null>} - Parsed data or null if invalid
   */
  async parseAprsPacket(packet) {
    try {
      // Basic APRS packet format: CALLSIGN>TOCALL,PATH:PAYLOAD
      const parts = packet.split(':');
      if (parts.length < 2) return null;

      const header = parts[0];
      const payload = parts.slice(1).join(':');

      const headerParts = header.split('>');
      if (headerParts.length < 2) return null;

      const callsign = headerParts[0].trim();

      // Only process APRS position reports (they start with '/')
      if (!payload.startsWith('/') && !payload.startsWith('@')) {
        return null;
      }

      // Filter out aircraft with the "^" symbol (large aircraft)
      if (payload.includes('^')) {
        return null;
      }

      // Filter out aircraft with the "'" (apostrophe) symbol (gliders/motorgliders)
      // The apostrophe needs to be properly positioned in the payload to be a symbol
      // Typically it appears after the coordinates
      const apostropheMatch = payload.match(/\d{4}\.\d{2}[NS]\/\d{5}\.\d{2}[EW]'/);
      if (apostropheMatch) {
        return null;
      }

      // Extract position data
      // Format is typically: /HHMMSSh/DDMMSSh/Course/Speed/...
      const positionData = this.parsePositionData(payload);
      if (!positionData) return null;

      // Extract aircraft type and address type from comment field
      const aircraftInfo = this.extractAircraftType(payload);

      // Filter out ICAO aircraft (address type 01)
      if (aircraftInfo.addressType === 1) { // 01 = ICAO
        return null;
      }

      // Filter out aircraft with ICA prefix in callsign (ICAO aircraft)
      if (callsign.startsWith('ICA')) {
        return null;
      }

      // Extract device ID from payload
      let deviceId = null;
      // Match the ID pattern (e.g., id0420DDD527)
      const idMatch = payload.match(/id[0-9A-F]{2}([0-9A-F]{6})/i); // Capture only the last 6 hex chars, case-insensitive
      if (idMatch && idMatch[1]) {
        // Use the captured 6-character Flarm ID as the deviceId
        deviceId = idMatch[1].toUpperCase();
      } else {
         // Fallback: If no 'id' field, try extracting from callsign like FLRDDD527
         const flarmCallsignMatch = callsign.match(/^FLR([0-9A-F]{6})$/i);
         if (flarmCallsignMatch && flarmCallsignMatch[1]) {
            deviceId = flarmCallsignMatch[1].toUpperCase();
         }
      }


      // --- Refined logic: Check trailing OGN type code ---
      let finalAircraftType = aircraftInfo.aircraftType; // Default to original type
      let rejectPacket = false;

      const payloadParts = payload.trim().split(/\s+/);
      if (payloadParts.length > 0) {
        const lastPart = payloadParts[payloadParts.length - 1];
        // Check if last part looks like an OGN type code (e.g., FNT11, FPG01, FHG02)
        if (/^[A-Z]{3}\d+$/.test(lastPart)) {
          const ognAircraftTypeCode = lastPart;
          const typePrefix = ognAircraftTypeCode.substring(0, 2);
          if (typePrefix === 'FP') { // Paraglider
            finalAircraftType = 6; // Override with PG type
            console.log(`OGN: Identified Paraglider (${deviceId || callsign}) from trailing code: ${ognAircraftTypeCode}`);
          } else if (typePrefix === 'FH') { // Hang glider
            finalAircraftType = 7; // Override with HG type
            console.log(`OGN: Identified Hang glider (${deviceId || callsign}) from trailing code: ${ognAircraftTypeCode}`);
          } else if (typePrefix === 'RNH') { // Hang glider
            finalAircraftType = 3; // Override with HG type
            console.log(`OGN: Identified Helicopter (${deviceId || callsign}) from trailing code: ${ognAircraftTypeCode}`);
          } else {
            // Valid OGN code, but not PG/HG - Mark for REJECTION
            console.log(`OGN: Rejecting packet for ${deviceId || callsign}. Non-PG/HG trailing type: ${ognAircraftTypeCode}. Packet: ${packet}`);
            rejectPacket = true;
          }
        }
        // If it doesn't look like an OGN code, we keep the original finalAircraftType
      }
      // If payloadParts was empty, we also keep the original finalAircraftType

      // --- End refined logic ---

      // Reject packet if marked
      if (rejectPacket) {
        return null;
      }

      // --- Continue processing if not rejected ---

      // Look up registration using the extracted 6-character deviceId
      let registration = null;
      if (deviceId) {
        // First, try the primary lookup (e.g., OGN DDB)
        registration = await this.lookupPilotName(deviceId);

        // If not found in primary lookup, try the Flarmnet cache
        if (!registration) {
            registration = this.flarmnetCache.get(deviceId);
        }
      }

      // Use registration if available, otherwise use the callsign
      const name = registration || callsign;

      // Calculate AGL using SRTM elevation data
      const altAgl = await this.calculateAGL(positionData.lat, positionData.lon, positionData.altMsl || 0);

      // Create result object - Use normalized deviceId as the primary 'id'
      return {
        // id: callsign.toUpperCase(), // OLD: Use callsign as ID
        id: deviceId, // NEW: Use normalized deviceId as the primary ID
        callsign: callsign.toUpperCase(), // Keep original callsign separately
        name: name, // This is usually registration or callsign
        timestamp: new Date(),
        lat: positionData.lat,
        lon: positionData.lon,
        altMsl: positionData.altMsl || 0,
        altAgl: altAgl || 0,
        course: positionData.course || 0,
        speedKmh: positionData.speed || 0,
        vs: positionData.climbRate || 0,
        turnRate: 0, // Not directly available in APRS, would need to calculate from multiple points
        aircraftType: finalAircraftType, // Use determined type (6, 7, or original)
        addressType: aircraftInfo.addressType, // Keep original address type if needed elsewhere
        deviceId: deviceId,
        pilotName: registration, // Use the registration found (or null) - might be same as 'name'
        rawPacket: packet // Store the raw APRS packet for debugging
      };
    } catch (err) {
      console.error('Error parsing APRS packet:', err);
      return null;
    }
  } // End of parseAprsPacket

  /**
   * Parse position data from APRS payload
   * @param {string} payload - APRS payload
   * @returns {Object|null} - Position data or null if invalid
   */
  parsePositionData(payload) {
    try {
      // This is a simplified parser - a real implementation would need to handle
      // all the APRS position formats and edge cases

      // Skip the timestamp part
      let positionPart;
      if (payload.startsWith('/')) {
        positionPart = payload.substring(8); // Skip /HHMMSSZ/
      } else if (payload.startsWith('@')) {
        positionPart = payload.substring(8); // Skip @HHMMSSZ/
      } else {
        return null;
      }

      // Extract latitude and longitude
      // Format: DDMM.SSN/DDDMM.SSE
      const latDegMin = positionPart.substring(0, 7);
      const latNS = positionPart.charAt(7);
      const lonDegMin = positionPart.substring(9, 17);
      const lonEW = positionPart.charAt(17);

      if (!latDegMin || !latNS || !lonDegMin || !lonEW) {
        return null;
      }

      // Convert DDMM.SS to decimal degrees
      const latDeg = parseInt(latDegMin.substring(0, 2), 10);
      const latMin = parseFloat(latDegMin.substring(2));
      let lat = latDeg + (latMin / 60);
      if (latNS === 'S') lat = -lat;

      const lonDeg = parseInt(lonDegMin.substring(0, 3), 10);
      const lonMin = parseFloat(lonDegMin.substring(3));
      let lon = lonDeg + (lonMin / 60);
      if (lonEW === 'W') lon = -lon;

      // Extract course and speed if available
      // Format after position: /Course/Speed/
      const remainingData = positionPart.substring(19);
      const parts = remainingData.split('/');

      let course = 0;
      let speed = 0;
      let altMsl = 0;
      let climbRate = 0;

      if (parts.length >= 2) {
        course = parseInt(parts[0], 10) || 0;
        // APRS speed is in knots, convert to km/h
        speed = Math.round((parseInt(parts[1], 10) || 0) * 1.852);
      }

      // Try to extract altitude from comment field
      // Format is typically /A=FFFFFF where FFFFFF is altitude in feet
      const altMatch = remainingData.match(/\/A=(\d{6})/);
      if (altMatch && altMatch[1]) {
        // Convert feet to meters
        altMsl = Math.round(parseInt(altMatch[1], 10) * 0.3048);
      }

      // Try to extract climb rate if available (e.g., +118fpm or -373fpm)
      // Convert feet per minute to m/s (1 fpm = 0.00508 m/s) and round to one decimal place
      const climbMatch = remainingData.match(/([+-]\d+)fpm/);
      if (climbMatch && climbMatch[1]) {
        const fpm = parseInt(climbMatch[1], 10);
        climbRate = Math.round(fpm * 0.00508 * 10) / 10; // Calculate m/s and round to 1 decimal
      }

      return { lat, lon, course, speed, altMsl, climbRate };
    } catch (err) {
      console.error('Error parsing position data:', err);
      return null;
    }
  } // End of parsePositionData

  /**
   * Extract aircraft information from APRS packet
   * @param {string} payload - APRS payload
   * @returns {Object} - Object containing aircraftType and addressType
   *
   * For aircraft types (4 bits), according to OGN documentation:
   * 0000 (0) = Unknown
   * 0001 (1) = Glider/motorglider
   * 0010 (2) = Tow/tug plane
   * 0011 (3) = Helicopter
   * 0100 (4) = Parachute
   * 0101 (5) = Drop plane
   * 0110 (6) = Hang-glider
   * 0111 (7) = Para-glider
   * 1000 (8) = Powered aircraft
   * 1001 (9) = Jet aircraft
   * 1010 (10) = UFO
   * 1011 (11) = Balloon
   * 1100 (12) = Airship
   * 1101 (13) = UAV/drone
   * 1110 (14) = Ground support
   * 1111 (15) = Static object
   *
   * For address types (2 bits):
   * 00 = Unknown
   * 01 = ICAO
   * 10 = FLARM
   * 11 = OGN
   */
  extractAircraftType(payload) {
    try {
      // --- New Check for sFx codes (Paraglider/Hangglider) ---
      const sFMatch = payload.match(/\s(sF[12])\s/); // Look for " sF1 " or " sF2 "
      if (sFMatch) {
        const sFCode = sFMatch[1];
        if (sFCode === 'sF1') {
          // console.log("Detected sF1 (Paraglider)");
          return { aircraftType: 7, addressType: 0 }; // 7 = Para-glider
        } else if (sFCode === 'sF2') {
          // console.log("Detected sF2 (Hang glider)");
          return { aircraftType: 6, addressType: 0 }; // 6 = Hang-glider
        }
      }
      // --- End New Check ---

      // Extract aircraft type from the id field in the format idXXYYYYYY
      // where XX encodes stealth mode, no-tracking flag, aircraft type, and address type
      const idMatch = payload.match(/id([0-9A-F]{2})[0-9A-F]+/);

      if (idMatch && idMatch[1]) {
        // Convert the first two hex digits to a number
        const encodedInfo = parseInt(idMatch[1], 16);

        // Extract the aircraft type (bits 2-5, counting from 0)
        // Shift right by 2 to remove address type bits, then mask with 0x0F to get only the 4 type bits
        const aircraftType = (encodedInfo >> 2) & 0x0F;

        // Extract the address type (bits 0-1, counting from 0)
        // Mask with 0x03 to get only the 2 address type bits
        const addressType = encodedInfo & 0x03;

        // Return both aircraft type and address type
        return {
          aircraftType: aircraftType,
          addressType: addressType
        };
      }

      // If we can't extract from id field, try other methods

      // Look for aircraft type in comment field
      // Format is typically !W12! where 1 is the aircraft type category
      const typeMatch = payload.match(/!W(\d)(\d)!/);
      if (typeMatch && typeMatch[1]) {
        const type = parseInt(typeMatch[1], 10);
        return {
          aircraftType: type,
          addressType: 0 // Unknown address type
        };
      }

      // If we can't determine the type, return unknown for both
      return {
        aircraftType: 0,
        addressType: 0
      };
    } catch (err) {
      console.error('Error extracting aircraft type:', err);
      return { aircraftType: 0, addressType: 0 }; // Return unknown object on error
    }
  } // End of extractAircraftType

  /**
   * Extract aircraft name from callsign and comment
   * @param {string} callsign - APRS callsign
   * @param {string} payload - APRS payload
   * @returns {string} - Aircraft name
   */
  extractAircraftName(callsign, payload) {
    // This function is currently simplified to just return the callsign.
    // We will revisit this based on further analysis of APRS packets containing names.
    return callsign;
  } // End of extractAircraftName

  /**
   * Calculate height above ground level
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {number} altMsl - Altitude above mean sea level in meters
   * @returns {Promise<number>} - Height above ground level in meters
   */
  async calculateAGL(lat, lon, altMsl) {
    try {
      // Get elevation from Mapbox
      let elevation = await this.mapboxElevation.getElevation(lat, lon);

      // SRTM fallback code kept but disabled as per request
      // if (elevation === null) {
      //   elevation = await this.srtmElevation.getElevation(lat, lon);
      // }

      // If we have elevation data, calculate AGL by subtracting ground elevation from MSL altitude
      if (elevation !== null) {
        // Add a small tolerance (5 meters) to account for minor inaccuracies in elevation or MSL data
        const tolerance = 5;
        const agl = Math.max(0, Math.round(altMsl - elevation + tolerance));

        // Only log warning for significant discrepancies (for monitoring purposes)
        if (agl === 0 && altMsl > elevation + 20) {
          console.warn(`Zero AGL despite MSL significantly higher than elevation: altMsl=${altMsl}, elevation=${elevation}, diff=${altMsl - elevation}, lat=${lat}, lon=${lon}`);
        }

        return agl;
      } else {
        // If no elevation data is available, return MSL as fallback
        return Math.round(altMsl);
      }
    } catch (err) {
      console.error(`Error calculating AGL for ${lat},${lon}:`, err);
      return Math.round(altMsl); // Return MSL as fallback (as integer)
    }
  } // End of calculateAGL

  /**
   * Store aircraft data in the database
   * @param {Object} data - Parsed aircraft data
   */
  async storeAircraftData(data) {
    let client; // Declare client outside try block
    try {
      // Note: pilotName is now looked up within parseAprsPacket and passed in the 'data' object
      // Calculate AGL using SRTM elevation data
      const altAgl = await this.calculateAGL(data.lat, data.lon, data.altMsl);

      client = await this.dbPool.connect();
      await client.query('BEGIN');

      // Extract data fields - including the type from ID passed from parseAprsPacket
      // Destructure data fields from parseAprsPacket result
      const {
        id, name, aircraftType, timestamp, lat, lon, altMsl, /* alt_agl is calculated below */
        course, speedKmh, vs, turnRate, rawPacket, deviceId, pilotName, callsign /* Added callsign */
      } = data;
  
      // Update or insert aircraft record, now including pilot_name and calculated AGL
      await client.query(`
        INSERT INTO aircraft (
          device_id, name, type, callsign, last_seen, last_lat, last_lon,
          last_alt_msl, last_alt_agl, last_course, last_speed_kmh, last_vs, last_turn_rate, raw_packet, pilot_name
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        ) ON CONFLICT (device_id) DO UPDATE SET
         -- name = EXCLUDED.name, -- Do NOT update name from position reports if record exists
         type = EXCLUDED.type,
         callsign = EXCLUDED.callsign,
          last_seen = EXCLUDED.last_seen,
          last_lat = EXCLUDED.last_lat,
          last_lon = EXCLUDED.last_lon,
          last_alt_msl = EXCLUDED.last_alt_msl,
          last_alt_agl = EXCLUDED.last_alt_agl,
          last_course = EXCLUDED.last_course,
          last_speed_kmh = EXCLUDED.last_speed_kmh,
          last_vs = EXCLUDED.last_vs,
          last_turn_rate = EXCLUDED.last_turn_rate,
          raw_packet = EXCLUDED.raw_packet,
          pilot_name = EXCLUDED.pilot_name -- Update pilot name
      `, [
        deviceId,           // $1 - Use deviceId as primary key
        data.name,          // $2
        aircraftType,       // $3 - Use the correct type from parseAprsPacket
        callsign,           // $4 - Store original callsign
        data.timestamp,     // $5
        data.lat,           // $6
        data.lon,           // $7
        data.altMsl,        // $8
        altAgl,             // $9 - Use calculated AGL instead of data.altAgl
        data.course,        // $10
        data.speedKmh,      // $11
        data.vs,            // $12
        data.turnRate,      // $13
        data.rawPacket,     // $14
        pilotName           // $15 - Use pilotName from destructuring
      ]);
  
      // --- Filter Skytraxx Default Location ---
      const distance = this._haversineDistance(
          data.lat, data.lon,
          SKYTRAXX_DEFAULT_LAT, SKYTRAXX_DEFAULT_LON
      );
 
      if (distance >= SKYTRAXX_FILTER_RADIUS_M) {
        // Only insert into tracks table if outside the filter radius AND alt_msl is not 0
        if (data.altMsl !== 0) {
          // Check if we need to apply track filtering for this aircraft
          let shouldInsertTrack = true;
          
          // Get recent tracks for this aircraft to check for anomalies
          const recentTracksQuery = await client.query(`
            SELECT id, aircraft_id, timestamp, lat, lon, alt_msl, alt_agl, course, speed_kmh, vs, turn_rate, status
            FROM aircraft_tracks
            WHERE aircraft_id = $1
            ORDER BY timestamp DESC
            LIMIT 10
          `, [deviceId]);
          
          if (recentTracksQuery.rows.length > 0) {
            // We have previous tracks, apply filtering using the more efficient isPointAnomaly method
            const newPoint = {
              aircraft_id: deviceId,
              timestamp: data.timestamp,
              lat: data.lat,
              lon: data.lon,
              alt_msl: data.altMsl,
              alt_agl: altAgl,
              course: data.course,
              speed_kmh: data.speedKmh,
              vs: data.vs,
              turn_rate: data.turnRate,
              status: data.status
            };
            
            // Create a TrackFilter instance and check if the new point is an anomaly
            const trackFilter = new TrackFilter([]);
            const { isAnomaly, anomalyDetails } = trackFilter.isPointAnomaly(newPoint, recentTracksQuery.rows);
            
            if (isAnomaly) {
              console.log(`Filtered out anomalous track point for ${deviceId} at ${data.timestamp}: lat=${data.lat}, lon=${data.lon}`);
              shouldInsertTrack = false;
              
              // Log the anomaly details if available
              if (anomalyDetails && anomalyDetails.length > 0) {
                const firstAnomaly = anomalyDetails[0];
                console.log(`Anomaly type: ${firstAnomaly.type}, Previous point: lat=${firstAnomaly.previous?.lat}, lon=${firstAnomaly.previous?.lon}`);
                
                if (firstAnomaly.details) {
                  console.log(`Anomaly details:`, JSON.stringify(firstAnomaly.details));
                }
              }
            }
          }
          
          // Only insert if the point passed all filters
          if (shouldInsertTrack) {
            await client.query(`
              INSERT INTO aircraft_tracks (
                aircraft_id, timestamp, lat, lon,
                alt_msl, alt_agl, course, speed_kmh, vs, turn_rate, status -- Added status column
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11 -- Added $11 for status
              )
            `, [
              deviceId,         // $1 - Use deviceId as aircraft_id
              data.timestamp,   // $2
              data.lat,         // $3
              data.lon,         // $4
              data.altMsl,      // $5
              altAgl,           // $6 - Use calculated AGL
              data.course,      // $7
              data.speedKmh,    // $8
              data.vs,          // $9
              data.turnRate,    // $10
              data.status       // $11 - Pass the calculated status
            ]);
          }
        } else {
          console.log(`Skipping track update for ${deviceId} because alt_msl is 0.`);
        }
      } else {
        console.log(`Filtered track point for ${deviceId} near Skytraxx default location (Distance: ${distance.toFixed(1)}m)`);
      }
      // --- End Filter ---
 
      await client.query('COMMIT');
    } catch (err) {
      if (client) { // Check if client was successfully connected before rollback
         await client.query('ROLLBACK');
      }
      console.error('Error storing aircraft data:', err);
    } finally {
      if (client) { // Check if client was successfully connected before release
        client.release();
      }
    }
  } // End of storeAircraftData

  /**
   * Get current aircraft positions within bounds
   * @param {Object} bounds - Map bounds {nwLat, nwLng, seLat, seLng}
   * @returns {Array} - Array of aircraft positions
   */
  async getAircraftInBounds(bounds) {
    let client; // Define client here
    try {
      client = await this.dbPool.connect();
      const result = await client.query(`
        SELECT
          device_id AS id, -- Map device_id to id for backward compatibility
          name,
          type,
          callsign,
          last_seen,
          last_lat,
          last_lon,
          last_alt_msl,
          last_alt_agl,
          last_course,
          last_speed_kmh,
          last_vs,
          last_turn_rate,
          raw_packet,
          pilot_name
        FROM aircraft
        WHERE last_lat BETWEEN $1 AND $2
        AND last_lon BETWEEN $3 AND $4
        AND last_seen > $5
        AND type IN (3, 6, 7) -- Allow Helicopter, Hang-Glider, Para-glider
      `, [
        bounds.seLat,
        bounds.nwLat,
        bounds.nwLng,
        bounds.seLng,
        new Date(Date.now() - 1800000) // Last 30 minutes
      ]);

      // Ensure all rows have valid coordinates before returning
      const validRows = result.rows.filter(row =>
        row.last_lat !== null &&
        row.last_lon !== null
      );
      
      console.log(`Found ${result.rows.length} aircraft in bounds, ${validRows.length} with valid coordinates`);
      
      return validRows;
    } catch (err) {
      console.error('Error getting aircraft in bounds:', err);
      return [];
    } finally {
      if (client) { // Check if client was successfully connected before releasing
         client.release();
      }
    }
  } // End of getAircraftInBounds

  /**
   * Get track points for a specific aircraft
   * @param {string} aircraftId - Aircraft ID
   * @param {number} minutes - Number of minutes of history to retrieve
   * @returns {Array} - Array of track points
   */
  async getAircraftTrack(aircraftId, minutes = 60) {
  	let client; // Define client here
  	try {
  		client = await this.dbPool.connect();
  		// aircraftId is already the normalized device_id from live.js
  		// which now directly matches the aircraft_id column in aircraft_tracks
  		const result = await client.query(`
  			SELECT * FROM aircraft_tracks
  			WHERE aircraft_id = $1
  			AND timestamp > $2
  			ORDER BY timestamp ASC
  		`, [
  			aircraftId, // This is now the normalized device_id
  			new Date(Date.now() - (minutes * 60000))
  		]);

  		return result.rows;
    } catch (err) {
      console.error('Error getting aircraft track:', err);
      return [];
    } finally {
      if (client) { // Check if client was successfully connected before releasing
         client.release();
      }
    }
  } // End of getAircraftTrack
  /**
   * Check if an aircraft is within the specified bounds
   * @param {Object} aircraft - Aircraft data
   * @param {Object} bounds - Map bounds {nwLat, nwLng, seLat, seLng}
   * @returns {boolean} - True if aircraft is within bounds
   */
  _isAircraftInBounds(aircraft, bounds) {
    // Handle different data formats (from database or from APRS parsing)
    const lat = aircraft.lat || aircraft.last_lat;
    const lon = aircraft.lon || aircraft.last_lon;
    
    if (!lat || !lon || !bounds) {
      console.debug(`Aircraft ${aircraft.id} has invalid coordinates or bounds:`, { lat, lon, bounds });
      return false;
    }
    
    const inBounds = (
      lat >= bounds.seLat &&
      lat <= bounds.nwLat &&
      lon >= bounds.nwLng &&
      lon <= bounds.seLng
    );
    
    // Debug log for bounds checking
     // if (!inBounds) {
     //   console.debug(`Aircraft ${aircraft.id} is outside bounds:`, {
     //     lat, lon,
     //     bounds: `${bounds.seLat},${bounds.nwLat},${bounds.nwLng},${bounds.seLng}`
      //  });
     // }
    
    return inBounds;
  }
  
  /**
   * Set the Socket.IO instance for WebSocket communication
   * @param {Object} io - Socket.IO instance
   */
  setSocketIO(io) {
    this.io = io;
    console.log('Socket.IO instance set in OGN APRS client');
  }
 
  /**
   * Calculates the distance between two lat/lon points using the Haversine formula.
   * @param {number} lat1 Latitude of point 1
   * @param {number} lon1 Longitude of point 1
   * @param {number} lat2 Latitude of point 2
   * @param {number} lon2 Longitude of point 2
   * @returns {number} Distance in meters.
   */
  _haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;
 
    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
 
    return R * c; // Distance in meters
  }
 
} // End of OgnAprsClient class
 
export default OgnAprsClient;
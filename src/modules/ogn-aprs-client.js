/**
 * OGN APRS Client Module
 * Connects to the Open Glider Network APRS server and processes aircraft data
 */

import net from 'net';
import { EventEmitter } from 'events';
import pkg from 'pg';
import fetch from 'node-fetch';
const { Pool } = pkg;

// Constants
const OGN_HOST = 'aprs.glidernet.org';
const OGN_PORT = 14580;
const OGN_FILTER = 'r/48.0/6.0/1500 t/o';  // 500km radius around Luxembourg, only aircraft
const OGN_USER_AGENT = 'XCmaps v1.0';
const CLEANUP_INTERVAL = 3600000; // 1 hour in milliseconds
const DATA_RETENTION_HOURS = 12; // Keep data for 12 hours
const OGN_DDB_URL = 'https://ddb.glidernet.org/download/';
const OGN_DDB_REFRESH_INTERVAL = 86400000; // 24 hours in milliseconds
const FLARMNET_URL = 'https://www.flarmnet.org/static/files/wfn/data.fln';
const FLARMNET_REFRESH_INTERVAL = 86400000; // 24 hours in milliseconds
const PURETRACK_URL = 'https://puretrack.io/api/labels.json';
const PURETRACK_REFRESH_INTERVAL = 86400000; // 24 hours in milliseconds
 
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
        CREATE TABLE IF NOT EXISTS aircraft (
          id VARCHAR(20) PRIMARY KEY,
          name VARCHAR(100),
          type SMALLINT,
          last_seen TIMESTAMP WITH TIME ZONE,
          last_lat DOUBLE PRECISION,
          last_lon DOUBLE PRECISION,
          last_alt_msl INTEGER,
          last_alt_agl INTEGER,
          last_course SMALLINT,
          last_speed_kmh SMALLINT,
          last_vs SMALLINT,
          last_turn_rate SMALLINT,
          raw_packet TEXT,
          device_id VARCHAR(50),
          pilot_name VARCHAR(100)
        )
      `);

      // Create tracks table if it doesn't exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS aircraft_tracks (
          id SERIAL PRIMARY KEY,
          aircraft_id VARCHAR(20) REFERENCES aircraft(id) ON DELETE CASCADE,
          timestamp TIMESTAMP WITH TIME ZONE,
          lat DOUBLE PRECISION,
          lon DOUBLE PRECISION,
          alt_msl INTEGER,
          alt_agl INTEGER,
          course SMALLINT,
          speed_kmh SMALLINT,
          vs SMALLINT,
          turn_rate SMALLINT
        )
      `);

      // Create index on aircraft_id and timestamp for faster queries
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_aircraft_tracks_aircraft_id ON aircraft_tracks(aircraft_id);
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

      // Create Flarmnet pilots table
      await client.query(`
        CREATE TABLE IF NOT EXISTS flarmnet_pilots (
          flarm_id VARCHAR(12) PRIMARY KEY,
          pilot_name VARCHAR(100),
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
 
      // 2. Perform initial data refresh
      console.log('Performing initial pilot data refresh...');
      await Promise.all([
        this.refreshPilotDatabase(),
        this.refreshFlarmnetDatabase(),
        this.refreshPureTrackDatabase() // Add PureTrack refresh
      ]);
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
 
      // 4. Connect to APRS server
      this.connect();
      console.log('OGN APRS Client initialization complete.');
 
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
      await client.query('BEGIN');
      
      let processedCount = 0;
      // Skip header line
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
        const [deviceType, deviceId, aircraftModel, registration, cn, trackedStr, identifiedStr] = fields;
        const pilotName = fields.length >= 8 ? fields[7] : null; // Assign null if 8th field is missing
        
        if (i < 5) { // Log first few processed lines
            console.log(`OGN DDB: Processing line ${i+1}: ID=${deviceId}, Name=${pilotName || '[None]'}`);
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
        await client.query(query, [deviceId, deviceType, aircraftModel, registration, cn, tracked, identified, pilotName || null]); // Use null if pilotName is empty
        processedCount++;
      }
      
      await client.query('COMMIT');
      console.log(`OGN pilot database refreshed: ${processedCount} records processed into DB`);
      
    } catch (err) {
      console.error('Error refreshing OGN pilot database:', err);
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
   * Refresh Flarmnet database
   */
  async refreshFlarmnetDatabase() {
    try {
      console.log('Refreshing Flarmnet database...');
      
      // Fetch Flarmnet data
      const response = await fetch(FLARMNET_URL, {
        headers: {
          'User-Agent': OGN_USER_AGENT
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch Flarmnet database: ${response.status} ${response.statusText}`);
      }
      
      // The Flarmnet file is a binary file, so we need to get it as an ArrayBuffer
      const buffer = await response.arrayBuffer();
      
      // Parse the Flarmnet binary file
      this.parseFlarmnetData(buffer);
      
      console.log(`Flarmnet database refresh initiated (parsing happens next).`); // Removed reference to cache size
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
      await client.query('BEGIN');
 
      let processedCount = 0;
      for (const record of data) {
        // Validate required fields
        if (!record || typeof record.hex !== 'string' || record.hex.length === 0) {
          console.warn('PureTrack: Skipping invalid record:', record);
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
 
        if (processedCount <= 5) {
          console.log(`PureTrack: Processing record: HEX=${hexId}, Label=${label}`);
        }
      }
 
      await client.query('COMMIT');
      console.log(`PureTrack pilot database refreshed: ${processedCount} records processed into DB.`);
 
    } catch (err) {
      console.error('Error refreshing PureTrack pilot database:', err);
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
   * Parse Flarmnet binary data
   * @param {ArrayBuffer} buffer - Binary data from Flarmnet
   */
  async parseFlarmnetData(buffer) {
    let client; // Declare client outside the try block
    let currentRecordIndex = -1; // For logging errors
    let currentFlarmId = 'N/A'; // For logging errors
    try {
      // ... (comments and initial setup remain the same) ...
      const dataView = new DataView(buffer);
      const headerSize = 8;
      const recordSize = 78;
      const dataSize = buffer.byteLength - headerSize;
      const numRecords = Math.floor(dataSize / recordSize);
      
      console.log(`Flarmnet: Contains ${numRecords} records. Processing into DB...`);
      
      client = await this.dbPool.connect();
      console.log("Flarmnet: DB client connected.");
      await client.query('BEGIN');
      console.log("Flarmnet: DB transaction started.");
      
      let processedCount = 0;
      // Process each record
      for (let i = 0; i < numRecords; i++) {
        currentRecordIndex = i; // Update for error logging
        const recordOffset = headerSize + (i * recordSize);
        
        // Helper function (remains the same)
        const extractString = (offset, length) => {
          let str = '';
          for (let j = 0; j < length; j++) {
            const byte = dataView.getUint8(recordOffset + offset + j);
            if (byte === 0) break;
            str += String.fromCharCode(byte);
          }
          return str.trim();
        };

        // Extract FLARM ID (remains the same)
        let flarmId = '';
        for (let j = 0; j < 6; j++) {
          const byte = dataView.getUint8(recordOffset + 0 + j);
          flarmId += byte.toString(16).padStart(2, '0');
        }
        flarmId = flarmId.toUpperCase();
        currentFlarmId = flarmId; // Update for error logging

        // Extract other fields (remains the same)
        const pilotName = extractString(6, 21);
        const registration = extractString(27, 7);
        const aircraftType = extractString(34, 21);
        const homeAirfield = extractString(55, 21);
        const frequency = extractString(76, 7);

        // Only store entries with a valid FLARM ID and pilot name
        if (flarmId && flarmId.length === 6 && flarmId !== '000000' && pilotName.length > 0) {
          // Log before query
          // console.log(`Flarmnet: Preparing to insert/update record ${i}, FLARM ID: ${flarmId}`);
          const query = `
            INSERT INTO flarmnet_pilots (flarm_id, pilot_name, registration, aircraft_type, home_airfield, frequency, last_updated)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (flarm_id) DO UPDATE SET
              pilot_name = EXCLUDED.pilot_name,
              registration = EXCLUDED.registration,
              aircraft_type = EXCLUDED.aircraft_type,
              home_airfield = EXCLUDED.home_airfield,
              frequency = EXCLUDED.frequency,
              last_updated = NOW();
          `;
          await client.query(query, [flarmId, pilotName, registration || null, aircraftType || null, homeAirfield || null, frequency || null]);
          // Log after query success
          // console.log(`Flarmnet: Successfully processed record ${i}, FLARM ID: ${flarmId}`);
          processedCount++;

          // Log first few records (remains the same)
          if (processedCount <= 5) {
             console.log(`Flarmnet: Record ${i}: FLARM ID: ${flarmId}, Pilot: ${pilotName}, Reg: ${registration}, Type: ${aircraftType}`);
          }
        } else {
           // Optional: Log skipped records
           // if (i < 10) console.log(`Flarmnet: Skipping record ${i} (ID: ${flarmId}, Name: ${pilotName})`);
        }
      }
      
      console.log("Flarmnet: Loop finished. Attempting COMMIT.");
      await client.query('COMMIT');
      console.log(`Flarmnet: COMMIT successful. Loaded ${processedCount} valid records into DB.`); // Modified final log
      
    } catch (err) {
      // Log error with more context
      console.error(`Error parsing Flarmnet data at record index ${currentRecordIndex} (FLARM ID: ${currentFlarmId}):`, err);
       if (client) {
        console.error("Flarmnet: Attempting ROLLBACK due to error.");
        await client.query('ROLLBACK'); // Rollback transaction on error
        console.error("Flarmnet: ROLLBACK successful.");
      }
    } finally {
       if (client) {
        console.log("Flarmnet: Releasing DB client.");
        client.release(); // Ensure client is always released
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
      let result = await client.query(
        'SELECT pilot_name FROM ogn_ddb_pilots WHERE device_id = $1 AND pilot_name IS NOT NULL AND pilot_name != \'\'',
        [deviceId]
      );
      if (result.rows.length > 0 && result.rows[0].pilot_name) {
        return result.rows[0].pilot_name;
      }
      
      // Then check the Flarmnet table (assuming deviceId might be a Flarm ID)
      // Flarm IDs are typically 6 hex characters, uppercase
      const potentialFlarmId = deviceId.toUpperCase();
      if (potentialFlarmId.length === 6) { // Check if it looks like a Flarm ID
         result = await client.query(
          'SELECT pilot_name, registration, aircraft_type FROM flarmnet_pilots WHERE flarm_id = $1',
          [potentialFlarmId]
        );
        if (result.rows.length > 0) {
          const { pilot_name, registration, aircraft_type } = result.rows[0];
          // Reconstruct the combined info string similar to how it was cached before
          let pilotInfo = pilot_name.trim();
          const regTrimmed = registration?.trim();
          const typeTrimmed = aircraft_type?.trim();
          if (regTrimmed || typeTrimmed) {
             pilotInfo += ` (${regTrimmed || ''} ${typeTrimmed || ''})`.trim().replace(/\s+/g, ' '); // Combine, trim, remove extra spaces
          }
          return pilotInfo;
        }
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
      console.log(`Pilot name not found for deviceId ${deviceId}, returning ID as name.`);
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

    console.log(`Connecting to OGN APRS server ${OGN_HOST}:${OGN_PORT}...`);
    
    this.socket = new net.Socket();
    
    this.socket.on('connect', () => {
      console.log('Connected to OGN APRS server');
      this.connected = true;
      
      // Send login command
      const loginCommand = `user XCmaps pass -1 vers ${OGN_USER_AGENT} filter ${OGN_FILTER}\r\n`;
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
    
    this.socket.connect(OGN_PORT, OGN_HOST);
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
    const client = await this.dbPool.connect();
    
    try {
      const cutoffTime = new Date(Date.now() - (DATA_RETENTION_HOURS * 3600000));
      
      // Delete old track points
      await client.query(`
        DELETE FROM aircraft_tracks 
        WHERE timestamp < $1
      `, [cutoffTime]);
      
      // Delete aircraft that haven't been seen recently
      await client.query(`
        DELETE FROM aircraft 
        WHERE last_seen < $1
      `, [cutoffTime]);
      
      console.log('OGN data cleanup completed');
    } catch (err) {
      console.error('Error during OGN data cleanup:', err);
    } finally {
      client.release();
    }
  }

  /**
   * Process APRS data line
   * @param {string} line - APRS data line
   */
  async processAprsData(line) {
    try {
      // Skip server messages and comments
      if (line.startsWith('#') || line.startsWith('>')) {
        return;
      }
      
      // Early filter for ICAO aircraft based on callsign
      if (line.startsWith('ICA')) {
        return;
      }
      
      // Early filter for FLARM devices based on callsign
      if (line.startsWith('FLR')) {
        return;
      }

      // Parse APRS packet
      const parsedData = this.parseAprsPacket(line);
      
      if (!parsedData) {
        return; // Skip invalid packets
      }
      
      // Only process hang gliders (type 6) and paragliders (type 7)
      // Note: ICAO aircraft, FLARM devices, and aircraft with "^" or "'" symbols are already filtered out in parseAprsPacket
      if (parsedData.aircraftType !== 6 && parsedData.aircraftType !== 7) {
        return;
      }

      // Store in database
      await this.storeAircraftData(parsedData);
      
      // Update cache
      this.aircraftCache.set(parsedData.id, parsedData);
      
      // Emit event for real-time updates
      this.emit('aircraft-update', parsedData);
      
    } catch (err) {
      console.error('Error processing APRS data:', err, 'Line:', line);
    }
  }

  /**
   * Parse APRS packet
   * @param {string} packet - APRS packet string
   * @returns {Object|null} - Parsed data or null if invalid
   */
  parseAprsPacket(packet) {
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
      
      // Filter out aircraft with FLR prefix in callsign (FLARM devices, often used in gliders)
      if (callsign.startsWith('FLR')) {
        return null;
      }
      
      // Extract device ID from payload
      let deviceId = null;
      const idMatch = payload.match(/id([0-9A-F]{2})([0-9A-F]+)/);
      if (idMatch && idMatch[2]) {
        deviceId = idMatch[2].toUpperCase();
      }
      
      // Extract FLARM ID if present (for Flarmnet lookup)
      let flarmId = null;
      if (callsign.startsWith('FLR')) {
        flarmId = callsign.substring(3).toUpperCase();
      }
      
      // Look up pilot name from device ID or FLARM ID
      let pilotName = null;
      if (deviceId) {
        pilotName = this.lookupPilotName(deviceId);
      }
      if (!pilotName && flarmId) {
        pilotName = this.flarmnetCache.get(flarmId);
      }
      
      // Use pilot name if available, otherwise use the callsign
      const name = pilotName || callsign;
      
      // Create result object
      return {
        id: callsign,
        name: name,
        timestamp: new Date(),
        lat: positionData.lat,
        lon: positionData.lon,
        altMsl: positionData.altMsl || 0,
        altAgl: this.calculateAGL(positionData.lat, positionData.lon, positionData.altMsl) || 0,
        course: positionData.course || 0,
        speedKmh: positionData.speed || 0,
        vs: positionData.climbRate || 0,
        turnRate: 0, // Not directly available in APRS, would need to calculate from multiple points
        aircraftType: aircraftInfo.aircraftType,
        addressType: aircraftInfo.addressType,
        deviceId: deviceId,
        pilotName: pilotName,
        rawPacket: packet // Store the raw APRS packet for debugging
      };
    } catch (err) {
      console.error('Error parsing APRS packet:', err);
      return null;
    }
  }

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
      
      // Try to extract climb rate if available
      const climbMatch = remainingData.match(/\+(\d+)fpm/);
      if (climbMatch && climbMatch[1]) {
        // Convert feet per minute to m/s
        climbRate = Math.round(parseInt(climbMatch[1], 10) * 0.00508);
      }
      
      return { lat, lon, course, speed, altMsl, climbRate };
    } catch (err) {
      console.error('Error parsing position data:', err);
      return null;
    }
  }

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
      return 0; // Unknown
    }
  }

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
  }

  /**
   * Calculate height above ground level
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {number} altMsl - Altitude above mean sea level in meters
   * @returns {number} - Height above ground level in meters
   */
  calculateAGL(lat, lon, altMsl) {
    // In a real implementation, this would query a terrain database
    // For now, we'll just return a rough estimate or the MSL value
    // A proper implementation would use a DEM (Digital Elevation Model)
    
    // For simplicity, we'll just return the MSL altitude
    // In a real implementation, you would subtract ground elevation
    return altMsl;
  }

  /**
   * Store aircraft data in the database
   * @param {Object} data - Parsed aircraft data
   */
  async storeAircraftData(data) {
    let client; // Declare client outside try block
    try {
      // Look up pilot name from DB
      const pilotName = await this.lookupPilotName(data.deviceId); // Added await and call
      
      client = await this.dbPool.connect();
      await client.query('BEGIN');
      
      // Update or insert aircraft record, now including pilot_name
      await client.query(`
        INSERT INTO aircraft (
          id, name, type, last_seen, last_lat, last_lon,
          last_alt_msl, last_alt_agl, last_course, last_speed_kmh, last_vs, last_turn_rate, raw_packet, device_id, pilot_name
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        ) ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          type = EXCLUDED.type,
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
          device_id = EXCLUDED.device_id, -- Ensure device_id is updated if needed
          pilot_name = EXCLUDED.pilot_name -- Update pilot name
      `, [
        data.id,            // $1
        data.name,          // $2
        data.aircraftType,  // $3
        data.timestamp,     // $4
        data.lat,           // $5
        data.lon,           // $6
        data.altMsl,        // $7
        data.altAgl,        // $8
        data.course,        // $9
        data.speedKmh,      // $10
        data.vs,            // $11
        data.turnRate,      // $12
        data.rawPacket,     // $13
        data.deviceId,      // $14 - Added deviceId
        pilotName           // $15 - Added pilotName
      ]);
      
      // Insert track point (no changes needed here)
      await client.query(`
        INSERT INTO aircraft_tracks (
          aircraft_id, timestamp, lat, lon, 
          alt_msl, alt_agl, course, speed_kmh, vs, turn_rate
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
      `, [
        data.id,
        data.timestamp,
        data.lat,
        data.lon,
        data.altMsl,
        data.altAgl,
        data.course,
        data.speedKmh,
        data.vs,
        data.turnRate
      ]);
      
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error storing aircraft data:', err);
    } finally {
      client.release();
    }
  }

  /**
   * Get current aircraft positions within bounds
   * @param {Object} bounds - Map bounds {nwLat, nwLng, seLat, seLng}
   * @returns {Array} - Array of aircraft positions
   */
  async getAircraftInBounds(bounds) {
    const client = await this.dbPool.connect();
    
    try {
      const result = await client.query(`
        SELECT * FROM aircraft
        WHERE last_lat BETWEEN $1 AND $2
        AND last_lon BETWEEN $3 AND $4
        AND last_seen > $5
        AND (type = 6 OR type = 7)
      `, [
        bounds.seLat,
        bounds.nwLat,
        bounds.nwLng,
        bounds.seLng,
        new Date(Date.now() - 1800000) // Last 30 minutes
      ]);
      
      return result.rows;
    } catch (err) {
      console.error('Error getting aircraft in bounds:', err);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Get track points for a specific aircraft
   * @param {string} aircraftId - Aircraft ID
   * @param {number} minutes - Number of minutes of history to retrieve
   * @returns {Array} - Array of track points
   */
  async getAircraftTrack(aircraftId, minutes = 60) {
    const client = await this.dbPool.connect();
    
    try {
      const result = await client.query(`
        SELECT * FROM aircraft_tracks
        WHERE aircraft_id = $1
        AND timestamp > $2
        ORDER BY timestamp ASC
      `, [
        aircraftId,
        new Date(Date.now() - (minutes * 60000))
      ]);
      
      return result.rows;
    } catch (err) {
      console.error('Error getting aircraft track:', err);
      return [];
    } finally {
      client.release();
    }
  }
}

export default OgnAprsClient;
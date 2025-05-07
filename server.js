import express from "express";
import cors from "cors";
import path from "path";
import { config } from "dotenv";
import pkg from "pg";
import 'dotenv/config';
import fetch from 'node-fetch';
import fs from 'fs'; // Added for file system operations
import { exec } from 'child_process';
import { promisify } from 'util';
import { createServer } from "http";
import { Server } from "socket.io";

// For GDAL checking
const execAsync = promisify(exec);

// Import routes
import createPlacesRouter from "./src/api/places.js";
import createWindRouter from "./src/api/wind.js";
import createFeedbackRouter from "./src/api/feedback.js";
import createAirspacesRouter from "./src/api/airspaces.js";
import createAirspacesXCRouter from "./src/api/airspacesXCfetch.js";
import createAirspacesXCdbRouter from "./src/api/airspaces-xcontest.js";
import createObstaclesRouter from './src/api/obstacles.js';
import createMoselfalkenImageRouter from './src/api/moselfalken-cams.js';
import kk7ThermalsProxy from './src/api/kk7thermals.js';
import kk7SkywayaysProxy from './src/api/kk7skyways.js';
import cron from 'node-cron';
import { fetchAndStoreAirspaces, fetchAndStoreObstacles } from './src/modules/update-xc-airspaces.js';
import createUserPreferencesRouter from './src/api/user-preferences.js'; // Import the user preferences router factory
import OgnAprsClient from './src/modules/ogn-aprs-client.js'; // Import OGN APRS client
import createOgnLiveRouter from './src/api/ogn-live.js'; // Import OGN Live API router
import createLookupRouter from './src/api/lookup.js'; // Import the new lookup router factory
import SrtmElevation from './src/modules/srtm-elevation.js'; // Import SRTM elevation module


const { Pool } = pkg;

// Load environment variables
config();

const app = express();

// Schedule daily airspace updates at 3 AM
cron.schedule('0 3 * * *', async () => {
    console.log('Running scheduled airspace update...');
    try {
        // Need to ensure pool is available here or passed differently
        // For now, assuming pool is globally accessible after initialization
        if (pool) {
            await fetchAndStoreObstacles(pool);
            await fetchAndStoreAirspaces(pool);
            console.log('Scheduled airspace update completed successfully');
        } else {
            console.error('Scheduled airspace update skipped: DB pool not initialized.');
        }
    } catch (err) {
        console.error('Scheduled airspace update failed:', err);
    }
});

// Schedule hourly cleanup of old aircraft tracks
cron.schedule('0 * * * *', async () => {
    console.log('Running scheduled cleanup of aircraft_tracks...');
    if (pool) {
        try {
            const result = await pool.query(
                "DELETE FROM aircraft_tracks WHERE timestamp < NOW() - INTERVAL '24 hours'"
            );
            console.log(`Scheduled cleanup of aircraft_tracks completed. ${result.rowCount} rows deleted.`);
        } catch (err) {
            console.error('Scheduled cleanup of aircraft_tracks failed:', err);
        }
    } else {
        console.error('Scheduled cleanup of aircraft_tracks skipped: DB pool not initialized.');
    }
});

// --- Configuration Loading ---
const configPath = path.join(process.cwd(), 'src', 'config.json');
let currentConfig = {};

function loadConfig() {
    try {
        console.log(`Attempting to load configuration from ${configPath}`);
        const rawData = fs.readFileSync(configPath, 'utf8');
        currentConfig = JSON.parse(rawData);
        console.log('Configuration loaded successfully:', currentConfig);
    } catch (err) {
        console.error('Error loading or parsing configuration file:', err);
        // Keep the old config or default to empty if initial load fails
        if (Object.keys(currentConfig).length === 0) {
            currentConfig = {}; // Ensure it's an object even on error
        }
    }
}

// Initial load
loadConfig();

// Watch for changes (with debounce)
let fsWait = false;
fs.watch(configPath, (eventType, filename) => {
    if (filename && eventType === 'change') {
        if (fsWait) return;
        fsWait = setTimeout(() => {
            fsWait = false;
        }, 100); // Debounce timeout
        console.log(`Configuration file ${filename} changed. Reloading...`);
        loadConfig();
    }
});
// --- End Configuration Loading ---


const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// PostgreSQL Connection Pool
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Initialize OGN APRS client
const ognClient = new OgnAprsClient(pool);

// Serve static files from "public" folder
app.use(express.static(path.join(process.cwd(), "build")));

// Serve index.html on root request
app.get("/", (req, res) => {
    res.sendFile(path.join(process.cwd(), "build", "index.html"));
});

// Use the API routers
app.use("/api/places", createPlacesRouter(pool));
app.use("/api", createWindRouter());
app.use("/api", createFeedbackRouter());
app.use("/api/airspaces", createAirspacesRouter());
app.use("/api/airspacesXC", createAirspacesXCRouter());
app.use("/api/proxy", createMoselfalkenImageRouter());
app.use("/api/airspacesXCdb", createAirspacesXCdbRouter(pool));
app.use("/api/obstacles", createObstaclesRouter(pool));
app.get("/api/kk7thermals/:z/:x/:y.png", kk7ThermalsProxy);
app.get("/api/kk7skyways/:z/:x/:y.png", kk7SkywayaysProxy);
app.use("/api/user", createUserPreferencesRouter(pool)); // Pass pool to the factory function
app.use("/api/ogn", createOgnLiveRouter(pool, ognClient)); // Use the OGN Live API router
app.use("/api/lookup", createLookupRouter(pool)); // Pass pool to the factory function

// --- Configuration Endpoint ---
app.get("/api/config", (req, res) => {
    res.json(currentConfig);
});
// --- End Configuration Endpoint ---

// Create HTTP server and Socket.IO instance
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Allow all origins in development
        methods: ["GET", "POST"]
    }
});

// Set up Socket.IO namespaces
const ognNamespace = io.of('/ogn');

// --- Start Server after Initializations ---
async function startServer() {
    try {
        // Check if PostGIS is installed in the database
        try {
            console.log('Checking for PostGIS extension...');
            const result = await pool.query(`
                SELECT 1 FROM pg_extension WHERE extname = 'postgis'
            `);
            if (result.rowCount > 0) {
                console.log('PostGIS extension is installed in the database');
            } else {
                console.warn('PostGIS extension is not installed in the database.');
                console.warn('Some spatial features may not work optimally.');
            }
        } catch (postgisError) {
            console.warn('Error checking for PostGIS extension:', postgisError.message);
        }

        // Initialize SRTM elevation module (only create table, don't import data)
        console.log('Initializing SRTM Elevation module...');
        const srtmElevation = new SrtmElevation(pool);
        await srtmElevation.initDatabase();
        console.log('SRTM database table initialized. Use one of the following scripts to import data:');
        console.log('- scripts/import-srtm.js (Pure JavaScript implementation)');
        console.log('- scripts/import-srtm-raster2pgsql.js (PostGIS implementation, recommended for large datasets)');

        console.log('Initializing OGN APRS Client (DB, data refresh, timers, connection)...');
        // Pass Socket.IO instance to OGN APRS client
        ognClient.setSocketIO(io);
        await ognClient.initializeAndStart(); // Use the new combined initialization method
        console.log('OGN APRS Client started successfully.');

        // --- Ensure xcm_pilots table exists (Added) ---
        try {
            console.log('Ensuring xcm_pilots table exists...');
            await pool.query(`
                CREATE TABLE IF NOT EXISTS xcm_pilots (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(255) NOT NULL, -- Keycloak user ID
                    pilot_name VARCHAR(255) NOT NULL,
                    device_id VARCHAR(50) NOT NULL,
                    -- xcontest_uuid VARCHAR(255), -- REMOVED - Store in Keycloak attributes
                    consent_timestamp TIMESTAMPTZ NOT NULL,
                    last_updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (user_id, device_id) -- Ensure a user can only add a device once
                    -- Consider adding FOREIGN KEY constraint if you have a users table:
                    -- FOREIGN KEY (user_id) REFERENCES your_user_table(id)
                );
            `);
// Drop xcontest_uuid column if it exists (moving to Keycloak attributes)
await pool.query(`
    ALTER TABLE xcm_pilots
    DROP COLUMN IF EXISTS xcontest_uuid;
`);
// Optional: Add indexes if not already handled by UNIQUE constraint or for other lookups
await pool.query(`CREATE INDEX IF NOT EXISTS idx_xcm_pilots_user_id ON xcm_pilots(user_id);`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_xcm_pilots_device_id ON xcm_pilots(device_id);`);
            console.log('xcm_pilots table check/creation complete.');
        } catch (tableError) {
            console.error('Error ensuring xcm_pilots table exists:', tableError);
            // Decide if this is a fatal error - probably should be?
            throw new Error('Failed to initialize xcm_pilots table.');
        }
        // --- End Ensure xcm_pilots table ---

        // --- Ensure aircraft and aircraft_tracks tables exist ---
        try {
            console.log('Ensuring aircraft and aircraft_tracks tables exist...');
            
            // Create aircraft table if it doesn't exist
            await pool.query(`
                CREATE TABLE IF NOT EXISTS aircraft (
                    device_id VARCHAR(50) PRIMARY KEY,
                    name VARCHAR(100),
                    type SMALLINT,
                    callsign VARCHAR(50),
                    last_seen TIMESTAMP WITH TIME ZONE,
                    last_lat DOUBLE PRECISION,
                    last_lon DOUBLE PRECISION,
                    last_alt_msl INTEGER,
                    last_alt_agl INTEGER,
                    last_course SMALLINT,
                    last_speed_kmh SMALLINT,
                    last_vs REAL,
                    last_turn_rate SMALLINT,
                    raw_packet TEXT,
                    pilot_name VARCHAR(100),
                    aprs_name VARCHAR(255) -- Added for OGN status message names
                );
            `);

            // Add aprs_name column if it doesn't exist
            await pool.query(`
                ALTER TABLE aircraft
                ADD COLUMN IF NOT EXISTS aprs_name VARCHAR(255);
            `);
            console.log('Ensured aprs_name column exists in aircraft table.');

            // Create tracks table if it doesn't exist
            await pool.query(`
                CREATE TABLE IF NOT EXISTS aircraft_tracks (
                    id SERIAL PRIMARY KEY,
                    aircraft_id VARCHAR(50) REFERENCES aircraft(device_id) ON DELETE CASCADE,
                    timestamp TIMESTAMP WITH TIME ZONE,
                    lat DOUBLE PRECISION,
                    lon DOUBLE PRECISION,
                    alt_msl INTEGER,
                    alt_agl INTEGER,
                    course SMALLINT,
                    speed_kmh SMALLINT,
                    vs REAL,
                    turn_rate SMALLINT,
                    status VARCHAR(20)
                );
            `);

            // Add status column if it doesn't exist (for existing tables)
            await pool.query(`
                ALTER TABLE aircraft_tracks
                ADD COLUMN IF NOT EXISTS status VARCHAR(20);
            `);
            
            // Create indexes for faster queries
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_aircraft_tracks_device_id ON aircraft_tracks(aircraft_id);
                CREATE INDEX IF NOT EXISTS idx_aircraft_tracks_timestamp ON aircraft_tracks(timestamp);
            `);
            
            console.log('aircraft and aircraft_tracks tables check/creation complete.');
        } catch (tableError) {
            console.error('Error ensuring aircraft and aircraft_tracks tables exist:', tableError);
            console.log('Will continue startup process despite aircraft tables error.');
            // Not throwing error here to allow server to start even if these tables fail
        }
        // --- End Ensure aircraft and aircraft_tracks tables ---

        // --- Manual Trigger ---
        console.log('MANUALLY TRIGGERING PILOT DB REFRESH...');
        try {
            await ognClient.refreshPilotDatabase();
            await ognClient.refreshFlarmnetDatabase();
            console.log('MANUAL PILOT DB REFRESH COMPLETE.');
        } catch (refreshError) {
            console.error('MANUAL PILOT DB REFRESH FAILED:', refreshError);
        }
        // --- End Manual Trigger ---

        // Socket.IO connection handler for OGN namespace
        ognNamespace.on('connection', (socket) => {
            console.log('Client connected to OGN namespace:', socket.id);
            
            // Handle client subscribing to aircraft updates within bounds
            socket.on('subscribe', (bounds) => {
                console.log(`Client ${socket.id} subscribed to aircraft updates within bounds:`, bounds);
                // Store bounds in socket object for later use
                socket.bounds = bounds;
                socket.join('aircraft-updates');
                
                // Send initial aircraft data within bounds
                if (ognClient && bounds) {
                    ognClient.getAircraftInBounds(bounds)
                        .then(aircraft => {
                            socket.emit('aircraft-init', aircraft);
                        })
                        .catch(err => {
                            console.error('Error fetching initial aircraft data:', err);
                        });
                }
            });
            
            // Handle client requesting track data for a specific aircraft
            socket.on('get-track', (aircraftId) => {
                console.log(`Client ${socket.id} requested track for aircraft:`, aircraftId);
                if (ognClient && aircraftId) {
                    ognClient.getAircraftTrack(aircraftId, 720) // 60 minutes of history
                        .then(track => {
                            socket.emit('track-data', { aircraftId, track });
                        })
                        .catch(err => {
                            console.error('Error fetching aircraft track:', err);
                        });
                }
            });
            
            // Handle client updating their view bounds
            socket.on('update-bounds', (bounds) => {
                // console.log(`Client ${socket.id} updated bounds:`, bounds);
                socket.bounds = bounds;
            });
            
            // Handle disconnection
            socket.on('disconnect', () => {
                console.log('Client disconnected from OGN namespace:', socket.id);
            });
        });
        
        // Start the HTTP server
        httpServer.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('Failed to initialize OGN or start server:', err);
        process.exit(1); // Exit if critical initialization fails
    }
}

startServer();
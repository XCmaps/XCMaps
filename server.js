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
import compression from 'compression'; // Import compression middleware

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
import createUserPreferencesRouter from './src/api/user-preferences.js'; 
import OgnAprsClient from './src/modules/ogn-aprs-client.js'; 
import createOgnLiveRouter from './src/api/ogn-live.js'; 
import createLookupRouter from './src/api/lookup.js'; 
import SrtmElevation from './src/modules/srtm-elevation.js';
import { initXContestLive } from './src/api/xcontest-live.js';
// mapBrowserLangToDeeplx and TEXT_DELIMITER will be used by the new translate router module
import createTranslateRouter from './src/api/translate.js'; // Import the new translate router
 
 
const { Pool } = pkg;

// Load environment variables
config();

const app = express();

// Schedule daily airspace updates at 3 AM
cron.schedule('0 4 * * *', async () => {
    console.log('Running scheduled airspace update...');
    try {
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
        if (Object.keys(currentConfig).length === 0) {
            currentConfig = {}; 
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
        }, 100); 
        console.log(`Configuration file ${filename} changed. Reloading...`);
        loadConfig();
    }
});
// --- End Configuration Loading ---


const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());
// Enable Gzip compression for all responses
app.use(compression());
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
app.use("/api/user", createUserPreferencesRouter(pool)); 
app.use("/api/ogn", createOgnLiveRouter(pool, ognClient));
app.use("/api/lookup", createLookupRouter(pool));
app.use("/api", createTranslateRouter()); // Register the new translate router
 
// --- Configuration Endpoint ---
app.get("/api/config", (req, res) => {
    res.json(currentConfig);
});
// --- End Configuration Endpoint ---

// Create HTTP server and Socket.IO instance
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", 
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
        ognClient.setSocketIO(io);
        await ognClient.initializeAndStart(); 
        console.log('OGN APRS Client started successfully.');

        console.log('Initializing XContest Live data fetching...');
        initXContestLive(io); 
        console.log('XContest Live data fetching initialized.');

        try {
            console.log('Ensuring xcm_pilots table exists...');
            await pool.query(`
                CREATE TABLE IF NOT EXISTS xcm_pilots (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(255) NOT NULL, 
                    pilot_name VARCHAR(255) NOT NULL,
                    device_id VARCHAR(50) NOT NULL,
                    consent_timestamp TIMESTAMPTZ NOT NULL,
                    last_updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (user_id, device_id) 
                );
            `);
            await pool.query(`
                ALTER TABLE xcm_pilots
                DROP COLUMN IF EXISTS xcontest_uuid;
            `);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_xcm_pilots_user_id ON xcm_pilots(user_id);`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_xcm_pilots_device_id ON xcm_pilots(device_id);`);
            console.log('xcm_pilots table check/creation complete.');
        } catch (tableError) {
            console.error('Error ensuring xcm_pilots table exists:', tableError);
            throw new Error('Failed to initialize xcm_pilots table.');
        }

        try {
            console.log('Ensuring aircraft and aircraft_tracks tables exist...');
            
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
                    aprs_name VARCHAR(255) 
                );
            `);

            await pool.query(`
                ALTER TABLE aircraft
                ADD COLUMN IF NOT EXISTS aprs_name VARCHAR(255);
            `);
            console.log('Ensured aprs_name column exists in aircraft table.');

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

            await pool.query(`
                ALTER TABLE aircraft_tracks
                ADD COLUMN IF NOT EXISTS status VARCHAR(20);
            `);
            
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_aircraft_tracks_device_id ON aircraft_tracks(aircraft_id);
                CREATE INDEX IF NOT EXISTS idx_aircraft_tracks_timestamp ON aircraft_tracks(timestamp);
            `);
            
            console.log('aircraft and aircraft_tracks tables check/creation complete.');
        } catch (tableError) {
            console.error('Error ensuring aircraft and aircraft_tracks tables exist:', tableError);
            console.log('Will continue startup process despite aircraft tables error.');
        }

        try {
            console.log('Ensuring aprs_blacklist table exists...');
            await pool.query(`
                CREATE TABLE IF NOT EXISTS aprs_blacklist (
                    device_id TEXT PRIMARY KEY
                );
            `);
            console.log('aprs_blacklist table check/creation complete.');
        } catch (tableError) {
            console.error('Error ensuring aprs_blacklist table exists:', tableError);
        }
        console.log('MANUALLY TRIGGERING PILOT DB REFRESH...');
        try {
            await ognClient.refreshPilotDatabase();
            await ognClient.refreshFlarmnetDatabase();
            console.log('MANUAL PILOT DB REFRESH COMPLETE.');
        } catch (refreshError) {
            console.error('MANUAL PILOT DB REFRESH FAILED:', refreshError);
        }

        ognNamespace.on('connection', (socket) => {
            console.log('Client connected to OGN namespace:', socket.id);
            
            socket.on('subscribe', (bounds) => {
                console.log(`Client ${socket.id} subscribed to aircraft updates within bounds:`, bounds);
                socket.bounds = bounds;
                socket.join('aircraft-updates');
                
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
            
            socket.on('get-track', (aircraftId) => {
                console.log(`Client ${socket.id} requested track for aircraft:`, aircraftId);
                if (ognClient && aircraftId) {
                    ognClient.getAircraftTrack(aircraftId, 720) 
                        .then(track => {
                            socket.emit('track-data', { aircraftId, track });
                        })
                        .catch(err => {
                            console.error('Error fetching aircraft track:', err);
                        });
                }
            });
            
            socket.on('update-bounds', (bounds) => {
                socket.bounds = bounds;
            });
            
            socket.on('disconnect', () => {
                console.log('Client disconnected from OGN namespace:', socket.id);
            });
        });
        
        httpServer.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('Failed to initialize OGN or start server:', err);
        process.exit(1); 
    }
}

startServer();
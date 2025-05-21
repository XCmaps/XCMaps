import fetch from 'node-fetch';
import pkg from 'pg';
import dotenv from 'dotenv';
import TerrainRgbElevation from '../modules/terrain-rgb-elevation.js'; // Using Terrain-RGB elevation service

dotenv.config();
const { Pool } = pkg;

// --- Constants ---
const XCONTEST_API_URL_BASE = 'https://api.xcontest.org/livedata/users?entity=group:xcmaps&opentime=';
const XCONTEST_TOKEN = process.env.XCONTEST_TOKEN;
const FETCH_INTERVAL_MS = 60 * 1000; // 1 minute
const DB_CONNECTION_STRING = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

// --- Pilot Status Calculation Constants (copied from ogn-aprs-client.js) ---
const AGL_GROUND_MAX = 20; // Max AGL considered 'on ground' (meters)
const AGL_FLYING_MIN = 30; // Min AGL considered 'flying' (meters)
const SPEED_RESTING_MAX_MS = 1.0; // m/s
const SPEED_HIKING_MAX_MS = 3.0; // m/s
const SPEED_TAKEOFF_MIN_MS = 5.0; // m/s
const SPEED_LANDING_MAX_MS = 4.0; // m/s
// const VS_TAKEOFF_MIN = 0.3; // m/s (Optional, can be adjusted/removed) - Not directly available in XContest data
// const VS_LANDING_MAX = -0.3; // m/s (Optional, can be adjusted/removed) - Not directly available in XContest data
const TIME_WINDOW_TRANSITION_MS = 10000; // 10 seconds
const TIME_WINDOW_LANDING_CONFIRM_MS = 15000; // 15 seconds
const STATUS_HISTORY_SIZE = 10; // Number of recent points for status calculation
// --- End Pilot Status Constants ---

const pool = new Pool({ connectionString: DB_CONNECTION_STRING });
const terrainElevation = new TerrainRgbElevation(pool); // Initialize Terrain-RGB Elevation service
const pilotStatusCache = new Map(); // Cache for pilot status calculation state
let SIO_INSTANCE = null; // To store the Socket.IO instance

/**
 * Calculates Altitude Above Ground Level (AGL)
 */
async function calculateAGL(lat, lon, altMsl) {
    try {
        let elevation = await terrainElevation.getElevation(lat, lon);
        if (elevation !== null) {
            const tolerance = 5;
            const agl = Math.max(0, Math.round(altMsl - elevation + tolerance));
            if (agl === 0 && altMsl > elevation + 20) {
                console.warn(`XContest AGL: Zero AGL despite MSL significantly higher than elevation: altMsl=${altMsl}, elevation=${elevation}, diff=${altMsl - elevation}, lat=${lat}, lon=${lon}`);
            }
            return agl;
        } else {
            console.warn(`XContest AGL: No elevation data for ${lat},${lon}. Returning MSL.`);
            return Math.round(altMsl);
        }
    } catch (err) {
        console.error(`XContest AGL: Error calculating AGL for ${lat},${lon}:`, err);
        return Math.round(altMsl); // Return MSL as fallback
    }
}

/**
 * Calculates pilot status based on current and historical data.
 * Adapted from ogn-aprs-client.js
 */
async function calculatePilotStatus(aircraftId, newPointData) {
    if (newPointData.alt_agl === null || newPointData.speed_kmh === null) { // vs is not directly available
        const cachedState = pilotStatusCache.get(aircraftId);
        return cachedState ? cachedState.currentStatus : 'unknown';
    }
    const currentTimestamp = new Date(newPointData.timestamp).getTime();
    const currentSpeedMS = newPointData.speed_kmh / 3.6; // Speed needs to be calculated if not directly available
                                                        // XContest 'lastLoc' doesn't have speed. 'flights' has 'lastFix' but that might not be the *very* last.
                                                        // For now, we'll assume speed_kmh is derived or will be 0 if landed.
                                                        // This part needs refinement based on how speed is determined from XContest data.
                                                        // If 'landed' is true, speed can be assumed to be 0.

    const currentPoint = {
        timestampMs: currentTimestamp,
        alt_agl: newPointData.alt_agl,
        speed_ms: newPointData.landed ? 0 : currentSpeedMS, // Assume 0 speed if landed
        vs: newPointData.vs || 0 // vs is not directly available, default to 0
    };

    let state = pilotStatusCache.get(aircraftId);
    if (!state) {
        let client;
        try {
            client = await pool.connect();
            const historyRes = await client.query(
                `SELECT timestamp, alt_agl, speed_kmh, vs, status
                 FROM aircraft_tracks
                 WHERE aircraft_id = $1 AND alt_agl IS NOT NULL AND speed_kmh IS NOT NULL
                 ORDER BY timestamp DESC
                 LIMIT $2`,
                [aircraftId, STATUS_HISTORY_SIZE]
            );
            state = {
                currentStatus: 'unknown',
                recentPoints: [],
                landingConfirmationStart: null
            };
            if (historyRes.rows.length > 0) {
                const historyRows = historyRes.rows.reverse();
                state.currentStatus = historyRows[historyRows.length - 1].status || 'unknown';
                state.recentPoints = historyRows.map(r => ({
                    timestampMs: new Date(r.timestamp).getTime(),
                    alt_agl: r.alt_agl,
                    speed_ms: r.speed_kmh / 3.6,
                    vs: r.vs || 0
                }));
            }
        } catch (dbError) {
            console.error(`XContest Status: Error fetching status history for ${aircraftId}:`, dbError);
            state = { currentStatus: 'unknown', recentPoints: [], landingConfirmationStart: null };
        } finally {
            if (client) client.release();
        }
    }

    state.recentPoints.push(currentPoint);
    if (state.recentPoints.length > STATUS_HISTORY_SIZE) {
        state.recentPoints.shift();
    }

    let nextStatus = state.currentStatus;
    const relevantHistory = state.recentPoints.filter(p => currentTimestamp - p.timestampMs <= TIME_WINDOW_TRANSITION_MS);
    let avgSpeed = 0;
    let altChange = 0;
    // let avgVs = 0; // vs not reliably available
    let isConsistentlyAboveGround = false;
    // let isConsistentlyBelowGround = false; // Not used in the same way here

    if (relevantHistory.length >= 2) {
        const first = relevantHistory[0];
        const last = relevantHistory[relevantHistory.length - 1];
        avgSpeed = relevantHistory.reduce((sum, p) => sum + p.speed_ms, 0) / relevantHistory.length;
        altChange = last.alt_agl - first.alt_agl;
        // avgVs = relevantHistory.reduce((sum, p) => sum + p.vs, 0) / relevantHistory.length;
        isConsistentlyAboveGround = relevantHistory.every(p => p.alt_agl > AGL_GROUND_MAX);
    } else if (relevantHistory.length === 1) {
        avgSpeed = relevantHistory[0].speed_ms;
        // avgVs = relevantHistory[0].vs;
        isConsistentlyAboveGround = relevantHistory[0].alt_agl > AGL_GROUND_MAX;
    }

    const currentAgl = currentPoint.alt_agl;
    const actualSpeedMS = currentPoint.speed_ms; // Use the speed derived for the current point

    if (state.currentStatus === 'flying') {
        if (newPointData.landed || (currentAgl < AGL_GROUND_MAX && actualSpeedMS < SPEED_LANDING_MAX_MS)) {
            nextStatus = 'landed';
            state.landingConfirmationStart = currentTimestamp;
        }
    } else if (state.currentStatus === 'landed') {
        if (actualSpeedMS < SPEED_RESTING_MAX_MS && state.landingConfirmationStart && (currentTimestamp - state.landingConfirmationStart >= TIME_WINDOW_LANDING_CONFIRM_MS)) {
            nextStatus = 'resting';
            state.landingConfirmationStart = null;
        } else if (actualSpeedMS >= SPEED_RESTING_MAX_MS) {
            state.landingConfirmationStart = null;
            if (actualSpeedMS < SPEED_HIKING_MAX_MS) nextStatus = 'hiking';
            else nextStatus = 'driving'; // Or could be 'started' if AGL increases
        }
        if (!newPointData.landed && currentAgl > AGL_GROUND_MAX && actualSpeedMS > SPEED_TAKEOFF_MIN_MS) {
             nextStatus = 'started';
             state.landingConfirmationStart = null;
        }
    } else if (state.currentStatus === 'started') {
        if (currentAgl > AGL_FLYING_MIN && isConsistentlyAboveGround) {
             nextStatus = 'flying';
        } else if (newPointData.landed || currentAgl < AGL_GROUND_MAX) {
            if (actualSpeedMS < SPEED_RESTING_MAX_MS) nextStatus = 'resting';
            else if (actualSpeedMS < SPEED_HIKING_MAX_MS) nextStatus = 'hiking';
            else nextStatus = 'driving';
        }
    } else { // 'unknown', 'resting', 'hiking', 'driving'
        const takeoffSpeedCondition = !newPointData.landed && relevantHistory.length > 1 && relevantHistory.every(p => p.speed_ms > SPEED_TAKEOFF_MIN_MS);
        const takeoffAltCondition = !newPointData.landed && currentAgl > AGL_GROUND_MAX && altChange > 0;

        if (takeoffSpeedCondition && takeoffAltCondition) {
            nextStatus = 'started';
        } else if (newPointData.landed || currentAgl < AGL_GROUND_MAX) {
            if (actualSpeedMS < SPEED_RESTING_MAX_MS) nextStatus = 'resting';
            else if (actualSpeedMS < SPEED_HIKING_MAX_MS) nextStatus = 'hiking';
            else nextStatus = 'driving';
        } else if (!newPointData.landed && currentAgl > AGL_GROUND_MAX) {
            // If airborne but takeoff not detected, directly set to flying
            nextStatus = 'flying';
        }
    }

    state.currentStatus = nextStatus;
    pilotStatusCache.set(aircraftId, state);
    return nextStatus;
}


/**
 * Fetches flight data from XContest API and updates the database.
 */
async function fetchAndProcessXContestData() {
    console.log('Fetching XContest live data...');
    const now = new Date();
    const opentime = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const apiUrl = `${XCONTEST_API_URL_BASE}${opentime}`;

    try {
        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `Bearer ${XCONTEST_TOKEN}`
            }
        });

        if (!response.ok) {
            console.error(`Error fetching XContest data: ${response.status} ${response.statusText}`);
            const errorBody = await response.text();
            console.error('Error body:', errorBody);
            return;
        }

        const data = await response.json();

        if (!data.users || typeof data.users !== 'object') {
            console.error('XContest API response does not contain users object:', data);
            return;
        }

        const processedAircraftForSocket = []; // Store data for WebSocket emission

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            for (const deviceId in data.users) {
                const user = data.users[deviceId];
                const lastLoc = user.lastLoc;
                const flightInfo = user.flights && user.flights.length > 0 ? user.flights[0] : null; // Assuming the first flight is the relevant one

                if (!lastLoc || !lastLoc.geometry || !lastLoc.geometry.coordinates) {
                    console.warn(`Skipping user ${deviceId} due to missing location data.`);
                    continue;
                }

                const coords = lastLoc.geometry.coordinates;
                const timestamp = coords[3] && coords[3].t ? coords[3].t : new Date().toISOString(); // Fallback to now if t is missing
                const lon = coords[0];
                const lat = coords[1];
                const altMsl = coords[2];

                // Map FAI class to aircraft type
                let aircraftType = null; // Default to null or a generic type
                if (flightInfo && flightInfo.faiClass) {
                    if (flightInfo.faiClass.includes('FAI-3')) aircraftType = 7; // PG
                    else if (flightInfo.faiClass.includes('FAI-1')) aircraftType = 6; // HG
                }

                const altAgl = await calculateAGL(lat, lon, altMsl);

                // For status calculation, we need speed.
                // XContest 'lastLoc' has a 'landed' boolean. If true, speed is 0.
                // If not landed, speed is not directly in 'lastLoc'.
                // We'll pass the 'landed' status to calculatePilotStatus.
                // A more robust speed calculation might involve looking at recent track points if available.
                const speedKmh = lastLoc.properties && lastLoc.properties.landed ? 0 : (flightInfo && flightInfo.lastFix && flightInfo.lastFix.speed) ? flightInfo.lastFix.speed : 0; // Placeholder if not landed and no speed in flightInfo

                const pilotStatusData = {
                    timestamp: timestamp,
                    alt_agl: altAgl,
                    speed_kmh: speedKmh, // This needs to be accurate for good status calculation
                    vs: null, // Vertical speed is not directly available from lastLoc
                    landed: lastLoc.properties ? lastLoc.properties.landed : false
                };
                const status = await calculatePilotStatus(deviceId, pilotStatusData);


                // Upsert into aircraft table
                const aircraftQuery = `
                    INSERT INTO aircraft (device_id, name, type, last_seen, last_lat, last_lon, last_alt_msl, last_alt_agl, callsign)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (device_id) DO UPDATE SET
                        name = EXCLUDED.name,
                        type = EXCLUDED.type,
                        last_seen = EXCLUDED.last_seen,
                        last_lat = EXCLUDED.last_lat,
                        last_lon = EXCLUDED.last_lon,
                        last_alt_msl = EXCLUDED.last_alt_msl,
                        last_alt_agl = EXCLUDED.last_alt_agl,
                        callsign = EXCLUDED.callsign;
                `;
                await client.query(aircraftQuery, [
                    deviceId,
                    user.fullname,
                    aircraftType,
                    timestamp,
                    lat,
                    lon,
                    altMsl,
                    altAgl,
                    user.username // Using username as callsign as there's no direct callsign field
                ]);

                // Insert into aircraft_tracks table
                const trackQuery = `
                    INSERT INTO aircraft_tracks (aircraft_id, timestamp, lat, lon, alt_msl, alt_agl, status, speed_kmh)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
                `;
                await client.query(trackQuery, [
                    deviceId,
                    timestamp,
                    lat,
                    lon,
                    altMsl,
                    altAgl,
                    status,
                    speedKmh // Storing speed_kmh used for status calculation
                ]);
                console.log(`Processed data for ${user.fullname} (${deviceId})`);

                // Prepare data for WebSocket emission
                processedAircraftForSocket.push({
                    id: deviceId,
                    name: user.fullname,
                    last_lat: lat,
                    last_lon: lon,
                    last_alt_msl: altMsl,
                    last_alt_agl: altAgl,
                    last_course: null, // XContest doesn't provide course directly in lastLoc
                    last_speed_kmh: speedKmh,
                    last_vs: null, // XContest doesn't provide VS directly in lastLoc
                    last_turn_rate: null, // XContest doesn't provide turn rate
                    status: status,
                    type: aircraftType,
                    pilot_name: user.fullname, // Redundant with name, but matches OGN structure
                    last_seen: timestamp,
                    update_timestamp: Date.now()
                });
            }
            await client.query('COMMIT');
            console.log('XContest data processed and committed successfully.');

            // Enhanced logging before emission
            console.log(`[XContest Emission Check] SIO_INSTANCE is ${SIO_INSTANCE ? 'defined' : 'null'}`);
            console.log(`[XContest Emission Check] processedAircraftForSocket length: ${processedAircraftForSocket.length}`);
            if (processedAircraftForSocket.length > 0) {
                // Log only the ID of the first aircraft to avoid overly verbose logs if many aircraft
                console.log(`[XContest Emission Check] First aircraft ID in processedAircraftForSocket: ${processedAircraftForSocket[0].id}`);
            }

            // Emit WebSocket events for processed aircraft
            if (SIO_INSTANCE && processedAircraftForSocket.length > 0) {
                console.log(`[XContest Emission Attempt] Attempting to emit for ${processedAircraftForSocket.length} XContest aircraft.`);
                const ognNamespace = SIO_INSTANCE.of('/ogn');
                const sockets = await ognNamespace.in('aircraft-updates').fetchSockets();
                console.log(`[XContest Emission Check] Found ${sockets.length} sockets in 'aircraft-updates' room.`);

                for (const aircraftData of processedAircraftForSocket) {
                    let emittedToAtLeastOneClient = false;
                    for (const socket of sockets) {
                        let shouldEmit = false;
                        if (socket.bounds && socket.bounds._southWest && socket.bounds._northEast) { // Ensure bounds are complete
                            const { last_lat, last_lon } = aircraftData;
                            if (
                                last_lat >= socket.bounds._southWest.lat &&
                                last_lat <= socket.bounds._northEast.lat &&
                                last_lon >= socket.bounds._southWest.lng &&
                                last_lon <= socket.bounds._northEast.lng
                            ) {
                                shouldEmit = true;
                            } else {
                                // console.log(`[XContest Skip Emit] ${aircraftData.id} to ${socket.id} - out of bounds.`);
                            }
                        } else {
                            // console.log(`[XContest Emit Fallback] ${aircraftData.id} to ${socket.id} - client has no bounds or incomplete bounds, emitting.`);
                            shouldEmit = true; // Emit if no bounds or incomplete bounds from client
                        }

                        if (shouldEmit) {
                            socket.emit('aircraft-update', aircraftData);
                            emittedToAtLeastOneClient = true;
                            // console.log(`[XContest Emit] Emitted ${aircraftData.id} to ${socket.id}`);
                        }
                    }
                    if (!emittedToAtLeastOneClient && sockets.length > 0) {
                        console.log(`[XContest No Emit] ${aircraftData.id} was not emitted to any of the ${sockets.length} clients (likely all out of bounds).`);
                    } else if (sockets.length === 0) {
                        console.log(`[XContest No Emit] ${aircraftData.id} - no clients currently in 'aircraft-updates' room.`);
                    }
                }
            } else {
                if (!SIO_INSTANCE) {
                    console.warn('[XContest Emission Skip] SIO_INSTANCE is null. Cannot emit WebSocket updates.');
                }
                if (processedAircraftForSocket.length === 0) {
                    console.log('[XContest Emission Skip] processedAircraftForSocket is empty. Nothing to emit.');
                }
            }

        } catch (dbError) {
            await client.query('ROLLBACK');
            console.error('Error processing XContest data and updating database:', dbError);
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Failed to fetch or process XContest data:', error);
    }
}

/**
 * Initializes the XContest live data fetching.
 * @param {object} io - The Socket.IO server instance.
 */
export function initXContestLive(io) {
    if (!XCONTEST_TOKEN) {
        console.error('XCONTEST_TOKEN is not defined in .env file. XContest live data will not be fetched.');
        return;
    }
    if (!io) {
        console.error('Socket.IO instance not provided to initXContestLive. WebSocket emissions will be disabled.');
    }
    SIO_INSTANCE = io; // Store the Socket.IO instance

    console.log('Initializing XContest live data fetching...');
    fetchAndProcessXContestData(); // Initial fetch
    setInterval(fetchAndProcessXContestData, FETCH_INTERVAL_MS);
    console.log(`XContest live data fetching scheduled every ${FETCH_INTERVAL_MS / 1000} seconds.`);
}

// If this script is run directly (e.g., for testing or as a standalone service)
if (import.meta.url === `file://${process.argv[1]}`) {
    // For standalone execution, Socket.IO would need to be set up differently or emissions skipped.
    console.warn('Running xcontest-live.js directly. Socket.IO emissions will be skipped unless an IO instance is provided.');
    initXContestLive(null); // Pass null if no IO instance is available
}
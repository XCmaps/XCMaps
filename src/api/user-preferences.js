import express from 'express';
// Removed incorrect pool import: import pool from '../db.js';
import KcAdminClient from '@keycloak/keycloak-admin-client';
import jwt from 'jsonwebtoken'; // Import jwt for decoding
import { authenticateToken, requireRole } from '../middleware/auth.js'; // Import middleware
import 'dotenv/config';

// --- Keycloak Admin Client Setup ---
// Validate necessary environment variables
const requiredEnvVars = [
    'KEYCLOAK_ADMIN_URL',
    'KEYCLOAK_REALM_NAME',
    'KEYCLOAK_ADMIN_CLIENT_ID',
    'KEYCLOAK_ADMIN_CLIENT_SECRET'
];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`ERROR: Environment variable ${envVar} is required for Keycloak Admin Client.`);
        process.exit(1);
    }
}

const kcAdminClient = new KcAdminClient({
    baseUrl: process.env.KEYCLOAK_ADMIN_URL.replace(/\/admin\/.*$/, ''), // Base URL of Keycloak (e.g., http://keycloak:8080/auth)
    realmName: process.env.KEYCLOAK_REALM_NAME,
});

// Function to ensure the admin client is authenticated
async function ensureAdminAuth() {
    try {
        // Force re-authentication before each request to ensure fresh token
        console.log("Attempting to authenticate Keycloak Admin Client...");
        await kcAdminClient.auth({
            grantType: 'client_credentials',
            clientId: process.env.KEYCLOAK_ADMIN_CLIENT_ID,
            clientSecret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET,
        });
        console.log("Keycloak Admin Client authenticated successfully for this request.");
    } catch (error) {
        console.error('FATAL: Failed to authenticate Keycloak Admin Client:', error.message);
        // Depending on the error, you might want to retry or exit
        // For now, we throw to prevent proceeding without auth
        throw new Error('Keycloak Admin Client authentication failed.');
    }
}

// --- Middleware to extract User ID without strict verification ---
// Used for operations like saving preferences on logout where the token might be expired,
// but we still need the user ID associated with the session.
function getUserIdIfPresent(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (token) {
        try {
            // Decode without verification to get claims even if expired/invalid signature
            const decoded = jwt.decode(token);
            if (decoded && decoded.sub) {
                // Attach essential user info if decoding is successful
                req.user = {
                    id: decoded.sub,
                    username: decoded.preferred_username || 'unknown', // Add username if available
                    roles: decoded.realm_access?.roles || []
                };
                 console.log(`User ID ${req.user.id} extracted from token (verification skipped).`);
            } else {
                 console.log("Token decoded but 'sub' (user ID) claim missing.");
                 // Optionally handle this case - maybe deny access? For now, just log.
                 // If req.user is needed downstream, this will cause issues.
            }
        } catch (err) {
            console.error("Error decoding token (without verification):", err.message);
            // Proceed without req.user if decoding fails
        }
    } else {
         console.log("No authorization token found in header.");
         // Proceed without req.user
    }
    next(); // Always proceed, subsequent middleware/routes handle missing req.user if needed
}


export default function createUserPreferencesRouter(pool) { // Accept pool as argument
    const router = express.Router();

    // Middleware order matters! Apply role check *after* user info is attached.
    // GET /api/user/preferences - Retrieve user preferences
    // GET /api/user/preferences - Retrieve user preferences (Requires STRICT authentication)
    // GET /api/user/preferences - Retrieve user preferences (Requires STRICT authentication AND 'user' role)
    // Use getUserIdIfPresent to allow fetching even if token slightly expired, requires 'user' role
    router.get('/preferences', getUserIdIfPresent, requireRole('user'), async (req, res) => {
        // Check if user ID was successfully extracted
        if (!req.user || !req.user.id) {
             console.error("GET /preferences: User ID could not be determined from token.");
             // Mirror PUT's response for consistency
             return res.status(401).json({ message: 'User identification failed.' });
        }
        const userId = req.user.id; // Get user ID from potentially expired token
        console.log(`GET /preferences request for user ID: ${userId}`);

        try {
            await ensureAdminAuth(); // Make sure admin client is authenticated

            const user = await kcAdminClient.users.findOne({ id: userId, realm: process.env.KEYCLOAK_REALM_NAME });

            if (!user) {
                console.warn(`User not found in Keycloak with ID: ${userId}`);
                return res.status(404).json({ message: 'User not found' });
            }

            const preferencesAttr = user.attributes?.preferences?.[0];
            // console.log(`Raw preferences attribute for user ${userId}:`, preferencesAttr); // Reduced logging
 
 
            if (preferencesAttr) {
                try {
                    const preferences = JSON.parse(preferencesAttr);
                    // console.log(`Parsed Keycloak preferences for user ${userId}:`, preferences); // Reduced logging
 
                    // --- Fetch Pilot Names from DB (UUID removed) ---
                    let pilotNames = [];
                    try {
                        const dbResult = await pool.query(
                            'SELECT device_id, pilot_name FROM xcm_pilots WHERE user_id = $1', // Removed xcontest_uuid
                            [userId]
                        );
                        // Map to the expected format { deviceId: '...', name: '...' }
                        pilotNames = dbResult.rows.map(row => ({
                            deviceId: row.device_id,
                            name: row.pilot_name
                            // xcontestUuid: row.xcontest_uuid // REMOVED - Get from preferences object
                        }));
                        // console.log(`Fetched pilot names from DB for user ${userId}:`, pilotNames); // Reduced logging
                    } catch (dbError) {
                        console.error(`Error fetching pilot names from DB for user ${userId}:`, dbError);
                        // Decide if this is fatal or if we can return preferences without pilot names
                        // For now, let's return what we have from Keycloak but log the error
                    }
                    // --- End Fetch Pilot Names ---

                    // Combine Keycloak prefs (which now includes xcontestUuid) and DB pilot names
                    const combinedPreferences = {
                        ...preferences, // Contains xcontestUuid from Keycloak attributes
                        pilotNames: pilotNames // Contains only deviceId and name from DB
                    };

                    return res.json(combinedPreferences);
                } catch (parseError) {
                    console.error(`Error parsing preferences JSON for user ${userId}:`, parseError);
                    // Decide how to handle corrupted data - return default or error?
                    return res.status(500).json({ message: 'Error parsing stored preferences' });
                }
            } else {
                 // console.log(`No preferences found in Keycloak for user ${userId}. Fetching pilot names from DB.`); // Reduced logging
                 // Still fetch pilot names even if no Keycloak prefs exist
                 let pilotNames = [];
                 try {
                     const dbResult = await pool.query(
                         'SELECT device_id, pilot_name FROM xcm_pilots WHERE user_id = $1', // Removed xcontest_uuid
                         [userId]
                     );
                     pilotNames = dbResult.rows.map(row => ({
                         deviceId: row.device_id,
                         name: row.pilot_name
                         // xcontestUuid: row.xcontest_uuid // REMOVED
                     }));
                     // console.log(`Fetched pilot names from DB for user ${userId}:`, pilotNames); // Reduced logging
                 } catch (dbError) {
                     console.error(`Error fetching pilot names from DB for user ${userId}:`, dbError);
                 }
                 // Return only pilot names if no other prefs
                 return res.json({ pilotNames: pilotNames });
            }

        } catch (error) {
            console.error(`Error fetching preferences for user ${userId}:`, error.message || error);
             // Check for specific Keycloak client errors if needed
            if (error.response?.status === 401 || error.message === 'Keycloak Admin Client authentication failed.') {
                 // Re-throw auth error or handle specifically
                 return res.status(500).json({ message: 'Failed to authenticate service account with Keycloak.' });
            }
            return res.status(500).json({ message: 'Failed to retrieve user preferences' });
        }
    });

    // PUT /api/user/preferences - Update user preferences
    // PUT /api/user/preferences - Update user preferences (Allows potentially expired token, just needs User ID)
    // PUT /api/user/preferences - Update user preferences (Allows potentially expired token, just needs User ID AND 'user' role)
    router.put('/preferences', getUserIdIfPresent, requireRole('user'), async (req, res) => {
        // Check if user ID was successfully extracted
        if (!req.user || !req.user.id) {
             console.error("PUT /preferences: User ID could not be determined from token.");
             // Decide appropriate response: 401 Unauthorized or 400 Bad Request?
             // Since the user *should* have a session, but token is bad/missing, 401 seems reasonable.
             return res.status(401).json({ message: 'User identification failed.' });
        }
        const userId = req.user.id;
        const newPreferences = req.body; // Expecting a JSON object
 
        // console.log(`PUT /preferences request for user ID: ${userId} with data:`, newPreferences); // Reduced logging
 
 
        // Basic validation: Ensure body is an object (could add more specific schema validation)
        if (typeof newPreferences !== 'object' || newPreferences === null) {
            return res.status(400).json({ message: 'Invalid request body: Expected a JSON object.' });
        }

        try {
            await ensureAdminAuth(); // Make sure admin client is authenticated

            // --- Separate Pilot Names from other Preferences (Added) ---
            const pilotNamesToSave = newPreferences.pilotNames || [];
            // const userXcontestUuid = newPreferences.xcontestUuid || null; // No longer needed here
            // Create a new object for Keycloak attributes *without* pilotNames
            // Keep xcontestUuid IN the object to be saved to Keycloak
            const keycloakPreferences = { ...newPreferences };
            delete keycloakPreferences.pilotNames; // Only remove pilotNames
            const preferencesString = JSON.stringify(keycloakPreferences); // Stringify the object containing xcontestUuid
            // console.log(`Updating Keycloak preferences for user ${userId} with string: ${preferencesString}`); // Reduced logging
            console.log(`Pilot names to sync for user ${userId}:`, pilotNamesToSave);
            // console.log(`XContest UUID to sync for user ${userId}:`, keycloakPreferences.xcontestUuid); // Log UUID being saved to Keycloak
            // --- End Separation ---

            // --- Database Sync Logic (Added) ---
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // 1. Get current pilot names from DB for this user
                const currentDbResult = await client.query(
                    'SELECT device_id, pilot_name FROM xcm_pilots WHERE user_id = $1', // Removed xcontest_uuid
                    [userId]
                );
                const currentDbPilotNames = currentDbResult.rows.map(row => ({
                    deviceId: row.device_id,
                    name: row.pilot_name
                    // xcontestUuid: row.xcontest_uuid // REMOVED
                }));
                const currentDbDeviceIds = new Set(currentDbPilotNames.map(p => p.deviceId));
                const incomingDeviceIds = new Set(pilotNamesToSave.map(p => p.deviceId)); // Assuming incoming format includes deviceId

                // 2. Identify deletes, inserts, updates
                const toDelete = currentDbPilotNames.filter(p => !incomingDeviceIds.has(p.deviceId));
                const toInsert = pilotNamesToSave.filter(p => !currentDbDeviceIds.has(p.deviceId));
                const toUpdate = pilotNamesToSave.filter(p => {
                    if (!currentDbDeviceIds.has(p.deviceId)) return false; // Not an update if it's new
                    const current = currentDbPilotNames.find(dbP => dbP.deviceId === p.deviceId);
                    // Check if name changed (UUID check removed)
                    return current && current.name !== p.name;
                });

                // console.log('DB Sync - To Delete:', toDelete); // Reduced logging
                // console.log('DB Sync - To Insert:', toInsert); // Reduced logging
                // console.log('DB Sync - To Update:', toUpdate); // Reduced logging

                // 3. Execute SQL
                if (toDelete.length > 0) {
                    const deleteIds = toDelete.map(p => p.deviceId);
                    await client.query(
                        'DELETE FROM xcm_pilots WHERE user_id = $1 AND device_id = ANY($2::text[])',
                        [userId, deleteIds]
                    );
                }

                const now = new Date(); // For timestamps
                for (const pilot of toInsert) {
                    await client.query(
                        'INSERT INTO xcm_pilots (user_id, device_id, pilot_name, consent_timestamp, last_updated) VALUES ($1, $2, $3, $4, $5)', // Removed xcontest_uuid
                        [userId, pilot.deviceId, pilot.name, now, now] // Removed UUID
                    );
                }

                for (const pilot of toUpdate) {
                    await client.query(
                        'UPDATE xcm_pilots SET pilot_name = $1, last_updated = $2 WHERE user_id = $3 AND device_id = $4', // Removed xcontest_uuid
                        [pilot.name, now, userId, pilot.deviceId] // Removed UUID
                    );
                }

                // 4. Update Keycloak attributes (only if DB sync is successful)
                // console.log(`Updating Keycloak attributes for user ${userId}`); // Reduced logging
                await kcAdminClient.users.update(
                    { id: userId, realm: process.env.KEYCLOAK_REALM_NAME },
                    { attributes: { preferences: [preferencesString] } } // Save string containing xcontestUuid
                );

                // 5. Commit transaction
                await client.query('COMMIT');
                // console.log(`Preferences and Pilot Names synced successfully for user ${userId}`); // Reduced logging
 
            } catch (dbError) {
                await client.query('ROLLBACK');
                console.error(`Error syncing pilot names to DB for user ${userId}, rolled back transaction:`, dbError);
                client.release(); // Release client on error
                // Throw error to prevent sending success response
                throw new Error('Failed to sync pilot names to database.');
            } finally {
                client.release(); // Ensure client is always released
            }
            // --- End Database Sync Logic ---

            // Keycloak update moved inside the try block after successful DB commit
            // Keycloak update moved inside the try block after successful DB commit
            // No need to update again here as it's done within the transaction block
            // await kcAdminClient.users.update(
            //     { id: userId, realm: process.env.KEYCLOAK_REALM_NAME },
            //     { attributes: { preferences: [preferencesString] } }
            // );

            // Return the full updated preferences (including pilot names from input)
            return res.status(200).json(newPreferences); // Return original request body

        } catch (error) {
            console.error(`Error updating preferences for user ${userId}:`, error.message || error);
             if (error.response?.status === 401 || error.message === 'Keycloak Admin Client authentication failed.') {
                 return res.status(500).json({ message: 'Failed to authenticate service account with Keycloak.' });
            }
             if (error.response?.status === 404) {
                 console.warn(`User not found in Keycloak during update attempt: ${userId}`);
                 return res.status(404).json({ message: 'User not found' });
             }
            // Include specific DB sync error message if available
            const errorMessage = error.message === 'Failed to sync pilot names to database.'
                ? error.message
                : 'Failed to update user preferences';
            return res.status(500).json({ message: errorMessage });
        }
    });

    return router;
}
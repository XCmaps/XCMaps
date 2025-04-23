import express from 'express';
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


export default function createUserPreferencesRouter() {
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
            console.log(`Raw preferences attribute for user ${userId}:`, preferencesAttr);


            if (preferencesAttr) {
                try {
                    const preferences = JSON.parse(preferencesAttr);
                    console.log(`Parsed preferences for user ${userId}:`, preferences);
                    return res.json(preferences);
                } catch (parseError) {
                    console.error(`Error parsing preferences JSON for user ${userId}:`, parseError);
                    // Decide how to handle corrupted data - return default or error?
                    return res.status(500).json({ message: 'Error parsing stored preferences' });
                }
            } else {
                 console.log(`No preferences found for user ${userId}, returning default.`);
                // No preferences set yet, return default empty object
                return res.json({});
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

        console.log(`PUT /preferences request for user ID: ${userId} with data:`, newPreferences);


        // Basic validation: Ensure body is an object (could add more specific schema validation)
        if (typeof newPreferences !== 'object' || newPreferences === null) {
            return res.status(400).json({ message: 'Invalid request body: Expected a JSON object.' });
        }

        try {
            await ensureAdminAuth(); // Make sure admin client is authenticated

            const preferencesString = JSON.stringify(newPreferences);
            console.log(`Updating preferences for user ${userId} with string: ${preferencesString}`);


            // Update the user attributes
            await kcAdminClient.users.update(
                { id: userId, realm: process.env.KEYCLOAK_REALM_NAME },
                { attributes: { preferences: [preferencesString] } }
            );

            console.log(`Preferences updated successfully for user ${userId}`);
            // Return the saved preferences object directly for immediate feedback
            // Note: This assumes the 'newPreferences' object accurately reflects the saved state.
            return res.status(200).json(newPreferences);

        } catch (error) {
            console.error(`Error updating preferences for user ${userId}:`, error.message || error);
             if (error.response?.status === 401 || error.message === 'Keycloak Admin Client authentication failed.') {
                 return res.status(500).json({ message: 'Failed to authenticate service account with Keycloak.' });
            }
             if (error.response?.status === 404) {
                 console.warn(`User not found in Keycloak during update attempt: ${userId}`);
                 return res.status(404).json({ message: 'User not found' });
             }
            return res.status(500).json({ message: 'Failed to update user preferences' });
        }
    });

    return router;
}
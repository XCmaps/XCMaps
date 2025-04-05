import express from 'express';
import KcAdminClient from '@keycloak/keycloak-admin-client';
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

// --- Router Definition ---
export default function createUserPreferencesRouter() {
    const router = express.Router();

    // Middleware applied to all routes in this router
    router.use(authenticateToken); // Ensure user is logged in
    router.use(requireRole('user')); // Ensure user has the 'user' role

    // GET /api/user/preferences - Retrieve user preferences
    router.get('/preferences', async (req, res) => {
        const userId = req.user.id; // Get user ID from authenticated token
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
    router.put('/preferences', async (req, res) => {
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


            await kcAdminClient.users.update(
                { id: userId, realm: process.env.KEYCLOAK_REALM_NAME },
                { attributes: { preferences: [preferencesString] } }
            );

            console.log(`Preferences updated successfully for user ${userId}`);
            return res.status(204).send(); // Success, no content to return

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
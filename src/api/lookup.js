import express from 'express';
// Removed incorrect pool import: import pool from '../db.js';

// Export a function that creates the router and accepts the pool
export default function createLookupRouter(pool) {
    const router = express.Router();

    // GET /api/lookup/pilot-name?deviceId=...
    router.get('/pilot-name', async (req, res) => {
    const { deviceId } = req.query;

    if (!deviceId) {
        return res.status(400).json({ message: 'Missing deviceId query parameter' });
    }

    console.log(`Lookup request for pilot name with Device ID: ${deviceId}`);

    try {
        // Prioritized lookup query
        // IMPORTANT: Adjust table and column names if they differ in your schema!
        const query = `
            SELECT COALESCE(xcm.pilot_name, ogn.registration, flarm.registration) as name
            FROM (SELECT $1::text AS device_id) input_device -- Create a row with the input device ID
            LEFT JOIN xcm_pilots xcm ON input_device.device_id = xcm.device_id -- Check user's custom name first (NOTE: This lookup is global, not user-specific)
            LEFT JOIN ogn_ddb_pilots ogn ON input_device.device_id = ogn.device_id -- Uses device_id
            LEFT JOIN flarmnet_pilots flarm ON input_device.device_id = flarm.flarm_id -- Corrected to use flarm_id
            LIMIT 1;
        `;
        const result = await pool.query(query, [deviceId]);

        // Check if COALESCE returned a non-null name
        if (result.rows.length > 0 && result.rows[0].name) {
            const foundName = result.rows[0].name;
            console.log(`Found name for Device ID ${deviceId}: ${foundName}`);
            return res.json({ name: foundName });
        } else {
            console.log(`No name found across xcm_pilots, ogn_ddb_pilots, or flarmnet_pilots for Device ID: ${deviceId}`);
            // Return 404 if not found in any table
            return res.status(404).json({ message: 'Pilot name not found' });
        }

    } catch (error) {
        // Log the full error object, including potential SQL state or details
        console.error(`Error looking up pilot name for device ID ${deviceId}:`, error.message, error.stack, error);
        return res.status(500).json({ message: 'Failed to lookup pilot name' });
    }
    }); // End of router.get('/pilot-name', ...)

    return router; // Return the configured router
} // End of createLookupRouter function
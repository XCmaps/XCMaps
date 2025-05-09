/**
 * OGN Live API
 * Provides endpoints for accessing OGN aircraft data
 */

import express from 'express';

/**
 * Create router for OGN live data
 * @param {Object} pool - PostgreSQL connection pool
 * @param {Object} ognClient - OGN APRS client instance
 * @returns {Object} - Express router
 */
function createOgnLiveRouter(pool, ognClient) {
  const router = express.Router();

  /**
   * Get aircraft within map bounds
   * GET /api/ogn/aircraft
   * Query parameters:
   * - nwLat: Northwest latitude
   * - nwLng: Northwest longitude
   * - seLat: Southeast latitude
   * - seLng: Southeast longitude
   */
  router.get('/aircraft', async (req, res) => {
    try {
      const { nwLat, nwLng, seLat, seLng } = req.query;
      
      // Validate parameters
      if (!nwLat || !nwLng || !seLat || !seLng) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }
      
      // Convert to numbers
      const bounds = {
        nwLat: parseFloat(nwLat),
        nwLng: parseFloat(nwLng),
        seLat: parseFloat(seLat),
        seLng: parseFloat(seLng)
      };
      
      // Get aircraft in bounds
      const aircraft = await ognClient.getAircraftInBounds(bounds);

      // Filter out duplicates, keeping only the latest entry per device_id
      const latestAircraft = {};
      for (const ac of aircraft) {
        if (!latestAircraft[ac.device_id] || new Date(ac.last_seen) > new Date(latestAircraft[ac.device_id].last_seen)) {
          latestAircraft[ac.device_id] = ac;
        }
      }
      const filteredAircraft = Object.values(latestAircraft);

      // --- Prioritize Custom Pilot Names (Added) ---
      if (filteredAircraft.length > 0) {
          const deviceIds = filteredAircraft.map(ac => ac.device_id);
          try {
              const customNamesResult = await pool.query(
                  'SELECT device_id, pilot_name FROM xcm_pilots WHERE device_id = ANY($1::text[])',
                  [deviceIds]
              );

              // Create a map for quick lookup
              const customNamesMap = new Map();
              customNamesResult.rows.forEach(row => {
                  customNamesMap.set(row.device_id, row.pilot_name);
              });

              // Update aircraft data with custom names
              filteredAircraft.forEach(ac => {
                  if (customNamesMap.has(ac.device_id)) {
                      const customName = customNamesMap.get(ac.device_id);
                      console.log(`Overriding name for ${ac.device_id} with custom name: ${customName}`);
                      ac.pilot_name = customName; // Assuming the property is pilot_name
                  }
                  // If not in map, the original name (from ognClient) remains
              });

          } catch (dbError) {
              console.error('Error fetching custom pilot names from xcm_pilots:', dbError);
              // Proceed without custom names if DB query fails
          }
      }
      // --- End Prioritize Custom Pilot Names ---

      // Return potentially modified aircraft data
      res.json(filteredAircraft);
    } catch (err) {
      console.error('Error getting aircraft data:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Get recent aircraft
   * GET /api/ogn/aircraft/recent
   * Query parameters:
   * - minutes: Number of minutes of history to retrieve (default: 15)
   */
  router.get('/aircraft/recent', async (req, res) => {
    try {
      const minutes = parseInt(req.query.minutes || '15', 10);
      const since = new Date(Date.now() - minutes * 60 * 1000);

      // Get all aircraft seen since the specified time
      // This might require a new method in ognClient or direct DB query
      // For now, let's assume ognClient.getRecentAircraft(since) exists
      // or adapt the logic from getAircraftInBounds if it fetches from a live cache
      // that can be filtered by time.
      // If ognClient primarily deals with live data in bounds, we might need
      // to query the database directly for historical "last seen" data.

      // Assuming a similar structure to getAircraftInBounds but filtered by time
      // This is a placeholder for actual implementation based on ognClient capabilities
      // or direct DB access.
      // For demonstration, let's adapt the DB query logic if that's where persistent data resides.
      // This example assumes 'aircraft' table has 'last_seen' and 'device_id'
      const client = await pool.connect();
      let recentAircraftData;
      try {
        const result = await client.query(
          'SELECT * FROM aircraft WHERE last_seen >= $1',
          [since]
        );
        recentAircraftData = result.rows;
      } finally {
        client.release();
      }

      // Filter out duplicates, keeping only the latest entry per device_id
      const latestAircraft = {};
      for (const ac of recentAircraftData) {
        if (!latestAircraft[ac.device_id] || new Date(ac.last_seen) > new Date(latestAircraft[ac.device_id].last_seen)) {
          latestAircraft[ac.device_id] = ac;
        }
      }
      const filteredAircraft = Object.values(latestAircraft);

      // --- Prioritize Custom Pilot Names (Copied from /aircraft endpoint) ---
      if (filteredAircraft.length > 0) {
          const deviceIds = filteredAircraft.map(ac => ac.device_id);
          try {
              const customNamesResult = await pool.query(
                  'SELECT device_id, pilot_name FROM xcm_pilots WHERE device_id = ANY($1::text[])',
                  [deviceIds]
              );

              const customNamesMap = new Map();
              customNamesResult.rows.forEach(row => {
                  customNamesMap.set(row.device_id, row.pilot_name);
              });

              filteredAircraft.forEach(ac => {
                  if (customNamesMap.has(ac.device_id)) {
                      const customName = customNamesMap.get(ac.device_id);
                      ac.pilot_name = customName;
                  }
              });
          } catch (dbError) {
              console.error('Error fetching custom pilot names for recent aircraft:', dbError);
          }
      }
      // --- End Prioritize Custom Pilot Names ---

      res.json(filteredAircraft);
    } catch (err) {
      console.error('Error getting recent aircraft data:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Get track for a specific aircraft
   * GET /api/ogn/track/:id
   * Path parameters:
   * - id: Aircraft ID
   * Query parameters:
   * - minutes: Number of minutes of history to retrieve (default: 60)
   */
  router.get('/track/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const minutes = parseInt(req.query.minutes || '720', 10);
      
      // Validate parameters
      if (!id) {
        return res.status(400).json({ error: 'Missing aircraft ID' });
      }
      
      // Get track points
      const track = await ognClient.getAircraftTrack(id, minutes);
      
      // Return track data
      res.json(track);
    } catch (err) {
      console.error('Error getting aircraft track:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Get statistics about current OGN data
   * GET /api/ogn/stats
   */
  router.get('/stats', async (req, res) => {
    try {
      const client = await pool.connect();
      
      try {
        // Get total aircraft count - updated for new schema with device_id as primary key
        const aircraftResult = await client.query(`
          SELECT COUNT(*) as total,
            SUM(CASE WHEN type = 6 THEN 1 ELSE 0 END) as hang_gliders,
            SUM(CASE WHEN type = 7 THEN 1 ELSE 0 END) as paragliders
          FROM aircraft
          WHERE last_seen > $1
        `, [new Date(Date.now() - 1800000)]); // Last 30 minutes
        
        // Get total track points
        const tracksResult = await client.query(`
          SELECT COUNT(*) as total
          FROM aircraft_tracks
          WHERE timestamp > $1
        `, [new Date(Date.now() - 86400000)]); // Last 24 hours
        
        // Return statistics
        res.json({
          aircraft: {
            total: parseInt(aircraftResult.rows[0].total, 10),
            hangGliders: parseInt(aircraftResult.rows[0].hang_gliders, 10),
            paragliders: parseInt(aircraftResult.rows[0].paragliders, 10)
          },
          tracks: {
            total: parseInt(tracksResult.rows[0].total, 10)
          },
          lastUpdate: new Date()
        });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Error getting OGN stats:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

export default createOgnLiveRouter;
import { Router } from 'express';
import express from 'express'; // Import express directly
import pkg from 'pg';
import NodeCache from 'node-cache'; // Import node-cache

const { Pool } = pkg;
const router = express.Router(); // Use express.Router()

// Initialize NodeCache with a TTL of 12 hour (3600 * 12seconds)
const airspaceCache = new NodeCache({ stdTTL: 43200 });

export default function createAirspacesXCdbRouter(pool) {

  router.get('/', async (req, res) => {
    try {
      const {
        startDate,
        nw_lat,
        nw_lng,
        se_lat,
        se_lng
      } = req.query;

      if (nw_lat === undefined || nw_lng === undefined || se_lat === undefined || se_lng === undefined) {
        return res.status(400).json({
          error: 'Missing required parameters: nw_lat, nw_lng, se_lat, se_lng'
        });
      }

      const northWestLat = parseFloat(nw_lat);
      const northWestLng = parseFloat(nw_lng);
      const southEastLat = parseFloat(se_lat);
      const southEastLng = parseFloat(se_lng);

      if (
        isNaN(northWestLat) ||
        isNaN(northWestLng) ||
        isNaN(southEastLat) ||
        isNaN(southEastLng)
      ) {
        return res.status(400).json({
          error: 'Invalid parameters: nw_lat, nw_lng, se_lat, se_lng must be valid numbers'
        });
      }

      const queryDate = startDate || new Date().toISOString().split('T')[0];
      
      // Create a cache key based on all query parameters
      const cacheKey = `airspacesXCdb:${queryDate}:${nw_lat}:${nw_lng}:${se_lat}:${se_lng}`;

      // Try to get data from cache
      const cachedResponse = airspaceCache.get(cacheKey);
      if (cachedResponse) {
        console.log(`[AirspacesXCdb] Serving from cache for key: ${cacheKey}`);
        return res.json(cachedResponse);
      }

      const query = `
        SELECT
          id,
          name,
          airspace_class as "airspaceClass",
          check_type as "airspaceCheckType",
          upper_limit as "upperLimit",
          lower_limit as "lowerLimit",
          upper_limit_data as "airupper_j",
          lower_limit_data as "airlower_j",
          stroke_color as "strokeColor",
          stroke_weight as "strokeWeight",
          fill_color as "fillColor",
          fill_opacity as "fillOpacity",
          country_code as "foreignisocode",
          descriptions,
          activations,
          ST_AsGeoJSON(geometry) as geometry
        FROM xcairspaces
        WHERE fetch_date = $1
        AND ST_Intersects(
          geometry,
          ST_MakeEnvelope($2, $3, $4, $5, 4326)
      )`;
        
      const result = await pool.query(query, [
        queryDate,
        northWestLng,
        southEastLat,
        southEastLng,
        northWestLat
      ]);
        
      const features = result.rows.map(row => {
        const geometry = JSON.parse(row.geometry);
        const { geometry: _, ...properties } = row;
        return {
          type: "Feature",
          geometry,
          properties
        };
      });
        
      const geoJsonResponse = {
        type: "FeatureCollection",
        features
      };
        
      // Store the response in cache before sending
      airspaceCache.set(cacheKey, geoJsonResponse);
      console.log(`[AirspacesXCdb] Stored in cache for key: ${cacheKey}`);

      res.json(geoJsonResponse);
    } catch (error) {
      console.error('Error querying airspace data:', error);
      res.status(500).json({
        error: 'Failed to fetch airspace data',
        details: error.message
      });
    }
  });

  return router;
};

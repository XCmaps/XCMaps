import { Router } from 'express';
import pkg from 'pg';

const { Pool } = pkg;
const router = Router();

export default function createObstaclesRouter(pool) {

  router.get('/', async (req, res) => {
    try {
      const { 
        nw_lat, 
        nw_lng, 
        se_lat, 
        se_lng 
      } = req.query;

      // Validate required parameters
      if (!nw_lat || !nw_lng || !se_lat || !se_lng) {
        return res.status(400).json({ 
          error: 'Missing required parameters: nw_lat, nw_lng, se_lat, se_lng' 
        });
      }

      // Parse and validate coordinates
      const coords = [
        parseFloat(nw_lat),
        parseFloat(nw_lng),
        parseFloat(se_lat),
        parseFloat(se_lng)
      ];

      if (coords.some(isNaN)) {
        return res.status(400).json({ 
          error: 'Invalid parameters: all coordinates must be valid numbers' 
        });
      }

      const [nwLat, nwLng, seLat, seLng] = coords;

      // Build PostGIS envelope parameters
      const envelopeParams = [
        nwLng,  // xmin (western longitude)
        seLat,   // ymin (southern latitude)
        seLng,   // xmax (eastern longitude)
        nwLat    // ymax (northern latitude)
      ];

      // SQL query with GeoJSON conversion and column aliases
      const query = `
        SELECT 
          id,
          feature_id AS "featureId",
          name,
          type,
          description,
          stroke_color AS "strokeColor",
          stroke_weight AS "strokeWeight",
          persistent_id AS "persistentId",
          tags,
          max_agl AS "maxAgl",
          top_amsl AS "topAmsl",
          country_code AS "countryCode",
          fetch_date AS "fetchDate",
          elevations,
          ST_AsGeoJSON(geometry) AS geometry
        FROM obstacles
        WHERE ST_Intersects(
          geometry,
          ST_MakeEnvelope($1, $2, $3, $4, 4326)
        )`;

      // Execute query
      const result = await pool.query(query, envelopeParams);

      // Convert to GeoJSON format
      const features = result.rows.map(row => ({
        type: "Feature",
        geometry: JSON.parse(row.geometry),
        properties: {
          ...row,
          geometry: undefined // Remove the parsed geometry from properties
        }
      }));

      const geoJsonResponse = {
        type: "FeatureCollection",
        features
      };

      res.json(geoJsonResponse);
    } catch (error) {
      console.error('Error fetching obstacles:', error);
      res.status(500).json({ 
        error: 'Failed to fetch obstacles', 
        details: error.message 
      });
    }
  });

  return router;
};
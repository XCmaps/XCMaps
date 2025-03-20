import { Router } from 'express';
import pkg from 'pg';

const { Pool } = pkg;
const router = Router();

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

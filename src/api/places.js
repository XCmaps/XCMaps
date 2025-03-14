import { Router } from 'express';
import pkg from 'pg';

const { Pool } = pkg;

// Create router
const router = Router();

// Type mapping for human-readable values
const typeMapping = {
  "TO": "TAKE OFF",
  "TOW": "TAKE OFF WINCH",
  "TH": "TRAINING HILL",
  "P": "PARKING",
  "LZ": "LANDING ZONE",
  "TOW-HG": "TAKE OFF WINCH HANG GLIDING",
  "TO-HG": "TAKE OFF HANG GLIDING"
};

// Use the same Pool that was created in server.js
// We'll need to pass this from the main app
export default function createPlacesRouter(pool) {
    // API endpoint to fetch places within a bounding box with multiple types
    router.get("/", async (req, res) => {
        const { nw_lat, nw_lng, se_lat, se_lng, type } = req.query;

        if (!nw_lat || !nw_lng || !se_lat || !se_lng) {
            return res.status(400).json({ error: "Missing bounding box parameters." });
        }

        // Allowed types
        const validTypes = ["TO", "TOW", "TH", "P", "LZ", "TOW-HG", "TO-HG"];
        
        // Convert type(s) to an array and filter valid ones
        let typeArray = [];
        if (type) {
            typeArray = Array.isArray(type) ? type : [type]; // Ensure it's an array
            typeArray = typeArray.filter(t => validTypes.includes(t)); // Filter valid types
        }

        const params = [parseFloat(nw_lng), parseFloat(nw_lat), parseFloat(se_lng), parseFloat(se_lat)];
        let typeFilter = "";

        if (typeArray.length > 0) {
            // Create placeholders dynamically ($5, $6, ...)
            const typePlaceholders = typeArray.map((_, i) => `$${i + 5}`).join(",");
            typeFilter = `AND type IN (${typePlaceholders})`;
            params.push(...typeArray); // Append type values to params
        }

        try {
            const query = `
                SELECT id, name, type, direction, description, 
                    ST_AsGeoJSON(geom)::json AS geometry
                FROM places
                WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
                ${typeFilter};
            `;

            const { rows } = await pool.query(query, params);

            res.json({
                type: "FeatureCollection",
                features: rows.map(row => ({
                    type: "Feature",
                    geometry: row.geometry,
                    properties: {
                        id: row.id,
                        name: row.name,
                        type: typeMapping[row.type] || row.type, // Map the type code to full name
                        direction: row.direction,
                    },
                })),
            });

        } catch (error) {
            console.error("Error fetching places:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    // API endpoint to fetch place details by ID (includes description)
    router.get("/:id", async (req, res) => {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ error: "Missing place ID." });
        }

        try {
            const query = `
                SELECT id, strplacemarkid, name, type, direction, lastupdate, rating, height, heightdifference, description, 
                    ST_AsGeoJSON(geom)::json AS geometry
                FROM places
                WHERE id = $1;
            `;

            const { rows } = await pool.query(query, [id]);

            if (rows.length === 0) {
                return res.status(404).json({ error: "Place not found." });
            }

            const place = rows[0];

            res.json({
                type: "Feature",
                geometry: place.geometry,
                properties: {
                    id: place.id,
                    strPlacemarkId: place.strplacemarkid,
                    name: place.name,
                    type: typeMapping[place.type] || place.type, // Map the type code to full name
                    direction: place.direction,
                    rating: place.rating,
                    height: place.height,
                    heightdifference: place.heightdifference,
                    lastupdate: place.lastupdate,
                    description: place.description,
                },
            });

        } catch (error) {
            console.error("Error fetching place details:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    return router;
}
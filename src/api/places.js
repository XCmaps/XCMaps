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
                SELECT id, name, type, direction, description, dhv_id,
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
                        dhv_id: row.dhv_id,
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
        const id = parseInt(req.params.id, 10);

        if (isNaN(id)) {
            return res.status(400).json({ error: "Invalid place ID. Must be a number." });
        }

        try {
            const query = `
                SELECT
                    p.id, p.strplacemarkid, p.name, p.type, p.direction, p.lastupdate, p.rating, p.height, p.heightdifference, p.description, p.dhv_id,
                    ST_AsGeoJSON(p.geom)::json AS geometry,
                    d.site_type, d.height_difference_max, d.weather_info, d.de_certified, d.altitude, d.de_certification_holder, d.site_contact, d.site_information, d.cable_car, d.site_remarks, d.requirements, d.site_url, d.location_name, d.location_id, d.location_type, d.directions_text, d.towing_length, d.towing_height1, d.towing_height2, d.access_by_car, d.access_by_public_transport, d.access_by_foot, d.access_remarks, d.hanggliding, d.paragliding, d.suitability_hg, d.suitability_pg, d.location_remarks
                FROM places p
                LEFT JOIN dhv_sites d ON p.dhv_id = d.id
                WHERE p.id = $1;
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
                    altitude: place.altitude, 
                    heightdifference: place.heightdifference,
                    lastupdate: place.lastupdate,
                    description: place.description,
                    dhv_id: place.dhv_id,
                    site_type: place.site_type,
                    height_difference_max: place.height_difference_max,
                    weather_info: place.weather_info,
                    de_certified: place.de_certified,
                    de_certification_holder: place.de_certification_holder,
                    site_contact: place.site_contact,
                    site_information: place.site_information,
                    cable_car: place.cable_car,
                    site_remarks: place.site_remarks,
                    requirements: place.requirements,
                    site_url: place.site_url,
                    location_name: place.location_name,
                    location_id: place.location_id,
                    location_type: place.location_type,
                    directions_text: place.directions_text,
                    towing_length: place.towing_length,
                    towing_height1: place.towing_height1,
                    towing_height2: place.towing_height2,
                    access_by_car: place.access_by_car,
                    access_by_public_transport: place.access_by_public_transport,
                    access_by_foot: place.access_by_foot,
                    access_remarks: place.access_remarks,
                    hanggliding: place.hanggliding,
                    paragliding: place.paragliding,
                    suitability_hg: place.suitability_hg,
                    suitability_pg: place.suitability_pg,
                    location_remarks: place.location_remarks,
                },
            });

        } catch (error) {
            console.error("Error fetching place details:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    return router;
}
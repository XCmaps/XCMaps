import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import path from "path";
import { config } from "dotenv";
import pkg from "pg";
import multer from "multer";
import nodemailer from "nodemailer";
import fs from 'fs';
import 'dotenv/config'

const { Pool } = pkg;

// Load environment variables
config();

const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = 3000;

// Enable CORS
app.use(cors());

const transporter = nodemailer.createTransport({
    host: "mail.hostedoffice.ag",
    port: 587,
    secure: false,
    auth: {
        user: "info@lorenzmeis.net",
        pass: "@Jy58si7812"
    }
});

app.post("/api/send-feedback", upload.array("images", 5), async (req, res) => {
    try {
        const { feedbackText, userName, userEmail } = req.body;
        const attachments = req.files.map(file => ({
            filename: file.originalname,
            path: file.path
        }));

        let mailOptions = {
            from: "info@lorenzmeis.net",
            to: "info@lorenzmeis.net",
            subject: "User Feedback Submission",
            text: `Feedback: ${feedbackText}\nName: ${userName}\nEmail: ${userEmail}`,
            attachments: attachments
        };

        let info = await transporter.sendMail(mailOptions);
        console.log("Email sent: " + info.response);

        // Cleanup: Delete uploaded files after sending
        attachments.forEach(file => fs.unlinkSync(file.path));

        res.json({ success: true, message: "Feedback submitted successfully" });
    } catch (error) {
        console.error("Error sending email:", error);
        res.status(500).json({ success: false, error: "Failed to send feedback" });
    }
});

// PostgreSQL Connection Pool
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Serve static files from "public" folder
app.use(express.static(path.join(process.cwd(), "public")));

// Serve static files from "js" folder under the "/js" route
app.use("/js", express.static(path.join(process.cwd(), "js")));

// Serve index.html on root request
app.get("/", (req, res) => {
    res.sendFile(path.join(process.cwd(), "public", "index.html"));
});



// 🆕 API endpoint to fetch places within a bounding box with multiple types
app.get("/api/places", async (req, res) => {
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
                    type: row.type,
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
app.get("/api/place/:id", async (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ error: "Missing place ID." });
    }

    try {
        const query = `
            SELECT id, name, type, direction, description, 
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
                name: place.name,
                type: place.type,
                direction: place.direction,
                description: place.description, // Included here
            },
        });

    } catch (error) {
        console.error("Error fetching place details:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});


// Existing API endpoint to fetch wind data - getNear
app.get("/api/wind-data-getNear", async (req, res) => {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
        return res.status(400).json({ error: "Latitude and longitude are required." });
    }

    const apiUrl = `https://windspion.app/dataServer/getNear.php?a=${lat}&o=${lng}&count=600`;

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("Error fetching data:", error);
        res.status(500).json({ error: "Failed to fetch wind station data." });
    }
});

// Existing API endpoint to fetch current wind data - getCurrent
app.get("/api/wind-data-getCurrent", async (req, res) => {
    const { nwLat, nwLng, seLat, seLng } = req.query;

    if (!nwLat || !nwLng || !seLat || !seLng) {
        return res.status(400).json({ error: "Latitude and longitude are required." });
    }

    const apiUrl = `https://winds.mobi/api/2.3/stations/?is-highest-duplicates-rating=true&keys=short&keys=loc&keys=status&keys=pv-name&keys=alt&keys=peak&keys=last._id&keys=last.w-dir&keys=last.w-avg&keys=last.w-max&limit=220&within-pt1-lat=${nwLat}&within-pt1-lon=${seLng}&within-pt2-lat=${seLat}&within-pt2-lon=${nwLng}`;

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("Error fetching data:", error);
        res.status(500).json({ error: "Failed to fetch current wind data." });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});



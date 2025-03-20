import express from "express";
import cors from "cors";
import path from "path";
import { config } from "dotenv";
import pkg from "pg";
import 'dotenv/config';
import fetch from 'node-fetch';

// Import routes
import createPlacesRouter from "./src/api/places.js";
import createWindRouter from "./src/api/wind.js";
import createFeedbackRouter from "./src/api/feedback.js";
import createAirspacesRouter from "./src/api/airspaces.js";
import createAirspacesXCRouter from "./src/api/airspacesXCfetch.js";
import createAirspacesXCdbRouter from "./src/api/airspaces-xcontest.js";
import createObstaclesRouter from './src/api/obstacles.js';


const { Pool } = pkg;

// Load environment variables
config();

const app = express();
const PORT = 3000;

// Enable CORS
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// PostgreSQL Connection Pool
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Serve static files from "public" folder
app.use(express.static(path.join(process.cwd(), "build")));

// Serve index.html on root request
app.get("/", (req, res) => {
    res.sendFile(path.join(process.cwd(), "build", "index.html"));
});

// Use the API routers
app.use("/api/places", createPlacesRouter(pool));
app.use("/api", createWindRouter());
app.use("/api", createFeedbackRouter());
app.use("/api/airspaces", createAirspacesRouter());
app.use("/api/airspacesXC", createAirspacesXCRouter());
app.use("/api/airspacesXCdb", createAirspacesXCdbRouter(pool));
app.use("/api/obstacles", createObstaclesRouter(pool));

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
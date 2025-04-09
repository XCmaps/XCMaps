import { config } from "dotenv";
import pkg from "pg";
import { fetchAndStoreAirspaces, fetchAndStoreObstacles } from './src/modules/update-xc-airspaces.js';

// Load environment variables from .env file
config();

const { Pool } = pkg;

// Database connection pool
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    // Add SSL configuration if needed, based on your environment
    // ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function runUpdate() {
    console.log('Starting manual airspace and obstacle update...');
    try {
        console.log('Updating obstacles...');
        await fetchAndStoreObstacles(pool);
        console.log('Obstacle update finished.');

        console.log('Updating airspaces...');
        await fetchAndStoreAirspaces(pool);
        console.log('Airspace update finished.');

        console.log('Manual update completed successfully.');
    } catch (err) {
        console.error('Manual update failed:', err);
    } finally {
        // Ensure the pool connections are closed
        await pool.end();
        console.log('Database pool closed.');
    }
}

runUpdate();
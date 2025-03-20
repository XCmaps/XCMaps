import { fetchAndStoreAirspaces, fetchAndStoreObstacles } from './update-xc-airspaces.js';
import pkg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from project root (one level up from modules directory)
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const { Pool } = pkg;

// Initialize the database pool with explicit type conversion for the password
const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD), // Explicitly convert to string
    database: process.env.DB_NAME,
});


await fetchAndStoreObstacles(pool)
.then(() => console.log('Obstacles updated successfully'))
.catch(err => console.error('Obstacles update failed:', err));

await fetchAndStoreAirspaces(pool)
  .then(() => console.log('Airspaces updated successfully'))
  .catch(err => console.error('Airspaces update failed:', err));
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const DB_CONNECTION_STRING = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
const pool = new Pool({
    connectionString: DB_CONNECTION_STRING,
});

const sqlFilePath = path.resolve('./scripts/create_dhv_sites_table.sql');

async function executeSqlScript() {
    let client;
    try {
        client = await pool.connect();
        console.log('Connected to PostgreSQL database.');

        const sql = fs.readFileSync(sqlFilePath, 'utf8');
        console.log(`Executing SQL script: ${sqlFilePath}`);

        await client.query(sql);
        console.log('SQL script executed successfully.');

    } catch (error) {
        console.error('Error executing SQL script:', error);
    } finally {
        if (client) {
            client.release();
            console.log('Database client released.');
        }
        pool.end();
        console.log('Database pool closed.');
    }
}

executeSqlScript();
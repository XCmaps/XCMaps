/**
 * Script to trigger the Flarmnet database import
 */

import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import * as FlarmnetParser from './src/modules/flarmnet-parser.js';

// Load environment variables
dotenv.config();

// Constants
const FLARMNET_URL = 'https://www.flarmnet.org/static/files/wfn/data.fln';

async function importFlarmnetData() {
  console.log('Starting Flarmnet import...');
  
  try {
    // Fetch Flarmnet data
    console.log('Fetching Flarmnet data from:', FLARMNET_URL);
    const response = await fetch(FLARMNET_URL);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch Flarmnet data: ${response.status} ${response.statusText}`);
    }
    
    // Get the data as text
    const hexData = await response.text();
    console.log(`Fetched ${hexData.length} bytes of Flarmnet data`);
    
    // Parse the data using our parser
    console.log('Parsing Flarmnet data...');
    const parsedData = FlarmnetParser.decode(hexData);
    console.log(`Successfully parsed ${parsedData.records.length} records`);
    
    // Connect to the database
    const pool = new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT
    });
    
    const client = await pool.connect();
    console.log('Connected to database');
    
    try {
      // Clear existing data
      console.log('Clearing existing Flarmnet data...');
      await client.query('DELETE FROM flarmnet_pilots');
      
      // Insert new data
      console.log('Inserting new Flarmnet data...');
      const batchSize = 1000;
      let processedCount = 0;
      
      await client.query('BEGIN');
      
      for (let i = 0; i < parsedData.records.length; i++) {
        const record = parsedData.records[i];
        if (!record) continue;
        
        // Skip records with invalid FLARM ID
        if (!record.id || record.id === '000000') continue;
        
        // Insert into database
        const query = `
          INSERT INTO flarmnet_pilots (flarm_id, pilot_name, registration, aircraft_type, home_airfield, frequency, last_updated)
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
        `;
        
        await client.query(query, [
          record.id, 
          record.pilot, 
          record.registration, 
          record.plane_type, 
          record.airfield, 
          record.frequency
        ]);
        
        processedCount++;
        
        // Log progress
        if (processedCount % 1000 === 0) {
          console.log(`Processed ${processedCount} records`);
        }
        
        // Commit batch and start new transaction if batch size is reached
        if (processedCount % batchSize === 0 && i < parsedData.records.length - 1) {
          await client.query('COMMIT');
          console.log(`Committed batch of ${batchSize} records (${processedCount} total)`);
          await client.query('BEGIN');
        }
      }
      
      // Commit final batch
      await client.query('COMMIT');
      console.log(`Import complete. Inserted ${processedCount} records.`);
      
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error importing Flarmnet data:', err);
    } finally {
      client.release();
      await pool.end();
    }
    
  } catch (err) {
    console.error('Error in Flarmnet import:', err);
  }
}

// Run the import
importFlarmnetData();
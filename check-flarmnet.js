import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function checkFlarmnetData() {
  // Use database credentials from .env
  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
  });
  const client = await pool.connect();
  
  try {
    console.log('Checking Flarmnet database...');
    
    // Check if table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'flarmnet_pilots'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('flarmnet_pilots table does not exist!');
      return;
    }
    
    // Get count of records
    const countResult = await client.query('SELECT COUNT(*) FROM flarmnet_pilots');
    console.log(`Total Flarmnet records: ${countResult.rows[0].count}`);
    
    // Get distribution of FLARM ID lengths
    const lengthDistribution = await client.query(`
      SELECT LENGTH(flarm_id) as id_length, COUNT(*)
      FROM flarmnet_pilots
      GROUP BY id_length
      ORDER BY id_length
    `);
    console.log('FLARM ID length distribution:');
    lengthDistribution.rows.forEach(row => {
      console.log(`  ${row.id_length} characters: ${row.count} records`);
    });
    
    // Check for specific FLARM IDs that we expect to see
    const specificIds = ['22017D', '31E00C'];
    for (const id of specificIds) {
      const specificResult = await client.query('SELECT flarm_id, pilot_name, registration FROM flarmnet_pilots WHERE flarm_id = $1', [id]);
      if (specificResult.rows.length > 0) {
        console.log(`Found specific FLARM ID ${id}:`);
        console.log(`  Pilot: ${specificResult.rows[0].pilot_name || '[null]'}, Registration: ${specificResult.rows[0].registration || '[null]'}`);
      } else {
        console.log(`Specific FLARM ID ${id} not found in database`);
      }
    }
    
    // Get sample records
    const result = await client.query('SELECT flarm_id, pilot_name, registration, aircraft_type FROM flarmnet_pilots LIMIT 10');
    console.log('First 10 Flarmnet records:');
    
    if (result.rows.length === 0) {
      console.log('No records found in flarmnet_pilots table');
    } else {
      result.rows.forEach(row => {
        console.log(`FLARM ID: ${row.flarm_id}, Pilot: ${row.pilot_name || '[null]'}, Registration: ${row.registration || '[null]'}, Type: ${row.aircraft_type || '[null]'}`);
      });
    }
    
    // Check for non-null pilot names
    const pilotResult = await client.query('SELECT COUNT(*) FROM flarmnet_pilots WHERE pilot_name IS NOT NULL');
    console.log(`Records with non-null pilot names: ${pilotResult.rows[0].count}`);
  } catch (err) {
    console.error('Error querying database:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

checkFlarmnetData();
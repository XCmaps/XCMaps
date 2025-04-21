#!/usr/bin/env node
/**
 * SRTM Elevation Data Import Script using raster2pgsql
 * 
 * This script imports NASA SRTM elevation data into a PostgreSQL database
 * using the raster2pgsql tool from PostGIS.
 * 
 * Usage:
 *   node import-srtm-raster2pgsql.js [--srtm-dir PATH] [--temp-dir PATH]
 * 
 * Options:
 *   --srtm-dir PATH     Path to the directory containing SRTM data files (default: ./SRTM)
 *   --temp-dir PATH     Path to the directory for temporary files (default: ./SRTM/temp)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import pg from 'pg';
import dotenv from 'dotenv';
import os from 'os';
import readline from 'readline';

// Try to import optional dependencies
let AdmZip;
try {
  AdmZip = (await import('adm-zip')).default;
  console.log('AdmZip package loaded successfully');
} catch (err) {
  console.warn('AdmZip package not found. Will use alternative ZIP extraction methods.');
  console.warn('To install: npm install adm-zip');
}

// Get the directory name (ES module compatible)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const DEFAULT_SRTM_DIR = path.join(path.dirname(__dirname), 'SRTM');
const DEFAULT_TEMP_DIR = path.join(DEFAULT_SRTM_DIR, 'temp');

// Parse command line arguments
let program;
try {
  const { Command } = await import('commander');
  program = new Command();
  console.log('Commander package loaded successfully');
} catch (err) {
  console.warn('Commander package not found. Will use default command line arguments.');
  console.warn('To install: npm install commander');
  // Create a simple program replacement
  program = {
    option: () => program,
    parse: () => {},
    opts: () => {
      const args = process.argv.slice(2);
      const options = {
        srtmDir: DEFAULT_SRTM_DIR,
        tempDir: DEFAULT_TEMP_DIR
      };
      
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--srtm-dir' || args[i] === '-d') {
          options.srtmDir = args[i+1];
          i++;
        } else if (args[i] === '--temp-dir' || args[i] === '-t') {
          options.tempDir = args[i+1];
          i++;
        }
      }
      
      return options;
    }
  };
}

// Load environment variables
// Try multiple locations for the .env file
const possibleEnvPaths = [
  path.resolve(process.cwd(), '.env'),              // Current directory
  path.resolve(process.cwd(), '../.env'),           // Parent directory (if run from scripts/)
  path.resolve(__dirname, '../.env'),               // Project root relative to script
  path.resolve(process.cwd(), '../../.env')         // Grandparent directory (just in case)
];

let envLoaded = false;
for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    console.log(`Found .env file at: ${envPath}`);
    dotenv.config({ path: envPath });
    envLoaded = true;
    break;
  } else {
    console.log(`No .env file found at: ${envPath}`);
  }
}

if (!envLoaded) {
  console.warn('WARNING: Could not find .env file in any of the expected locations.');
  console.warn('Will use default database configuration or environment variables if set.');
  dotenv.config(); // Try default location as a last resort
}

// Log loaded environment variables (without sensitive info)
console.log('Loaded environment variables:');
console.log(`DB_HOST: ${process.env.DB_HOST || '(not set)'}`);
console.log(`DB_PORT: ${process.env.DB_PORT || '(not set)'}`);
console.log(`DB_NAME: ${process.env.DB_NAME || '(not set)'}`);
console.log(`DB_USER: ${process.env.DB_USER || '(not set)'}`);
console.log(`DB_PASSWORD: ${process.env.DB_PASSWORD ? '(set)' : '(not set)'}`);

// Promisify exec
const execAsync = promisify(exec);

// Set up command line options
program
  .option('-d, --srtm-dir <path>', 'Path to SRTM directory', DEFAULT_SRTM_DIR)
  .option('-t, --temp-dir <path>', 'Path to temporary directory', DEFAULT_TEMP_DIR)
  .parse(process.argv);

const options = program.opts();

// Main thread code
main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

/**
 * Main function
 */
async function main() {
  const srtmDir = options.srtmDir;
  const tempDir = options.tempDir;
  
  console.log(`Starting SRTM data import using raster2pgsql`);
  console.log(`SRTM directory: ${srtmDir}`);
  console.log(`Temporary directory: ${tempDir}`);
  
  // Ensure SRTM directory exists
  if (!fs.existsSync(srtmDir)) {
    console.log(`Creating SRTM directory: ${srtmDir}`);
    fs.mkdirSync(srtmDir, { recursive: true });
  }
  
  // Create temp directory
  if (!fs.existsSync(tempDir)) {
    console.log(`Creating temporary directory: ${tempDir}`);
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  // Database connection parameters
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  };
  
  // Validate database config
  console.log('Database configuration:');
  console.log(`- Host: ${dbConfig.host}`);
  console.log(`- Port: ${dbConfig.port}`);
  console.log(`- Database: ${dbConfig.database}`);
  console.log(`- User: ${dbConfig.user}`);
  console.log(`- Password: ${dbConfig.password ? '********' : '(empty)'}`);
  
  if (!dbConfig.password) {
    console.warn('WARNING: Database password is empty. This might cause authentication issues.');
    console.warn('Make sure your .env file contains the DB_PASSWORD variable.');
  }
  
  // Connect to database
  let client;
  try {
    console.log('Connecting to database...');
    client = new pg.Client(dbConfig);
    await client.connect();
    console.log('Connected to database successfully');
  } catch (err) {
    console.error('Error connecting to database:', err);
    console.error('\nPlease check your database configuration in the .env file:');
    console.error('DB_HOST=your_host');
    console.error('DB_PORT=your_port');
    console.error('DB_NAME=your_database_name');
    console.error('DB_USER=your_username');
    console.error('DB_PASSWORD=your_password');
    console.error('\nIf you don\'t have a .env file, create one in the project root directory.');
    process.exit(1);
  }
  
  // let firstFileProcessed = false; // No longer needed
  let successfulImports = 0; // Track number of successful imports
  try {
    // Initialize database table
    await initDatabase(client);
    
    // Find TIFF and ZIP files
    const tiffFiles = findTiffFiles(srtmDir);
    const zipFiles = findZipFiles(srtmDir);
    
    console.log(`Found ${tiffFiles.length} TIFF files`);
    console.log(`Found ${zipFiles.length} ZIP files`);
    
    // Extract ZIP files if needed
    for (const zipFile of zipFiles) {
      const zipPath = path.join(srtmDir, zipFile);
      await extractZipFile(zipPath, srtmDir);
    }
    
    // Find TIFF files again (in case new ones were extracted)
    const allTiffFiles = findTiffFiles(srtmDir);
    console.log(`Processing ${allTiffFiles.length} TIFF files`);
    
    // Process each TIFF file
    // let firstFileProcessed = false; <-- Removed declaration from here
    for (const tiffFile of allTiffFiles) {
      const tiffPath = path.join(srtmDir, tiffFile);
      console.log(`Processing TIFF file: ${tiffFile}`);
      
      // Generate SQL file using raster2pgsql
      const sqlFile = path.join(tempDir, `${path.basename(tiffFile, '.tif')}.sql`);
      const sqlGenerated = await generateSqlFile(tiffPath, sqlFile);
      
      if (!sqlGenerated) {
        console.warn(`Skipping import for ${tiffFile} due to SQL generation error.`);
        continue; // Skip to the next file
      }
      
      // Import SQL file into database using psql
      const importSuccess = await importSqlFile(sqlFile, dbConfig); // Pass dbConfig
      
      // Clean up temporary SQL file regardless of import success
      try {
        fs.unlinkSync(sqlFile);
        console.log(`Removed temporary file ${sqlFile}`);
      } catch (err) {
        console.error(`Error removing temporary file ${sqlFile}:`, err);
      }
      // } <-- Removed misplaced brace

      // Log success or failure for the current file
      if (importSuccess) {
        console.log(`Successfully processed and imported file: ${tiffFile}`);
        successfulImports++; // Increment counter
        // firstFileProcessed = true; // No longer needed
        // break; // Don't exit the loop, process all files
      } else {
        console.warn(`Import failed for ${tiffFile}. Continuing with next file if any.`);
      }
    } // End of loop processing TIFF files - Correct brace placement
    
    // Print summary based on the counter
    console.log(`\n--- Import Summary ---`);
    console.log(`Processed ${allTiffFiles.length} TIFF files.`);
    console.log(`Successfully imported data from ${successfulImports} files.`);
    if (allTiffFiles.length > 0 && successfulImports > 0) {
       // Query final count after all imports
       try {
         const countResult = await client.query('SELECT COUNT(*) FROM srtm_elevation');
         console.log(`Total elevation points in database: ${countResult.rows[0].count}`);
       } catch(countErr) {
         console.error('Could not query final count:', countErr.message);
       }
    } else if (allTiffFiles.length === 0) {
       console.log('No TIFF files found in the SRTM directory.');
    }
    console.log(`----------------------\n`);

    // Note: Client closing is now handled in the finally block
  } catch (err) { // This catch corresponds to the try starting at line 195
    console.error('Error during import process:', err);
    process.exitCode = 1; // Indicate error
  } finally {
    // Ensure database connection is always closed
    if (client) {
      try {
        await client.end();
        console.log('Database connection closed.');
      } catch (closeErr) {
        console.error('Error closing database connection:', closeErr);
      }
    }
    // Final status message
    console.log(`SRTM data import process finished.`);
    console.log(`Successfully imported data from ${successfulImports} out of ${allTiffFiles ? allTiffFiles.length : 0} files found.`);
    
    // Exit with appropriate code (0 if no errors during the process, 1 if errors occurred)
    process.exit(process.exitCode || 0);
  }
}

/**
 * Initialize database table
 * @param {pg.Client} client - PostgreSQL client
 */
async function initDatabase(client) {
  try {
    // Check if PostGIS extension is installed
    const postgisResult = await client.query(`
      SELECT 1 FROM pg_extension WHERE extname = 'postgis'
    `);
    
    if (postgisResult.rowCount === 0) {
      console.error('PostGIS extension is not installed in the database.');
      console.error('Please install PostGIS extension:');
      console.error('CREATE EXTENSION postgis;');
      process.exit(1);
    } else {
      console.log('PostGIS extension found.');
    }

    // Check if PostGIS Raster extension is installed
    const rasterResult = await client.query(`
      SELECT 1 FROM pg_extension WHERE extname = 'postgis_raster'
    `);

    if (rasterResult.rowCount === 0) {
      console.warn('PostGIS Raster extension is not installed. Attempting to create it...');
      try {
        await client.query('CREATE EXTENSION postgis_raster;');
        console.log('Successfully created PostGIS Raster extension.');
      } catch (extErr) {
        console.error('Failed to create PostGIS Raster extension:', extErr);
        console.error('Please ensure the extension is available and the database user has permission to create extensions.');
        console.error('You might need to run: CREATE EXTENSION postgis_raster; manually as a superuser.');
        process.exit(1);
      }
    } else {
      console.log('PostGIS Raster extension found.');
    }
    
    // Create table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS srtm_elevation (
        id SERIAL PRIMARY KEY,
        lon DOUBLE PRECISION NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        elevation INTEGER NOT NULL,
        CONSTRAINT elevation_check CHECK (elevation > 0 AND elevation < 8848 AND elevation != 32767)
      )
    `);
    
    // Create spatial index if it doesn't exist
    const indexResult = await client.query(`
      SELECT 1 FROM pg_indexes WHERE indexname = 'srtm_elevation_idx'
    `);
    
    if (indexResult.rowCount === 0) {
      await client.query(`
        CREATE INDEX srtm_elevation_idx ON srtm_elevation USING gist (
          ST_SetSRID(ST_MakePoint(lon, lat), 4326)
        )
      `);
    }
    
    console.log('Database table initialized successfully');
  } catch (err) {
    console.error('Error initializing database:', err);
    throw err;
  }
}

/**
 * Find TIFF files in the specified directory
 * @param {string} dir - Directory to search
 * @returns {string[]} - Array of TIFF file names
 */
function findTiffFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(file => file.toLowerCase().endsWith('.tif') || file.toLowerCase().endsWith('.tiff'));
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err);
    return [];
  }
}

/**
 * Find ZIP files in the specified directory
 * @param {string} dir - Directory to search
 * @returns {string[]} - Array of ZIP file names
 */
function findZipFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(file => file.toLowerCase().endsWith('.zip'));
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err);
    return [];
  }
}

/**
 * Extract a ZIP file
 * @param {string} zipPath - Path to the ZIP file
 * @param {string} destDir - Destination directory
 * @returns {Promise<boolean>} - True if successful
 */
async function extractZipFile(zipPath, destDir) {
  try {
    const zipFileName = path.basename(zipPath);
    const fileNameWithoutExt = zipFileName.replace(/\.zip$/i, '');
    
    // Check if the ZIP file contains a TIFF file
    const expectedTiffFile = path.join(destDir, `${fileNameWithoutExt}.tif`);
    if (fs.existsSync(expectedTiffFile)) {
      console.log(`Extracted file ${fileNameWithoutExt}.tif already exists, skipping extraction`);
      return true;
    }
    
    console.log(`Extracting ${zipFileName}...`);
    
    // Try to use AdmZip if available
    if (AdmZip) {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(destDir, true);
      console.log(`Successfully extracted ${zipFileName} using AdmZip`);
      return true;
    }
    
    // Fallback to using unzip command
    try {
      await execAsync(`unzip -o "${zipPath}" -d "${destDir}"`);
      console.log(`Successfully extracted ${zipFileName} using unzip command`);
      return true;
    } catch (err) {
      console.error(`Error using unzip command:`, err.message);
    }
    
    // Fallback to using PowerShell on Windows
    if (process.platform === 'win32') {
      try {
        await execAsync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`);
        console.log(`Successfully extracted ${zipFileName} using PowerShell`);
        return true;
      } catch (err) {
        console.error(`Error using PowerShell:`, err.message);
      }
    }
    
    console.error(`Could not extract ${zipPath}. Please extract it manually to ${destDir}`);
    console.error(`Then run this script again.`);
    return false;
  } catch (err) {
    console.error(`Error extracting ${zipPath}:`, err);
    return false;
  }
}

/**
 * Generate SQL file using raster2pgsql
 * @param {string} tiffPath - Path to the TIFF file
 * @param {string} sqlFile - Path to the output SQL file
 * @returns {Promise<boolean>} - True if successful
 */
async function generateSqlFile(tiffPath, sqlFile) {
  try {
    // Check if raster2pgsql is available
    try {
      await execAsync('raster2pgsql -?');
      console.log('raster2pgsql is available');
    } catch (err) {
      console.error('raster2pgsql is not available. Please install PostGIS.');
      console.error('On Ubuntu/Debian: sudo apt-get install postgis');
      console.error('On Windows: Install PostGIS from https://postgis.net/windows_downloads/');
      console.error('On macOS: brew install postgis');
      throw new Error('raster2pgsql not found');
    }

    let gdalAvailable = false;
    let tempTiledTiffPath = null;
    let inputTiffForRaster2pgsql = tiffPath; // Default to original file

    // Check if gdal_translate is available
    try {
      await execAsync('gdal_translate --version');
      console.log('gdal_translate is available. Attempting to pre-tile the TIFF.');
      gdalAvailable = true;
    } catch (err) {
      console.warn('gdal_translate is not available. Will attempt raster2pgsql directly.');
      console.warn('Install GDAL for potentially better memory handling:');
      console.warn('On Ubuntu/Debian: sudo apt-get install gdal-bin');
      console.warn('On Windows/macOS: See https://gdal.org/download.html');
    }

    // If GDAL is available, create a temporary tiled TIFF
    if (gdalAvailable) {
      tempTiledTiffPath = path.join(path.dirname(sqlFile), `${path.basename(tiffPath, '.tif')}_tiled.tif`);
      const gdalCommand = `gdal_translate -co TILED=YES -co BLOCKXSIZE=256 -co BLOCKYSIZE=256 "${tiffPath}" "${tempTiledTiffPath}"`;
      try {
        console.log(`Executing GDAL command: ${gdalCommand}`);
        await execAsync(gdalCommand);
        console.log(`Successfully created temporary tiled TIFF: ${tempTiledTiffPath}`);
        inputTiffForRaster2pgsql = tempTiledTiffPath; // Use the tiled version for raster2pgsql
      } catch (gdalErr) {
        console.error(`Error executing gdal_translate: ${gdalErr.message}`);
        console.warn('Falling back to using the original TIFF with raster2pgsql.');
        // Clean up potentially incomplete temp file
        if (fs.existsSync(tempTiledTiffPath)) {
          try { fs.unlinkSync(tempTiledTiffPath); } catch (_) {}
        }
        tempTiledTiffPath = null; // Reset path so it's not cleaned up later
        inputTiffForRaster2pgsql = tiffPath; // Revert to original
      }
    }
    
    // Generate SQL file using raster2pgsql on the (potentially tiled) input TIFF
    // -I: Create a GiST index on the raster column
    // -C: Apply raster constraints
    // -e: Execute each statement individually
    // -Y: Use COPY statements instead of INSERT
    // -F: Add a column with the filename
    // -t: Tile size (use raster2pgsql tiling as fallback or if GDAL failed)
    
    // SRTM data uses SRID 4326 (WGS84)
    const srid = 4326;
    
    const raster2pgsqlApproaches = [
      // Try with SRID and auto tiling first (inspired by tutorial)
      `raster2pgsql -s ${srid} -I -C -e -Y -F -t auto "${inputTiffForRaster2pgsql}" > "${sqlFile}"`,
      // Fallback: Try with SRID but no explicit tiling
      `raster2pgsql -s ${srid} -I -C -e -Y -F "${inputTiffForRaster2pgsql}" > "${sqlFile}"`,
      // Fallback: Try with SRID and specific smaller tiles
      `raster2pgsql -s ${srid} -I -C -e -Y -F -t 100x100 "${inputTiffForRaster2pgsql}" > "${sqlFile}"`,
      `raster2pgsql -s ${srid} -I -C -e -Y -F -t 50x50 "${inputTiffForRaster2pgsql}" > "${sqlFile}"`
    ];
    
    let success = false;
    for (const cmd of raster2pgsqlApproaches) {
      try {
        console.log(`Executing: ${cmd}`);
        await execAsync(cmd);
        success = true;
        break;
      } catch (err) {
         // Log the full error including stderr if available
        console.error(`Error with command ${cmd}:`, err.message);
        if (err.stderr) {
            console.error(`raster2pgsql stderr: ${err.stderr}`);
        }
      }
    }

    // Clean up temporary tiled TIFF if it was created
    if (tempTiledTiffPath && fs.existsSync(tempTiledTiffPath)) {
      try {
        fs.unlinkSync(tempTiledTiffPath);
        console.log(`Removed temporary tiled TIFF: ${tempTiledTiffPath}`);
      } catch (unlinkErr) {
        console.error(`Error removing temporary tiled TIFF ${tempTiledTiffPath}:`, unlinkErr);
      }
    }
    
    if (!success) {
      console.error(`All raster2pgsql approaches failed for ${inputTiffForRaster2pgsql}.`);
      // Indicate failure - SQL file was not generated
      return false;
    } // End of if (!success) block - Correctly closed

    // If raster2pgsql succeeded, proceed to modify the SQL file
    const modified = await modifySqlFile(sqlFile);
    if (!modified) {
        console.error(`Failed to modify the generated SQL file: ${sqlFile}`);
        // Consider if we should delete the unmodified sqlFile here
        return false; // Indicate failure as modification step failed
    }
    
    console.log(`Successfully generated and modified SQL file: ${sqlFile}`);
    return true; // Return true only if SQL generated AND modified

  } catch (err) { // Catch block for the main try starting at line 474
    console.error(`Error during SQL file generation process:`, err.message);
     // Clean up temporary tiled TIFF if it exists and an error occurred before normal cleanup
    if (tempTiledTiffPath && fs.existsSync(tempTiledTiffPath)) {
        try {
            fs.unlinkSync(tempTiledTiffPath);
            console.log(`Cleaned up temporary tiled TIFF after error: ${tempTiledTiffPath}`);
        } catch (unlinkErr) {
            // Log secondary error but don't overwrite primary error reason
            console.error(`Error removing temporary tiled TIFF ${tempTiledTiffPath} during error handling:`, unlinkErr);
        }
    }
    return false; // Indicate overall failure
  } // End of catch block
} // End of generateSqlFile function - Correctly closed

/**
 * Modify SQL file to apply filtering
 * @param {string} sqlFile - Path to the SQL file
 * @returns {Promise<boolean>} - True if successful
 */
async function modifySqlFile(sqlFile) {
  try {
    // Create a temporary file for the modified SQL
    const tempFile = `${sqlFile}.temp`;
    const readStream = fs.createReadStream(sqlFile, { encoding: 'utf8', highWaterMark: 1024 * 1024 }); // 1MB chunks
    const writeStream = fs.createWriteStream(tempFile);
    
    // Process the SQL file line by line
    const rl = readline.createInterface({
      input: readStream,
      crlfDelay: Infinity
    });
    
    console.log(`Processing SQL file line by line to apply filtering...`);
    
    let tableName = null;
    const createTableRegex = /CREATE TABLE "([^"]+)"/;

    // Process line by line, write to temp file, and find table name
    for await (const line of rl) {
      writeStream.write(line + '\n'); // Write original line to temp file
      if (!tableName) {
        const match = line.match(createTableRegex);
        if (match) {
          tableName = match[1];
          console.log(`Found table name: ${tableName}`);
        }
      }
    }

    // Close the read stream interface
    rl.close();
    readStream.close(); // Ensure the read stream is closed

    if (!tableName) {
      console.error('Could not find CREATE TABLE statement in SQL file. Cannot append extraction logic.');
      // Close the write stream before returning
      await new Promise((resolve) => {
        writeStream.end();
        writeStream.on('finish', resolve);
      });
      // Clean up temp file
      try {
        fs.unlinkSync(tempFile);
      } catch (unlinkErr) {
        console.warn(`Could not remove temporary file ${tempFile}: ${unlinkErr.message}`);
      }
      return false;
    }
    
    // Now append our custom SQL to extract elevation data from the raster
    const extractSql = `
-- Extract elevation data from raster and insert into srtm_elevation table
-- This will be executed after the raster table is created
INSERT INTO srtm_elevation (lon, lat, elevation)
SELECT
  ST_X(geom) as lon,
  ST_Y(geom) as lat,
  val as elevation
FROM (
  SELECT
    (ST_PixelAsPoints(rast, 1)).geom,
    (ST_PixelAsPoints(rast, 1)).val
  FROM "${tableName}"
) AS t
WHERE val > 0 AND val < 8848 AND val != 32767 -- Removed LIMIT
ON CONFLICT (lat, lon) DO NOTHING; -- Ignore duplicate lat/lon pairs

-- Drop the temporary raster table after extraction
DROP TABLE IF EXISTS "${tableName}";
DROP TABLE IF EXISTS "${tableName}";
`;
    
    writeStream.write(extractSql);
    
    // Close the write stream
    await new Promise((resolve) => {
      writeStream.end();
      writeStream.on('finish', resolve);
    });
    
    // Replace the original file with the modified file
    fs.unlinkSync(sqlFile);
    fs.renameSync(tempFile, sqlFile);
    
    console.log(`Successfully modified SQL file to apply filtering`);
    return true;
  } catch (err) {
    console.error(`Error modifying SQL file:`, err.message);
    return false;
  }
}

/**
 * Import SQL file into database using psql CLI
 * @param {string} sqlFile - Path to the SQL file
 * @param {object} dbConfig - Database connection configuration
 * @returns {Promise<boolean>} - True if successful
 */
async function importSqlFile(sqlFile, dbConfig) {
  try {
    // Check if psql is available
    try {
      await execAsync('psql --version');
      console.log('psql command is available.');
    } catch (err) {
      console.error('psql command is not available. Please install PostgreSQL client tools.');
      console.error('On Ubuntu/Debian: sudo apt-get install postgresql-client');
      console.error('On Windows: Install PostgreSQL from https://www.postgresql.org/download/windows/');
      console.error('On macOS: brew install postgresql');
      throw new Error('psql not found');
    }

    console.log(`Importing SQL file using psql: ${sqlFile}`);
    
    // Construct the psql command
    // Use PGPASSWORD environment variable for security
    const psqlCommand = `psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -v ON_ERROR_STOP=1 -f "${sqlFile}"`;
    
    console.log(`Executing psql command (password hidden)...`);
    
    // Execute the command with the password in the environment
    const { stdout, stderr } = await execAsync(psqlCommand, {
      env: {
        ...process.env, // Inherit existing environment variables
        PGPASSWORD: dbConfig.password,
      },
    });

    if (stderr) {
      // psql often prints notices to stderr, check if it's a real error
      if (stderr.toLowerCase().includes('error:') || stderr.toLowerCase().includes('fatal:')) {
        console.error(`psql Error Output:\n${stderr}`);
        throw new Error(`psql command failed. Stderr: ${stderr}`);
      } else {
        console.log(`psql Output (stderr):\n${stderr}`); // Log non-error output like notices
      }
    }
    
    if (stdout) {
      console.log(`psql Output (stdout):\n${stdout}`);
    }

    console.log(`Successfully imported SQL file ${sqlFile} using psql.`);
    return true;

  } catch (err) {
    // Log the error message, but avoid logging the full command which might contain sensitive info if not careful
    console.error(`Error importing SQL file ${sqlFile} using psql:`, err.message);
    // If the error object contains stdout/stderr from execAsync, log them
    if (err.stdout) console.error(`psql stdout on error: ${err.stdout}`);
    if (err.stderr) console.error(`psql stderr on error: ${err.stderr}`);
    return false;
  }
}
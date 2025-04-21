#!/usr/bin/env node
/**
 * SRTM Elevation Data Import Script
 * 
 * This script imports NASA SRTM elevation data into a PostgreSQL database.
 * It uses worker threads for improved performance.
 * 
 * Usage:
 *   node import-srtm.js [--threads N] [--batch-size N] [--srtm-dir PATH]
 * 
 * Options:
 *   --threads N         Number of worker threads to use (default: number of CPU cores)
 *   --batch-size N      Number of points to insert in a single batch (default: 10000)
 *   --srtm-dir PATH     Path to the directory containing SRTM data files (default: ./SRTM)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { createReadStream, createWriteStream } from 'fs';
import { createInterface } from 'readline';
import { exec } from 'child_process';
import { promisify } from 'util';
import pg from 'pg';
import dotenv from 'dotenv';
import os from 'os';

// Try to import geotiff
let geotiff;
try {
  geotiff = await import('geotiff');
  console.log('GeoTIFF package loaded successfully');
} catch (err) {
  console.warn('GeoTIFF package not found. Please install it with: npm install geotiff');
  console.warn('Continuing without GeoTIFF support...');
}

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
const DEFAULT_THREADS = os.cpus().length;
const DEFAULT_BATCH_SIZE = 10000;
// Use project root for SRTM directory
const DEFAULT_SRTM_DIR = path.join(path.dirname(__dirname), 'SRTM');
const DEFAULT_MAX_POINTS = 0; // 0 means no limit
const DEFAULT_TILE_SIZE = 100; // Much smaller tile size to reduce memory usage

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
        threads: DEFAULT_THREADS,
        batchSize: DEFAULT_BATCH_SIZE,
        srtmDir: DEFAULT_SRTM_DIR,
        maxPoints: DEFAULT_MAX_POINTS,
        tileSize: DEFAULT_TILE_SIZE
      };
      
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--threads' || args[i] === '-t') {
          options.threads = parseInt(args[i+1], 10);
          i++;
        } else if (args[i] === '--batch-size' || args[i] === '-b') {
          options.batchSize = parseInt(args[i+1], 10);
          i++;
        } else if (args[i] === '--srtm-dir' || args[i] === '-d') {
          options.srtmDir = args[i+1];
          i++;
        } else if (args[i] === '--max-points' || args[i] === '-m') {
          options.maxPoints = parseInt(args[i+1], 10);
          i++;
        } else if (args[i] === '--tile-size') {
          options.tileSize = parseInt(args[i+1], 10);
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
  .option('-t, --threads <number>', 'Number of worker threads', DEFAULT_THREADS)
  .option('-b, --batch-size <number>', 'Batch size for database inserts', DEFAULT_BATCH_SIZE)
  .option('-d, --srtm-dir <path>', 'Path to SRTM directory', DEFAULT_SRTM_DIR)
  .option('-m, --max-points <number>', 'Maximum number of points to process (0 = no limit)', DEFAULT_MAX_POINTS)
  .option('--tile-size <number>', 'Size of tiles for processing GeoTIFF files', DEFAULT_TILE_SIZE)
  .parse(process.argv);

const options = program.opts();

// Worker thread code
if (!isMainThread) {
  const { csvPath, sourceFile, dbConfig, batchSize } = workerData;
  
  processCsvFile(csvPath, sourceFile, dbConfig, batchSize)
    .then(() => {
      parentPort.postMessage({ status: 'completed', csvPath });
    })
    .catch(err => {
      parentPort.postMessage({ status: 'error', error: err.message, csvPath });
    });
}
// Main thread code
else {
  main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}

/**
 * Main function
 */
async function main() {
  const threads = parseInt(options.threads, 10);
  const batchSize = parseInt(options.batchSize, 10);
  const srtmDir = options.srtmDir;
  const maxPoints = parseInt(options.maxPoints, 10);
  const tileSize = parseInt(options.tileSize, 10);
  
  console.log(`Starting SRTM data import with ${threads} threads`);
  console.log(`Batch size: ${batchSize}`);
  console.log(`SRTM directory: ${srtmDir}`);
  console.log(`Maximum points: ${maxPoints === 0 ? 'No limit' : maxPoints}`);
  console.log(`Tile size: ${tileSize}`);
  
  // Ensure SRTM directory exists
  if (!fs.existsSync(srtmDir)) {
    console.log(`Creating SRTM directory: ${srtmDir}`);
    fs.mkdirSync(srtmDir, { recursive: true });
  }
  
  // Create temp directory for CSV files
  const tempDir = path.join(srtmDir, 'temp');
  if (!fs.existsSync(tempDir)) {
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
  
  try {
    // Initialize database table
    await initDatabase(client);
    
    // Find all TIFF files
    const tiffFiles = fs.readdirSync(srtmDir)
      .filter(file => file.endsWith('_DEM.tif'))
      .map(file => path.join(srtmDir, file));
    
    console.log(`Found ${tiffFiles.length} TIFF files`);
    
    // Find all ZIP files
    const zipFiles = fs.readdirSync(srtmDir)
      .filter(file => file.endsWith('.zip'))
      .map(file => path.join(srtmDir, file));
    
    console.log(`Found ${zipFiles.length} ZIP files`);
    
    // Extract ZIP files if needed
    for (const zipPath of zipFiles) {
      const zipBasename = path.basename(zipPath);
      const extractedName = zipBasename.replace('.zip', '');
      const extractedTiff = `${extractedName}_XSAR_DEM.tif`;
      const extractedPath = path.join(srtmDir, extractedTiff);
      
      // Check if the extracted file already exists
      if (fs.existsSync(extractedPath)) {
        console.log(`Extracted file ${extractedTiff} already exists, skipping extraction`);
        continue;
      }
      
      // Extract the ZIP file
      console.log(`Extracting ${zipPath}...`);
      try {
        await extractZipFile(zipPath, srtmDir);
        
        // Add the extracted TIFF to the list if it exists
        if (fs.existsSync(extractedPath)) {
          tiffFiles.push(extractedPath);
        }
      } catch (err) {
        console.error(`Error extracting ${zipPath}:`, err);
      }
    }
    
    // Process each TIFF file
    const csvQueue = [];
    
    for (const tiffPath of tiffFiles) {
      const tiffBasename = path.basename(tiffPath);
      
      // Check if this file has already been imported
      const imported = await isFileImported(client, tiffBasename);
      if (imported) {
        console.log(`File ${tiffBasename} has already been imported, skipping`);
        continue;
      }
      
      console.log(`Processing TIFF file: ${tiffBasename}`);
      
      // Create a temporary CSV file
      const csvPath = path.join(tempDir, `${path.basename(tiffBasename, '.tif')}.csv`);
      
      // Convert TIFF to CSV
      try {
        const success = await tiffToCsv(tiffPath, csvPath);
        if (success) {
          csvQueue.push({ csvPath, sourceFile: tiffBasename });
        }
      } catch (err) {
        console.error(`Error converting ${tiffPath} to CSV:`, err);
      }
    }
    
    // Process CSV files with worker threads
    if (csvQueue.length > 0) {
      console.log(`Processing ${csvQueue.length} CSV files with ${threads} worker threads`);
      
      // Create a pool of worker threads
      const activeWorkers = new Set();
      const pendingCsvFiles = [...csvQueue];
      
      // Function to start a worker
      const startWorker = (csvData) => {
        const worker = new Worker(new URL(import.meta.url), {
          workerData: {
            csvPath: csvData.csvPath,
            sourceFile: csvData.sourceFile,
            dbConfig,
            batchSize
          }
        });
        
        activeWorkers.add(worker);
        
        worker.on('message', (message) => {
          if (message.status === 'completed') {
            console.log(`Completed processing ${message.csvPath}`);
            
            // Clean up the temporary CSV file
            try {
              fs.unlinkSync(message.csvPath);
              console.log(`Removed temporary file ${message.csvPath}`);
            } catch (err) {
              console.error(`Error removing temporary file ${message.csvPath}:`, err);
            }
          } else if (message.status === 'error') {
            console.error(`Error processing ${message.csvPath}:`, message.error);
          }
          
          // Remove this worker from the active set
          activeWorkers.delete(worker);
          
          // Start a new worker if there are pending CSV files
          if (pendingCsvFiles.length > 0) {
            startWorker(pendingCsvFiles.shift());
          } else if (activeWorkers.size === 0) {
            console.log('All CSV files processed');
            process.exit(0);
          }
        });
        
        worker.on('error', (err) => {
          console.error(`Worker error:`, err);
          activeWorkers.delete(worker);
          
          // Start a new worker if there are pending CSV files
          if (pendingCsvFiles.length > 0) {
            startWorker(pendingCsvFiles.shift());
          } else if (activeWorkers.size === 0) {
            console.log('All CSV files processed');
            process.exit(0);
          }
        });
      };
      
      // Start initial workers
      const initialWorkers = Math.min(threads, pendingCsvFiles.length);
      for (let i = 0; i < initialWorkers; i++) {
        startWorker(pendingCsvFiles.shift());
      }
    } else {
      console.log('No CSV files to process');
    }
  } catch (err) {
    console.error('Error:', err);
    await client.end();
    process.exit(1);
  }
}

/**
 * Initialize database table
 * @param {pg.Client} client - Database client
 */
async function initDatabase(client) {
  try {
    // Create table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS srtm_elevation (
        id SERIAL PRIMARY KEY,
        lat DOUBLE PRECISION,
        lon DOUBLE PRECISION,
        elevation INTEGER,
        source_file VARCHAR(255),
        UNIQUE(lat, lon)
      )
    `);
    
    // Create spatial index
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_srtm_elevation_lat_lon 
      ON srtm_elevation(lat, lon)
    `);
    
    console.log('Database table initialized successfully');
  } catch (err) {
    console.error('Error initializing database table:', err);
    throw err;
  }
}

/**
 * Check if a file has already been imported
 * @param {pg.Client} client - Database client
 * @param {string} filename - TIFF filename
 * @returns {Promise<boolean>} - True if already imported
 */
async function isFileImported(client, filename) {
  try {
    const result = await client.query(
      'SELECT COUNT(*) FROM srtm_elevation WHERE source_file = $1',
      [filename]
    );
    return parseInt(result.rows[0].count, 10) > 0;
  } catch (err) {
    console.error(`Error checking if file ${filename} is imported:`, err);
    return false;
  }
}

/**
 * Extract a zip file
 * @param {string} zipPath - Path to the zip file
 * @param {string} destDir - Destination directory
 * @returns {Promise<boolean>} - True if successful
 */
async function extractZipFile(zipPath, destDir) {
  try {
    // Try using AdmZip if available
    if (AdmZip) {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(destDir, true);
      console.log(`Successfully extracted ${zipPath} using AdmZip`);
      return true;
    }
    
    // Fall back to using external unzip command
    try {
      if (process.platform === 'win32') {
        // On Windows, try to use PowerShell's Expand-Archive
        const cmd = `powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`;
        await execAsync(cmd);
      } else {
        // On Unix, use unzip command
        await execAsync(`unzip -o "${zipPath}" -d "${destDir}"`);
      }
      console.log(`Successfully extracted ${zipPath} using system command`);
      return true;
    } catch (cmdErr) {
      console.error(`Error extracting with system command:`, cmdErr);
      
      // As a last resort, inform the user
      console.error(`Could not extract ${zipPath}. Please extract it manually to ${destDir}`);
      console.error(`Then run this script again.`);
      return false;
    }
  } catch (err) {
    console.error(`Error extracting ${zipPath}:`, err);
    return false;
  }
}

/**
 * Convert TIFF to CSV using GeoTIFF library
 * @param {string} tiffPath - Path to the TIFF file
 * @param {string} csvPath - Path to the output CSV file
 * @returns {Promise<boolean>} - True if successful
 */
async function tiffToCsv(tiffPath, csvPath) {
  if (!geotiff) {
    console.error('GeoTIFF library is not available. Please install it with: npm install geotiff');
    return false;
  }

  try {
    console.log(`Processing GeoTIFF file: ${tiffPath}`);
    
    // Read the GeoTIFF file
    const { fromFile } = geotiff;
    const tiff = await fromFile(tiffPath);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    
    // Get geotransform information
    const origin = image.getOrigin();
    const resolution = image.getResolution();
    
    console.log(`GeoTIFF dimensions: ${width}x${height}`);
    console.log(`Origin: ${origin}`);
    console.log(`Resolution: ${resolution}`);
    
    // Create a write stream for the CSV file
    const writeStream = createWriteStream(csvPath);
    
    // Process the GeoTIFF in tiles to reduce memory usage
    console.log('Converting GeoTIFF to CSV format using tiled processing...');
    let pointCount = 0;
    
    // Get tile size from options
    const TILE_SIZE = options.tileSize || 100;
    const numXTiles = Math.ceil(width / TILE_SIZE);
    const numYTiles = Math.ceil(height / TILE_SIZE);
    
    console.log(`Processing in ${numXTiles}x${numYTiles} tiles of size ${TILE_SIZE}x${TILE_SIZE}`);
    
    // Process each tile
    for (let tileY = 0; tileY < numYTiles; tileY++) {
      for (let tileX = 0; tileX < numXTiles; tileX++) {
        // Calculate tile boundaries
        const startX = tileX * TILE_SIZE;
        const startY = tileY * TILE_SIZE;
        const endX = Math.min(startX + TILE_SIZE, width);
        const endY = Math.min(startY + TILE_SIZE, height);
        const tileWidth = endX - startX;
        const tileHeight = endY - startY;
        
        console.log(`Processing tile ${tileX},${tileY} (${startX},${startY} to ${endX},${endY})`);
        
        // Read only the data for this tile
        const window = [startX, startY, endX, endY];
        let tileRasters = await image.readRasters({ window });
        
        // Process the tile data
        for (let y = 0; y < tileHeight; y++) {
          for (let x = 0; x < tileWidth; x++) {
            // Check if we've reached the maximum number of points
            if (options.maxPoints > 0 && pointCount >= options.maxPoints) {
              console.log(`Reached maximum number of points (${options.maxPoints}), stopping processing`);
              // Close the write stream
              await new Promise((resolve) => {
                writeStream.end();
                writeStream.on('finish', resolve);
              });
              return true;
            }
            
            // Calculate the geographic coordinates
            const pixelX = startX + x;
            const pixelY = startY + y;
            const lon = origin[0] + (pixelX * resolution[0]);
            const lat = origin[1] + (pixelY * resolution[1]);
            
            // Get the elevation value
            const elevation = tileRasters[0][y * tileWidth + x];
            
            // Skip points with elevation <= 0 or suspiciously high values (likely "no data" values)
            // 32767 is the maximum value for a signed 16-bit integer, often used as "no data" value
            if (elevation <= 0 || elevation >= 32767 || elevation > 8848) { // 8848m is Mount Everest height
              continue;
            }
            
            // Write the point to the CSV file (format: lon lat elevation)
            writeStream.write(`${lon} ${lat} ${elevation}\n`);
            pointCount++;
            
            // Log progress more frequently
            if (pointCount % 1000000 === 0) {
              console.log(`Processed ${pointCount} points so far`);
            }
          }
          
          // Free memory more aggressively by clearing temporary variables
          if (y % 10 === 0) {
            // This helps trigger garbage collection more frequently
            global.gc && global.gc();
          }
        }
        
        // Log progress after each tile
        console.log(`Processed ${pointCount} points so far`);
        
        // Clear the rasters array to free memory
        tileRasters.length = 0;
        
        // Set to null to help garbage collection
        tileRasters = null;
        
        // Force garbage collection if available
        if (global.gc) {
          console.log('Running garbage collection...');
          global.gc();
        } else {
          // Suggest running with --expose-gc
          console.log('Tip: Run with node --expose-gc to enable manual garbage collection');
        }
        
        // Add a small delay to allow garbage collection to complete
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // Close the write stream
    await new Promise((resolve) => {
      writeStream.end();
      writeStream.on('finish', resolve);
    });
    
    console.log(`Successfully converted GeoTIFF to CSV. Processed ${pointCount} points.`);
    return true;
  } catch (err) {
    console.error(`Error processing GeoTIFF file: ${err.message}`);
    console.error('Please make sure you have installed the geotiff package: npm install geotiff');
    return false;
  }
}

/**
 * Process a CSV file
 * @param {string} csvPath - Path to the CSV file
 * @param {string} sourceFile - Source file name
 * @param {object} dbConfig - Database configuration
 * @param {number} batchSize - Batch size for inserts
 */
async function processCsvFile(csvPath, sourceFile, dbConfig, batchSize) {
  // Connect to database
  const client = new pg.Client(dbConfig);
  await client.connect();
  
  try {
    console.log(`Processing ${csvPath}...`);
    
    // Read the CSV file line by line
    const fileStream = createReadStream(csvPath, { encoding: 'utf8' });
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    let batch = [];
    let processedCount = 0;
    let skippedCount = 0;
    
    // Process each line
    for await (const line of rl) {
      try {
        const parts = line.trim().split(' ');
        if (parts.length < 3) continue;
        
        const lon = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        const elevation = parseFloat(parts[2]);
        
        // Skip points with elevation <= 0
        if (elevation <= 0) {
          skippedCount++;
          continue;
        }
        
        batch.push({ lat, lon, elevation });
        
        // Insert batch when it reaches the batch size
        if (batch.length >= batchSize) {
          await insertBatch(client, batch, sourceFile);
          processedCount += batch.length;
          batch = [];
          
          // Log progress
          if (processedCount % (batchSize * 10) === 0) {
            console.log(`Processed ${processedCount} points from ${sourceFile}`);
          }
        }
      } catch (err) {
        console.error(`Error processing line in ${csvPath}:`, err);
      }
    }
    
    // Insert any remaining points
    if (batch.length > 0) {
      await insertBatch(client, batch, sourceFile);
      processedCount += batch.length;
    }
    
    console.log(`Completed ${csvPath}: Processed ${processedCount} points, Skipped ${skippedCount} points`);
  } catch (err) {
    console.error(`Error processing ${csvPath}:`, err);
    throw err;
  } finally {
    await client.end();
  }
}

/**
 * Insert a batch of points into the database
 * @param {pg.Client} client - Database client
 * @param {Array} batch - Array of data points {lat, lon, elevation}
 * @param {string} sourceFile - Source file name
 */
async function insertBatch(client, batch, sourceFile) {
  try {
    // Create a parameterized query
    const values = [];
    const params = [];
    
    for (let i = 0; i < batch.length; i++) {
      const point = batch[i];
      const offset = i * 3;
      values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, '${sourceFile}')`);
      params.push(point.lat, point.lon, point.elevation);
    }
    
    // Insert the batch
    const query = `
      INSERT INTO srtm_elevation (lat, lon, elevation, source_file)
      VALUES ${values.join(',')}
      ON CONFLICT (lat, lon) DO UPDATE SET
        elevation = EXCLUDED.elevation,
        source_file = EXCLUDED.source_file
    `;
    
    await client.query(query, params);
  } catch (err) {
    console.error('Error inserting batch:', err);
    throw err;
  }
}

4. **NASA SRTM** - For elevation data (included in SRTM folder)

### SRTM Elevation Data

XCmaps can use NASA SRTM (Shuttle Radar Topography Mission) data to calculate accurate AGL (Above Ground Level) heights for pilots in the OGN Live view. To use this feature:

1. **Install GDAL**: The GDAL command-line tools are required to process SRTM data files.
   - On Ubuntu/Debian: `sudo apt-get install gdal-bin`
   - On Windows: Install GDAL from OSGeo4W (https://trac.osgeo.org/osgeo4w/)
   - On macOS: `brew install gdal`

2. **Download SRTM Data**: Download SRTM data files for your region from NASA's Earth Data website (https://earthdata.nasa.gov/). You'll need to create a free account.
   - Look for "SRTM 1 Arc-Second Global" or similar datasets
   - Download the data for your region of interest

3. **Place SRTM Files**:
   - Create an `SRTM` folder in the root directory of the project
   - Place the downloaded `.tif` or `.zip` files in this folder
   - The system will automatically extract and import the data on startup

4. **Data Format**:
   - The system expects SRTM data files with names ending in `_DEM.tif` or zipped files that contain such files
   - SRTM 1 Arc-Second (about 30m resolution) or 3 Arc-Second (about 90m resolution) data should work
   - GeoTIFF format is required

5. **Troubleshooting**:
   - If you encounter errors with TIFF files, try downloading a different format or version
   - The system attempts multiple approaches to read TIFF files, but some formats may not be compatible
   - If you see "require is not defined" errors, this is because the project uses ES modules. Make sure you're using ES module imports (`import` instead of `require`)
   - If you encounter memory issues, try reducing the tile size or setting a maximum number of points

The elevation data is used to calculate the AGL height of pilots by subtracting the ground elevation from their GPS altitude. This provides more accurate height information than GPS altitude alone.

> **Note**: The SRTM folder is not included in the webpack build to avoid TIFF processing errors. The folder is accessed directly by the server.

### Importing SRTM Data

The application includes two scripts for importing SRTM elevation data:

1. **JavaScript Script** (`scripts/import-srtm.js`): Uses pure JavaScript libraries with no external dependencies
2. **PostGIS Script** (`scripts/import-srtm-raster2pgsql.js`): Uses the `raster2pgsql` tool from PostGIS for improved performance

Both scripts are designed to be run separately from the main application and include intelligent filtering of elevation data.

#### Prerequisites

1. **Node.js** (v14 or higher)

> **Note**: The script uses pure JavaScript libraries and doesn't require any external dependencies.

#### How It Works

The script uses the following JavaScript libraries:

1. **geotiff**: A pure JavaScript library for reading GeoTIFF files
2. **adm-zip**: A pure JavaScript library for working with ZIP files
3. **pg**: A PostgreSQL client for Node.js

The script processes SRTM data with intelligent filtering:
- Skips points with elevation ≤ 0 (water or invalid data)
- Filters out extreme values (≥ 32767) which are typically "no data" values
- Excludes unrealistic elevations (> 8848m, the height of Mount Everest)

This approach uses only JavaScript libraries, making the script more portable and easier to use across different platforms.

#### Usage

1. **Install the required Node.js packages**:
   ```bash
   npm install
   
   # If you encounter package not found errors, install the specific packages:
   npm install adm-zip commander
   ```

2. **Configure database connection**:
   Create or update your `.env` file in the project root with the following variables:
   ```
   DB_HOST=your_database_host
   DB_PORT=your_database_port
   DB_NAME=your_database_name
   DB_USER=your_database_username
   DB_PASSWORD=your_database_password
   ```

2. **Create the SRTM folder** in your project root:
   ```bash
   mkdir -p SRTM
   ```

3. **Download SRTM data** from NASA's Earth Data website:
   - Visit https://earthdata.nasa.gov/ (create a free account if needed)
   - Search for "SRTM 1 Arc-Second Global"
   - Download TIFF files or ZIP files for your regions of interest

4. **Place the files** in the SRTM folder:
   ```bash
   # Example: Copy downloaded files to the SRTM folder
   cp ~/Downloads/E000N40_XSAR_DEM.tif ./SRTM/
   cp ~/Downloads/E001N40.zip ./SRTM/
   ```

5. **Run the import script** from the project root directory:
   ```bash
   # Basic usage
   node scripts/import-srtm.js

   # With custom options
   node scripts/import-srtm.js --threads 8 --batch-size 5000 --srtm-dir ./SRTM
   
   # For large SRTM files, increase Node.js memory limit
   node --max-old-space-size=8192 scripts/import-srtm.js
   
   # To enable manual garbage collection (helps with memory issues)
   # Note: --expose-gc is a Node.js flag, not a script option
   node --expose-gc --max-old-space-size=8192 scripts/import-srtm.js
   
   # To limit the number of points processed (for testing)
   node scripts/import-srtm.js --max-points 1000000
   
   # To adjust the tile size for memory optimization (smaller = less memory)
   node scripts/import-srtm.js --tile-size 100
   
   # Combine options for optimal performance with large files
   node --expose-gc --max-old-space-size=8192 scripts/import-srtm.js --threads 4 --tile-size 100 --batch-size 5000
   
   # For extremely large files, process in chunks by setting max-points
   node --expose-gc --max-old-space-size=8192 scripts/import-srtm.js --max-points 10000000
   # Then run again to continue from where it left off (the script skips already imported points)
   
   # Important: Run the script from the project root directory, not from the scripts directory
   # This ensures the .env file is found correctly
   ```

6. **Options**:
   - `-t, --threads <number>`: Number of worker threads (default: number of CPU cores)
   - `-b, --batch-size <number>`: Number of points per batch (default: 10000)
   - `-d, --srtm-dir <path>`: Path to SRTM directory (default: ./SRTM)

> **Note**: The script automatically loads database connection parameters from your project's `.env` file, so you don't need to specify them manually.

#### Running in Docker

To run the import script in the Docker environment:

1. **Ensure the scripts directory is copied to the container**:
   If you've just added the scripts or made changes to the Dockerfile, rebuild the container:
   ```bash
   docker-compose build app
   docker-compose up -d
   ```

2. **Copy SRTM files** to the SRTM folder in your project root.

3. **Run the script in the app container**:
   ```bash
   # Run the script directly (no sudo needed in the container)
   docker-compose exec app node scripts/import-srtm.js
   
   # If you're already inside the container, just run:
   node scripts/import-srtm.js
   ```

4. **Monitor progress** in the terminal output.

5. **Verify the data** in the database:
   ```bash
   # Connect to the PostgreSQL container
   docker-compose exec db psql -U $DB_USER -d $DB_NAME

   # Check the table and data
   SELECT COUNT(*) FROM srtm_elevation;
   SELECT MIN(elevation), MAX(elevation), AVG(elevation) FROM srtm_elevation;
   ```

5. **Test AGL calculation** by viewing aircraft in the live view and checking their AGL heights.

#### Using the PostGIS Script (Recommended for Large Datasets)

The PostGIS script uses the `raster2pgsql` tool from PostGIS to import SRTM data. This approach is recommended for large datasets as it offers better performance and memory efficiency. The script includes several fallback mechanisms to handle memory limitations.

##### Prerequisites

1. **Node.js** (v14 or higher)
2. **PostgreSQL with PostGIS extension**
3. **raster2pgsql** tool (comes with PostGIS)

##### Usage

1. **Install the required Node.js packages**:
   ```bash
   npm install
   
   # If you encounter package not found errors, install the specific packages:
   npm install adm-zip commander
   ```

2. **Configure database connection**:
   Create or update your `.env` file in the project root with the following variables:
   ```
   DB_HOST=your_database_host
   DB_PORT=your_database_port
   DB_NAME=your_database_name
   DB_USER=your_database_username
   DB_PASSWORD=your_database_password
   ```

3. **Place SRTM data files** in the SRTM folder in the project root:
   ```bash
   # Example: Copy downloaded files to the SRTM folder
   cp ~/Downloads/E000N40_XSAR_DEM.tif ./SRTM/
   cp ~/Downloads/E001N40.zip ./SRTM/
   ```

4. **Run the import script** from the project root directory:
   ```bash
   # Basic usage
   node scripts/import-srtm-raster2pgsql.js
   
   # With custom options
   node scripts/import-srtm-raster2pgsql.js --srtm-dir ./SRTM --temp-dir ./SRTM/temp
   
   # Important: Run the script from the project root directory, not from the scripts directory
   # This ensures the .env file is found correctly
   ```

5. **Options**:
   - `--srtm-dir <path>`: Path to SRTM directory (default: ./SRTM)
   - `--temp-dir <path>`: Path to temporary directory (default: ./SRTM/temp)

##### Running in Docker

To run the import script in the Docker environment:

1. **Ensure the scripts directory is copied to the container**:
   If you've just added the scripts or made changes to the Dockerfile, rebuild the container:
   ```bash
   docker-compose build app
   docker-compose up -d
   ```

2. **Copy SRTM files** to the SRTM folder in your project root.

3. **Run the script in the app container**:
   ```bash
   # IMPORTANT: Use this exact syntax to run the script from outside the container
   # Note: The script uses ES modules, which require Node.js v14+ or the --experimental-modules flag
   docker-compose exec app node scripts/import-srtm-raster2pgsql.js
   
   # If you're already inside the container, use this exact syntax:
   node scripts/import-srtm-raster2pgsql.js
   
   # For large TIFF files, you might need to increase the memory limit:
   docker-compose exec app node --max-old-space-size=4096 scripts/import-srtm-raster2pgsql.js
   
   # If you encounter issues with ES modules on older Node.js versions, try:
   docker-compose exec app node --experimental-modules scripts/import-srtm-raster2pgsql.js
   ```

   > **Note**: Do not try to run the script output directly in the shell. The script will output progress messages, but these are not commands to be executed.

4. **If you encounter memory issues**, you can increase the memory limit for the Docker container by adding a `mem_limit` parameter to the app service in your `docker-compose.yml` file:
   ```yaml
   app:
     # ... other configuration ...
     mem_limit: 8g  # Allocate 8GB of memory to the container
   ```

4. **Monitor progress** in the terminal output.

5. **Verify the data** in the database:
   ```bash
   # Connect to the PostgreSQL container
   docker-compose exec db psql -U $DB_USER -d $DB_NAME

   # Check the table and data
   SELECT COUNT(*) FROM srtm_elevation;
   SELECT MIN(elevation), MAX(elevation), AVG(elevation) FROM srtm_elevation;
   ```

#### Advantages of Each Implementation

##### JavaScript Implementation

1. **Native Integration**: Uses the same Node.js runtime as the rest of the application
2. **Pure JavaScript**: Uses only JavaScript libraries with no external dependencies
3. **Simplified Dependencies**: Uses npm packages already in your project
4. **Worker Threads**: Uses Node.js worker threads for parallel processing
5. **Environment Consistency**: Shares the same environment and configuration as the main application
6. **Memory Optimization**: Processes large files in small tiles with aggressive memory management
7. **Intelligent Filtering**: Filters out invalid or extreme elevation values

##### PostGIS Implementation

1. **Performance**: Significantly faster for large datasets
2. **Memory Efficiency**: Uses less memory during import
3. **Spatial Indexing**: Automatically creates appropriate spatial indexes
4. **Data Integrity**: Handles coordinate systems and transformations correctly
5. **Mature Tool**: Uses a well-established tool with extensive testing
6. **Intelligent Filtering**: Maintains the same filtering logic as the JavaScript implementation
7. **PostGIS Integration**: Seamless integration with PostGIS functions
8. **Fallback Mechanisms**: Tries multiple approaches with different tile sizes if memory issues occur
9. **Chunk Processing**: Processes large SQL files in chunks to avoid memory limitations
10. **ES Module Support**: Uses modern JavaScript ES module syntax for better compatibility

> **Note on Memory Usage**: When processing very large TIFF files, you might encounter memory issues with raster2pgsql. The script tries several approaches with different tile sizes to reduce memory usage. It also processes SQL files in chunks to avoid Node.js memory limitations. If all approaches fail, it will create an empty SQL file with just the table creation. In this case, you can try running the script with increased memory limits or use the JavaScript implementation instead.
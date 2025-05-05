# XCmaps - Interactive Map for Para- and Hang-Gliding

[![CC-BY-4.0][cc-by-shield]][cc-by]

XCmaps is an interactive web-based map designed specifically for paragliding and hang gliding pilots. It provides critical flight planning information including airspaces, wind conditions, takeoff and landing spots, and obstacles in an intuitive, interactive interface.

## Features

- **Interactive Map Layers**
  - Multiple base maps (terrain, satellite, OpenStreetMap, XContest)
  - Toggle different information layers on/off
  - Responsive design for desktop and mobile devices

- **Airspace Information**
  - Dynamic airspace visualization with color-coding
  - Filter airspaces by altitude limits
  - Date-based filtering for temporary airspaces
  - Detailed information on click (class, limits, activation times)
  - Separate toggle for "Trigger NOTAM" airspaces (hidden by default)

- **Wind Stations**
  - Real-time wind data with directional indicators
  - Color-coded wind speed visualization
  - Historical wind data in tables and charts
  - Integration with webcams where available

- **Flying Sites**
  - Paragliding takeoff locations with directional indicators
  - Hang gliding takeoff spots
  - Landing zones
  - Detailed site information including height, rating, and descriptions
  - User feedback system for site information updates

- **Safety Features**
  - Obstacle visualization
  - Geolocation for finding nearby sites
  - Altitude filtering to focus on relevant airspaces

## Sponsors
![JawgMaps](https://blog.jawg.io/content/images/2019/10/jawgmaps-pin.png)

JawgMaps provides their vector map tiles service to XCMaps for free, i.e. the Terrain Base Map.

## Installation

### Prerequisites

- Node.js (v14 or higher)
- PostgreSQL with PostGIS extension
- API keys for map services (see Configuration section)

> **Important**: This project uses ES modules, not CommonJS. Make sure your Node.js version supports ES modules and that any imported modules are compatible with ES modules.

### Setup (Docker Compose - Recommended)

This project uses Docker Compose to manage the application, database (PostgreSQL/PostGIS), and Keycloak services.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/xcmaps.git # Replace with actual repo URL if different
    cd xcmaps
    ```

2.  **Create and configure `.env` file:**
    *   Copy the `.env.example` file (if one exists) or create a new `.env` file in the root directory.
    *   Fill in the required environment variables. Refer to the **Configuration -> Environment Variables** section below for details (Database credentials, Keycloak settings, etc.).
    *   **Important:** For Keycloak setup, leave `KEYCLOAK_ADMIN_CLIENT_SECRET` blank initially if you plan to use the setup script.

3.  **Build and Start Services:**
    *   First, build the frontend application:
        ```bash
        npm run build
        ```
    *   Then, build the Docker images and start the services:
        ```bash
        docker-compose up -d --build
        ```
    *   This command builds the application image (using the pre-built frontend assets) and starts all services defined in `docker-compose.yml` in detached mode.

4.  **Database Initialization:**
    *   The first time you run `docker-compose up` with an empty database volume (`postgres_data`), the `init-postgis.sh` script will run inside the `db` container. This script **only enables necessary PostGIS extensions**.
    *   **It does NOT create the application tables** (`places`, `obstacles`, `xcairspaces`, etc.).
    *   **Action Required:** You must manually create these tables after the containers are running. You can do this by:
        *   Restoring a database backup into the `db` container.
        *   Connecting to the `db` container (e.g., `docker exec -it xcmaps-db-1 psql -U $DB_USER -d $DB_NAME`) and running the required `CREATE TABLE` SQL statements (ensure you have the schema definition).

5.  **Keycloak Client Setup (Optional but Recommended):**
    *   If using Keycloak, run the setup script (after containers are running) to configure clients and roles automatically. See the **Keycloak Setup (Automated)** section below for details.
    *   Remember to add the generated `KEYCLOAK_ADMIN_CLIENT_SECRET` to your `.env` file after running the script.

6.  **Access the application:**
    *   Open your browser and navigate to `http://localhost:3000` (or the `APP_DOMAIN` you configured).

## Usage Guide

### Basic Navigation

- **Pan**: Click and drag the map
- **Zoom**: Use the scroll wheel or the zoom controls in the bottom right
- **Find Your Location**: Click the location icon in the bottom right

### Layer Controls

The layer control panel on the right side of the map allows you to:

1. **Select Base Map**:
   - Terrain (default) - Topographic map
   - XContest - XContest competition map
   - OpenStreetMap - Standard street map
   - Satellite - Aerial imagery

2. **Toggle Overlays**:
   - Wind Stations - Shows wind data points
   - Spots - Takeoff and landing locations
   - Airspaces - General restricted and controlled airspace
   - Trigger NOTAM - Specific temporary restricted airspaces (hidden by default)
   - Obstacles - Known flight hazards

### Airspace Filtering

1. **Date Selection**: Choose the date for which you want to see active airspaces
2. **Altitude Filtering**: Set the maximum altitude to filter out high-level airspaces

### Viewing Spot Details

1. Click on any takeoff or landing spot marker
2. View detailed information including:
   - Site name and type
   - Wind directions
   - Height and height difference
   - Rating and description
   - Last update date

### Wind Station Data

1. Click on a wind station marker
2. View current wind conditions
3. Switch between tabs to see:
   - Table view of historical data
   - Chart view of wind trends
   - Camera view (if available)

### Submitting Feedback

1. Click on a spot marker to open its popup
2. Click the "Feedback/Correction" button
3. Fill in the feedback form with your information
4. Optionally upload images (up to 5)
5. Submit your feedback

## Configuration

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| PORT | Server port | 3000 |
| APP_DOMAIN | Application URL | http://localhost:3000 |
| DB_HOST | PostgreSQL host | localhost |
| DB_PORT | PostgreSQL port | 5432 |
| DB_USER | Database username | postgres |
| DB_PASSWORD | Database password | password |
| DB_NAME | Database name | xcmaps |
| OAIP_KEY | OpenAIP API key | your_api_key |
| MAIL_HOST | SMTP server for feedback emails | smtp.example.com |
| MAIL_USER | Email username | user@example.com |
| MAIL_PASSWORD | Email password | password |
| KEYCLOAK_AUTH_SERVER_URL | Base URL of Keycloak auth endpoint | http://keycloak:8080/auth |
| KEYCLOAK_CLIENT_ID | Public client ID for frontend | xcmaps-client |
| KEYCLOAK_REALM_NAME | Keycloak realm name | master |
| KEYCLOAK_ADMIN_URL | Keycloak Admin API URL for backend (Not currently used by setup script/app) | http://keycloak:8080/auth/admin/realms/master |
| KEYCLOAK_ADMIN_CLIENT_ID | Service account client ID for backend | xcmaps-backend-service |
| KEYCLOAK_ADMIN_CLIENT_SECRET | Service account client secret | your_kc_admin_secret |

### Map Services

XCmaps uses several map services that may require API keys:

1. **OpenAIP** - For airspace data (requires API key)
2. **MapTiler** - For terrain maps (API key included but may need updating)
3. **Winds.mobi** - For wind station data (no key required)
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
### Keycloak Setup (Automated)

If you are using Keycloak for user authentication (recommended for features like saving layer preferences), you can automate the client and role setup using the provided script.

1.  **Run Keycloak:** Ensure Keycloak is running (e.g., via Docker Compose using the provided `docker-compose.yml` or your own setup). The default admin credentials are often `admin`/`admin` for initial setup.
2.  **Configure `.env`:** Ensure the following Keycloak-related variables are set in your `.env` file. Default values used by the script are shown if the variable is not set, but you should configure them for your environment:
    *   `KEYCLOAK_AUTH_SERVER_URL`: Base URL of Keycloak auth endpoint (Default: `http://localhost:8080/auth`)
    *   `KEYCLOAK_REALM_NAME`: Keycloak realm name (Default: `master`)
    *   `KEYCLOAK_ADMIN_USER`: Keycloak admin username (Default: `admin`)
    *   `KEYCLOAK_ADMIN_PASSWORD`: Keycloak admin password (Default: `admin`)
    *   `KEYCLOAK_CLIENT_ID`: Public client ID for frontend (Default: `xcmaps-client`)
    *   `KEYCLOAK_ADMIN_CLIENT_ID`: Service account client ID for backend (Default: `xcmaps-backend-service`)
    *   `APP_DOMAIN`: Base URL of the XCmaps application (Default: `http://localhost:3000`)
    *   `KEYCLOAK_ADMIN_CLIENT_SECRET`: *Leave this blank initially.* The script will generate and display the secret for you to add.
3.  **Run the Setup Script:**
    *   **Linux/macOS:**
        ```bash
        chmod +x setup-keycloak-client.sh
        ./setup-keycloak-client.sh
        ```
    *   **Windows (using Git Bash or WSL):**
        ```bash
        ./setup-keycloak-client.sh
        ```
    *   **Windows (using PowerShell):**
        ```powershell
        .\setup-keycloak-client.ps1
        ```
        *   **Warning:** The PowerShell script (`setup-keycloak-client.ps1`) is currently **outdated and incomplete**. It does not configure the backend client or roles correctly. Use the Bash script (`.sh`) via Git Bash or WSL for full automation.

4.  **Update `.env` with Secret:** The script will output the generated `KEYCLOAK_ADMIN_CLIENT_SECRET`. Copy this value and add it to your `.env` file.

5.  **Assign User Role (Manual Step):** The script creates the `user` role, but you still need to assign this role to your users manually via the Keycloak Admin Console:
    *   Go to `Users`. Find or create a user.
    *   Go to the `Role mapping` tab for the user.
    *   Click `Assign role`.
    *   Find and select the `user` role.
    *   Click `Assign`.

This automated setup configures the necessary clients and roles, allowing the frontend to authenticate users and the backend to securely manage user attributes via the Keycloak Admin API.

## API Documentation

XCmaps provides several API endpoints that can be used by other applications:

### OGN Live Data

- `GET /api/ogn/aircraft?nwLat={nwLat}&nwLng={nwLng}&seLat={seLat}&seLng={seLng}`
  - Returns aircraft positions within the specified bounding box
  - Parameters: `nwLat`, `nwLng`, `seLat`, `seLng` (coordinates of the northwest and southeast corners)

- `GET /api/ogn/track/{id}?minutes={minutes}`
  - Returns the track for a specific aircraft
  - Parameters:
    - `id`: Aircraft ID
    - `minutes` (optional): Number of minutes of history to retrieve (default: 60)

### Wind Data

- `GET /api/wind-data-getNear?lat={latitude}&lng={longitude}`
  - Returns wind stations near the specified coordinates
  - Parameters: `lat` (latitude), `lng` (longitude)

- `GET /api/wind-data-getCurrent?nwLat={nwLat}&nwLng={nwLng}&seLat={seLat}&seLng={seLng}`
  - Returns current wind data within the specified bounding box
  - Parameters: `nwLat`, `nwLng`, `seLat`, `seLng` (coordinates of the northwest and southeast corners)

### Places (Takeoff/Landing)

- `GET /api/places?nw_lat={nwLat}&nw_lng={nwLng}&se_lat={seLat}&se_lng={seLng}&type={type}`
  - Returns places within the specified bounding box
  - Parameters: 
    - `nw_lat`, `nw_lng`, `se_lat`, `se_lng` (coordinates of the bounding box)
    - `type` (optional): Filter by place type (TO, TOW, TH, LZ)

- `GET /api/places/{id}`
  - Returns detailed information about a specific place
  - Parameters: `id` (place ID)

### Airspaces

- `GET /api/airspacesXCdb?startDate={date}&nw_lat={nwLat}&nw_lng={nwLng}&se_lat={seLat}&se_lng={seLng}`
  - Returns airspaces within the specified bounding box for the given date
  - Parameters:
    - `startDate`: Date in YYYY-MM-DD format
    - `nw_lat`, `nw_lng`, `se_lat`, `se_lng` (coordinates of the bounding box)

### Feedback

- `POST /api/send-feedback`
  - Submits user feedback about a place
  - Form data parameters:
    - `feedbackText`: User's feedback message
    - `userName`: User's name
    - `userEmail`: User's email
    - `name`: Place name
    - `id`: Place ID
    - `strPlacemarkId`: Placemark ID
    - `images`: Up to 5 image files

## Contributing

Contributions to XCmaps are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Commit your changes (`git commit -m 'Add some amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## License

This work is licensed under a [Creative Commons Attribution 4.0 International License][cc-by].

[![CC-BY-4.0][cc-by-image]][cc-by]

[cc-by]: http://creativecommons.org/licenses/by/4.0/
[cc-by-image]: https://i.creativecommons.org/l/by/4.0/88x31.png
[cc-by-shield]: https://img.shields.io/badge/License-CC%20BY%204.0-lightgrey.svg

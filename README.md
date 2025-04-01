# XCmaps - Interactive Map for Paragliding and Hang Gliding

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

## Installation

### Prerequisites

- Node.js (v14 or higher)
- PostgreSQL with PostGIS extension
- API keys for map services (see Configuration section)

### Setup

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/xcmaps.git
   cd xcmaps
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory with the following variables:
   ```
   # Server
   PORT=3000
   APP_DOMAIN=http://localhost:3000
   
   # Database
   DB_HOST=localhost
   DB_PORT=5432
   DB_USER=your_db_user
   DB_PASSWORD=your_db_password
   DB_NAME=xcmaps
   
   # API Keys
   OAIP_KEY=your_openaip_key
   
   # Email (for feedback)
   MAIL_HOST=your_smtp_host
   MAIL_USER=your_email
   MAIL_PASSWORD=your_email_password
   ```

4. Set up the database:
   ```
   # Create database tables (example - adjust as needed)
   psql -U your_db_user -d xcmaps -f database/schema.sql
   
   # Import initial data if available
   psql -U your_db_user -d xcmaps -f database/initial_data.sql
   ```

5. Build the frontend assets:
   ```
   npm run build
   ```

6. Start the server:
   ```
   npm start
   ```

7. Access the application at `http://localhost:3000`

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
   - Airspaces - Restricted and controlled airspace
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

### Map Services

XCmaps uses several map services that may require API keys:

1. **OpenAIP** - For airspace data (requires API key)
2. **MapTiler** - For terrain maps (API key included but may need updating)
3. **Winds.mobi** - For wind station data (no key required)

## API Documentation

XCmaps provides several API endpoints that can be used by other applications:

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

// First, include necessary libraries
// - Leaflet
// - A library to work with pixel data like georaster or d3-scale-chromatic for coloring

// Initialize the map
const map = L.map('map').setView([37.8, -122.4], 10);

// Add a base layer for reference
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Your Mapbox access token
const mapboxToken = c49iG8J3xvAkgCSZ8M8v;

// Create a custom canvas overlay to process terrain-rgb data
const TerrainRGBLayer = L.GridLayer.extend({
  createTile: function(coords, done) {
    const tile = document.createElement('canvas');
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;
    const ctx = tile.getContext('2d');
    
    // Construct the URL for the terrain-rgb tile
    const url = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${coords.z}/${coords.x}/${coords.y}.pngraw?access_token=${mapboxToken}`;
    
    // Load the terrain-rgb tile
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = function() {
      // Draw the image to our canvas to access pixel data
      ctx.drawImage(img, 0, 0);
      
      // Get the image data to process elevation values
      const imageData = ctx.getImageData(0, 0, tile.width, tile.height);
      const pixels = imageData.data;
      
      // Process each pixel
      for (let i = 0; i < pixels.length; i += 4) {
        // Decode elevation value from RGB
        // Mapbox formula: -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
        const R = pixels[i];
        const G = pixels[i + 1];
        const B = pixels[i + 2];
        
        const elevation = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1);
        
        // Apply your custom color scheme based on elevation
        let color = getColorForElevation(elevation);
        
        // Set the pixel color
        pixels[i] = color.r;     // Red
        pixels[i + 1] = color.g; // Green
        pixels[i + 2] = color.b; // Blue
        // Keep alpha as is
      }
      
      // Put the modified pixels back
      ctx.putImageData(imageData, 0, 0);
      
      // Notify Leaflet that the tile is ready
      done(null, tile);
    };
    
    img.onerror = function() {
      done('Error loading terrain tile');
    };
    
    img.src = url;
    return tile;
  }
});

// Define your custom color scheme function
function getColorForElevation(elevation) {
  // Example color scheme:
  // Deep blue for below sea level
  // Green to light green for low elevation
  // Yellow to orange for medium elevation
  // Red to white for high elevation
  
  if (elevation < 0) {
    return { r: 0, g: 0, b: 128 + Math.min(127, Math.abs(elevation) / 100) }; // Deep blue
  } else if (elevation < 500) {
    const factor = elevation / 500;
    return { r: 34, g: 139 + factor * 60, b: 34 }; // Forest green to lighter green
  } else if (elevation < 1500) {
    const factor = (elevation - 500) / 1000;
    return { r: 34 + factor * 221, g: 199 - factor * 120, b: 34 }; // Green-yellow to orange
  } else if (elevation < 4000) {
    const factor = (elevation - 1500) / 2500;
    return { r: 255, g: 79 - factor * 79, b: 0 + factor * 255 }; // Orange-red to white
  } else {
    return { r: 255, g: 255, b: 255 }; // White for very high elevations
  }
}

// Add the custom terrain layer to the map
const terrainLayer = new TerrainRGBLayer().addTo(map);

// Add a legend to explain the color scheme
const legend = L.control({ position: 'bottomright' });
legend.onAdd = function(map) {
  const div = L.DomUtil.create('div', 'legend');
  div.innerHTML = `
    <h4>Elevation (meters)</h4>
    <div style="background: rgb(0,0,255)"></div><span>Below sea level</span><br>
    <div style="background: rgb(34,199,34)"></div><span>0-500m</span><br>
    <div style="background: rgb(255,79,0)"></div><span>1500-4000m</span><br>
    <div style="background: rgb(255,255,255)"></div><span>Above 4000m</span>
  `;
  div.style.backgroundColor = 'white';
  div.style.padding = '10px';
  div.style.borderRadius = '5px';
  
  return div;
};
legend.addTo(map);
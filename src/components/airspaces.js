// airspaces.js

function fetchAirspaces() {
  // Make sure map is available
  if (!window.map) {
    console.error("Map not initialized yet");
    return;
  }
  
  const center = window.map.getCenter();
  const lat = center.lat.toFixed(6);
  const lng = center.lng.toFixed(6);

  // Use your proxy endpoint
  const apiUrl = `${process.env.APP_DOMAIN}/api/airspaces?lat=${lat}&lng=${lng}&dist=200000`;

  fetch(apiUrl)
    .then(response => response.json())
    .then(data => {
      // Clear existing layers
      window.airspaceEFG.clearLayers();

      const airspaces = []; // Store polygons and data for later use

      data.items.forEach(airspace => {
        if (airspace.type === 0 && airspace.icaoClass === 4) {
          return;
        }

        if (airspace.geometry && airspace.geometry.type === "Polygon") {
          const coordinates = airspace.geometry.coordinates[0].map(coord => [coord[1], coord[0]]);

          const lowerLimit = airspace.lowerLimit.value;
          const color = lowerLimit === 0 ? "red" : "blue";

          const airspaceTypeText = airspaceTypes[airspace.type] || "Unknown";
          const icaoClassText = icaoClasses[airspace.icaoClass] || "Unknown";

          const polygon = L.polygon(coordinates, {
            color: color,
            weight: 2,
            fillOpacity: 0.3
          });

          // Store airspace data with its polygon
          airspaces.push({ polygon, data: airspace });

          window.airspaceEFG.addLayer(polygon);
        }
      });

      console.log(`Added ${airspaces.length} airspaces to the map`);

      // Remove any existing click listeners to avoid duplicates
      window.map.off("click.airspaces");
      
      // Add click event to detect overlapping airspaces
      window.map.on("click.airspaces", function (e) {
        const clickedPoint = e.latlng;
        const overlappingAirspaces = [];

        airspaces.forEach(({ polygon, data }) => {
          if (polygon.getBounds().contains(clickedPoint)) {
            overlappingAirspaces.push(data);
          }
        });

        if (overlappingAirspaces.length > 0) {
          const popupContent = overlappingAirspaces.map(a => `
            <b>${a.name}</b><br>
            Type: ${airspaceTypes[a.type] || "Unknown"}<br>
            ICAO Class: ${icaoClasses[a.icaoClass] || "Unknown"}<br>
            ↧${a.lowerLimit.value} ${getUnit(a.lowerLimit.unit)}  ↥${a.upperLimit.value} ${getUnit(a.upperLimit.unit)}<br>
          `).join("<hr>");

          L.popup()
            .setLatLng(clickedPoint)
            .setContent(popupContent)
            .openOn(window.map);
        }
      });
    })
    .catch(error => console.error("Error fetching airspaces:", error));
}

// Lookup tables for airspace type and ICAO class
const airspaceTypes = {
  0: "Other",
  // ... other types
};

const icaoClasses = {
  0: "A",
  // ... other classes
};

function getUnit(unitCode) {
  const units = {
    1: "ft", // Feet
    6: "FL"  // Flight Level
  };
  return units[unitCode] || "Unknown";
}

// Export the fetchAirspaces function to make it globally available
window.fetchAirspaces = fetchAirspaces;

// Listen for map layer visibility changes
document.addEventListener('map_initialized', function() {
  console.log("Setting up airspace layer events");
  
  // Add event listener for when the airspace layer is added to the map
  window.map.on('overlayadd', function(e) {
    if (e.name === 'Airspaces' || e.name === 'Gliding' || e.name === 'Notam') {
      console.log(`Overlay added: ${e.name}, fetching airspaces`);
      fetchAirspaces();
    }
  });
  
  // Also set up the moveend event to refresh airspaces when panning/zooming
  window.map.on('moveend', function() {
    // Only fetch if the layer is currently visible
    if (window.map.hasLayer(window.airspaceEFG)) {
      console.log("Map moved, refreshing airspaces");
      fetchAirspaces();
    }
  });
});

// Don't auto-fetch on script load - wait for the layer to be enabled
// Remove or comment out: fetchAirspaces();
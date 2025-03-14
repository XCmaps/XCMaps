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
  1: "Restricted",
  2: "Danger (D)",
  3: "Prohibited (Parc reserve)",
  4: "Controlled Tower Region (CTR)",
  5: "Transponder Mandatory Zone (TMZ)",
  6: "Radio Mandatory Zone (RMZ)",
  7: "Terminal Maneuvering Area (TMA)",
  8: "Temporary Reserved Area (TRA)",
  9: "Temporary Segregated Area (TSA)",
  10: "Flight Information Region (FIR)",
  11: "Upper Flight Information Region (UIR)",
  12: "Air Defense Identification Zone (ADIZ)",
  13: "Airport Traffic Zone (ATZ)",
  14: "Military Airport Traffic Zone (MATZ)",
  15: "Airway",
  16: "Military Training Route (MTR)",
  17: "Alert Area",
  18: "Warning Area",
  19: "Protected Area",
  20: "Helicopter Traffic Zone (HTZ)",
  21: "Gliding Sector",
  22: "Transponder Setting (TRP)",
  23: "Traffic Information Zone (TIZ)",
  24: "Traffic Information Area (TIA)",
  25: "Military Training Area (MTA)",
  26: "Control Area (CTA)",
  27: "ACC Sector (ACC)",
  28: "Aerial Sporting Or Recreational Activity",
  29: "Low Altitude Overflight Restriction",
  30: "Military Route (MRT)",
  31: "TSA/TRA Feeding Route (TFR)",
  32: "VFR Sector",
  33: "FIS Sector",
  34: "Lower Traffic Area (LTA)",
  35: "Upper Traffic Area (UTA)"
};

const icaoClasses = {
  0: "A",
  1: "B",
  2: "C",
  3: "D",
  4: "E",
  5: "F",
  6: "G",
  8: "Special Use Airspace (SUA)"
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
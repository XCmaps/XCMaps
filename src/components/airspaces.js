// airspaces.js
// Store the airspace click handler as a module-level variable so we can reference it later
let airspaceClickHandler = null;
let currentLowerLimit = 3000; // Default value matching dropdown
let airspaceDebounceTimer;


// Add the convertToMeters function
function convertToMeters(value, unitCode) {
  switch (unitCode) {
    case 1: // Feet to meters
      return value * 0.3048;
    case 2: // Meters (no conversion)
      return value;
    case 6: // Flight Level (FL * 100 ft to meters)
      return value * 100 * 0.3048;
    default:
      return null; // Unknown unit
  }
}

function fetchAirspaces() {
  // Make sure map is available
  if (!window.map) {
    console.error("Map not initialized yet");
    return;
  }
  
  const center = window.map.getCenter();
  const lat = center.lat.toFixed(6);
  const lng = center.lng.toFixed(6);
  const types = [0, 1, 3, 4, 5, 7, 26, 28];

  const apiUrl = `/api/airspaces?lat=${lat}&lng=${lng}&dist=200000&types=${encodeURIComponent(types.join(','))}`;

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

        // Get current limit from dropdown
        const selectedLimit = parseInt(document.getElementById('airspaceLowerLimit').value, 10);

        // Filter based on lower limit converted to meters
        const lowerLimit = airspace.lowerLimit;
        if (!lowerLimit) return; // Skip if no lower limit data

        const lowerLimitMeters = convertToMeters(lowerLimit.value, lowerLimit.unit);
        if (lowerLimitMeters === null || lowerLimitMeters >= selectedLimit) {  // Modified line
            return; // Now using dynamic limit from dropdown
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
      if (airspaceClickHandler) {
        window.map.off("click", airspaceClickHandler);
      }

      // Create a new click handler that captures the airspaces in its closure
      airspaceClickHandler = function(e) {
        // Check if the airspace layer is actually visible before processing clicks
        if (!window.map.hasLayer(window.airspaceEFG)) {
          return; // Exit if airspace layer is not visible
        }

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
            ID: ${a._id}<br>
            ↧${a.lowerLimit.value} ${getUnit(a.lowerLimit.unit)}  ↥${a.upperLimit.value} ${getUnit(a.upperLimit.unit)}<br>
          `).join("<hr>");

          L.popup()
            .setLatLng(clickedPoint)
            .setContent(popupContent)
            .openOn(window.map);
        }
      };
      
      // Add the new click handler
      window.map.on("click", airspaceClickHandler);
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
    2: "m",
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

  // Add event listener with debouncing
document.addEventListener('DOMContentLoaded', function() {
  document.body.addEventListener('change', function(e) {
    if (e.target && e.target.id === 'airspaceLowerLimit') {
      const newLimit = parseInt(e.target.value, 10);
      
      // Only update if value changed
      if (newLimit !== currentLowerLimit) {
        currentLowerLimit = newLimit;
        
        // Clear any pending debounce
        clearTimeout(airspaceDebounceTimer);
        
        // Debounce to prevent rapid successive requests
        airspaceDebounceTimer = setTimeout(() => {
          if (window.map.hasLayer(window.airspaceEFG)) {
            console.log(`Lower limit changed to ${newLimit}m, reloading airspaces`);
            fetchAirspaces();
          }
        }, 300); // 300ms debounce delay
      }
    }
  });
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
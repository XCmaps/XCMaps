// airspaces.js

// Airspaces Layer
// const airspaces = L.tileLayer('https://a.api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=171189a4d43c6578ce63758f28363cb3');

// E/F/G Airspaces (initially disabled)
// const airspaceEFG = L.layerGroup([]);

function fetchAirspaces() {
  const center = map.getCenter();
  const lat = center.lat.toFixed(6);
  const lng = center.lng.toFixed(6);

  const apiUrl = `https://api.core.openaip.net/api/airspaces?pos=${lat},${lng}&dist=200000&type=0&type=1&type=3&type=4&type=5&type=7&type=26&type=28&apiKey=171189a4d43c6578ce63758f28363cb3`;

  fetch(apiUrl)
    .then(response => response.json())
    .then(data => {
      airspaceEFG.clearLayers();

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

          airspaceEFG.addLayer(polygon);
        }
      });

      // Add click event to detect overlapping airspaces
      map.on("click", function (e) {
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
            .openOn(map);
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

// Function to convert unit codes into readable units
function getUnit(unitCode) {
  const units = {
    1: "ft", // Feet
    6: "FL"  // Flight Level
  };
  return units[unitCode] || "Unknown";
}

// Call the function to fetch and display airspaces
fetchAirspaces();

// Fetch airspaces when the map stops moving
map.on('moveend', fetchAirspaces);
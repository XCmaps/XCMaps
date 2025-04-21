import moment from 'moment';
import 'moment-timezone';
import * as turf from '@turf/turf';

let airspacePopupOpenListener = null; // Listener for popupopen
let currentLowerLimit = 3000; // Default matches dropdown
let airspaceDebounceTimer;
let selectedDateStr = getCurrentDateStr(); // Store the selected date

// Global array to store airspace data accessible by the popupopen listener
let allLoadedAirspaces = [];

// Helper function to get current date string in YYYY-MM-DD format
function getCurrentDateStr() {
  const today = new Date();
  return `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
}

// Helper function to convert limit to meters
function getLimitMeters(limit) {
  if (!limit) return null;

  switch (limit.type) {
    case 'FL': return limit.height * 0.3048;
    case 'AMSL': case 'AGL': return limit.height * 0.3048;
    default: return null;
  }
}

// Helper function to generate HTML for a single airspace's popup content
function generateAirspacePopupHtml(a) { // 'a' represents the airspace data (feature.properties)
  const tzName = moment.tz.guess();

  let descriptionsHtml = '';
  if (a.descriptions && Array.isArray(a.descriptions) && a.descriptions.length > 0) {
    const formatDescription = (text) => {
      if (!text) return '';
      return text.replace(/([ABCDEFGQ]\))/g, '<br>$1');
    };
    descriptionsHtml = `
      <div class="airspace-descriptions" style="font-size: 0.8em;">
          ${a.descriptions.map(desc => {
            const formattedDesc = formatDescription(desc.airdescription || '');
            return `${formattedDesc} ${desc.airlanguage ? `(${desc.airlanguage})` : ''}`;
          }).join('')}
      </div>
    `;
  }

  let activationsHtml = '';
  if (a.activations && Array.isArray(a.activations) && a.activations.length > 0) {
    activationsHtml = `
      <div class="airspace-activations">
        <b>Activations:</b><br>
        ${a.activations.map(activation => {
          const startMoment = moment.utc(activation[0]).tz(tzName);
          const endMoment = moment.utc(activation[1]).tz(tzName);
          return `${startMoment.format('MMM D, HH:mm z')} - ${endMoment.format('MMM D, HH:mm z')}`;
        }).join('<br>')}
      </div>
    `;
  }

  const formatLimit = (limit, original) => {
    if (!limit) return original || 'N/A';
    const type = limit.type;
    const height = limit.height;
    if (type === 'FL') {
      const meters = Math.round(height * 0.3048);
      const flNumber = height / 100;
      return `${meters}m (FL${flNumber})`;
    } else if (type === 'AMSL' || type === 'AGL') {
      const meters = Math.round(height * 0.3048);
      return `${meters}m`;
    } else {
      return original || 'N/A';
    }
  };

  const lower = formatLimit(a.airlower_j, a.lowerLimit);
  const upper = formatLimit(a.airupper_j, a.upperLimit);

  // Add timezone info like in the old code example
  const tzAbbreviation = moment.tz(tzName).zoneAbbr();
  const tzOffset = moment.tz(tzName).format('Z');

  return `
    <div class="airspace-detail">
      <b>${a.name} (${a.airspaceClass})</b><br>
      <b>↧ </b>${lower} - <b>↥ </b>${upper}<br>
      ${descriptionsHtml}
      ${activationsHtml}
    </div>
  `;
}


function fetchAirspacesXC() {
    if (!window.map) {
      console.error("Map not initialized yet");
      return;
    }

    // --- Zoom Level Check ---
    const currentZoom = window.map.getZoom();
    const minZoomLevel = 5;
    if (currentZoom < minZoomLevel) {
        console.log(`[AirspaceXC] Zoom level ${currentZoom} is below minimum (${minZoomLevel}), clearing layer and skipping fetch.`);
        if (window.airspaceXC) { // Ensure layer group exists before clearing
            window.airspaceXC.clearLayers(); // Clear existing layers
        }
        if (window.airspaceTriggerNotam) { // Clear Trigger NOTAM layer too
            window.airspaceTriggerNotam.clearLayers();
        }
        allLoadedAirspaces = []; // Reset data
        // No need to manage popup listener here, it's handled elsewhere or irrelevant if no data is loaded
        return; // Exit *before* constructing URL or fetching
    }
    // --- End Zoom Level Check ---


    const center = window.map.getCenter();
    const lat = center.lat.toFixed(6);
    const lng = center.lng.toFixed(6);
    const bounds = window.map.getBounds();
    const nw = bounds.getNorthWest();
    const se = bounds.getSouthEast();
    const dateStr = selectedDateStr;
    const apiUrl = `/api/airspacesXCdb?startDate=${dateStr}&nw_lat=${nw.lat.toFixed(6)}&nw_lng=${nw.lng.toFixed(6)}&se_lat=${se.lat.toFixed(6)}&se_lng=${se.lng.toFixed(6)}`;

    fetch(apiUrl)
    .then(response => response.json())
    .then(data => {
        window.airspaceXC.clearLayers();
        if (window.airspaceTriggerNotam) { // Clear Trigger NOTAM layer too
            window.airspaceTriggerNotam.clearLayers();
        }
        allLoadedAirspaces = []; // Reset global array

        // Remove any existing popupopen listeners from the MAP
        if (airspacePopupOpenListener) {
          window.map.off("popupopen", airspacePopupOpenListener); // Target MAP now
          airspacePopupOpenListener = null;
        }

        // Redundant zoom check removed from here

        // Deduplicate features using a Map with unique identifiers
        const uniqueFeatures = new Map();
        const features = data.features || [];
        
        // First pass: collect unique features using a composite key (name + geometry)
        features.forEach(feature => {
          if (feature.properties && feature.properties.name && feature.geometry) {
            // Create a composite key from name and stringified geometry
            // This ensures airspaces with the same name but different geometries are kept
            const geometryString = JSON.stringify(feature.geometry);
            const compositeKey = `${feature.properties.name}_${geometryString}`;
            uniqueFeatures.set(compositeKey, feature);
          } else if (feature.properties && feature.properties.id) {
            // Fallback: use ID if name or geometry is not available
            uniqueFeatures.set(feature.properties.id, feature);
          }
        });
        
        console.log(`[AirspaceXC] Deduplicated ${features.length} features to ${uniqueFeatures.size} unique features`);
        
        // Use the deduplicated features
        const deduplicatedFeatures = Array.from(uniqueFeatures.values());
        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const selectedDateStartLocal = moment.tz(selectedDateStr, "YYYY-MM-DD", userTimezone).startOf('day');
        const selectedDateStartUTC = selectedDateStartLocal.utc().toDate();

        deduplicatedFeatures.forEach(feature => {
          if (feature.geometry && feature.geometry.type === "Polygon") {

            // --- Filtering Logic ---
            if (feature.properties.name && (feature.properties.name.startsWith("V00") || feature.properties.name.startsWith("EBBR"))) return;
            const lowerLimitMeters = getLimitMeters(feature.properties.airlower_j);
            if (lowerLimitMeters === null || lowerLimitMeters > currentLowerLimit) return;
            let isExpired = false;
            if (feature.properties.descriptions && Array.isArray(feature.properties.descriptions)) {
              for (const desc of feature.properties.descriptions) {
                const description = desc.airdescription || '';
                const cMatch = description.match(/C\)\s*(\d{10})/);
                if (cMatch && cMatch[1]) {
                  try {
                    const year = 2000 + parseInt(cMatch[1].substring(0, 2));
                    const month = parseInt(cMatch[1].substring(2, 4)) - 1;
                    const day = parseInt(cMatch[1].substring(4, 6));
                    const hour = parseInt(cMatch[1].substring(6, 8));
                    const minute = parseInt(cMatch[1].substring(8, 10));
                    const expirationDate = new Date(Date.UTC(year, month, day, hour, minute));
                    if (expirationDate < selectedDateStartUTC) { isExpired = true; break; }
                  } catch (error) { console.error("Error parsing expiration date:", error); }
                }
              }
            }
            if (isExpired) return;
            let hasActiveActivation = false;
            if (feature.properties.activations && Array.isArray(feature.properties.activations) && feature.properties.activations.length > 0) {
              const selectedDateEndLocal = moment.tz(selectedDateStr, "YYYY-MM-DD", userTimezone).endOf('day');
              const selectedDateEndUTC = selectedDateEndLocal.utc().toDate();
              for (const activation of feature.properties.activations) {
                const activationStart = new Date(activation[0]);
                const activationEnd = new Date(activation[1]);
                if (activationStart <= selectedDateEndUTC && activationEnd >= selectedDateStartUTC) { hasActiveActivation = true; break; }
              }
              if (!hasActiveActivation) return;
            }
            if (feature.properties.airspaceClass === "R") {
              let hasExpirationDate = false;
              if (feature.properties.descriptions && Array.isArray(feature.properties.descriptions)) {
                for (const desc of feature.properties.descriptions) {
                  if ((desc.airdescription || '').match(/C\)\s*(\d{10})/)) { hasExpirationDate = true; break; }
                }
              }
              if (!hasExpirationDate && !hasActiveActivation) return;
            }
            // --- End Filtering Logic ---

            // --- New Trigger NOTAM Filter ---
            const isTriggerNotam = feature.properties.airspaceClass === "R" &&
                                   feature.properties.descriptions &&
                                   Array.isArray(feature.properties.descriptions) &&
                                   feature.properties.descriptions.some(desc => {
                                       const text = desc.airdescription || '';
                                       // Check for "E) TRIGGER NOTAM" and one of the AIP/AIC keywords
                                       return text.includes("E) TRIGGER NOTAM") &&
                                              (text.includes("AIP AMDT") || text.includes("AIP SUP") || text.includes("AIC"));
                                  });

           // --- End New Trigger NOTAM Filter ---

           const coordinates = feature.geometry.coordinates[0].map(coord => [coord[1], coord[0]]);
           const polygon = L.polygon(coordinates, {
             color: feature.properties.strokeColor || "blue",
             weight: feature.properties.strokeWeight || 2,
             fillColor: feature.properties.fillColor || "blue",
             fillOpacity: feature.properties.fillOpacity || 0.3
           });

           // *** Bind a SIMPLE initial popup content ***
           polygon.bindPopup(`<b>${feature.properties.name}</b><br><i>Loading details...</i>`, {
                className: 'airspace-popup' // Keep class
           });

           // Store polygon, data, and geometry globally
           // Note: We store ALL loaded airspaces here for popup logic, regardless of which layer they are added to.
           allLoadedAirspaces.push({
             polygon, // Keep reference to layer
             data: feature.properties,
             geometry: feature.geometry
           });

           // Add to the correct layer group
           if (isTriggerNotam) {
               if (window.airspaceTriggerNotam) { // Check if the layer group exists
                   window.airspaceTriggerNotam.addLayer(polygon);
               } else {
                   console.warn("[AirspaceXC] window.airspaceTriggerNotam layer group not found. Trigger NOTAM not added.");
               }
           } else {
               window.airspaceXC.addLayer(polygon); // Add non-trigger airspaces to the main layer
           }
         }
       });

        // Define the popupopen listener function
        airspacePopupOpenListener = function(e) {
          // console.log('[AirspaceXC popupopen Listener - Attempt 13] Fired for layer:', e.layer); // DEBUG REMOVED

          const popup = e.popup;
          // Check if this is one of our airspaces popups before proceeding
          if (!popup || !popup.options || !popup.options.className || !popup.options.className.includes('airspace-popup')) {
              // console.log('[AirspaceXC popupopen Listener - Attempt 14] Ignoring popup without airspace-popup class.'); // DEBUG REMOVED
              return;
          }

          const openedLayer = e.layer; // We know it's an airspace popup now
          const latlng = popup.getLatLng();

          if (!latlng) {
              // console.log('[AirspaceXC popupopen Listener - Attempt 13] No LatLng found on popup.'); // DEBUG REMOVED
              return;
          }
          // console.log('[AirspaceXC popupopen Listener - Attempt 13] Popup LatLng:', latlng); // DEBUG REMOVED

          const overlappingAirspacesData = [];
          const pt = turf.point([latlng.lng, latlng.lat]);

          // console.log('[AirspaceXC popupopen Listener - Attempt 13] Checking overlaps in allLoadedAirspaces (count:', allLoadedAirspaces.length, ')'); // DEBUG REMOVED

          // Find overlapping airspaces using the globally stored data
          allLoadedAirspaces.forEach(({ data, geometry }, index) => {
            try {
              const poly = turf.polygon(geometry.coordinates);
              if (turf.booleanPointInPolygon(pt, poly)) {
                // console.log(`[AirspaceXC popupopen Listener - Attempt 13] Overlap found with airspace index ${index}:`, data.name); // DEBUG REMOVED
                overlappingAirspacesData.push(data);
              }
            } catch (error) {
              console.error(`[AirspaceXC] Error checking point in polygon for index ${index}:`, error); // Keep error log, remove debug marker
            }
          });

          // console.log(`[AirspaceXC popupopen Listener - Attempt 13] Found ${overlappingAirspacesData.length} total overlaps.`); // DEBUG REMOVED
          // Log the names for easier debugging
          // console.log('[AirspaceXC popupopen Listener - Attempt 13] Overlapping names:', overlappingAirspacesData.map(d => d.name)); // DEBUG REMOVED

          if (overlappingAirspacesData.length > 0) {
              // Generate combined HTML content
              const combinedHtml = overlappingAirspacesData
                  .map(data => generateAirspacePopupHtml(data)) // Use helper for each
                  .join("<hr style='margin: 5px 0; border-top: 1px solid #ccc;'>"); // Join with separator

              // Update the content of the popup that just opened
              // console.log('[AirspaceXC popupopen Listener - Attempt 13] Updating popup content.'); // DEBUG REMOVED
              // console.log('[AirspaceXC popupopen Listener - Attempt 13] Combined HTML:', combinedHtml); // DEBUG (potentially very long)
              popup.setContent(combinedHtml);

          } else {
              // console.log('[AirspaceXC popupopen Listener - Attempt 13] No overlaps found, setting default content.'); // DEBUG REMOVED
              // Fallback: Set content to just the opened layer's default
              const openedLayerEntry = allLoadedAirspaces.find(entry => entry.polygon === openedLayer);
              if (openedLayerEntry) {
                 popup.setContent(generateAirspacePopupHtml(openedLayerEntry.data));
              } else {
                 console.error('[AirspaceXC popupopen Listener - Attempt 13] Could not find data for the opened layer!'); // DEBUG
                 popup.setContent("Error: Could not find airspace details.");
              }
          }
        };

        // Add the popupopen listener to the MAP, but first ensure no duplicate listeners exist
        // This is a more robust approach to prevent multiple listeners
        if (typeof window.map._events.popupopen === 'object') {
          // Check if there are any existing popupopen listeners that match our function
          const existingListeners = window.map._events.popupopen.filter(
            handler => handler.fn === airspacePopupOpenListener
          );
          
          if (existingListeners.length > 0) {
            console.log(`[AirspaceXC] Found ${existingListeners.length} existing identical popupopen listeners, removing them.`);
            existingListeners.forEach(() => {
              window.map.off("popupopen", airspacePopupOpenListener);
            });
          }
        }
        
        // Now attach the listener
        window.map.on("popupopen", airspacePopupOpenListener);
        console.log("[AirspaceXC] popupopen listener attached to MAP."); // INFO
      })
      .catch(error => console.error("Error fetching airspaces:", error));
}


document.addEventListener('change', function(e) {
    //close open popups
    if (e.target && (e.target.id === 'airspaceLowerLimit' || e.target.id === 'airspaceTime')) {
      if (window.map && window.map._popup) {
        window.map.closePopup();
      }
    }
    // Handle airspaceLowerLimit changes
    if (e.target && e.target.id === 'airspaceLowerLimit') {
        const newLimit = parseInt(e.target.value, 10);
        if (newLimit !== currentLowerLimit) {
            currentLowerLimit = newLimit;
            clearTimeout(airspaceDebounceTimer);
            airspaceDebounceTimer = setTimeout(() => {
                if (window.map.hasLayer(window.airspaceXC)) {
                    fetchAirspacesXC();
                }
            }, 300);
        }
    }
    // Handle date selection changes
    if (e.target && e.target.id === 'airspaceTime') {
      const newDate = e.target.value;
      if (newDate !== selectedDateStr) {
        selectedDateStr = newDate;
        clearTimeout(airspaceDebounceTimer);
        airspaceDebounceTimer = setTimeout(() => {
          if (window.map.hasLayer(window.airspaceXC)) {
            fetchAirspacesXC();
          }
        }, 300);
      }
    }
});

function initializeAirspaceXCMapListeners(mapInstance) {
    if (mapInstance) {
        mapInstance.on('zoomend', function() {
            // Check if the airspaceXC layer is currently supposed to be visible
            // Ensure window.airspaceXC exists before checking hasLayer
            if (window.airspaceXC && mapInstance.hasLayer(window.airspaceXC)) {
                console.log("[AirspaceXC] Map zoom ended, re-fetching airspaces based on new zoom level.");
                // Use a small debounce to avoid rapid calls if zoom changes quickly
                clearTimeout(airspaceDebounceTimer);
                airspaceDebounceTimer = setTimeout(() => {
                    // Pass mapInstance to fetch function if it needs it,
                    // otherwise ensure fetchAirspacesXC uses the correct map reference
                    // (Assuming fetchAirspacesXC still relies on window.map internally for now)
                    fetchAirspacesXC();
                }, 150); // Shorter delay for zoom
            }
        });
        console.log("[AirspaceXC] zoomend listener attached to map.");

        // Don't attach the popup listener here to avoid duplication
        // The listener is already attached in fetchAirspacesXC
        console.log("[AirspaceXC] popupopen listener will be attached by fetchAirspacesXC.");

    } else {
        console.error("[AirspaceXC] Invalid map instance provided to initializeAirspaceXCMapListeners.");
    }
}

// Export the initializer and the fetch function
export { fetchAirspacesXC, initializeAirspaceXCMapListeners };

// Keep global assignment for potential legacy compatibility, though ideally refactor away
window.fetchAirspacesXC = fetchAirspacesXC;

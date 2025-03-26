import moment from 'moment';
import 'moment-timezone'; 
import * as turf from '@turf/turf';

let airspaceClickHandler = null;
let currentLowerLimit = 3000; // Default matches dropdown
let airspaceDebounceTimer;
let selectedDateStr = getCurrentDateStr(); // Store the selected date

// Helper function to get current date string in YYYY-MM-DD format
function getCurrentDateStr() {
  const today = new Date();
  return `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
}

// Helper function to convert limit to meters
function getLimitMeters(limit) {
  if (!limit) return null;
  
  switch (limit.type) {
    case 'FL': // Flight level (already in hundreds of feet)
      return limit.height * 0.3048; // Convert feet to meters
    case 'AMSL': // Feet above mean sea level
    case 'AGL': // Feet above ground level
      return limit.height * 0.3048;
    default:
      return null;
  }
}

function fetchAirspacesXC() {
    // Make sure map is available

    if (!window.map) {
      console.error("Map not initialized yet");
      return;
    }
    
    const center = window.map.getCenter();
    const lat = center.lat.toFixed(6);
    const lng = center.lng.toFixed(6);

    // Get map bounds for the query
    const bounds = window.map.getBounds();
    const nw = bounds.getNorthWest();
    const se = bounds.getSouthEast();

    // Use the selected date instead of current date
    const dateStr = selectedDateStr;
    
   // Build API URL with parameters
   const apiUrl = `${process.env.APP_DOMAIN}/api/airspacesXCdb?startDate=${dateStr}&nw_lat=${nw.lat.toFixed(6)}&nw_lng=${nw.lng.toFixed(6)}&se_lat=${se.lat.toFixed(6)}&se_lng=${se.lng.toFixed(6)}`;
 
    fetch(apiUrl)
    .then(response => response.json())
    
      .then(data => {
        // Clear existing layers
        window.airspaceXC.clearLayers();
  
        const airspaces = []; // Store polygons and data for later use

      // Remove any existing click listeners to avoid duplicates
      if (airspaceClickHandler) {
        window.map.off("click", airspaceClickHandler);
        airspaceClickHandler = null; // Clean up reference
      }
  
        // Check if data is a GeoJSON FeatureCollection
        const features = data.features || [];


        let filteredCount = 0;
        let filteredAirspaces = [];
        let includedAirspaces = [];

        // Precompute the selected date's start in UTC once
        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const selectedDateStartLocal = moment.tz(selectedDateStr, "YYYY-MM-DD", userTimezone).startOf('day');
        const selectedDateStartUTC = selectedDateStartLocal.utc().toDate();
            
        
        features.forEach(feature => {
          if (feature.geometry && feature.geometry.type === "Polygon") {
        
            // Skip V00 names
            if (feature.properties.name && feature.properties.name.startsWith("V00")) {
              return;
            }
        
            // Check lower limit
            const lowerLimitMeters = getLimitMeters(feature.properties.airlower_j);
            const shouldFilter = lowerLimitMeters === null || lowerLimitMeters > currentLowerLimit;
            if (shouldFilter) {
              filteredAirspaces.push({ name: feature.properties.name, limit: lowerLimitMeters });
              return;
            } else {
              includedAirspaces.push({ name: feature.properties.name, limit: lowerLimitMeters });
            }
        
            // Check expiration date
            let isExpired = false;
            if (feature.properties.descriptions && Array.isArray(feature.properties.descriptions)) {
              for (const desc of feature.properties.descriptions) {
                const description = desc.airdescription || '';
                const cMatch = description.match(/C\)\s*(\d{10})/);
                if (cMatch && cMatch[1]) {
                  // Parse expiration date
                  const dateStr = cMatch[1];
                  try {
                    const year = 2000 + parseInt(dateStr.substring(0, 2));
                    const month = parseInt(dateStr.substring(2, 4)) - 1;
                    const day = parseInt(dateStr.substring(4, 6));
                    const hour = parseInt(dateStr.substring(6, 8));
                    const minute = parseInt(dateStr.substring(8, 10));
                    const expirationDate = new Date(Date.UTC(year, month, day, hour, minute));
                    if (expirationDate < selectedDateStartUTC) {
                      isExpired = true;
                      break;
                    }
                  } catch (error) {
                    console.error("Error parsing expiration date:", error);
                  }
                }
              }
            }
            if (isExpired) return;
        
            // Check activations
            let hasActiveActivation = false;
            if (feature.properties.activations && Array.isArray(feature.properties.activations) && feature.properties.activations.length > 0) {
              const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
              const selectedDateEndLocal = moment.tz(selectedDateStr, "YYYY-MM-DD", userTimezone).endOf('day');
              const selectedDateEndUTC = selectedDateEndLocal.utc().toDate();
        
              for (const activation of feature.properties.activations) {
                const activationStart = new Date(activation[0]);
                const activationEnd = new Date(activation[1]);
                if (activationStart <= selectedDateEndUTC && activationEnd >= selectedDateStartUTC) {
                  hasActiveActivation = true;
                  break;
                }
              }
        
              if (!hasActiveActivation) {
                return;
              }
            }
        
            // Additional check for R class airspaces
            if (feature.properties.airspaceClass === "R") {
              let hasExpirationDate = false;
              if (feature.properties.descriptions && Array.isArray(feature.properties.descriptions)) {
                for (const desc of feature.properties.descriptions) {
                  const description = desc.airdescription || '';
                  if (description.match(/C\)\s*(\d{10})/)) {
                    hasExpirationDate = true;
                    break;
                  }
                }
              }
        
              // Skip R airspaces without expiration date and active activation
              if (!hasExpirationDate && !hasActiveActivation) {
                return;
              }
            }
        
            // Proceed to create and add the polygon to the map
            const coordinates = feature.geometry.coordinates[0].map(coord => [coord[1], coord[0]]);
            const polygon = L.polygon(coordinates, {
              color: feature.properties.strokeColor || "blue",
              weight: feature.properties.strokeWeight || 2,
              fillColor: feature.properties.fillColor || "blue",
              fillOpacity: feature.properties.fillOpacity || 0.3
            });
            
            // Add popup with airspace-popup class and full content
            polygon.bindPopup(() => {
              const tzName = moment.tz.guess();
              const tzAbbreviation = moment.tz(tzName).zoneAbbr();
              const tzOffset = moment.tz(tzName).format('Z');
              const timezoneInfo = `<div class="timezone-info" style="margin-top: 5px; font-size: 0.85em;">Local timezone: ${tzAbbreviation} (UTC${tzOffset})</div>`;

              // Create the description HTML if there are any descriptions
              let descriptionsHtml = '';
              if (feature.properties.descriptions && Array.isArray(feature.properties.descriptions) && feature.properties.descriptions.length > 0) {
                const formatDescription = (text) => {
                  if (!text) return '';
                  return text.replace(/([ABCDEFGQ]\))/g, '<br>$1');
                };
                
                descriptionsHtml = `
                  <div class="airspace-descriptions" style="font-size: 0.8em;">
                      ${feature.properties.descriptions.map(desc => {
                        const formattedDesc = formatDescription(desc.airdescription || '');
                        return `${formattedDesc} ${desc.airlanguage ? `(${desc.airlanguage})` : ''}`;
                      }).join('')}
                  </div>
                `;
              }

              // Create activations HTML if any
              let activationsHtml = '';
              if (feature.properties.activations && Array.isArray(feature.properties.activations) && feature.properties.activations.length > 0) {
                activationsHtml = `
                  <div class="airspace-activations">
                    <b>Activations:</b><br>
                    ${feature.properties.activations.map(activation => {
                      const startMoment = moment.utc(activation[0]).tz(tzName);
                      const endMoment = moment.utc(activation[1]).tz(tzName);
                      return `${startMoment.format('MMM D, HH:mm z')} - ${endMoment.format('MMM D, HH:mm z')}`;
                    }).join('<br>')}
                  </div>
                `;
              }

              // Format limits
              const formatLimit = (limit, original) => {
                if (!limit) return original || 'N/A';
                const type = limit.type;
                const height = limit.height;
                
                if (type === 'FL') {
                  const meters = Math.round(height * 0.3048);
                  const flNumber = height / 100;
                  return `${meters}m (FL${flNumber})`;
                }
                else if (type === 'AMSL' || type === 'AGL') {
                  const meters = Math.round(height * 0.3048);
                  return `${meters}m`;
                }
                else {
                  return original || 'N/A';
                }
              };

              const lower = formatLimit(feature.properties.airlower_j, feature.properties.lowerLimit);
              const upper = formatLimit(feature.properties.airupper_j, feature.properties.upperLimit);
                          
              return `
              <b>${feature.properties.name} (${feature.properties.airspaceClass})</b><br>
              <b>↧ </b>${lower} - <b>↥ </b>${upper}<br>
              ${descriptionsHtml}
              ${activationsHtml}
              ${timezoneInfo}
              `;
            }, { className: 'airspace-popup' });
            
            // MODIFIED: Single push with all required properties
            airspaces.push({ 
              polygon,
              data: feature.properties,
              geometry: feature.geometry // Store original GeoJSON geometry
            });
            window.airspaceXC.addLayer(polygon);
          }
        });

        // After processing all features 
        // Create a new click handler that captures the airspaces in its closure
        airspaceClickHandler = function(e) {
          // Check if the airspace layer is actually visible before processing clicks
          if (!window.map.hasLayer(window.airspaceXC)) {
            return; // Exit if airspace layer is not visible
          }
  
          const clickedPoint = e.latlng;
          const overlappingAirspaces = [];

          // Convert clicked point to GeoJSON format [lng, lat]
          const pt = turf.point([clickedPoint.lng, clickedPoint.lat]);
  
          airspaces.forEach(({ polygon, data, geometry }) => {
            try {
              // Convert stored GeoJSON geometry to Turf polygon
              const poly = turf.polygon(geometry.coordinates);
              
              // Perform accurate point-in-polygon check
              if (turf.booleanPointInPolygon(pt, poly)) {
                overlappingAirspaces.push(data);
              }
            } catch (error) {
              console.error("Error checking point in polygon:", error);
            }
          });
  
          if (overlappingAirspaces.length > 0) {
              // Inside your click handler:
              const tzName = moment.tz.guess(); // Gets the user's timezone like "Europe/Berlin"
              const tzAbbreviation = moment.tz(tzName).zoneAbbr(); // Gets "CET"
              const tzOffset = moment.tz(tzName).format('Z'); // Gets "+01:00"

              const timezoneInfo = `<div class="timezone-info" style="margin-top: 5px; font-size: 0.85em;">Local timezone: ${tzAbbreviation} (UTC${tzOffset})</div>`;

              const popupContent = overlappingAirspaces.map(a => {
              // Create the description HTML if there are any descriptions
              let descriptionsHtml = '';
              // Check if descriptions exists and is actually an array with elements
              if (a.descriptions && Array.isArray(a.descriptions) && a.descriptions.length > 0) {
                // Function to format description text with line breaks before A), B), etc.
                const formatDescription = (text) => {
                  if (!text) return '';
                  
                  // Add line breaks before A), B), C), etc.
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

              // Create the description HTML if there are any descriptions
              let activationsHtml = '';

              // Add null check and array validation
              if (a.descriptions && Array.isArray(a.descriptions) && a.descriptions.length > 0) {
                // existing description formatting code
              }

              // Check if activations exists and is actually an array with elements
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

                // Define helper function to format lower/upper limits
              const formatLimit = (limit, original) => {
                if (!limit) return original || 'N/A'; // Fallback to original string if no structured data
                const type = limit.type;
                const height = limit.height;
                
                // Flight Level (FL) handling
                if (type === 'FL') {
                  const meters = Math.round(height * 0.3048); // Convert feet to meters
                  const flNumber = height / 100; // Calculate FL (e.g., 10000ft → FL100)
                  return `${meters}m (FL${flNumber})`;
                }
                // AMSL or AGL handling (feet)
                else if (type === 'AMSL' || type === 'AGL') {
                  const meters = Math.round(height * 0.3048);
                  return `${meters}m`;
                }
                // Unknown type: fallback to original string
                else {
                  return original || 'N/A';
                }
              };

                // Format lower and upper limits
              const lower = formatLimit(a.airlower_j, a.lowerLimit);
              const upper = formatLimit(a.airupper_j, a.upperLimit);
                          
              return `
              <b>${a.name} (${a.airspaceClass})</b><br>
              <b>↧ </b>${lower} - <b>↥ </b>${upper}<br>
              </div>
                ${descriptionsHtml}
                ${activationsHtml}
              </div>
              `;
            }).join("<hr style='margin: 3px 0;'>");
          
            L.popup({
              className: 'airspace-popup',
              closeOnClick: false,
              autoClose: false,
              tap: false,
              closeButton: true
            })
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


  document.addEventListener('change', function(e) {
    //close open popups
    if (e.target && (e.target.id === 'airspaceLowerLimit' || e.target.id === 'airspaceTime')) {
      // Close any open popup
      if (window.map && window.map._popup) {
        window.map.closePopup();
      }
    }
    // Handle airspaceLowerLimit changes
    if (e.target && e.target.id === 'airspaceLowerLimit') {
        const newLimit = parseInt(e.target.value, 10);
        
        console.log(`Dropdown changed: old limit=${currentLowerLimit}m, new limit=${newLimit}m`);
        
        if (newLimit !== currentLowerLimit) {
            currentLowerLimit = newLimit;
            console.log(`Current limit updated to ${currentLowerLimit}m`);
            
            clearTimeout(airspaceDebounceTimer);
            airspaceDebounceTimer = setTimeout(() => {
                if (window.map.hasLayer(window.airspaceXC)) {
                    console.log(`Triggering XC airspaces reload with limit=${currentLowerLimit}m`);
                    fetchAirspacesXC();
                }
            }, 300);
        }
    }
    // Handle date selection changes
    if (e.target && e.target.id === 'airspaceTime') {
      const newDate = e.target.value;
      console.log('Selected airspace date:', newDate);

      if (newDate !== selectedDateStr) {
        selectedDateStr = newDate;
        
        // Debounce and refetch airspaces
        clearTimeout(airspaceDebounceTimer);
        airspaceDebounceTimer = setTimeout(() => {
          if (window.map.hasLayer(window.airspaceXC)) {
            console.log('Refetching airspaces with new date:', selectedDateStr);
            fetchAirspacesXC();
          }
        }, 300);
      }
    }
  });

window.fetchAirspacesXC = fetchAirspacesXC;


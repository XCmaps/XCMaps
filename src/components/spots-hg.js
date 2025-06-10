import { 
    getAngleRange, 
    loadPlaceDetails, 
    showFeebackForm, 
    cancelFeedback 
} from './spots-helper.js';

// Use a module initialization function that waits for map to be ready
export function initSpotHG() {
    // Check if map and placesLayerHG are available in the window object
    if (!window.map || !window.placesLayerHG) {
        console.error("Map or placesLayerHG is not defined. Retrying in 500ms...");
        setTimeout(initSpotHG, 500);
        return;
    }

    console.log("Initializing HG spots module...");

    // Expose needed functions to global scope for event handlers
    window.showFeebackForm = showFeebackForm;
    window.cancelFeedback = cancelFeedback;

    // Create cluster group and nest it in the existing layer group
    const clusterGroup = L.markerClusterGroup({
        disableClusteringAtZoom: 9,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: true,
        zoomToBoundsOnClick: true,
        maxClusterRadius: 250,
        iconCreateFunction: function(cluster) {
            return L.divIcon({ 
                html: `<div class="cluster-marker">${cluster.getChildCount()}</div>`,
                className: 'hg-cluster-icon',
                iconSize: L.point(30, 30)
            });
        }
    });

    window.placesLayerHG.addLayer(clusterGroup);

    // Track current fetch controller to allow cancellation
    let currentFetchController = null;
    // Add debounce timer
    let fetchDebounceTimer = null;
    const DEBOUNCE_DELAY = 300; // ms

    // Fetch places without descriptions
    function fetchPlaces() {
        // Clear any pending debounce
        if (fetchDebounceTimer) {
            clearTimeout(fetchDebounceTimer);
        }
        
        // Debounce the fetch call to prevent rapid successive requests
        fetchDebounceTimer = setTimeout(() => {
            // Cancel any ongoing fetch
            if (currentFetchController) {
                currentFetchController.abort();
            }

            // Create a new controller for this fetch
            currentFetchController = new AbortController();
            const signal = currentFetchController.signal;

            const bounds = window.map.getBounds();
            const nw_lat = bounds.getNorthWest().lat;
            const nw_lng = bounds.getNorthWest().lng;
            const se_lat = bounds.getSouthEast().lat;
            const se_lng = bounds.getSouthEast().lng;

            fetch(`/api/places?nw_lat=${nw_lat}&nw_lng=${nw_lng}&se_lat=${se_lat}&se_lng=${se_lng}&type=TO-HG&type=TOW-HG`, {
                signal // Attach the abort signal to the fetch call
            })
                .then(response => response.json())
                .then(data => {
                    // Only process if this is still the active request
                    if (signal.aborted) return;
                    
                    clusterGroup.clearLayers();

                    L.geoJSON(data, {
                        pointToLayer: function (feature, latlng) {
                            // Helper function to convert polar coordinates to Cartesian for SVG paths
                            function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
                                var angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0; // Adjust for 0 degrees = North
                                return {
                                    x: centerX + (radius * Math.cos(angleInRadians)),
                                    y: centerY + (radius * Math.sin(angleInRadians))
                                };
                            }

                            // Helper function to describe an SVG arc path (pie slice)
                            function describeArc(x, y, radius, startAngle, endAngle) {
                                // Handle full circle or near full circle
                                if (Math.abs(endAngle - startAngle) >= 359.99) {
                                    endAngle = startAngle + 359.99; // Avoid start === end for arc calculation
                                }

                                var start = polarToCartesian(x, y, radius, endAngle); // Note: SVG arcs draw clockwise with sweep-flag 1
                                var end = polarToCartesian(x, y, radius, startAngle);

                                var largeArcFlag = Math.abs(endAngle - startAngle) <= 180 ? "0" : "1";

                                // Path definition: Move to center, Line to arc start, Arc to arc end, Close path
                                var d = [
                                    "M", x, y,
                                    "L", start.x, start.y,
                                    "A", radius, radius, 0, largeArcFlag, 1, end.x, end.y,
                                    "Z"
                                ].join(" ");

                                return d;
                            }

                            const iconSize = 45; // Adjusted icon size
                            const center = iconSize / 2;
                            const radius = center - 1; // Leave 1px padding
                            let direction = feature.properties.direction || "";
                            let angleRanges = getAngleRange(direction); // Imported from spots-helper.js

                            let pathData = angleRanges.map(([start, end]) => {
                                // Handle ranges crossing 360 degrees (e.g., NNE: 348.75 to 11.25)
                                if (start > end) {
                                    // Draw two arcs: start to 360 and 0 to end
                                    let path1 = describeArc(center, center, radius, start, 359.999);
                                    let path2 = describeArc(center, center, radius, 0, end);
                                    return path1 + " " + path2;
                                } else {
                                    return describeArc(center, center, radius, start, end);
                                }
                            }).join(" ");

                            // Default path if no direction specified (e.g., draw nothing or a full circle)
                            if (!pathData && angleRanges.length === 0) {
                                // pathData = describeArc(center, center, radius, 0, 359.999); // Optional: Draw full circle if no direction
                            }


                            const dhvIconSize = iconSize * 0.4;
                            const dhvOffset = (iconSize - dhvIconSize) / 2;

                            // Construct the SVG content string
                            const svgContent = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 ${iconSize} ${iconSize}">
                            <path d="${pathData}" fill="orange" stroke="darkorange" stroke-width="0.5" />
                            ${feature.properties.dhv_site_id != null ? `
                                <svg x="${dhvOffset}" y="${dhvOffset}" width="${dhvIconSize}" height="${dhvIconSize}" viewBox="0 0 101.25857 101.25857">
                                <defs><style>.d { fill: #fff; }</style></defs>
                                <g data-name="Ebene 1" transform="translate(-178.17581,-39.828537)">
                                    <g style="fill:#0000ff">
                                    <circle style="fill:#ffffff;fill-opacity:1;stroke:#234084;stroke-width:7;stroke-dasharray:none;stroke-opacity:1" cx="228.8051" cy="90.457825" r="47.129288" />
                                    <path class="d" d="m 251.19289,75.475405 -8.46584,33.844665 c -6.78492,-6.50358 -18.32068,-8.05383 -29.01362,-6.7317 0,0 2.5002,-6.983076 -8.73421,-16.787314 l 46.21367,-10.3303 z m -62.84402,6.96912 c 20.52895,12.397299 17.0541,28.104565 17.0541,28.104565 20.28882,-2.82582 35.03576,2.43942 41.71238,13.60304 l 14.54447,-58.266819 -73.31095,16.554552 z" style="fill:#234084;fill-opacity:1;stroke-width:0.468185" />
                                    </g>
                                </g>
                                </svg>
                            ` : `<circle cx="${center}" cy="${center}" r="${radius / 4}" fill="green" stroke="darkgreen" stroke-width="0.5" />`}
                            </svg>`;

                            // Encode the SVG string using Base64 for use as a data URI
                            const svgCleaned = svgContent.replace(/[\r\n]+/g, ''); // Remove only newlines
                            const svgBase64 = btoa(svgCleaned); // Base64 encode
                            const svgDataUri = `data:image/svg+xml;base64,${svgBase64}`;


                            // Return the marker with the new SVG icon
                            return L.marker(latlng, {
                                icon: L.icon({
                                    iconUrl: svgDataUri,
                                    iconSize: [iconSize, iconSize],
                                    iconAnchor: [center, center] // Anchor at the center
                                })
                            });
                        },
                        onEachFeature: function (feature, layer) {
                            if (feature.properties) {
                                let popupContent = `<b>${feature.properties.name}</b><br>
                                                    Type: ${feature.properties.type}<br>
                                                    Direction: ${feature.properties.direction}<br>
                                                    <i>Loading details...</i>`;

                                let responsivePopup = L.responsivePopup({
                                    hasTip: true,
                                    autoPan: false,
                                    offset: [15, 25],
                                    maxWidth: 900,
                                    maxHeight: 780
                                }).setContent(popupContent);

                                layer.bindPopup(responsivePopup);

                                layer.on("popupopen", async function () {
                                    await loadPlaceDetails(layer, feature.properties.id);
                                });
                            }
                            
                            clusterGroup.addLayer(layer);
                        }
                    });
                    
                    // Clear the controller reference when done
                    currentFetchController = null;
                })
                .catch(error => {
                    // Don't log aborted requests as errors
                    if (error.name !== 'AbortError') {
                        console.error("Error fetching HG places:", error);
                    }
                });
        }, DEBOUNCE_DELAY);
    }

    // IMPORTANT: Expose fetchPlaces to window so it can be called from index.js
    window.fetchPlacesHG = fetchPlaces;

    // REMOVED: Don't attach moveend listener here anymore
    // The central handler in index.js will call fetchPlacesPG when needed

    // Initial load only if layer is visible
    if (window.map.hasLayer(window.placesLayerHG)) {
        fetchPlaces();
    }
    
    console.log("PG spots module initialized");
}

// Listen for map initialization event
document.addEventListener("map_initialized", function() {
    console.log("Map initialized event received in HG spots module");
    setTimeout(initSpotHG, 100);
});

// Alternative initialization approach
setTimeout(() => {
    if (window.mapInitialized) {
        console.log("Backup initialization for HG spots module");
        initSpotHG();
    }
}, 1000);
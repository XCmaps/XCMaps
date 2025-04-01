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
                            return L.marker(latlng, {
                                icon: L.canvasIcon({
                                    iconSize: [50, 50],
                                    iconAnchor: [15, 15],
                                    drawIcon: function (icon, type) {
                                        if (type === 'icon') {
                                            var ctx = icon.getContext('2d');
                                            var size = L.point(this.options.iconSize);
                                            var center = L.point(size.x / 2, size.y / 2);
                                            ctx.clearRect(0, 0, size.x, size.y);

                                            let direction = feature.properties.direction || "";
                                            let angleRanges = getAngleRange(direction);

                                            ctx.beginPath();
                                            angleRanges.forEach(([start, end]) => {
                                                ctx.moveTo(center.x, center.y);
                                                ctx.arc(center.x, center.y, center.x, (start - 90) * Math.PI / 180, (end - 90) * Math.PI / 180, false);
                                                ctx.lineTo(center.x, center.y);
                                            });
                                            ctx.fillStyle = 'orange';
                                            ctx.fill();
                                            ctx.closePath();

                                            ctx.beginPath();
                                            ctx.arc(center.x, center.y, center.x / 4, 0, Math.PI * 2);
                                            ctx.fillStyle = 'green';
                                            ctx.fill();
                                            ctx.closePath();
                                        }
                                    }
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
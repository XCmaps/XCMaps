import { 
    getAngleRange, 
    loadPlaceDetails, 
    showFeebackForm, 
    cancelFeedback 
} from './spotsHelper.js';

// Use a module initialization function that waits for map to be ready
export function initSpotPG() {
    // Check if map and placesLayerPG are available in the window object
    if (!window.map || !window.placesLayerPG) {
        console.error("Map or placesLayerPG is not defined. Retrying in 500ms...");
        setTimeout(initSpotPG, 500);
        return;
    }

    console.log("Initializing PG spots module...");

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
                className: 'pg-cluster-icon',
                iconSize: L.point(30, 30)
            });
        }
    });

    window.placesLayerPG.addLayer(clusterGroup);

    // Fetch places without descriptions
    function fetchPlaces() {
        const bounds = window.map.getBounds();
        const nw_lat = bounds.getNorthWest().lat;
        const nw_lng = bounds.getNorthWest().lng;
        const se_lat = bounds.getSouthEast().lat;
        const se_lng = bounds.getSouthEast().lng;

        fetch(`http://localhost:3000/api/places?nw_lat=${nw_lat}&nw_lng=${nw_lng}&se_lat=${se_lat}&se_lng=${se_lng}&type=TO&type=TOW&type=TH`)
            .then(response => response.json())
            .then(data => {
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
            })
            .catch(error => console.error("Error fetching PG places:", error));
    }

    // Fetch places when the map stops moving
    window.map.on("moveend", fetchPlaces);

    // Initial load
    fetchPlaces();
    console.log("PG spots module initialized");
}

// Listen for map initialization event
document.addEventListener("map_initialized", function() {
    console.log("Map initialized event received in PG spots module");
    setTimeout(initSpotPG, 100);
});

// Alternative initialization approach
setTimeout(() => {
    if (window.mapInitialized) {
        console.log("Backup initialization for PG spots module");
        initSpotPG();
    }
}, 1000);
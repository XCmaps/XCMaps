import { 
    getAngleRange, 
    loadPlaceDetails, 
    showFeebackForm, 
    cancelFeedback 
} from './spotsHelper.js';

// Use a module initialization function that waits for map to be ready
// Replace the existing markerClusterGroup creation with:
export function initSpotLZ() {
    if (!window.map || !window.placesLayerLZ) {
        setTimeout(initSpotLZ, 500);
        return;
    }

    console.log("Initializing LZ spots module...");

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
                className: 'lz-cluster-icon',
                iconSize: L.point(30, 30)
            });
        }
    });

    window.placesLayerLZ.addLayer(clusterGroup); // Add cluster group to the layer group

    // Update fetchPlaces to use clusterGroup
    function fetchPlaces() {
        const bounds = window.map.getBounds();
        const nw_lat = bounds.getNorthWest().lat;
        const nw_lng = bounds.getNorthWest().lng;
        const se_lat = bounds.getSouthEast().lat;
        const se_lng = bounds.getSouthEast().lng;

        fetch(`http://localhost:3000/api/places?nw_lat=${nw_lat}&nw_lng=${nw_lng}&se_lat=${se_lat}&se_lng=${se_lng}&type=LZ`)
            .then(response => response.json())
            .then(data => {
                clusterGroup.clearLayers(); // Clear the cluster group

                L.geoJSON(data, {
                    pointToLayer: function (feature, latlng) {
                        return L.marker(latlng, {
                            icon: L.icon({
                                iconUrl: '../assets/images/windsock.png', // Replace with the actual path to your PNG
                                iconSize: [20, 20], // Adjust size as needed
                                iconAnchor: [20, 20] // Adjust anchor to center the image properly
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

                            // Fetch details when popup is opened
                            layer.on("popupopen", async function () {
                                await loadPlaceDetails(layer, feature.properties.id);
                            });
                           
                        }
                        
                        clusterGroup.addLayer(layer); // Add to clusterGroup
                    }
                });
            })
            .catch(error => console.error("Error:", error));
    }

    window.map.on("moveend", fetchPlaces);
    fetchPlaces();
}

// Listen for map initialization event
document.addEventListener("map_initialized", function() {
    console.log("Map initialized event received in LZ spots module");
    // Give a slight delay to ensure map is fully ready
    setTimeout(initSpotLZ, 100);
});

// Alternative initialization approach - also try to init if we missed the event
setTimeout(() => {
    if (window.mapInitialized) {
        console.log("Backup initialization for LZ spots module");
        initSpotLZ();
    }
}, 1000);


import { 
    getAngleRange, 
    loadPlaceDetails, 
    showFeebackForm, 
    cancelFeedback 
} from './spotsHelper.js';

document.addEventListener("DOMContentLoaded", function () {
    if (typeof placesLayerHG === "undefined") {
        console.error("placesLayerHG is not defined in index.html");
        return;
    }

    // Expose needed functions to global scope for event handlers
    window.showFeebackForm = showFeebackForm;
    window.cancelFeedback = cancelFeedback;

    // Fetch places without descriptions
    function fetchPlaces() {
        const bounds = map.getBounds();
        const nw_lat = bounds.getNorthWest().lat;
        const nw_lng = bounds.getNorthWest().lng;
        const se_lat = bounds.getSouthEast().lat;
        const se_lng = bounds.getSouthEast().lng;

        fetch(`/api/places?nw_lat=${nw_lat}&nw_lng=${nw_lng}&se_lat=${se_lat}&se_lng=${se_lng}&type=TO-HG&type=TOW-HG`)
            .then(response => response.json())
            .then(data => {
                placesLayerHG.clearLayers();

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

                            // Fetch details when popup is opened
                            layer.on("popupopen", async function () {
                                await loadPlaceDetails(layer, feature.properties.id);
                            });

                            placesLayerHG.addLayer(layer);
                        }
                    }
                });
            })
            .catch(error => console.error("Error fetching places:", error));
    }

    // Fetch places when the map stops moving
    map.on("moveend", fetchPlaces);

    // Initial load
    fetchPlaces();
});
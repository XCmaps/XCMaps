document.addEventListener("DOMContentLoaded", function () {
    if (typeof placesLayerLZ === "undefined") {
        console.error("placesLayerLZ is not defined in index.html");
        return;
    }

    // Fetch places without descriptions
    function fetchPlaces() {
        const bounds = map.getBounds();
        const nw_lat = bounds.getNorthWest().lat;
        const nw_lng = bounds.getNorthWest().lng;
        const se_lat = bounds.getSouthEast().lat;
        const se_lng = bounds.getSouthEast().lng;

        fetch(`/api/places?nw_lat=${nw_lat}&nw_lng=${nw_lng}&se_lat=${se_lat}&se_lng=${se_lng}&type=LZ`)
            .then(response => response.json())
            .then(data => {
                placesLayerLZ.clearLayers();

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
                                maxWidth: 800,
                                maxHeight: 780
                            }).setContent(popupContent);

                            layer.bindPopup(responsivePopup);

                            // Fetch details when popup is opened
                            layer.on("popupopen", async function () {
                                await loadPlaceDetails(layer, feature.properties.id);
                            });

                            placesLayerLZ.addLayer(layer);
                        }
                    }
                });
            })
            .catch(error => console.error("Error fetching places:", error));
    }

    // Fetch full place details when a popup is opened
    async function loadPlaceDetails(layer, placeId) {
        try {
            const response = await fetch(`/api/place/${placeId}`);
            const data = await response.json();

            if (data.error) {
                console.error("Error fetching place details:", data.error);
                return;
            }

            let regex1 = /<center><b><a href="http:\/\/www\.paraglidingearth\.com\/index\.php\?site=\d+">More information on ParaglidingEarth<\/a><\/b><\/center>\n?/g;
            let regex2 = /<br>\n<b>Take off : <\/b><br>\n?/g;

            let description = (data.properties.description || "")
                .replace(regex1, "")
                .replace(regex2, "")
                .trim();

            let popupContent = `<b>${data.properties.name}</b><br>
                                Type: ${data.properties.type}<br>
                                Direction: ${data.properties.direction}<br>
                                Description: ${description}`;

            layer.setPopupContent(popupContent);

        } catch (error) {
            console.error("Error fetching place details:", error);
        }
    }

    // Fetch places when the map stops moving
    map.on("moveend", fetchPlaces);

    // Initial load
    fetchPlaces();
});

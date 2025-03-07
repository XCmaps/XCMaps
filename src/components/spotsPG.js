document.addEventListener("DOMContentLoaded", function () {
    if (typeof placesLayerPG === "undefined") {
        console.error("placesLayerPG is not defined in index.html");
        return;
    }

    // Mapping wind directions to angles
    function getAngleRange(direction) {
        const dirToAngle = {
            "N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5,
            "E": 90, "ESE": 112.5, "SE": 135, "SSE": 157.5,
            "S": 180, "SSW": 202.5, "SW": 225, "WSW": 247.5,
            "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5
        };

        let angleRanges = [];
        let parts = direction.split(',').map(part => part.trim());

        parts.forEach(part => {
            let range = part.split('-').map(dir => dir.trim());
            if (range.length === 1) {
                let angle = dirToAngle[range[0]];
                if (angle !== undefined) {
                    angleRanges.push([angle - 22.5, angle + 22.5]);
                }
            } else if (range.length === 2) {
                let start = dirToAngle[range[0]];
                let end = dirToAngle[range[1]];
                if (start !== undefined && end !== undefined) {
                    if (end < start) {
                        [start, end] = [end, start];
                    }
                    if (end - start > 180) {
                        [start, end] = [end, start];
                    }
                    angleRanges.push([start, end]);
                }
            }
        });

        return angleRanges;
    }

    // Fetch places without descriptions
    function fetchPlaces() {
        const bounds = map.getBounds();
        const nw_lat = bounds.getNorthWest().lat;
        const nw_lng = bounds.getNorthWest().lng;
        const se_lat = bounds.getSouthEast().lat;
        const se_lng = bounds.getSouthEast().lng;

        fetch(`/api/places?nw_lat=${nw_lat}&nw_lng=${nw_lng}&se_lat=${se_lat}&se_lng=${se_lng}&type=TO&type=TOW&type=TH`)
            .then(response => response.json())
            .then(data => {
                placesLayerPG.clearLayers();

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
                                maxWidth: 800,
                                maxHeight: 780
                            }).setContent(popupContent);

                            layer.bindPopup(responsivePopup);

                            // Fetch details when popup is opened
                            layer.on("popupopen", async function () {
                                await loadPlaceDetails(layer, feature.properties.id);
                            });

                            placesLayerPG.addLayer(layer);
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

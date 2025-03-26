// obstacles.js
let obstacleClickHandler = null;
let obstacleDebounceTimer;

// Initialize the obstacle layer
let obstacleLayer = L.layerGroup({
    attribution: 'XContest&copy; <a href="https://xcontest.org">XContest</a>'
});
window.obstacleLayer = obstacleLayer;

function fetchObstacles() {
  if (!window.map) {
    console.error("Map not initialized yet");
    return;
  }

  // Get current map bounds
  const bounds = window.map.getBounds();
  const nw = bounds.getNorthWest();
  const se = bounds.getSouthEast();

  const apiUrl = `${process.env.APP_DOMAIN}/api/obstacles?nw_lat=${nw.lat}&nw_lng=${nw.lng}&se_lat=${se.lat}&se_lng=${se.lng}`;

  // Clear previous layers
  obstacleLayer.clearLayers();

  fetch(apiUrl)
    .then(response => response.json())
    .then(geoJson => {
      const obstacles = [];

      geoJson.features.forEach(feature => {
        if (feature.geometry.type === "LineString") {
          // Convert coordinates to LatLng format [lat, lng]
          const coords = feature.geometry.coordinates.map(coord => [
            coord[1],
            coord[0]
          ]);

          // Create polyline with styling from properties
          const polyline = L.polyline(coords, {
            color: feature.properties.strokeColor || "#ff0000",
            weight: feature.properties.strokeWeight || 2
          });

          // Store obstacle data with its polyline
          obstacles.push({ polyline, data: feature.properties });

          // Add to layer group
          polyline.addTo(obstacleLayer);

          // Add popup content (using standard popup)
          polyline.bindPopup(() => {
            const content = [];
            if (feature.properties.name) content.push(`<b>${feature.properties.name}</b>`);
            if (feature.properties.type) content.push(`Type: ${feature.properties.type}`);
            if (feature.properties.description) content.push(`Description: ${feature.properties.description}`);
            if (feature.properties.maxAgl) content.push(`Max AG: ${feature.properties.maxAgl}m`);
            
            return content.join("<br>");
          }, { className: 'obstacle-popup' }); // Add custom class to identify obstacle popups
        }
      });

      console.log(`Added ${obstacles.length} obstacles to the map`);

      // Remove existing click handler if any
      if (obstacleClickHandler) {
        window.map.off("click", obstacleClickHandler);
      }

      // Add new click handler for obstacles
      obstacleClickHandler = function(e) {
        if (!window.map.hasLayer(obstacleLayer)) return;

        const clickedPoint = e.latlng;
        const clickedObstacles = [];

        obstacles.forEach(({ polyline, data }) => {
          if (polyline.getBounds().contains(clickedPoint)) {
            clickedObstacles.push(data);
          }
        });

        if (clickedObstacles.length > 0) {
          const popupContent = clickedObstacles.map(obs => `
            ${obs.name ? `<b>${obs.name}</b><br>` : ''}
            ${obs.type ? `Type: ${obs.type}<br>` : ''}
            ${obs.description ? `Description: ${obs.description}<br>` : ''}
            ${obs.maxAgl ? `Max AG: ${obs.maxAgl}m<br>` : ''}
          `).join("<hr>");

          L.popup({ className: 'obstacle-popup' }) // Add custom class to identify obstacle popups
            .setLatLng(clickedPoint)
            .setContent(popupContent)
            .openOn(window.map);
        }
      };

      window.map.on("click", obstacleClickHandler);
    })
    .catch(error => console.error("Error fetching obstacles:", error));
}

// Export the fetch function
window.fetchObstacles = fetchObstacles;



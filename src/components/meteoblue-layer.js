// Ensure L (Leaflet) is available before defining the layer
if (typeof L !== 'undefined') {
    L.MeteoblueWeatherLayer = L.Layer.extend({
        options: {
            // Default options for the layer (e.g., zIndex if needed)
        },

        onAdd: function (map) {
            console.log('[MeteoblueWeatherLayer] onAdd called', { map });
            this._map = map;

            // Create a container div that will hold the iframe and attribution
            this._container = L.DomUtil.create('div', 'mb-weather-container'); // Simplified class name
            this._container.style.position = 'absolute';
            this._container.style.top = '0px';
            this._container.style.left = '0px';
            // Initial size will be set by _updateSize
            // this._container.style.border = '5px solid red'; // DIAGNOSTIC REMOVED
            this._container.style.zIndex = '1000'; // Ensure it's above other base layers if necessary, but below controls
            this._container.style.pointerEvents = 'auto';
            console.log('[MeteoblueWeatherLayer] Container created:', this._container);

            this._updateSize(); // Set initial size

            // Create the iframe
            this._iframe = L.DomUtil.create('iframe', '', this._container);
            this._iframe.src = "https://www.meteoblue.com/en/weather/maps/widget?windAnimation=1&gust=1&satellite=1&cloudsAndPrecipitation=1&temperature=1&sunshine=1&extremeForecastIndex=1&geoloc=detect&tempunit=C&windunit=km%252Fh&lengthunit=metric&zoom=5&autowidth=auto";
            this._iframe.frameBorder = "0";
            this._iframe.scrolling = "NO";
            // this._iframe.allowTransparency = "true"; // Keep commented for now
            this._iframe.sandbox = "allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox";
            this._iframe.style.position = 'absolute'; // Position within container
            this._iframe.style.top = '0px';
            this._iframe.style.left = '0px';
            this._iframe.style.width = '100%';
            this._iframe.style.height = '100%';
            // this._iframe.style.border = '5px solid lime'; // DIAGNOSTIC REMOVED
            this._iframe.style.zIndex = '1'; // Relative to container
            this._iframe.style.pointerEvents = 'auto';
            // No explicit background on iframe; let its content or default show
            console.log('[MeteoblueWeatherLayer] Iframe created:', this._iframe);

            // Create the attribution div
            this._attributionDiv = L.DomUtil.create('div', 'meteoblue-attribution', this._container);
            this._attributionDiv.innerHTML = '<!-- DO NOT REMOVE THIS LINK --><a href="https://www.meteoblue.com/en/weather/maps/index" target="_blank" rel="noopener">meteoblue</a>';
            this._attributionDiv.style.position = 'absolute';
            this._attributionDiv.style.bottom = '3px'; // Position it at the bottom
            this._attributionDiv.style.right = '10px';
            this._attributionDiv.style.zIndex = '2'; // Ensure it's above iframe content
            this._attributionDiv.style.backgroundColor = 'rgba(255,255,255,0.7)';
            this._attributionDiv.style.padding = '1px 4px';
            this._attributionDiv.style.fontSize = '10px';
            this._attributionDiv.style.borderRadius = '3px';
            this._attributionDiv.style.pointerEvents = 'auto'; // Link must be clickable
            console.log('[MeteoblueWeatherLayer] Attribution div created:', this._attributionDiv);

            // Add the main container to the map's mapPane for base layer behavior
            const pane = map.getPane('mapPane');
            console.log('[MeteoblueWeatherLayer] Attempting to append container to mapPane:', pane);
            if (pane) {
                pane.appendChild(this._container);
                console.log('[MeteoblueWeatherLayer] Container appended to mapPane.');
            } else {
                console.error('[MeteoblueWeatherLayer] mapPane not found!');
            }
            
            this.fire('load'); // Fire a load event (optional, but good practice)
            console.log('[MeteoblueWeatherLayer] onAdd finished.');

            map.on('resize', this._updateSize, this); // Update container size on map resize

            return this;
        },

        onRemove: function (map) {
            console.log('[MeteoblueWeatherLayer] onRemove called', { map });
            map.off('resize', this._updateSize, this); // Remove resize listener

            if (this._container) {
                console.log('[MeteoblueWeatherLayer] Removing container:', this._container);
                L.DomUtil.remove(this._container);
                console.log('[MeteoblueWeatherLayer] Container removed.');
            }
            this._container = null;
            this._iframe = null;
            this._attributionDiv = null;
            this._map = null;
            console.log('[MeteoblueWeatherLayer] onRemove finished.');
            return this;
        },

        _updateSize: function () {
            if (!this._map || !this._container) {
                return;
            }
            const mapSize = this._map.getSize();
            console.log('[MeteoblueWeatherLayer] _updateSize called. Map size:', mapSize);
            this._container.style.width = mapSize.x + 'px';
            this._container.style.height = mapSize.y + 'px';
            console.log('[MeteoblueWeatherLayer] Container size set to:', this._container.style.width, this._container.style.height);
        }
    });

    // Factory function for creating the layer (L.meteoblueWeatherLayer())
    L.meteoblueWeatherLayer = function (options) {
        console.log('[MeteoblueWeatherLayer] Factory function called with options:', options);
        return new L.MeteoblueWeatherLayer(options);
    };
} else {
    console.error("Leaflet (L) is not defined. MeteoblueWeatherLayer cannot be initialized.");
}
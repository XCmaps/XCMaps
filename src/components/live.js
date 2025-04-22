/**
 * Live Control Component
 * Toggles the live layer for displaying paragliding and hang gliding pilots from OGN
 */

// Create a LiveControl class that extends L.Control
const LiveControl = L.Control.extend({
    options: {
        position: 'bottomright',
        activeIcon: 'assets/images/live-active.svg',
        inactiveIcon: 'assets/images/live-inactive.svg',
        title: 'Toggle live pilots',
        refreshInterval: 30000, // 30 seconds
        trackColor: '#FF5500',
        trackWeight: 3,
        trackOpacity: 0.8,
        canopySvgUrl: '/assets/images/canopy.svg',
        hangGliderSvgUrl: '/assets/images/hang-glider.svg',
        canopyPlaceholderFill: 'fill:#0000ff;',
        hangGliderPlaceholderFill: 'fill:#ff0000;'
    },

    initialize: function(options) {
        L.Util.setOptions(this, options);
        this.active = false;
        this.markers = {};
        this.tracks = {};
        this.aircraftLayer = L.layerGroup();
        this.trackLayer = L.layerGroup();
        this.refreshTimer = null;
        this.selectedAircraft = null;
        this.canopySvgContent = null; // To store fetched SVG
        this.hangGliderSvgContent = null; // To store fetched SVG
        this._svgsLoading = false; // Flag to prevent multiple fetches
    },

    onAdd: function(map) {
        // ... (container, link, img creation as before lines 31-53) ...
        const container = L.DomUtil.create('div', 'leaflet-control-live leaflet-bar leaflet-control');
        const link = L.DomUtil.create('a', 'leaflet-control-button', container);
        link.href = '#';
        link.title = this.options.title;

        const img = L.DomUtil.create('img', 'live-control-icon', link);
        img.src = this.options.inactiveIcon;
        img.alt = 'Live';
        img.style.width = '24px';
        img.style.height = '24px';

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(link, 'click', this._toggleLive, this);

        this._map = map;
        this._container = container;
        this._link = link;
        this._icon = img;

        // Fetch SVGs when control is added
        this._fetchSvgs();

        return container;
    },

    // --- NEW: Function to fetch SVG content ---
    _fetchSvgs: function() {
        if (this._svgsLoading || (this.canopySvgContent && this.hangGliderSvgContent)) {
            return; // Already loaded or loading
        }
        this._svgsLoading = true;
        const fetchCanopy = fetch(this.options.canopySvgUrl)
            .then(response => response.ok ? response.text() : Promise.reject('Failed to load canopy SVG'))
            .then(text => { this.canopySvgContent = text; })
            .catch(error => console.error('Error fetching canopy SVG:', error));

        const fetchHangGlider = fetch(this.options.hangGliderSvgUrl)
            .then(response => response.ok ? response.text() : Promise.reject('Failed to load hang-glider SVG'))
            .then(text => { this.hangGliderSvgContent = text; })
            .catch(error => console.error('Error fetching hang-glider SVG:', error));

        Promise.all([fetchCanopy, fetchHangGlider]).finally(() => {
            this._svgsLoading = false;
            // Optionally trigger a redraw if needed, though updates happen on data fetch
        });
    },
    // --- END NEW ---

    onRemove: function(map) {
        // Clean up when control is removed
        this._deactivateLive();
        L.DomEvent.off(this._link, 'click', this._toggleLive, this);
    },

    _toggleLive: function(e) {
        L.DomEvent.stop(e);
        
        if (this.active) {
            this._deactivateLive();
        } else {
            this._activateLive();
        }
    },

    _activateLive: function() {
        // Update UI to active state
        this.active = true;
        // Update UI to active state
        this._icon.src = this.options.activeIcon;

        // Add layers to map
        this.aircraftLayer.addTo(this._map);
        this.trackLayer.addTo(this._map);

        // Fetch aircraft data immediately
        this._fetchAircraftData();

        // Set up refresh timer
        this.refreshTimer = setInterval(() => {
            this._fetchAircraftData();
        }, this.options.refreshInterval);

        // Add map move end listener to update aircraft when map is moved
        this._map.on('moveend', this._fetchAircraftData, this);
    },

    _deactivateLive: function() {
        // Update UI to inactive state
        this.active = false;
        // Update UI to inactive state
        this._icon.src = this.options.inactiveIcon;

        // Clear refresh timer
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }

        // Remove map move end listener
        this._map.off('moveend', this._fetchAircraftData, this);

        // Remove layers from map
        this._map.removeLayer(this.aircraftLayer);
        this._map.removeLayer(this.trackLayer);

        // Clear markers and tracks
        this.aircraftLayer.clearLayers();
        this.trackLayer.clearLayers();
        this.markers = {};
        this.tracks = {};
        this.selectedAircraft = null;
    },

    _fetchAircraftData: function() {
        if (!this.active) return;

        // Get map bounds
        const bounds = this._map.getBounds();
        const nwLat = bounds.getNorthWest().lat;
        const nwLng = bounds.getNorthWest().lng;
        const seLat = bounds.getSouthEast().lat;
        const seLng = bounds.getSouthEast().lng;

        // Fetch aircraft data from API
        fetch(`/api/ogn/aircraft?nwLat=${nwLat}&nwLng=${nwLng}&seLat=${seLat}&seLng=${seLng}`)
            .then(response => response.json())
            .then(data => {
                this._updateAircraft(data);
            })
            .catch(error => {
                console.error('Error fetching aircraft data:', error);
            });
    },

    _updateAircraft: function(aircraftData) {
        if (!this.active) return;

        // Track which aircraft are still active
        const activeAircraftIds = new Set();

        // Update or add markers for each aircraft
        aircraftData.forEach(aircraft => {
            activeAircraftIds.add(aircraft.id);

            if (this.markers[aircraft.id]) {
                // Update existing marker
                this.markers[aircraft.id].setLatLng([aircraft.last_lat, aircraft.last_lon]);
                this._updateMarkerIcon(this.markers[aircraft.id], aircraft);
                this._updatePopupContent(this.markers[aircraft.id], aircraft);
            } else {
                // Create new marker
                this._createAircraftMarker(aircraft);
            }
        });

        // Remove markers for aircraft that are no longer active
        Object.keys(this.markers).forEach(id => {
            if (!activeAircraftIds.has(id)) {
                this.aircraftLayer.removeLayer(this.markers[id]);
                delete this.markers[id];

                // Remove track if exists
                if (this.tracks[id]) {
                    this.trackLayer.removeLayer(this.tracks[id]);
                    delete this.tracks[id];
                }
            }
        });

        // Update track for selected aircraft if needed
        if (this.selectedAircraft && activeAircraftIds.has(this.selectedAircraft)) {
            this._fetchAircraftTrack(this.selectedAircraft);
        }
    },

    _createAircraftMarker: function(aircraft) {
        // Create marker
        const marker = L.marker([aircraft.last_lat, aircraft.last_lon], {
            icon: this._createAircraftIcon(aircraft),
            title: aircraft.name,
            alt: aircraft.name,
            aircraftId: aircraft.id
        });

        // Create popup content
        const popupContent = this._createPopupContent(aircraft);
        
        // Bind popup
        marker.bindPopup(popupContent);

        // Add click handler to show track
        marker.on('click', (e) => {
            this.selectedAircraft = aircraft.id;
            this._fetchAircraftTrack(aircraft.id);
        });

        // Add marker to layer and store reference
        this.aircraftLayer.addLayer(marker);
        this.markers[aircraft.id] = marker;

        return marker;
    },

    // --- MODIFIED: _createAircraftIcon ---
    _createAircraftIcon: function(aircraft) {
        const agl = aircraft.last_alt_agl;
        const speed = aircraft.last_speed_kmh;
        const iconSize = [40, 40]; // Requested size for ground states
        const iconAnchor = [20, 20]; // Center anchor for 40x40

        // Ground States (Resting, Hiking, Driving)
        if (agl < 5) {
            let iconUrl;
            if (speed === 0) {
                iconUrl = '/assets/images/resting.svg';
            } else if (speed > 0 && speed <= 16) {
                iconUrl = '/assets/images/hiking.svg';
            } else { // speed > 16
                iconUrl = '/assets/images/driving.svg';
            }
            return L.icon({
                iconUrl: iconUrl,
                iconSize: iconSize,
                iconAnchor: iconAnchor,
                className: 'ground-aircraft-icon' // Add a class for potential styling
            });
        }

        // Flying State (Existing logic)
        else {
            // Ensure SVGs for flying state are fetched if needed
            if (!this.canopySvgContent || !this.hangGliderSvgContent) {
                this._fetchSvgs();
                if (!this.canopySvgContent || !this.hangGliderSvgContent) {
                    console.warn("Flying SVGs not loaded yet for icon creation.");
                    // Return a simple default icon or null for flying state while loading
                    return L.divIcon({ className: 'aircraft-icon-loading', iconSize: [60, 60], iconAnchor: [30, 30] }); // Adjusted anchor
                }
            }

            const isHangGlider = aircraft.type === 6;
            const heading = aircraft.last_course || 0;
            const vs = aircraft.last_vs;
            const flyingIconSize = [60, 60]; // Keep original flying size
            const flyingIconAnchor = [30, 30]; // Center anchor for 60x60

            const baseSvg = isHangGlider ? this.hangGliderSvgContent : this.canopySvgContent;
            const placeholderFill = isHangGlider ? this.options.hangGliderPlaceholderFill : this.options.canopyPlaceholderFill;
            const newColor = this._getVSColor(vs); // Get color based on vertical speed

            // Replace placeholder fill with the dynamic color
            const colorFill = `fill:${newColor};`;
            const regex = new RegExp(placeholderFill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            let modifiedSvg = baseSvg.replace(regex, colorFill);

            // Ensure SVG has width/height attributes
            modifiedSvg = modifiedSvg.replace(/<svg/i, `<svg width="${flyingIconSize[0]}px" height="${flyingIconSize[1]}px"`);

            // Apply rotation to the wrapper div
            const iconHtml = `
                <div style="width: ${flyingIconSize[0]}px; height: ${flyingIconSize[1]}px; transform: rotate(${heading}deg); transform-origin: center center; display: block;">
                    ${modifiedSvg}
                </div>
            `;

            return L.divIcon({
                html: iconHtml,
                className: 'flying-aircraft-icon', // Specific class for flying
                iconSize: flyingIconSize,
                iconAnchor: flyingIconAnchor
            });
        }
    },
    // --- END MODIFIED ---

    // --- NEW: Helper function for VS color ---
    _getVSColor: function(vs) {
        if (vs <= -5.0) return '#8B0000'; // DarkRed
        if (vs <= -3.5) return '#FF0000'; // Red
        if (vs <= -2.5) return '#FF4500'; // OrangeRed
        if (vs <= -1.5) return '#FFA500'; // Orange
        if (vs <= -0.5) return '#FFD700'; // Gold
        if (vs === 0)   return '#FFFFFF'; // White
        if (vs >= 5.0) return '#0D400D'; // Dark Green (adjusting from table for consistency)
        if (vs >= 3.5) return '#289628'; // ForestGreen (adjusting)
        if (vs >= 2.5) return '#5CCD5C'; // MediumSeaGreen (adjusting)
        if (vs >= 1.5) return '#99E699'; // LightGreen (adjusting)
        if (vs >= 0.5) return '#CFF2CF'; // Honeydew (adjusting)
        return '#FFFFFF'; // Default to White for vs between -0.5 and 0.5 but not 0
    },
    // --- END NEW ---

    // ... (rest of the functions: _updateMarkerIcon, _createPopupContent, _updatePopupContent, _fetchAircraftTrack, _displayAircraftTrack) ...
    // Note: _updateMarkerIcon now correctly calls the modified _createAircraftIcon

     _updateMarkerIcon: function(marker, aircraft) {
         marker.setIcon(this._createAircraftIcon(aircraft));
     },

     _createPopupContent: function(aircraft) {
        // Calculate time ago
        const lastSeen = new Date(aircraft.last_seen);
        const now = new Date();
        const diffSeconds = Math.round((now - lastSeen) / 1000);
        let formattedTimeAgo;

        if (diffSeconds < 60) {
            // Less than a minute ago: (-SS sec)
            const seconds = String(diffSeconds).padStart(2, '0');
            formattedTimeAgo = `(-${seconds} sec)`;
        } else if (diffSeconds < 3600) {
            // Less than an hour ago: (-MM:SS min)
            const minutes = String(Math.floor(diffSeconds / 60)).padStart(2, '0');
            const seconds = String(diffSeconds % 60).padStart(2, '0');
            formattedTimeAgo = `(-${minutes}:${seconds} min)`;
        } else {
            // More than an hour ago: (-HH:MM h)
            const hours = String(Math.floor(diffSeconds / 3600)).padStart(2, '0');
            const minutes = String(Math.floor((diffSeconds % 3600) / 60)).padStart(2, '0');
            formattedTimeAgo = `(-${hours}:${minutes} h)`;
        }
        
        // Determine aircraft type (though not used in the popup string anymore)
        const aircraftType = aircraft.type === 6 ? 'Hang Glider' : 'Paraglider';
        
        // Create popup content
        return `
   <div class="aircraft-popup">
                <p><strong style="color:#007bff;">${aircraft.pilot_name}</strong> ${formattedTimeAgo}</p>
                <p><strong>${aircraft.last_alt_msl}m </strong>(${aircraft.last_alt_agl} AGL) <strong>${aircraft.last_vs}m/s</strong></p>
            </div>
        `;
    },

    _updatePopupContent: function(marker, aircraft) {
        if (marker.getPopup()) {
            marker.getPopup().setContent(this._createPopupContent(aircraft));
        }
    },

    _fetchAircraftTrack: function(aircraftId) {
        // Fetch track data from API
        fetch(`/api/ogn/track/${aircraftId}?minutes=60`)
            .then(response => response.json())
            .then(trackData => {
                this._displayAircraftTrack(aircraftId, trackData);
            })
            .catch(error => {
                console.error('Error fetching aircraft track:', error);
            });
    },

    _displayAircraftTrack: function(aircraftId, trackData) {
        // Remove existing track if any
        if (this.tracks[aircraftId]) {
            this.trackLayer.removeLayer(this.tracks[aircraftId]);
        }

        // Create track line
        if (trackData.length > 0) {
            const trackPoints = trackData.map(point => [point.lat, point.lon]);
            
            // Create polyline with gradient color based on altitude
            const track = L.polyline(trackPoints, {
                color: this.options.trackColor,
                weight: this.options.trackWeight,
                opacity: this.options.trackOpacity,
                lineJoin: 'round'
            });

            // Add to layer and store reference
            this.trackLayer.addLayer(track);
            this.tracks[aircraftId] = track;
 
            // Altitude markers removed as requested
            // this._addAltitudeMarkers(aircraftId, trackData);
        }
    }
 
    // _addAltitudeMarkers function removed as it's no longer called
});

// Factory function to create the control
L.control.live = function(options) {
    return new LiveControl(options);
};

// Add event listener for track button clicks
document.addEventListener('show-aircraft-track', function(e) {
    const aircraftId = e.detail;
    if (window.map) {
        window.map.eachLayer(function(layer) {
            // Assuming the control instance might be stored differently,
            // or accessed via a known property if added directly to map
            // This part might need adjustment based on how LiveControl is instantiated and added
            // A more robust way would be to keep a reference to the control instance.
            // For now, let's assume a property _liveControl exists if added directly.
            if (layer instanceof LiveControl) { // Check if the layer itself is the control
                 layer._fetchAircraftTrack(aircraftId);
            } else if (layer instanceof L.LayerGroup && layer._live) { // Original check
                 layer._live._fetchAircraftTrack(aircraftId);
            } else if (window.map._liveControl) { // Check for a direct property on map
                 window.map._liveControl._fetchAircraftTrack(aircraftId);
            }
        });
    }
});

export default LiveControl;
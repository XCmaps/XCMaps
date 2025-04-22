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
        trackOpacity: 0.8
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
    },

    onAdd: function(map) {
        // Create control container
        const container = L.DomUtil.create('div', 'leaflet-control-live leaflet-bar leaflet-control');
        const link = L.DomUtil.create('a', 'leaflet-control-button', container);
        link.href = '#';
        link.title = this.options.title;
        
        // Create icon
        const img = L.DomUtil.create('img', 'live-control-icon', link);
        img.src = this.options.inactiveIcon;
        img.alt = 'Live';
        img.style.width = '24px';
        img.style.height = '24px';

        // Prevent click propagation
        L.DomEvent.disableClickPropagation(container);
        
        // Add click handler
        L.DomEvent.on(link, 'click', this._toggleLive, this);
        
        this._map = map;
        this._container = container;
        this._link = link;
        this._icon = img;
        
        return container;
    },

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

    _createAircraftIcon: function(aircraft) {
        // Determine icon based on aircraft type
        const isHangGlider = aircraft.type === 6;
        const isParaglider = aircraft.type === 7;
        
        // Get aircraft heading
        const heading = aircraft.last_course || 0;
        
        // Determine icon URL based on aircraft type
        const iconUrl = isHangGlider ? '/assets/images/hang-glider.svg' : '/assets/images/canopy.svg';

        // Create HTML for the icon using an img tag with rotation
        const iconHtml = `
            <img src="${iconUrl}"
                 style="width: 40px; height: 40px; transform: rotate(${heading}deg); transform-origin: center center; display: block;"
                 alt="${isHangGlider ? 'Hang Glider' : 'Paraglider'}"/>
        `;
        
        // Create div icon with the img tag
        return L.divIcon({
            html: iconHtml,
            className: 'aircraft-icon',
            iconSize: [40, 40],
            iconAnchor: [15, 15]
        });
    },

    _updateMarkerIcon: function(marker, aircraft) {
        marker.setIcon(this._createAircraftIcon(aircraft));
    },

    _createPopupContent: function(aircraft) {
        // Format last seen time
        const lastSeen = new Date(aircraft.last_seen);
        const formattedTime = lastSeen.toLocaleTimeString();
        
        // Determine aircraft type
        const aircraftType = aircraft.type === 6 ? 'Hang Glider' : 'Paraglider';
        
        // Create popup content
        return `
            <div class="aircraft-popup">
                <h3>${aircraft.pilot_name}</h3>
                <p><strong>Type:</strong> ${aircraftType}</p>
                <p><strong>Altitude:</strong> ${aircraft.last_alt_msl}m MSL (${aircraft.last_alt_agl}m AGL)</p>
                <p><strong>Speed:</strong> ${aircraft.last_speed_kmh} km/h</p>
                <p><strong>Heading:</strong> ${aircraft.last_course}°</p>
                <p><strong>Vertical Speed:</strong> ${aircraft.last_vs} m/s</p>
                <p><strong>Last Seen:</strong> ${formattedTime}</p>
                <button class="track-button" onclick="document.dispatchEvent(new CustomEvent('show-aircraft-track', {detail: '${aircraft.id}'}))">Show Track</button>
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
    // Find the LiveControl instance and call _fetchAircraftTrack
    // This is a bit of a hack, but it works for simple cases
    if (window.map) {
        window.map.eachLayer(function(layer) {
            if (layer instanceof L.LayerGroup && layer._live) {
                layer._live._fetchAircraftTrack(aircraftId);
            }
        });
    }
});

export default LiveControl;
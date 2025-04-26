/**
 * Live Control Component
 * Toggles the live layer for displaying paragliding and hang gliding pilots from OGN
 * Now using WebSockets for real-time updates
 */

import { io } from "socket.io-client";

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
        drivingSvgUrl: '/assets/images/driving.svg', // Added driving SVG URL
        canopyPlaceholderFill: 'fill:#0000ff;',
        hangGliderPlaceholderFill: 'fill:#ff0000;',
        // No placeholder needed for driving SVG unless color change is required later
        trackHighlightColors: [ // Added color list for tracks/popups
            '#4169E1', '#DC143C', '#3CB371', '#DAA520', '#00BFFF',
            '#FF4500', '#9400D3', '#00CED1', '#6A5ACD', '#FF6347',
            '#B22222', '#FF69B4', '#D2691E', '#BA55D3', '#008080'
        ]
    },

    initialize: function(options) {
        L.Util.setOptions(this, options);
        this.active = false;
        this.markers = {};
        this.tracks = {};
        this.activePopupOrder = []; // Track order of opened popups
        this.activePopupColors = {}; // Store assigned color per aircraft
        this.aircraftLayer = L.layerGroup();
        this.trackLayer = L.layerGroup();
        this.refreshTimer = null;
        this.socket = null; // WebSocket connection
        this.lastUpdateTimestamps = {}; // Track last update timestamp for each aircraft
        this.canopySvgContent = null;
        this.hangGliderSvgContent = null;
        this.drivingSvgContent = null;
        this._svgsLoading = false;
        this._configBadgeOpen = false; // Track if config badge is open

        // --- NEW: Live Settings State ---
        this._liveSettings = {
            isActive: true, // Default to active
            showResting: true,
            showHiking: true,
            showDriving: true
        };
        // --- END NEW ---
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
        // --- MODIFIED: Attach click to container ---
        L.DomEvent.on(container, 'click', this._handleControlClick, this);

        this._map = map;
        this._container = container; // Keep reference to the main control container
        this._link = link;
        this._icon = img;

        // Fetch SVGs when control is added
        this._fetchSvgs();

        return container;
    },

    // --- MODIFIED: Function to fetch SVG content ---
    _fetchSvgs: function() {
        // Check if already loading or if all SVGs are loaded
        if (this._svgsLoading || (this.canopySvgContent && this.hangGliderSvgContent && this.drivingSvgContent)) {
            return;
        }
        this._svgsLoading = true;

        const fetches = [];

        // Fetch Canopy SVG if not already loaded
        if (!this.canopySvgContent) {
            fetches.push(
                fetch(this.options.canopySvgUrl)
                    .then(response => response.ok ? response.text() : Promise.reject('Failed to load canopy SVG'))
                    .then(text => { this.canopySvgContent = text; })
                    .catch(error => console.error('Error fetching canopy SVG:', error))
            );
        }

        // Fetch Hang Glider SVG if not already loaded
        if (!this.hangGliderSvgContent) {
            fetches.push(
                fetch(this.options.hangGliderSvgUrl)
                    .then(response => response.ok ? response.text() : Promise.reject('Failed to load hang-glider SVG'))
                    .then(text => { this.hangGliderSvgContent = text; })
                    .catch(error => console.error('Error fetching hang-glider SVG:', error))
            );
        }

        // Fetch Driving SVG if not already loaded
        if (!this.drivingSvgContent) {
            fetches.push(
                fetch(this.options.drivingSvgUrl)
                    .then(response => response.ok ? response.text() : Promise.reject('Failed to load driving SVG'))
                    .then(text => { this.drivingSvgContent = text; })
                    .catch(error => console.error('Error fetching driving SVG:', error))
            );
        }


        Promise.all(fetches).finally(() => {
            this._svgsLoading = false;
            // Optionally trigger a redraw if needed, though updates happen on data fetch
            // If live is active, maybe trigger a data fetch to update icons that might have been placeholders
             if (this.active) {
                 // Find markers that might need updating (e.g., those using loading icons)
                 // This might require iterating markers or triggering a full _fetchAircraftData
                 // For simplicity, let's rely on the next scheduled update or map move.
             }
        });
    },
    // --- END MODIFIED ---

    onRemove: function(map) {
        // Clean up when control is removed
        this._deactivateLive();
        // Ensure the original click listener on the link (if it existed) is removed
        // L.DomEvent.off(this._link, 'click', this._toggleLive, this); // Original listener was on link
        // Remove the new listener on the container
        L.DomEvent.off(this._container, 'click', this._handleControlClick, this);
    },

    // --- MODIFIED: Handle clicks on the control ---
    _handleControlClick: function(e) {
        L.DomEvent.stop(e);

        if (this.active) {
            // If active, show/hide the config badge
            if (this._configBadgeOpen) {
                this._closeConfigBadge();
            } else {
                this._showConfigBadge();
            }
        } else {
            // If inactive, activate live mode
            this._activateLive();
        }
    },
    // --- END MODIFIED ---

    // --- REMOVED: _toggleLive (replaced by _handleControlClick) ---

    _activateLive: function() {
        if (this.active) return; // Already active
        console.log("Activating Live Mode");
        this.active = true;
        this._liveSettings.isActive = true; // Update internal state
        this._icon.src = this.options.activeIcon;
        this._container.classList.add('live-active'); // Add class to main container if needed

        // Add layers to map
        this.aircraftLayer.addTo(this._map);
        this.trackLayer.addTo(this._map);

        // Clear any existing markers and state
        this.aircraftLayer.clearLayers();
        this.markers = {};
        this.tracks = {};
        this.lastUpdateTimestamps = {};

        // Connect to WebSocket server
        this._connectWebSocket();

        // Add map move end listener to update bounds when map is moved
        this._map.on('moveend', this._updateBounds, this);

        // Ensure main toggle reflects state if badge is open
        if (this._configBadgeOpen && this._configContainer) {
            const mainToggle = this._configContainer.querySelector('#live-toggle-main');
            if (mainToggle && !mainToggle.checked) mainToggle.checked = true;
        }
         // Trigger preference save check
         document.dispatchEvent(new CustomEvent('xcmaps-preferences-changed'));
    },

    _deactivateLive: function() {
        if (!this.active) return; // Already inactive
        console.log("Deactivating Live Mode");
        this.active = false;
        this._liveSettings.isActive = false; // Update internal state
        this._icon.src = this.options.inactiveIcon;
        this._container.classList.remove('live-active'); // Remove class from main container if needed

        // Close config badge if open
        if (this._configBadgeOpen) {
            this._closeConfigBadge();
        }

        // Disconnect WebSocket
        this._disconnectWebSocket();

        // Remove map move end listener
        this._map.off('moveend', this._updateBounds, this);
        
        // Clear state
        this.lastUpdateTimestamps = {};

        // Remove layers from map
        this._map.removeLayer(this.aircraftLayer);
        this._map.removeLayer(this.trackLayer);

        // Clear markers and tracks
        this.aircraftLayer.clearLayers();
        this.trackLayer.clearLayers();
        this.markers = {};
        this.tracks = {};
        this.selectedAircraft = null;

        // Ensure main toggle reflects state if badge is open
        if (this._configBadgeOpen && this._configContainer) {
            const mainToggle = this._configContainer.querySelector('#live-toggle-main');
            if (mainToggle && mainToggle.checked) mainToggle.checked = false;
        }
         // Trigger preference save check
         document.dispatchEvent(new CustomEvent('xcmaps-preferences-changed'));
    },

    /**
     * Connect to WebSocket server and set up event handlers
     */
    _connectWebSocket: function() {
        if (this.socket) {
            console.log("WebSocket already connected");
            return;
        }

        console.log("Connecting to WebSocket server...");
        
        // Flag to track data source
        this.usingWebSocket = false;
        this.usingRESTFallback = false;
        
        // Connect to the OGN namespace
        this.socket = io('/ogn');

        // Set up event handlers
        this.socket.on('connect', () => {
            console.log("Connected to WebSocket server");
            
            // Clear any existing refresh timer (in case we reconnected after fallback)
            if (this.refreshTimer) {
                clearInterval(this.refreshTimer);
                this.refreshTimer = null;
            }
            
            // Set data source flag
            this.usingWebSocket = true;
            this.usingRESTFallback = false;
            
            // Subscribe to aircraft updates with current map bounds
            this._updateBounds();
        });

        this.socket.on('disconnect', () => {
            console.log("Disconnected from WebSocket server");
            this.usingWebSocket = false;
            
            // If we're still active but not using REST fallback, switch to it
            if (this.active && !this.usingRESTFallback) {
                console.log("Switching to REST API fallback after WebSocket disconnect");
                this._startRESTFallback();
            }
        });

        this.socket.on('connect_error', (error) => {
            console.error("WebSocket connection error:", error);
            this.usingWebSocket = false;
            
            // Fallback to REST API if WebSocket connection fails
            if (this.active && !this.usingRESTFallback) {
                console.log("Falling back to REST API due to connection error");
                this._startRESTFallback();
            }
        });

        // Handle initial aircraft data
        this.socket.on('aircraft-init', (data) => {
            if (!this.usingWebSocket) return; // Ignore if not using WebSocket
            
            console.log("Received initial aircraft data:", data.length);
            
            // Clear existing markers before updating with initial data
            this.aircraftLayer.clearLayers();
            this.markers = {};
            
            this._updateAircraft(data);
        });

        // Handle aircraft updates
        this.socket.on('aircraft-update', (data) => {
            if (!this.usingWebSocket) return; // Ignore if not using WebSocket
            
            // Update a single aircraft
            this._updateSingleAircraft(data);
        });

        // Handle track data
        this.socket.on('track-data', (data) => {
            console.log("Received track data for:", data.aircraftId);
            this._displayAircraftTrack(data.aircraftId, data.track);
        });
    },
    
    /**
     * Start REST API fallback mode
     */
    _startRESTFallback: function() {
        if (this.usingRESTFallback) return; // Already using fallback
        
        console.log("Starting REST API fallback mode");
        this.usingRESTFallback = true;
        this.usingWebSocket = false;
        
        // Clear existing markers before switching data sources
        this.aircraftLayer.clearLayers();
        this.markers = {};
        
        // Fetch data immediately
        this._fetchAircraftDataREST();
        
        // Set up refresh timer
        if (!this.refreshTimer) {
            this.refreshTimer = setInterval(() => {
                this._fetchAircraftDataREST();
            }, this.options.refreshInterval);
        }
    },

    /**
     * Disconnect from WebSocket server
     */
    _disconnectWebSocket: function() {
        if (this.socket) {
            console.log("Disconnecting from WebSocket server");
            this.socket.disconnect();
            this.socket = null;
        }

        // Clear refresh timer if it exists (fallback mode)
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        
        // Reset data source flags
        this.usingWebSocket = false;
        this.usingRESTFallback = false;
    },

    /**
     * Update bounds when map is moved and send to server
     */
    _updateBounds: function() {
        if (!this.active || !this.socket) return;

        // Get map bounds
        const bounds = this._map.getBounds();
        const nwLat = bounds.getNorthWest().lat;
        const nwLng = bounds.getNorthWest().lng;
        const seLat = bounds.getSouthEast().lat;
        const seLng = bounds.getSouthEast().lng;

        const boundsData = { nwLat, nwLng, seLat, seLng };
        
        // Only send bounds to server if using WebSocket
        if (this.usingWebSocket) {
            // Send bounds to server
            this.socket.emit('update-bounds', boundsData);
            
            // If this is the first time or we're reconnecting, also subscribe
            if (this.socket.connected && !this._boundsSubscribed) {
                this.socket.emit('subscribe', boundsData);
                this._boundsSubscribed = true;
            }
        }
        
        // If we're using REST fallback, update that too
        if (this.usingRESTFallback) {
            this._fetchAircraftDataREST();
        }
    },

    /**
     * Fallback method to fetch aircraft data using REST API
     * Used when WebSocket connection fails
     */
    _fetchAircraftDataREST: function() {
        if (!this.active || !this.usingRESTFallback) return;

        console.log("Fetching aircraft data via REST API (fallback)");

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
                // Only process if we're still in REST fallback mode
                if (this.usingRESTFallback) {
                    this._updateAircraft(data);
                }
            })
            .catch(error => {
                console.error('Error fetching aircraft data:', error);
            });
    },

    // --- MODIFIED: _updateAircraft to filter based on settings ---
    _updateAircraft: function(aircraftData) {
        if (!this.active) return;

        const activeAircraftIds = new Set();
        const now = Date.now(); // For checking staleness if needed

        // Filter aircraft based on current settings BEFORE processing markers
        const filteredAircraft = aircraftData.filter(aircraft => {
            const agl = aircraft.last_alt_agl;
            const speed = aircraft.last_speed_kmh;

            if (agl < 5) { // Ground states
                if (speed === 0 && !this._liveSettings.showResting) return false;
                if (speed > 0 && speed <= 16 && !this._liveSettings.showHiking) return false;
                if (speed > 16 && !this._liveSettings.showDriving) return false;
            }
            // Add future filters here (e.g., staleness)
            return true; // Keep flying aircraft and visible ground states
        });

        // Process filtered aircraft: Update or add markers
        filteredAircraft.forEach(aircraft => {
            const normalizedId = this._normalizeAircraftId(aircraft.id);
            activeAircraftIds.add(normalizedId); // Add normalized ID

            const aircraftWithNormalizedId = {
                ...aircraft,
                id: normalizedId,
                originalId: aircraft.id
            };

            if (this.markers[normalizedId]) {
                // Update existing marker
                this.markers[normalizedId].setLatLng([aircraft.last_lat, aircraft.last_lon]);
                this._updateMarkerIcon(this.markers[normalizedId], aircraftWithNormalizedId); // Icon might change (e.g., flying -> landing)
                this._updatePopupContent(this.markers[normalizedId], aircraftWithNormalizedId);
            } else {
                // Attempt to create new marker (might return null if filtered by _createAircraftMarker)
                const newMarker = this._createAircraftMarker(aircraftWithNormalizedId);
                // Note: _createAircraftMarker now handles the initial visibility check
            }
        });

        // Remove markers for aircraft that are no longer active OR are now filtered out
        Object.keys(this.markers).forEach(normalizedId => {
            if (!activeAircraftIds.has(normalizedId)) {
                if (this.markers[normalizedId]) { // Check if marker exists before removing
                    this.aircraftLayer.removeLayer(this.markers[normalizedId]);
                }
                delete this.markers[normalizedId];

                // Remove track if exists
                if (this.tracks[normalizedId]) {
                    this.trackLayer.removeLayer(this.tracks[normalizedId]);
                    delete this.tracks[normalizedId];
                }
            }
        });

        // Removed track update logic based on this.selectedAircraft
        // Track updates are now handled by popupopen/popupclose events
    },
    // --- END MODIFIED ---

    // --- MODIFIED: _createAircraftMarker to check visibility settings and add popup listeners ---
    _createAircraftMarker: function(aircraft) {
        // --- NEW: Check visibility settings before creating ground markers ---
        const agl = aircraft.last_alt_agl;
        const speed = aircraft.last_speed_kmh;
        if (agl < 5) { // Ground states
             if (speed === 0 && !this._liveSettings.showResting) return null; // Don't create marker
             if (speed > 0 && speed <= 16 && !this._liveSettings.showHiking) return null; // Don't create marker
             if (speed > 16 && !this._liveSettings.showDriving) return null; // Don't create marker
        }
        // --- END NEW ---


        // Create icon first (might return loading icon)
        const icon = this._createAircraftIcon(aircraft);
        if (!icon) return null; // If icon creation failed (e.g., SVG not loaded yet)

        // Create marker
        const marker = L.marker([aircraft.last_lat, aircraft.last_lon], {
            icon: icon,
            title: aircraft.name || aircraft.id, // Use ID as fallback title
            alt: aircraft.name || aircraft.id,
            aircraftId: aircraft.id
        });

        // Create popup content
        const popupContent = this._createPopupContent(aircraft);

        // Bind popup
        // Bind popup with autoClose set to false
        // Bind popup with autoClose set to false, let Leaflet handle closeOnClick
        marker.bindPopup(popupContent, {
            offset: [50, 35],
            autoClose: false, // Prevent other popups from closing
            closeOnClick: false // Prevent map click from closing this popup (based on SO suggestion)
        });

        // Add listeners for popup events to manage track display and color assignment
        marker.on('popupopen', (e) => {
            const normalizedId = e.target.options.aircraftId; // Get normalized aircraftId from marker options
            console.log(`Popup opened for ${normalizedId}`);

            // Assign color
            if (!this.activePopupOrder.includes(normalizedId)) {
                this.activePopupOrder.push(normalizedId);
            }
            const colorIndex = this.activePopupOrder.indexOf(normalizedId) % this.options.trackHighlightColors.length;
            const color = this.options.trackHighlightColors[colorIndex];
            this.activePopupColors[normalizedId] = color;
            console.log(`Assigned color ${color} to ${normalizedId} at index ${this.activePopupOrder.indexOf(normalizedId)}`);

            // Update popup content immediately with the new color
            this._updatePopupContent(marker, aircraft); // Pass marker and aircraft data

            // Fetch and display track (will use the assigned color)
            this._fetchAircraftTrack(normalizedId);
        });

        marker.on('popupclose', (e) => {
            const normalizedId = e.target.options.aircraftId; // Get normalized aircraftId from marker options
            console.log(`Popup closed for ${normalizedId}`);

            // Remove track
            if (this.tracks[normalizedId]) {
                this.trackLayer.removeLayer(this.tracks[normalizedId]);
                delete this.tracks[normalizedId];
                console.log(`Removed track for ${normalizedId}`);
            }

            // Unassign color and remove from order
            const index = this.activePopupOrder.indexOf(normalizedId);
            if (index > -1) {
                this.activePopupOrder.splice(index, 1);
            }
            delete this.activePopupColors[normalizedId];
            console.log(`Unassigned color and removed ${normalizedId} from active order. New order:`, this.activePopupOrder);

            // Optional: Update popups of remaining active tracks if their color index changed?
            // This might be complex and potentially jarring. Let's skip for now.
            // If needed, iterate this.activePopupOrder, recalculate colors, update popups/tracks.
        });


        // Add marker to layer and store reference using normalized ID
        this.aircraftLayer.addLayer(marker);
        this.markers[aircraft.id] = marker; // Use normalized ID here

        return marker;
    },
    // --- END MODIFIED ---

    // --- MODIFIED: _createAircraftIcon ---
    _createAircraftIcon: function(aircraft) {
        const agl = aircraft.last_alt_agl;
        const speed = aircraft.last_speed_kmh;
        const heading = aircraft.last_course || 0;
        const groundIconSize = [30, 30]; // Updated size for ground states
        const groundIconAnchor = [15, 15]; // Center anchor for 30x30

        // Ensure SVGs are fetched if needed (especially for driving)
        this._fetchSvgs(); // Call fetchSvgs to ensure all SVGs are requested

        // Ground States (Resting, Hiking, Driving)
        if (agl < 5) {
            if (speed === 0) { // Resting
                return L.icon({
                    iconUrl: '/assets/images/resting.svg',
                    iconSize: groundIconSize,
                    iconAnchor: groundIconAnchor,
                    popupAnchor: [15, 0], // Anchor popup to middle-right
                    className: 'resting-aircraft-icon ground-aircraft-icon'
                });
            } else if (speed > 0 && speed <= 16) { // Hiking
                return L.icon({
                    iconUrl: '/assets/images/hiking.svg',
                    iconSize: groundIconSize,
                    iconAnchor: groundIconAnchor,
                    popupAnchor: [15, 0], // Anchor popup to middle-right
                    className: 'hiking-aircraft-icon ground-aircraft-icon'
                });
            } else { // Driving (speed > 16)
                if (!this.drivingSvgContent) {
                    console.warn("Driving SVG not loaded yet.");
                    // Return a placeholder loading icon for driving state
                    return L.divIcon({ className: 'aircraft-icon-loading', iconSize: groundIconSize, iconAnchor: groundIconAnchor, popupAnchor: [15, 0] }); // Anchor popup to middle-right
                }

                // Ensure driving SVG has width/height attributes
                let drivingSvg = this.drivingSvgContent.replace(/<svg/i, `<svg width="${groundIconSize[0]}px" height="${groundIconSize[1]}px"`);

                // Apply rotation to the wrapper div for driving icon
                const iconHtml = `
                    <div style="width: ${groundIconSize[0]}px; height: ${groundIconSize[1]}px; transform: rotate(${heading}deg); transform-origin: center center; display: block;">
                        ${drivingSvg}
                    </div>
                `;

                return L.divIcon({
                    html: iconHtml,
                    className: 'driving-aircraft-icon ground-aircraft-icon', // Specific class for driving
                    iconSize: groundIconSize,
                    iconAnchor: groundIconAnchor,
                    popupAnchor: [15, 0] // Anchor popup to middle-right
                });
            }
        }

        // Flying State (Existing logic - size 60x60)
        else {
            // Ensure SVGs for flying state are fetched if needed
            if (!this.canopySvgContent || !this.hangGliderSvgContent) {
                 // Fetch might have been called above, check again
                 if (!this.canopySvgContent || !this.hangGliderSvgContent) {
                    console.warn("Flying SVGs not loaded yet for icon creation.");
                    return L.divIcon({ className: 'aircraft-icon-loading', iconSize: [60, 60], iconAnchor: [30, 30], popupAnchor: [30, 0] }); // Anchor popup to middle-right
                 }
            }

            const isHangGlider = aircraft.type === 6;
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
                iconAnchor: flyingIconAnchor,
                popupAnchor: [30, 0] // Anchor popup to middle-right
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
            formattedTimeAgo = `-${seconds} sec`;
        } else if (diffSeconds < 3600) {
            // Less than an hour ago: (-MM:SS min)
            const minutes = String(Math.floor(diffSeconds / 60)).padStart(2, '0');
            const seconds = String(diffSeconds % 60).padStart(2, '0');
            formattedTimeAgo = `-${minutes}:${seconds} min`;
        } else {
            // More than an hour ago: (-HH:MM h)
            const hours = String(Math.floor(diffSeconds / 3600)).padStart(2, '0');
            const minutes = String(Math.floor((diffSeconds % 3600) / 60)).padStart(2, '0');
            formattedTimeAgo = `-${hours}:${minutes} h`;
        }

        // Determine aircraft type (though not used in the popup string anymore)
        const aircraftType = aircraft.type === 6 ? 'Hang Glider' : 'Paraglider';

        // Get assigned color or fallback using normalized ID
        const assignedColor = this.activePopupColors[aircraft.id] || '#007bff'; // Fallback to blue

        // Create popup content
        return `
   <div class="aircraft-popup">
                <p style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="flex-grow: 1;"><strong style="color:${assignedColor};">${aircraft.pilot_name}</strong></span>
                    <span style="margin-left: 10px; white-space: nowrap;">${formattedTimeAgo}</span>
                </p>
                <p><strong>${aircraft.last_alt_msl} m </strong>[${aircraft.last_alt_agl} AGL]</strong> <strong style="color: ${aircraft.last_vs > 0 ? 'green' : aircraft.last_vs < 0 ? 'red' : 'black'};">${aircraft.last_vs} m/s</strong></p>
            </div>
        `;
    },

    _updatePopupContent: function(marker, aircraft) {
        if (marker.getPopup()) {
            marker.getPopup().setContent(this._createPopupContent(aircraft));
        }
    },

    /**
     * Update a single aircraft (used with WebSocket updates)
     */
    _updateSingleAircraft: function(aircraft) {
        if (!this.active) return;

        // Normalize aircraft ID by removing the prefix (FLR, FNT, etc.) and keeping only the unique part
        const normalizedId = this._normalizeAircraftId(aircraft.id);
        
        // Use the normalized ID for all operations
        const aircraftWithNormalizedId = {
            ...aircraft,
            id: normalizedId,
            originalId: aircraft.id // Keep the original ID for reference
        };
        
        // Check for duplicate updates using timestamp
        if (aircraft.update_timestamp) {
            const lastTimestamp = this.lastUpdateTimestamps[normalizedId] || 0;
            if (aircraft.update_timestamp <= lastTimestamp) {
                console.debug(`Skipping duplicate update for aircraft ${normalizedId} (timestamp: ${aircraft.update_timestamp}, last: ${lastTimestamp})`);
                return;
            }
            // Update the timestamp
            this.lastUpdateTimestamps[normalizedId] = aircraft.update_timestamp;
        }

        // Debug log to see what data we're receiving
        console.debug("Received aircraft update:", aircraft);

        // Ensure we have valid coordinates
        const lat = aircraft.lat || aircraft.last_lat;
        const lon = aircraft.lon || aircraft.last_lon;
        
        if (!lat || !lon) {
            console.warn("Skipping aircraft update due to missing coordinates:", aircraft.id);
            return;
        }

        // Add to active aircraft IDs set
        const activeAircraftIds = new Set(Object.keys(this.markers));
        activeAircraftIds.add(normalizedId);

        // Filter based on current settings
        const agl = aircraft.last_alt_agl || aircraft.altAgl || 0;
        const speed = aircraft.last_speed_kmh || aircraft.speedKmh || 0;

        let shouldDisplay = true;
        if (agl < 5) { // Ground states
            if (speed === 0 && !this._liveSettings.showResting) shouldDisplay = false;
            if (speed > 0 && speed <= 16 && !this._liveSettings.showHiking) shouldDisplay = false;
            if (speed > 16 && !this._liveSettings.showDriving) shouldDisplay = false;
        }

        if (shouldDisplay) {
            // Update or create marker
            if (this.markers[normalizedId]) {
                // Update existing marker
                this.markers[normalizedId].setLatLng([lat, lon]);
                this._updateMarkerIcon(this.markers[normalizedId], aircraftWithNormalizedId);
                            // --- NEW: Update track if popup is open ---
                            if (this.tracks[normalizedId]) {
                                // console.debug(`Updating track for ${normalizedId}`); // Optional debug log
                                this.tracks[normalizedId].addLatLng([lat, lon]);
                                // Optional: Add logic here to trim old points if the track becomes too long for performance reasons
                            }
                            // --- END NEW ---
                this._updatePopupContent(this.markers[normalizedId], aircraftWithNormalizedId);
               } else {
                // Create new marker
                // Ensure aircraft has all required properties
                const processedAircraft = {
                    ...aircraftWithNormalizedId,
                    last_lat: lat,
                    last_lon: lon,
                    last_alt_agl: agl,
                    last_speed_kmh: speed,
                    last_course: aircraft.last_course || aircraft.course || 0,
                    last_vs: aircraft.last_vs || aircraft.vs || 0,
                    type: aircraft.type || aircraft.aircraftType || 0,
                    name: aircraft.name || normalizedId,
                    pilot_name: aircraft.pilot_name || aircraft.name || normalizedId
                };
                
                this._createAircraftMarker(processedAircraft);
            }
        } else if (this.markers[normalizedId]) {
            // Remove marker if it exists but shouldn't be displayed
            this.aircraftLayer.removeLayer(this.markers[normalizedId]);
            delete this.markers[normalizedId];

            // Remove track if exists
            if (this.tracks[normalizedId]) {
                this.trackLayer.removeLayer(this.tracks[normalizedId]);
                delete this.tracks[normalizedId];
            }
        }
    },

    /**
     * Normalize aircraft ID by removing known prefixes
     * @param {string} id - Original aircraft ID
     * @returns {string} - Normalized ID
     */
    _normalizeAircraftId: function(id) {
        if (!id) return id;
        // Remove prefixes like FLR, FNT, OGN, RND, ICA
        return id.replace(/^(FLR|FNT|OGN|RND|ICA)/i, '');
    },

    /**
     * Fetch aircraft track using WebSocket or fallback to REST API
     */
    _fetchAircraftTrack: function(normalizedId) {
    	if (this.usingWebSocket && this.socket && this.socket.connected) {
    		// Use WebSocket
    		console.log(`[LiveControl] Requesting track via WebSocket for: ${normalizedId}`);
    		this.socket.emit('get-track', normalizedId);
    	} else {
    		// Fallback to REST API
    		console.log("Requesting track via REST API for:", normalizedId);
    		fetch(`/api/ogn/track/${normalizedId}?minutes=60`)
    			.then(response => response.json())
    			.then(trackData => {
    			             console.log(`[LiveControl] Received track via REST for ${normalizedId}. Length: ${trackData?.length ?? 'N/A'}`);
    				this._displayAircraftTrack(normalizedId, trackData);
    			})
    			.catch(error => {
    			             // Keep existing error log
    				console.error('Error fetching aircraft track:', error);
    			});
    	}
    },

    _displayAircraftTrack: function(normalizedId, trackData) {
    	// Remove existing track if any
    			 console.log(`[LiveControl] Displaying track for ${normalizedId}. Received data length: ${trackData?.length ?? 'N/A'}`);
    			 if (this.tracks[normalizedId]) {
    		this.trackLayer.removeLayer(this.tracks[normalizedId]);
    	}

    	// Create track line
    	if (trackData.length > 0) {
    		const trackPoints = trackData.map(point => [point.lat, point.lon]);
    			     console.log(`[LiveControl] Creating polyline for ${normalizedId} with ${trackPoints.length} points.`);

    		// Get assigned color or fallback using normalized ID
    		const assignedColor = this.activePopupColors[normalizedId] || this.options.trackColor; // Fallback to default track color

            // Create polyline with the assigned color
            const track = L.polyline(trackPoints, {
                color: assignedColor, // Use the assigned color
                weight: this.options.trackWeight,
                opacity: this.options.trackOpacity,
                lineJoin: 'round'
            });

            // Add to layer and store reference using normalized ID
            this.trackLayer.addLayer(track);
                  console.log(`[LiveControl] Added track polyline for ${normalizedId} to trackLayer.`);
            this.tracks[normalizedId] = track;
      
              } else {
                  console.log(`[LiveControl] No track data or empty track data for ${normalizedId}, not displaying track.`);
            // Altitude markers removed as requested
            // this._addAltitudeMarkers(normalizedId, trackData);
              }
          },

    // _addAltitudeMarkers function removed as it's no longer called

    // --- NEW: Methods for Config Badge and Preferences ---
    _showConfigBadge: function() {
        if (this._configBadgeOpen) return; // Already open

        this._configBadgeOpen = true;
        // --- MODIFIED: Append badge to parent container for correct positioning ---
        const badge = L.DomUtil.create('div', 'live-config-badge', this._container.parentNode);
        badge.id = 'live-config-badge';

        // Stop propagation to prevent map clicks when interacting with the badge
        L.DomEvent.disableClickPropagation(badge);
        L.DomEvent.on(badge, 'mousedown wheel', L.DomEvent.stopPropagation); // Prevent map drag/zoom

        // Badge Content (Toggles)
        // Log the state right before rendering the HTML
        console.log(`[LiveControl._openConfigBadge] About to render badge. Current this._liveSettings.showDriving: ${this._liveSettings.showDriving}`);
        badge.innerHTML = `
            <div class="live-config-row live-config-header">
                <span style="font-size: 14px; font-weight: 700;">Live!</span>
                <label class="switch">
                    <input type="checkbox" id="live-toggle-main" ${this._liveSettings.isActive ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            </div>
            <div class="live-config-row">
                <span style="font-size: 14px;">Resting pilots</span>
                <label class="switch">
                    <input type="checkbox" id="live-toggle-resting" ${this._liveSettings.showResting ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            </div>
            <div class="live-config-row">
                <span style="font-size: 14px;">Hiking pilots</span>
                <label class="switch">
                    <input type="checkbox" id="live-toggle-hiking" ${this._liveSettings.showHiking ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            </div>
            <div class="live-config-row">
                <span style="font-size: 14px;">Driving pilots</span>
                <label class="switch">
                    <input type="checkbox" id="live-toggle-driving" ${this._liveSettings.showDriving ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            </div>
        `;

        // Add Event Listeners to Toggles
        const mainToggle = badge.querySelector('#live-toggle-main');
        const restingToggle = badge.querySelector('#live-toggle-resting');
        const hikingToggle = badge.querySelector('#live-toggle-hiking');
        const drivingToggle = badge.querySelector('#live-toggle-driving');

        L.DomEvent.on(mainToggle, 'change', (e) => {
            if (e.target.checked) {
                this._activateLive();
            } else {
                this._deactivateLive();
            }
            // Note: activate/deactivate now handle updating _liveSettings.isActive and triggering save check
        });

        const updateSetting = (key, checked) => {
            if (this._liveSettings[key] !== checked) {
                this._liveSettings[key] = checked;
                this._fetchAircraftData(); // Re-fetch and filter data
                // Trigger preference save check (needs access to keycloak-auth logic)
                // This might require emitting a custom event or calling a global function
                document.dispatchEvent(new CustomEvent('xcmaps-preferences-changed'));
                console.log(`Live setting changed: ${key} = ${checked}`);
            }
        };

        L.DomEvent.on(restingToggle, 'change', (e) => updateSetting('showResting', e.target.checked));
        L.DomEvent.on(hikingToggle, 'change', (e) => updateSetting('showHiking', e.target.checked));
        L.DomEvent.on(drivingToggle, 'change', (e) => updateSetting('showDriving', e.target.checked));


        // Add listener to close badge when clicking outside
        // Use a timeout to prevent immediate closing due to the initial click
        setTimeout(() => {
            // Store listener reference to remove it later
            this._closeBadgeClickListener = (event) => {
                // Check if the click target is outside the badge and the control container
                if (badge && (!badge.contains(event.target) && !this._container.contains(event.target))) {
                    this._closeConfigBadge(); // Pass the event if needed, though not strictly necessary here
                }
            };
            L.DomEvent.on(document, 'click', this._closeBadgeClickListener, this);
        }, 0);
    },

    _closeConfigBadge: function() { // Removed 'e' as it's not always passed/needed here
        const badge = document.getElementById('live-config-badge');
        if (badge) {
             badge.remove();
        }
        this._configBadgeOpen = false;
        // Remove the document click listener
        if (this._closeBadgeClickListener) {
             L.DomEvent.off(document, 'click', this._closeBadgeClickListener, this);
             this._closeBadgeClickListener = null;
        }
    },

    getLiveSettings: function() {
        // Return a copy to prevent direct modification
        return { ...this._liveSettings };
    },

    applyLivePreferences: function(settings) {
        if (!settings) return;

        let changed = false;
        let activationChanged = false; // Track if main active state changed

        // Apply main active state first
        if (typeof settings.isActive === 'boolean' && this._liveSettings.isActive !== settings.isActive) {
            console.log(`[LiveControl.applyLivePreferences] Updating isActive from ${this._liveSettings.isActive} to ${settings.isActive}`);
            // Only update internal state here, activation/deactivation happens separately
            // based on this state after preferences are fully loaded.
            this._liveSettings.isActive = settings.isActive;
            activationChanged = true; // Mark that activation state needs applying
            changed = true;
        }

        // Apply sub-settings, checking type and if value actually changed
        if (typeof settings.showResting === 'boolean' && this._liveSettings.showResting !== settings.showResting) {
            console.log(`[LiveControl.applyLivePreferences] Updating showResting from ${this._liveSettings.showResting} to ${settings.showResting}`);
            this._liveSettings.showResting = settings.showResting;
            changed = true;
        }
        if (typeof settings.showHiking === 'boolean' && this._liveSettings.showHiking !== settings.showHiking) {
            this._liveSettings.showHiking = settings.showHiking;
            changed = true;
        }
        if (typeof settings.showDriving === 'boolean' && this._liveSettings.showDriving !== settings.showDriving) {
            console.log(`[LiveControl.applyLivePreferences] Updating showDriving from ${this._liveSettings.showDriving} to ${settings.showDriving}`); // Keep this log
            this._liveSettings.showDriving = settings.showDriving;
            changed = true;
        }

        console.log("Applied live preferences:", this._liveSettings);

        // If sub-settings changed and live mode is currently active (based on internal state), refresh the data
        if (changed && !activationChanged && this._liveSettings.isActive) { // Use internal state for check
             console.log("[LiveControl] Sub-settings changed and live active, refreshing data...");
            this._fetchAircraftData();
        }

        // --- NEW: Apply activation state AFTER preferences are loaded ---
        // This ensures activation/deactivation happens based on the loaded preference
        if (activationChanged) {
            console.log(`[LiveControl.applyLivePreferences] Applying activation state: ${this._liveSettings.isActive}`);
            if (this._liveSettings.isActive) {
                this._activateLive(); // Activate if preference is true
            } else {
                this._deactivateLive(); // Deactivate if preference is false
            }
        }
        // --- END NEW ---

        // If settings changed AND the config badge is currently open, update the toggles directly
        if (changed && this._configBadgeOpen && this._configContainer) {
             console.log("[LiveControl] Settings changed and badge open, updating toggles directly.");
             const restingToggle = this._configContainer.querySelector('#live-toggle-resting');
             const hikingToggle = this._configContainer.querySelector('#live-toggle-hiking');
             const drivingToggle = this._configContainer.querySelector('#live-toggle-driving');

             if (restingToggle) {
                 console.log(`[LiveControl] Updating resting toggle checked state to: ${this._liveSettings.showResting}`);
                 restingToggle.checked = this._liveSettings.showResting;
             }
             if (hikingToggle) {
                 console.log(`[LiveControl] Updating hiking toggle checked state to: ${this._liveSettings.showHiking}`);
                 hikingToggle.checked = this._liveSettings.showHiking;
             }
             if (drivingToggle) {
                 console.log(`[LiveControl] Updating driving toggle checked state to: ${this._liveSettings.showDriving}`);
                 drivingToggle.checked = this._liveSettings.showDriving;
             }
        }
    }
    // --- END NEW ---

});

// Factory function to create the control
L.control.live = function(options) {
    // --- MODIFIED: Store instance globally ---
    // Ensure window.liveControl is not overwritten if already exists (e.g., HMR)
    if (!window.liveControl) {
        window.liveControl = new LiveControl(options);
    } else {
        // Optionally update options if needed, or just return existing
        L.Util.setOptions(window.liveControl, options);
        console.log("LiveControl already exists, updated options.");
    }
    return window.liveControl;
    // --- END MODIFIED ---
};

// Add event listener for track button clicks (No changes needed here)
document.addEventListener('show-aircraft-track', function(e) {
    const aircraftId = e.detail;
    // Use the global instance
    if (window.liveControl && window.liveControl.active) {
         window.liveControl._fetchAircraftTrack(aircraftId);
    } else if (window.map) { // Fallback search if global instance not found/ready (less ideal)
        window.map.eachLayer(function(layer) {
            // Check if the layer is the LiveControl instance itself
            if (layer instanceof LiveControl && layer.active) {
                 layer._fetchAircraftTrack(aircraftId);
            }
        });
    }
});

// --- NEW: Listen for preference changes to update save button ---
document.addEventListener('xcmaps-preferences-changed', () => {
    // This assumes the profile badge might be open. Find the save button and update it.
    const saveButton = document.getElementById('save-settings-button');
    const userControlContainer = document.getElementById('user-control'); // Check if user badge is open

    // Only update if the save button is currently visible within the user control
    if (saveButton && userControlContainer && userControlContainer.contains(saveButton)) {
        console.log("Live settings changed, visually enabling save button.");
        // This is a visual cue; the actual check happens on save click in keycloak-auth.js
        saveButton.style.backgroundColor = '#4CAF50'; // Green
        saveButton.style.color = 'white';
        saveButton.style.cursor = 'pointer';
        saveButton.disabled = false;
        saveButton.dataset.hasChanges = 'true'; // Mark potential changes
    }
});
// --- END NEW ---


export default LiveControl; // Export the class
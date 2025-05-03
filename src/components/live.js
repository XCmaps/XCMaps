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
        drivingSvgUrl: '/assets/images/driving.svg',
        restingSvgUrl: '/assets/images/resting.svg',
        hikingSvgUrl: '/assets/images/hiking.svg',
        helicopterSvgUrl: '/assets/images/helicopter.svg', // Added helicopter URL
        canopyInactiveSvgUrl: '/assets/images/canopy-inactive.svg', // Added inactive canopy URL
        hangGliderInactiveSvgUrl: '/assets/images/hang-glider-inactive.svg', // Added inactive HG URL
        canopyPlaceholderFill: 'fill:#0000ff;',
        hangGliderPlaceholderFill: 'fill:#ff0000;',
        // Assuming inactive SVGs also use the same placeholders for color fill if needed
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
        this.restingSvgContent = null;
        this.hikingSvgContent = null;
        this.helicopterSvgContent = null; // Added property for helicopter SVG
        this.canopyInactiveSvgContent = null; // Added property for inactive canopy SVG
        this.hangGliderInactiveSvgContent = null; // Added property for inactive HG SVG
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
        this.popupTimers = {}; // Store interval IDs for updating popup times
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
        if (this._svgsLoading || (
            this.canopySvgContent && this.hangGliderSvgContent &&
            this.drivingSvgContent && this.restingSvgContent && this.hikingSvgContent && this.helicopterSvgContent &&
            this.canopyInactiveSvgContent && this.hangGliderInactiveSvgContent
        )) {
            return; // All SVGs loaded
        }
        this._svgsLoading = true;

        const fetches = [];

        // Fetch Canopy SVG if not already loaded
        if (!this.canopySvgContent) {
            fetches.push(
                fetch(this.options.canopySvgUrl)
                    .then(response => response.ok ? response.text() : Promise.reject('Failed to load canopy SVG'))
                    .then(text => {
                        console.log("Successfully fetched canopy.svg"); // Added log
                        this.canopySvgContent = text;
                    })
                    .catch(error => console.error('Error fetching canopy SVG:', error)) // Keep existing error log
            );
        }

        // Fetch Hang Glider SVG if not already loaded
        if (!this.hangGliderSvgContent) {
            fetches.push(
                fetch(this.options.hangGliderSvgUrl)
                    .then(response => response.ok ? response.text() : Promise.reject('Failed to load hang-glider SVG'))
                    .then(text => {
                        console.log("Successfully fetched hang-glider.svg"); // Added log
                        this.hangGliderSvgContent = text;
                    })
                    .catch(error => console.error('Error fetching hang-glider SVG:', error)) // Keep existing error log
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
 
        // Fetch Resting SVG if not already loaded
        if (!this.restingSvgContent) {
            fetches.push(
                fetch(this.options.restingSvgUrl)
                    .then(response => response.ok ? response.text() : Promise.reject('Failed to load resting SVG'))
                    .then(text => { this.restingSvgContent = text; })
                    .catch(error => console.error('Error fetching resting SVG:', error))
            );
        }
 
        // Fetch Hiking SVG if not already loaded
        if (!this.hikingSvgContent) {
            fetches.push(
                fetch(this.options.hikingSvgUrl)
                    .then(response => response.ok ? response.text() : Promise.reject('Failed to load hiking SVG'))
                    .then(text => { this.hikingSvgContent = text; })
                    .catch(error => console.error('Error fetching hiking SVG:', error))
            );
        }
 
        // Fetch Inactive Canopy SVG if not already loaded
        if (!this.canopyInactiveSvgContent) {
            fetches.push(
                fetch(this.options.canopyInactiveSvgUrl)
                    .then(response => response.ok ? response.text() : Promise.reject('Failed to load inactive canopy SVG'))
                    .then(text => { this.canopyInactiveSvgContent = text; })
                    .catch(error => console.error('Error fetching inactive canopy SVG:', error))
            );
        }
 
        // Fetch Inactive Hang Glider SVG if not already loaded
        if (!this.hangGliderInactiveSvgContent) {
            fetches.push(
                fetch(this.options.hangGliderInactiveSvgUrl)
                    .then(response => response.ok ? response.text() : Promise.reject('Failed to load inactive hang-glider SVG'))
                    .then(text => { this.hangGliderInactiveSvgContent = text; })
                    .catch(error => console.error('Error fetching inactive hang-glider SVG:', error))
            );
        }

        // Fetch Helicopter SVG if not already loaded
        if (!this.helicopterSvgContent) {
            fetches.push(
                fetch(this.options.helicopterSvgUrl)
                    .then(response => response.ok ? response.text() : Promise.reject('Failed to load helicopter SVG'))
                    .then(text => { this.helicopterSvgContent = text; })
                    .catch(error => console.error('Error fetching helicopter SVG:', error))
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

        // Clear any running popup timers
        this._clearAllPopupTimers();

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
                this._updatePopupContent(this.markers[normalizedId], aircraftWithNormalizedId, normalizedId); // Pass normalizedId
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
    }, // End of _updateAircraft method
 
    // --- NEW HELPER: Get Aircraft Icon ---
    _getAircraftIcon: function(aircraft) {
        let iconSize = [30, 30]; // Standard icon size - Changed to let
        let iconAnchor = [15, 15]; // Center anchor - Changed to let
        let svgContent = null;
        let className = 'live-marker-icon'; // Base class
        let html = '';
        let rotation = 0;
        let useRotation = false;
        let isFlyingType = false; // Flag to check if color fill should be applied

        // Determine base SVG based on status
        const status = aircraft.status || 'unknown'; // Default status if missing
        switch (status) {
            case 'resting':
                // Use L.icon for simple resting state
                return L.icon({
                    iconUrl: this.options.restingSvgUrl,
                    iconSize: iconSize, // [30, 30]
                    iconAnchor: iconAnchor, // [15, 15]
                    popupAnchor: [23, 0], // Add popup anchor
                    className: className + ' status-resting'
                });
                // break; // Unreachable after return
            case 'hiking':
                 // Use L.icon for simple hiking state
                return L.icon({
                    iconUrl: this.options.hikingSvgUrl,
                    iconSize: iconSize, // [30, 30]
                    iconAnchor: iconAnchor, // [15, 15]
                    popupAnchor: [23, 0], // Add popup anchor
                    className: className + ' status-hiking'
                });
                // break; // Unreachable after return
            case 'driving':
                // Driving needs DivIcon for rotation
                svgContent = this.drivingSvgContent;
                className += ' status-driving';
                useRotation = true; // Driving icon should rotate
                break;
            // REMOVED incorrect helicopter status case
            case 'flying':
            case 'started': // Treat 'started' and 'landed' visually as flying for icon choice
            case 'landed':
            case 'unknown': // Default to flying icon if status is unknown or unexpected
            default: // Flying, Started, Landed, Unknown
                iconSize = [42, 42]; // Flying icon size (Reduced by ~30% from 60)
                iconAnchor = [21, 21]; // Anchor for 42x42 (Reduced by ~30% from 30)
                useRotation = true;
                className += ' status-flying'; // Generic flying class
                // Determine if aircraft is stale (e.g., > 10 minutes)
                const isStale = (Date.now() - new Date(aircraft.last_seen).getTime()) > (10 * 60 * 1000);
 
                // Determine flying type (PG or HG) and select active/inactive SVG
                if (aircraft.type === 7) { // Paraglider
                    svgContent = isStale ? this.canopyInactiveSvgContent : this.canopySvgContent;
                    className += ' type-paraglider';
                    isFlyingType = true; // Color fill applies to both active/inactive
                } else if (aircraft.type === 6) { // Hang Glider
                    svgContent = isStale ? this.hangGliderInactiveSvgContent : this.hangGliderSvgContent;
                    className += ' type-hangglider';
                    isFlyingType = true; // Color fill applies to both active/inactive
                } else if (aircraft.type === 3) { // Helicopter
                    svgContent = this.helicopterSvgContent;
                    iconSize = [24, 24]; // Use smaller size for helicopter
                    iconAnchor = [12, 12]; // Adjust anchor for smaller size
                    className += ' type-helicopter';
                    isFlyingType = false; // No color fill for helicopter
                    // useRotation is already true for 'flying' status
                } else {
                    // Fallback for other types if needed (e.g., gliders, planes if added later)
                    // Default to paraglider icon (active/inactive based on staleness) for now
                    svgContent = isStale ? this.canopyInactiveSvgContent : this.canopySvgContent;
                    className += ' type-paraglider';
                    isFlyingType = true; // Assume colorable if defaulting to PG
                }
 
                // Add stale class if needed
                if (isStale) {
                    className += ' stale-aircraft';
                }
 
                break;
        }

        // Handle SVG loading state
        if (!svgContent) {
            // --- Added Log ---
            console.warn(`[LiveControl._getAircraftIcon] SVG content not ready for aircraft ${aircraft.id} (status: ${status}, type: ${aircraft.type}). Returning placeholder.`);
            // --- End Added Log ---
            // Return a simple placeholder icon if SVGs haven't loaded yet
            // console.warn(`SVG content not ready for status: ${status}, type: ${aircraft.type}`);
            // Use appropriate size for placeholder based on intended state
            const placeholderSize = (status === 'resting' || status === 'hiking' || status === 'driving') ? [30, 30] : [60, 60];
            const placeholderAnchor = (status === 'resting' || status === 'hiking' || status === 'driving') ? [15, 15] : [30, 30];
            return L.divIcon({ // Use DivIcon for consistency, even for loading
                 html: '?', // Simple placeholder text or small spinner SVG
                 className: 'live-marker-loading',
                 iconSize: placeholderSize,
                 iconAnchor: placeholderAnchor
             });
        }
        // Note: Resting and Hiking cases now return L.icon directly above.
        // The following code only applies to Driving and Flying states which use L.divIcon.
 
        // Apply rotation if applicable (driving, flying states - helicopter handled within flying)
        if (useRotation && typeof aircraft.last_course === 'number' && aircraft.last_course >= 0) {
            rotation = aircraft.last_course;
        }

        // --- Reinstated SVG Color Fill Logic ---
        // Apply color fill for PG/HG icons based on Vertical Speed
        let finalSvg = svgContent;
        if (isFlyingType) { // Only apply color to PG/HG
             const vsColor = this._getVSColor(aircraft.last_vs); // Use _getVSColor
             const placeholder = aircraft.type === 7 ? this.options.canopyPlaceholderFill : this.options.hangGliderPlaceholderFill;
             // Ensure placeholder exists before replacing
             if (placeholder && svgContent.includes(placeholder)) {
                finalSvg = svgContent.replace(placeholder, `fill:${vsColor};`);
             } else if (placeholder) {
                // Optional: Warn if placeholder isn't found, might indicate SVG structure changed
                // console.warn(`Placeholder '${placeholder}' not found in SVG for type ${aircraft.type}. Cannot apply VS color.`);
             }
        }
        // --- End Reinstated Logic ---

        // Create the HTML for the DivIcon (Driving and Flying states)
        // Apply rotation directly to the outer div.
        // Explicitly set width/height on the SVG tag within the HTML.
        const sizedSvg = finalSvg.replace(/<svg/i, `<svg width="${iconSize[0]}" height="${iconSize[1]}"`); // Use finalSvg here
        html = `<div class="marker-rotation-wrapper" style="transform: rotate(${rotation}deg);">${sizedSvg}</div>`;

        return L.divIcon({
            html: html,
            className: className, // Apply status/type classes here
            iconSize: iconSize, // Use determined size (Leaflet needs this)
            iconAnchor: iconAnchor, // Use determined anchor
            popupAnchor: (status === 'driving') ? [15, 0] : [30, 0] // Set popup anchor based on size
        });
    }, // Keep comma here
    // --- END NEW HELPER ---
 
    // --- MODIFIED: _createAircraftMarker to use helper ---
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


        // Create icon first using the new helper (might return loading icon)
        const icon = this._getAircraftIcon(aircraft);
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

            // --- NEW: Start timer for this popup ---
            this._startPopupTimer(e.popup, normalizedId);
            // --- END NEW ---

            // --- NEW: Close popup on click ---
            const popupContainer = e.popup.getElement();
            if (popupContainer) {
                // Use a flag to prevent immediate closure after opening due to event propagation
                let justOpened = true;
                setTimeout(() => { justOpened = false; }, 0); // Allow current event loop to finish

                L.DomEvent.on(popupContainer, 'click', (ev) => {
                    if (justOpened) return; // Don't close immediately on the click that might have opened it
                    // Check if the click target is the close button itself to avoid double handling
                    if (ev.target && L.DomUtil.hasClass(ev.target, 'leaflet-popup-close-button')) {
                        return;
                    }
                    marker.closePopup();
                    L.DomEvent.stop(ev); // Stop propagation to map
                }, this);
                // Note: Leaflet might handle listener removal on close, but explicit removal in popupclose might be safer if issues arise.
            }
            // --- END NEW ---
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
 
            // Stop the update timer for this popup
            this._stopPopupTimer(normalizedId);
            // --- END NEW ---

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

    // --- Removed redundant _createAircraftIcon method ---

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
         marker.setIcon(this._getAircraftIcon(aircraft)); // Use the new helper function
     },

    // --- NEW: Helper function to format time difference ---
    _formatTimeAgo: function(timestamp) {
        const lastSeen = new Date(timestamp);
        const now = new Date();
        const diffSeconds = Math.max(0, Math.round((now - lastSeen) / 1000)); // Ensure non-negative

        if (diffSeconds < 60) {
            // Less than a minute ago: (-SS sec)
            const seconds = String(diffSeconds).padStart(2, '0');
            return `-${seconds} sec`;
        } else if (diffSeconds < 3600) {
            // Less than an hour ago: (-MM:SS min)
            const minutes = String(Math.floor(diffSeconds / 60)).padStart(2, '0');
            const seconds = String(diffSeconds % 60).padStart(2, '0');
            return `-${minutes}:${seconds} min`;
        } else {
            // More than an hour ago: (-HH:MM h)
            const hours = String(Math.floor(diffSeconds / 3600)).padStart(2, '0');
            const minutes = String(Math.floor((diffSeconds % 3600) / 60)).padStart(2, '0');
            return `-${hours}:${minutes} h`;
        }
    },
    // --- END NEW ---
// --- NEW: Timer management for popups ---
    _startPopupTimer: function(popup, aircraftId) {
        // Clear any existing timer for this aircraft first
        this._stopPopupTimer(aircraftId);

        const popupElement = popup.getElement();
        if (!popupElement) return;

        const timeElement = popupElement.querySelector('.live-time-ago');
        const timestamp = parseInt(timeElement?.getAttribute('data-timestamp'), 10);

        if (!timeElement || isNaN(timestamp)) {
            console.warn(`Could not find time element or valid timestamp for popup timer: ${aircraftId}`);
            return;
        }

        // Update immediately
        timeElement.textContent = this._formatTimeAgo(timestamp);

        // Start interval
        this.popupTimers[aircraftId] = setInterval(() => {
            // Check if the popup is still open and the element exists
            const currentPopupElement = popup.getElement(); // Re-fetch element in case popup was replaced
            const currentTimeElement = currentPopupElement?.querySelector('.live-time-ago');
            if (popup.isOpen() && currentTimeElement) {
                currentTimeElement.textContent = this._formatTimeAgo(timestamp);
            } else {
                // Popup closed or element gone, stop the timer
                this._stopPopupTimer(aircraftId);
            }
        }, 1000); // Update every second
    },

    _stopPopupTimer: function(aircraftId) {
        if (this.popupTimers[aircraftId]) {
            clearInterval(this.popupTimers[aircraftId]);
            delete this.popupTimers[aircraftId];
        }
    },

    _clearAllPopupTimers: function() {
        Object.keys(this.popupTimers).forEach(aircraftId => {
            this._stopPopupTimer(aircraftId);
        });
    },
    // --- END NEW ---

     _createPopupContent: function(aircraft) {
        const lastSeenTimestamp = new Date(aircraft.last_seen).getTime();
        const initialFormattedTimeAgo = this._formatTimeAgo(lastSeenTimestamp); // Use helper

        // Determine aircraft type (though not used in the popup string anymore)
        const aircraftType = aircraft.type === 6 ? 'Hang Glider' : 'Paraglider';

        // Get assigned color or fallback using normalized ID
        const assignedColor = this.activePopupColors[aircraft.id] || '#007bff'; // Fallback to blue

        // Create popup content with data-timestamp and class for the time span
        return `
            <div class="aircraft-popup" data-aircraft-id="${aircraft.id}">
                <p style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="flex-grow: 1;"><strong style="color:${assignedColor};">${aircraft.name}</strong></span>
                    <span class="live-time-ago" data-timestamp="${lastSeenTimestamp}" style="margin-left: 10px; white-space: nowrap;">${initialFormattedTimeAgo}</span>
                </p>
                <p><strong>${aircraft.last_alt_msl} m </strong>[${aircraft.last_alt_agl} AGL]</strong> <strong style="color: ${aircraft.last_vs === 0 ? 'black' : (aircraft.last_vs < 0 ? 'red' : 'green')};">${aircraft.last_vs} m/s</strong></p>
            </div>
        `;
    },

    _updatePopupContent: function(marker, aircraft, normalizedId) { // Add normalizedId
        const popup = marker.getPopup();
        if (popup) {
            // Generate the new base HTML content
            const newContent = this._createPopupContent(aircraft);
            popup.setContent(newContent);

            // If the popup is currently open, restart its timer.
            // This ensures the timer uses the new DOM element and the new timestamp.
            if (popup.isOpen()) {
                // We need the normalizedId here to manage the timer correctly
                if (normalizedId) {
                     this._startPopupTimer(popup, normalizedId);
                } else {
                     // Fallback: Try to get ID from popup content if not passed (less ideal)
                     const popupElement = popup.getElement();
                     const containerDiv = popupElement?.querySelector('.aircraft-popup');
                     const idFromDOM = containerDiv?.getAttribute('data-aircraft-id');
                     if (idFromDOM) {
                         this._startPopupTimer(popup, idFromDOM);
                     } else {
                         console.warn("[LiveControl] Could not restart popup timer: normalizedId missing and not found in DOM.");
                     }
                }
            }
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
                this._updatePopupContent(this.markers[normalizedId], aircraftWithNormalizedId, normalizedId); // Pass normalizedId
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

    // --- NEW: Timer management functions ---
    _startPopupTimer: function(popup, normalizedId) {
        this._stopPopupTimer(normalizedId); // Clear existing timer first

        const popupElement = popup.getElement();
        if (!popupElement) return;

        const timeElement = popupElement.querySelector('.live-time-ago');
        if (!timeElement) return;

        const timestamp = parseInt(timeElement.getAttribute('data-timestamp'), 10);
        if (isNaN(timestamp)) return;

        // Update immediately
        timeElement.textContent = this._formatTimeAgo(timestamp);

        // Start interval - Capture the initial timestamp
        const initialTimestamp = timestamp;
        this.popupTimers[normalizedId] = setInterval(() => {
            // Check if element still exists (popup might have been closed/removed unexpectedly)
            // Use contains check on the popup element itself for robustness
            if (!popupElement || !document.body.contains(popupElement)) {
                this._stopPopupTimer(normalizedId);
                return;
            }
            // Calculate time difference based on the initial timestamp captured when the timer started
            timeElement.textContent = this._formatTimeAgo(initialTimestamp);

        }, 1000); // Update every second
    },

    _stopPopupTimer: function(normalizedId) {
        if (this.popupTimers[normalizedId]) {
            clearInterval(this.popupTimers[normalizedId]);
            delete this.popupTimers[normalizedId];
        }
    },

    _clearAllPopupTimers: function() {
        Object.keys(this.popupTimers).forEach(normalizedId => {
            this._stopPopupTimer(normalizedId);
        });
        this.popupTimers = {}; // Reset the object
    },
    // --- END NEW ---

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
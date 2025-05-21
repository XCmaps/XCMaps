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
        reconnectInterval: 5000, // 5 seconds for WebSocket reconnection
        subscriptionRetryInterval: 3000, // 3 seconds for subscription retry
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
        this.tracks = {}; // Stores { layer: L.Polyline, isLoading: boolean }
        this.activePopupOrder = []; // Track order of opened popups
        this.activePopupColors = {}; // Store assigned color per aircraft
        this.aircraftLayer = L.layerGroup();
        this.availableColors = [...this.options.trackHighlightColors]; // Initialize available colors
        this.trackLayer = L.layerGroup();
        this.refreshTimer = null;
        this.reconnectTimer = null; // Timer for WebSocket reconnection
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
        this._boundsSubscribed = false; // Flag to track if subscribed to bounds updates
        this.subscriptionRetryTimer = null; // Timer for retrying subscription

        // --- NEW: Live Settings State ---
        this._liveSettings = {
            isActive: true, // Default to active
            showResting: true,
            showHiking: true,
            showDriving: true
        };
        // --- END NEW ---
        this.popupTimers = {}; // Store interval IDs for updating popup times

        // Chart related properties
        this.altitudeChart = null;
        this.altitudeChartContainer = null;
        this.altitudeChartCanvas = null;
        this.chartVisible = false;
        this.chartData = {
            datasets: []
        };
        this.pilotTracksForChart = {}; // Store full track data { normalizedId: [trackPoints] } for pilots in chart
        this.selectedAircraft = null; // Track the last clicked aircraft ID
        this.chartHoverMarkers = {}; // Markers to show on map when hovering chart, keyed by aircraftId
    },

    onAdd: function(map) {
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
        L.DomEvent.on(container, 'click', this._handleControlClick, this);

        this._map = map;
        this._container = container;
        this._link = link;
        this._icon = img;

        this._fetchSvgs();

        // Get chart elements
        this.altitudeChartContainer = document.getElementById('altitudeChartContainer');
        this.altitudeChartCanvas = document.getElementById('altitudeChart');

        if (this.altitudeChartContainer && this.altitudeChartCanvas) {
            const closeButton = L.DomUtil.create('button', 'chart-close-button', this.altitudeChartContainer);
            closeButton.innerHTML = '&times;';
            L.DomEvent.on(closeButton, 'click', (e) => {
                L.DomEvent.stop(e);
                this._hideAltitudeChart(); // Visually hide the chart container

                // Close all aircraft popups
                Object.values(this.markers).forEach(marker => {
                    if (marker.isPopupOpen()) {
                        marker.closePopup();
                    }
                });

                // Clear all tracks from the map and internal state
                if (this.trackLayer) {
                    this.trackLayer.clearLayers();
                }
                this.tracks = {};

                // Clear pilot-specific data from the chart's data model
                this.chartData.datasets = []; // Remove all datasets (pilot lines and ground level)
                this.pilotTracksForChart = {}; // Clear cached track data used for chart

                // If the chart instance exists, update it to reflect the cleared data
                if (this.altitudeChart) {
                    this.altitudeChart.data.datasets = [];
                    this.altitudeChart.update('none'); // Update without animation
                }

                // Reset active popup tracking
                this.activePopupOrder = [];
                this.activePopupColors = {};

                // Reset selected aircraft
                this.selectedAircraft = null;

                Object.values(this.chartHoverMarkers).forEach(marker => marker.remove());
                this.chartHoverMarkers = {};
            }, this);
            this._hideAltitudeChart(); // Initially hidden
        } else {
            console.error("Altitude chart container or canvas not found in the DOM.");
        }

        return container;
    },

    _createOrUpdateAltitudeChart: function() {
        if (!this.altitudeChartCanvas) return;

        // 1. Filter pilot datasets to include only those currently selected and with data
        const pilotDatasetsToShow = this.chartData.datasets.filter(ds =>
            ds.label !== 'Ground' && // Exclude any previous groundLevel dataset
            this.activePopupOrder.includes(ds.label) &&
            this.pilotTracksForChart[ds.label] &&
            this.pilotTracksForChart[ds.label].length > 0
        );

        let finalDatasets = [...pilotDatasetsToShow];

        // 2. If exactly one pilot is selected, prepare and add ground level data
        if (pilotDatasetsToShow.length === 1) {
            const pilotDataset = pilotDatasetsToShow[0];
            const aircraftId = pilotDataset.label;
            const originalTrackData = this.pilotTracksForChart[aircraftId];

            if (originalTrackData) {
                const groundLevelPoints = originalTrackData.map(point => {
                    const alt_msl = point.last_alt_msl ?? point.alt_msl;
                    const alt_agl = point.alt_agl ?? point.agl; // Altitude Above Ground Level - Added fallback to point.agl

                    if (typeof alt_msl === 'number' && !isNaN(alt_msl) &&
                        typeof alt_agl === 'number' && !isNaN(alt_agl)) {
                        const num_alt_msl = Number(alt_msl);
                        const num_alt_agl = Number(alt_agl);
                        return {
                            x: new Date(point.timestamp || point.last_fix_epoch * 1000),
                            y: num_alt_msl - num_alt_agl
                        };
                    }
                    return null;
                }).filter(p => p !== null && typeof p.y === 'number' && !isNaN(p.y))
                  .sort((a, b) => a.x - b.x);

                if (groundLevelPoints.length > 0) {
                    const groundLevelDataset = {
                        label: 'Ground',
                        data: groundLevelPoints,
                        borderColor: 'transparent', // No border for the fill area
                        backgroundColor: '#ddb88b', // Specified fill color
                        fill: 'origin', // Fill from y=0 up to the data points
                        tension: 0.4, // Increased for smoother ground fill
                        pointRadius: 0, // No points on the ground line
                        order: 1 // Draw ground fill first
                    };
                    finalDatasets.push(groundLevelDataset);
                }
            }
        }

        // If no datasets with actual data points remain, hide the chart
        const hasDataPoints = finalDatasets.some(ds => ds.data && ds.data.length > 0);
        if (!hasDataPoints) {
            this._hideAltitudeChart();
            if (this.altitudeChart) {
                this.altitudeChart.destroy();
                this.altitudeChart = null;
            }
            return;
        }

        // Sort datasets by 'order' to ensure correct drawing sequence (lower order drawn first)
        finalDatasets.sort((a, b) => (a.order || 0) - (b.order || 0));

        if (this.altitudeChart) {
            this.altitudeChart.data.datasets = finalDatasets;
            this.altitudeChart.options.scales.y.suggestedMin = this._calculateChartYMin(finalDatasets);
            this.altitudeChart.options.scales.y.suggestedMax = this._calculateChartYMax(finalDatasets);
            this.altitudeChart.options.scales.x.max = this._calculateChartXMax(finalDatasets);
            this.altitudeChart.update('none'); // Disable animations for a direct update
        } else {
            const config = {
                type: 'line',
                data: { datasets: finalDatasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    hover: { // Added to make Chart.js apply hoverRadius based on index
                        mode: 'index',
                        intersect: false,
                        animationDuration: 0 // Disable animation for faster hover response
                    },
                    scales: {
                        x: {
                            type: 'time',
                            time: {
                                unit: 'second',
                                tooltipFormat: 'HH:mm:ss', // Keep detailed time in tooltip
                                displayFormats: {
                                    second: 'HH:mm', // Only show HH:mm on axis labels
                                    minute: 'HH:mm'
                                },
                                stepSize: 5
                                // Using 'second' as the unit for data points but only showing HH:mm on axis
                            },
                            title: { display: false },
                            ticks: {
                                source: 'auto',
                                maxRotation: 0,
                                autoSkip: true,
                                maxTicksLimit: 6 // Limit to 6 total time labels for better mobile readability
                            },
                            max: this._calculateChartXMax(finalDatasets)
                        },
                        y: {
                            title: { display: false },
                            beginAtZero: false, // Ground level might be negative in some terrains
                            suggestedMin: this._calculateChartYMin(finalDatasets),
                            suggestedMax: this._calculateChartYMax(finalDatasets),
                            ticks: {
                                stepSize: 500,
                                callback: function(value, index, ticks) {
                                    return value.toLocaleString() + 'm';
                                }
                            }
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            enabled: true,
                            mode: 'index',
                            intersect: false,
                            position: 'nearest',
                            callbacks: {
                                label: function(tooltipItem) {
                                    const dataset = tooltipItem.chart.data.datasets[tooltipItem.datasetIndex];
                                    const displayName = dataset.displayName || dataset.label;
                                    let label = displayName || '';
                                    if (label) {
                                        label += ': ';
                                    }
                                    if (tooltipItem.parsed.y !== null) {
                                        label += tooltipItem.parsed.y.toLocaleString() + 'm';
                                    }
                                    return label;
                                }
                            }
                        }
                    },
                    elements: {
                        point: {
                            radius: function(context) {
                                // Only show points when hovered
                                return context.active ? 5 : 0;
                            },
                            hoverRadius: 6, // Larger hover radius for better visibility
                            hitRadius: 15, // Even larger hit area for easier hover
                            hoverBackgroundColor: '#FFFFFF',
                            borderWidth: 2
                        },
                        line: {
                            tension: 0.4
                        }
                    },
                    interaction: {
                        mode: 'index',
                        intersect: false
                    },
                    onHover: (event, activeElements, chart) => {
                        if (!this._map) {
                            return;
                        }

                        const newHoveredAircraftIds = new Set();
                        let dataPointIndex = -1;
                        let isPointerInCanvas = false; // Initialize to false by default

                        // Determine the dataPointIndex from the event, using Chart.js's utility
                        if (event.native) {
                            if (!chart.canvas) {
                                return;
                            }
                            const canvasRect = chart.canvas.getBoundingClientRect();
                            if (!canvasRect) {
                                return;
                            }
                            
                            // Handle both mouse and touch events
                            let clientX, clientY;
                            
                            if (event.native.type.startsWith('touch')) {
                                // For touch events, get coordinates from changedTouches
                                if (event.native.changedTouches && event.native.changedTouches.length > 0) {
                                    clientX = event.native.changedTouches[0].clientX;
                                    clientY = event.native.changedTouches[0].clientY;
                                } else if (event.native.touches && event.native.touches.length > 0) {
                                    clientX = event.native.touches[0].clientX;
                                    clientY = event.native.touches[0].clientY;
                                } else {
                                    console.error("[Chart Hover] Touch event without valid touch coordinates");
                                    return;
                                }
                            } else {
                                // For mouse events, use clientX/Y directly
                                clientX = event.native.clientX;
                                clientY = event.native.clientY;
                            }
                            
                            // Ensure we have valid numbers
                            clientX = Number(clientX);
                            clientY = Number(clientY);

                            if (isNaN(clientX) || isNaN(clientY)) {
                                return;
                            }

                            // Update the outer scope variable
                            isPointerInCanvas = clientX >= canvasRect.left &&
                                              clientX <= canvasRect.right &&
                                              clientY >= canvasRect.top &&
                                              clientY <= canvasRect.bottom;

                            if (isPointerInCanvas) {
                                try {
                                    // Create a synthetic event with the correct properties for Chart.js
                                    const syntheticEvent = {
                                        type: 'mousemove', // Use mousemove type for consistent behavior
                                        clientX: clientX,
                                        clientY: clientY,
                                        target: chart.canvas
                                    };
                                    
                                    const elementsAtEvent = chart.getElementsAtEventForMode(
                                        syntheticEvent,
                                        'index',
                                        { intersect: false },
                                        true
                                    );
                                    
                                    if (elementsAtEvent && elementsAtEvent.length > 0) {
                                        dataPointIndex = elementsAtEvent[0].index;
                                    }
                                } catch (e) {
                                    // Silent error handling
                                }
                            }
                        }

                        if (dataPointIndex !== -1) {
                            // First, activate points on ALL datasets at the same index
                            // This ensures all elevation lines show points at the same x-position
                            chart.data.datasets.forEach((dataset) => {
                                // Include all datasets except Ground
                                if (dataset.label === 'Ground' || !dataset.data) {
                                    return;
                                }
                                
                                // Make sure we have data at this index
                                if (dataset.data[dataPointIndex]) {
                                    try {
                                        // For Chart.js v3, we need to manually set the active state
                                        const meta = dataset._meta;
                                        if (meta && chart.id && meta[chart.id] && meta[chart.id].data &&
                                            meta[chart.id].data[dataPointIndex]) {
                                            meta[chart.id].data[dataPointIndex].hidden = false;
                                            meta[chart.id].data[dataPointIndex].active = true;
                                        }
                                    } catch (e) {
                                        // Silent error handling
                                    }
                                }
                            });
                            
                            // Now handle map markers for datasets that have lat/lon data
                            chart.data.datasets.forEach((dataset) => {
                                // Skip the 'Ground' dataset and any dataset that doesn't have data at this specific index
                                if (dataset.label === 'Ground' || !dataset.data || !dataset.data[dataPointIndex]) {
                                    return;
                                }

                                const aircraftId = dataset.label; // This is the normalizedId
                                const chartPoint = dataset.data[dataPointIndex];

                                // Ensure the point has lat/lon before creating/updating a marker
                                if (chartPoint && typeof chartPoint.lat === 'number' && typeof chartPoint.lon === 'number') {
                                    newHoveredAircraftIds.add(aircraftId);
                                    const latLng = L.latLng(chartPoint.lat, chartPoint.lon);

                                    if (this.chartHoverMarkers[aircraftId]) {
                                        this.chartHoverMarkers[aircraftId].setLatLng(latLng);
                                        if (!this._map.hasLayer(this.chartHoverMarkers[aircraftId])) {
                                            this.chartHoverMarkers[aircraftId].addTo(this._map);
                                        }
                                    } else {
                                        this.chartHoverMarkers[aircraftId] = L.circleMarker(latLng, {
                                            radius: 6,
                                            color: dataset.borderColor || '#FF5500',
                                            weight: 2,
                                            fillColor: '#FFFFFF',
                                            fillOpacity: 0.9, // User's preference
                                            pane: 'markerPane'
                                        }).addTo(this._map);
                                    }
                                }
                            });
                        }

                        // Remove markers for aircraft that are no longer at the current hover index
                        // (i.e., their ID is not in newHoveredAircraftIds after processing the current index)
                        Object.keys(this.chartHoverMarkers).forEach(aircraftId => {
                            if (!newHoveredAircraftIds.has(aircraftId)) {
                                this.chartHoverMarkers[aircraftId].remove();
                                delete this.chartHoverMarkers[aircraftId];
                            }
                        });

                        // If pointer is out of chart canvas, ensure all markers are cleared
                        if (!isPointerInCanvas) {
                            if (Object.keys(this.chartHoverMarkers).length > 0) {
                                Object.values(this.chartHoverMarkers).forEach(marker => marker.remove());
                                this.chartHoverMarkers = {};
                            }
                            // Also hide tooltip when pointer leaves chart
                            if (chart.tooltip) {
                                try {
                                    chart.tooltip.setActiveElements([], { x: 0, y: 0 });
                                    chart.update('none');
                                } catch (e) {
                                    // Silent error handling
                                }
                            }
                        } else {
                            // If pointer is inside, but no valid dataPointIndex was found (e.g., hover over empty chart area)
                            if (dataPointIndex === -1 && Object.keys(this.chartHoverMarkers).length > 0) {
                                Object.values(this.chartHoverMarkers).forEach(marker => marker.remove());
                                this.chartHoverMarkers = {};
                            } else if (dataPointIndex !== -1) {
                                // Force chart to redraw with active points
                                chart.update('none');
                                try {
                                    // Explicitly show tooltip at the current index position
                                    const activeElements = [];
                                    chart.data.datasets.forEach((dataset, datasetIndex) => {
                                        if (dataset.label !== 'Ground' && dataset.data && dataset.data[dataPointIndex]) {
                                            activeElements.push({
                                                datasetIndex: datasetIndex,
                                                index: dataPointIndex
                                            });
                                        }
                                    });
                                    
                                    if (activeElements.length > 0 && chart.tooltip) {
                                        // First try the standard Chart.js v3 approach
                                        try {
                                            chart.tooltip.setActiveElements(activeElements, {
                                                x: clientX,
                                                y: clientY
                                            });
                                        } catch (e) {
                                            
                                            // Alternative approach - manually trigger tooltip
                                            const evt = new MouseEvent('mousemove', {
                                                clientX: clientX,
                                                clientY: clientY,
                                                bubbles: true,
                                                cancelable: true,
                                                view: window
                                            });
                                            chart.canvas.dispatchEvent(evt);
                                        }
                                        
                                        // Force update with no animation
                                        chart.update('none');
                                    }
                                } catch (e) {
                                    // Silent error handling
                                }
                            }
                        }
                    } // This closes the onHover function body
            } // This closes options
            }; // This closes config
            this.altitudeChart = new Chart(this.altitudeChartCanvas, config);
        }
    },

    _calculateChartYMin: function(datasets) {
        let minAlt = Infinity;
        datasets.forEach(dataset => {
            dataset.data.forEach(point => {
                if (point.y < minAlt) minAlt = point.y;
            });
        });
        // Add 100m padding below, then round down to nearest 500, ensuring it's not negative.
        const yMinCalc = Math.floor((minAlt - 100) / 500) * 500;
        return datasets.length > 0 ? Math.max(0, yMinCalc) : 0;
    },

    _calculateChartYMax: function(datasets) {
        let maxAlt = -Infinity;
        datasets.forEach(dataset => {
            dataset.data.forEach(point => {
                if (point.y > maxAlt) maxAlt = point.y;
            });
        });
        // Add 200m padding above, then round up to nearest 500, ensuring it's at least 500.
        const yMaxCalc = Math.ceil((maxAlt + 200) / 500) * 500;
        // Ensure that if there's data, the max is at least 500. If no data, default to 500.
        // Also, ensure yMax is greater than yMin (which is handled by Chart.js if min > max, but good to be logical)
        // The primary goal is that yMax itself is at least 500.
        let resultYMax = datasets.length > 0 ? Math.max(500, yMaxCalc) : 500;

        // Ensure there's at least a 500m span if yMin is calculated and is close to yMax
        const yMin = this._calculateChartYMin(datasets); // Recalculate yMin to compare
        if (resultYMax < yMin + 500 && datasets.length > 0) { // only adjust if there's data
            resultYMax = yMin + 500;
        }
        // Final check to ensure it's at least 500, especially if yMin + 500 was still less (e.g. yMin = -200 after some error)
        return Math.max(500, resultYMax);
    },

    _calculateChartXMax: function(/* datasets */) {
        // The right border of the chart should be 1o minutes after the current time.
        // This ensures that 'now' (the current time) is 10 minutes from the right edge.
        return Date.now() + 10 * 60 * 1000;
    },

    _showAltitudeChart: function() {
        console.log("[Show Chart] Function called."); // Log function entry
        if (!this.altitudeChartContainer) {
             console.log("[Show Chart] No chart container found.");
             return;
        }
        // Check dataset count *before* checking visibility flag
        if (this.chartData.datasets.length === 0) {
             console.log("[Show Chart] No datasets to display, aborting show.");
             // If it was visible, hide it now
             if (this.chartVisible) this._hideAltitudeChart();
             return; // Don't show if there's no data
         }

        if (this.chartVisible) {
            console.log("[Show Chart] Chart already visible, updating.");
            this._createOrUpdateAltitudeChart(); // Ensure update even if already visible
            return;
        }

        console.log("[Show Chart] Making chart visible.");
        this.altitudeChartContainer.style.display = 'flex';
        // Use requestAnimationFrame for smoother transition start
        requestAnimationFrame(() => {
            this.altitudeChartContainer.classList.remove('hidden');
        });


        this.chartVisible = true;
        console.log("[Show Chart] Creating/Updating Chart instance.");
        this._createOrUpdateAltitudeChart();

        // Adjust map position smoothly
        // Use a short timeout after starting the transition to allow the browser to calculate height
        setTimeout(() => {
            const chartHeight = this.altitudeChartContainer.offsetHeight;
            console.log(`[Show Chart] Calculated chart height after timeout: ${chartHeight}px`);
            if (chartHeight > 0) {
                this._map.getContainer().style.transition = 'padding-bottom 0.3s ease-in-out';
                this._map.getContainer().style.paddingBottom = chartHeight + 'px';
                console.log("[Show Chart] Invalidating map size.");
                this._map.invalidateSize({ animate: true }); // Animate map resize

                // Pan map up if active marker is obscured
                if (this.selectedAircraft && this.markers[this.selectedAircraft]) {
                    const marker = this.markers[this.selectedAircraft];
                    if (this._map.hasLayer(marker)) {
                        const markerPoint = this._map.latLngToContainerPoint(marker.getLatLng());
                        const mapHeight = this._map.getSize().y;

                        console.log(`[Show Chart] Marker Y: ${markerPoint.y}, Map Height: ${mapHeight}, Chart Height: ${chartHeight}`);
                        if (markerPoint.y > mapHeight - chartHeight - 30) {
                            const diff = (mapHeight - chartHeight - 30) - markerPoint.y;
                            console.log(`[Show Chart] Panning map by [0, ${diff}]`);
                            this._map.panBy([0, diff], { animate: true, duration: 0.3 });
                        }
                    } else {
                         console.log("[Show Chart] Selected marker no longer on map, skipping pan.");
                    }
                }
            } else {
                 console.warn("[Show Chart] Chart height is still 0 after timeout, skipping map padding adjustment.");
            }
        }, 50); // 50ms delay - adjust if needed
    },

    _hideAltitudeChart: function() {
        if (!this.altitudeChartContainer || !this.chartVisible) return;

        this.altitudeChartContainer.classList.add('hidden');
        setTimeout(() => {
            // Only set display:none if it's still supposed to be hidden
            if (this.altitudeChartContainer.classList.contains('hidden')) {
                 this.altitudeChartContainer.style.display = 'none';
            }
        }, 300); // Match CSS transition

        this.chartVisible = false;

        // Reset map position smoothly
        this._map.getContainer().style.paddingBottom = '0px';
        this._map.invalidateSize({ animate: true }); // Animate map resize

        Object.values(this.chartHoverMarkers).forEach(marker => marker.remove());
        this.chartHoverMarkers = {};
    },

    _addPilotDataToChart: function(aircraftId, trackData, color, displayName) {
        if (!trackData || trackData.length === 0) {
            console.log(`No track data for ${displayName || aircraftId} to add to chart.`);
            return;
        }

        const existingDatasetIndex = this.chartData.datasets.findIndex(ds => ds.label === aircraftId);

        // Filter trackData to include only points with valid altitude before mapping
        const validAltitudePoints = trackData.filter(point => {
            // Check common altitude field names: last_alt_msl (from live updates), alt_msl (from DB track)
            const alt = point.last_alt_msl ?? point.alt_msl;
            return typeof alt === 'number' && !isNaN(alt); // Check if it's a valid number
        });

        if (validAltitudePoints.length === 0) {
             console.log(`[Chart Data] No points with valid 'last_alt_msl' or 'alt_msl' found for ${displayName || aircraftId}.`);
             if (existingDatasetIndex > -1) {
                 this.chartData.datasets.splice(existingDatasetIndex, 1);
                 console.log(`[Chart Data] Removed dataset for ${displayName || aircraftId} due to lack of valid points.`);
                 if (this.chartVisible) this._createOrUpdateAltitudeChart();
             }
             return;
        } else {
             console.log(`[Chart Data] Found ${validAltitudePoints.length} points with valid altitude for ${displayName || aircraftId}.`);
        }

        // Further filter to ensure we have a range, and not just 0s if those are not desired.
        // For now, let's assume any valid number is okay to plot to see if data comes through.
        // If 0 altitude is still an issue, we can add a > 0 filter here later.

        const newPoints = validAltitudePoints.map(point => {
            const altValue = point.last_alt_msl ?? point.alt_msl;
            // Convert to number, removing potential commas
            const numericAlt = typeof altValue === 'string'
                ? parseFloat(altValue.replace(/,/g, ''))
                : altValue; // Assume it's already a number if not a string

            // Ensure it's a valid number after parsing
            if (isNaN(numericAlt)) {
                 console.warn(`[Chart Data] Failed to parse altitude for point:`, point);
                 return null; // Skip points that can't be parsed to a valid number
            }

            const lat = point.lat ?? point.last_lat;
            const lon = point.lon ?? point.last_lon;

            // Skip point if essential data (lat, lon, alt, time) is missing
            if (typeof lat !== 'number' || typeof lon !== 'number' ||
                isNaN(numericAlt) || !(point.timestamp || point.last_fix_epoch)) {
                 console.warn(`[Chart Data] Skipping point due to missing essential data (lat/lon/alt/time):`, point);
                 return null;
            }

            return {
                x: new Date(point.timestamp || point.last_fix_epoch * 1000),
                y: numericAlt,
                lat: lat,
                lon: lon
            };
        }).filter(p => p !== null) // Remove any points that failed parsing or missing essential data
          .sort((a, b) => a.x - b.x);

        // Check again if we still have points after potential parsing failures
        if (newPoints.length === 0) {
             console.log(`[Chart Data] No valid numeric altitude points found for ${displayName || aircraftId} after parsing.`);
             if (existingDatasetIndex > -1) {
                 this.chartData.datasets.splice(existingDatasetIndex, 1);
                 if (this.chartVisible) this._createOrUpdateAltitudeChart();
             }
             return;
        }

        if (existingDatasetIndex > -1) {
            this.chartData.datasets[existingDatasetIndex].data = newPoints;
            this.chartData.datasets[existingDatasetIndex].borderColor = color;
            this.chartData.datasets[existingDatasetIndex].backgroundColor = color + '33';
            this.chartData.datasets[existingDatasetIndex].displayName = displayName || aircraftId;
        } else {
            this.chartData.datasets.push({
                label: aircraftId, // Keep original ID for internal tracking
                displayName: displayName || aircraftId, // For display in tooltip
                data: newPoints,
                borderColor: color,
                backgroundColor: color + '33', // For pilot's line, if fill was true
                fill: false, // Pilot line itself is not filled by default
                tension: 0.4, // Keep increased for smoother curve
                cubicInterpolationMode: 'monotone', // Added for smoother line drawing
                order: 2 // Draw pilot line on top of ground fill (ground is order 1)
            });
        }
        // Ensure the raw track data is also stored/updated
        this.pilotTracksForChart[aircraftId] = trackData; // Store original track data with potentially missing alts

        // Update the chart if it's currently visible
        if (this.chartVisible) {
            this._createOrUpdateAltitudeChart();
        }
    },

    _removePilotDataFromChart: function(aircraftId) {
        this.chartData.datasets = this.chartData.datasets.filter(ds => ds.label !== aircraftId);
        delete this.pilotTracksForChart[aircraftId]; // Remove cached track data

        // Update the chart if it's visible, or hide it if no datasets remain
        if (this.chartVisible) {
            if (this.chartData.datasets.length === 0) {
                this._hideAltitudeChart();
            } else {
                this._createOrUpdateAltitudeChart();
            }
        }
    },

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
             if (this.active) {
                 // If live mode is active, trigger an update to potentially redraw icons
                 // that might have been placeholders initially.
                 // A simple way is to re-process existing markers.
                 Object.values(this.markers).forEach(marker => {
                     if (marker.options.aircraftData) {
                         this._updateMarkerIcon(marker, marker.options.aircraftData);
                     }
                 });
             }
        });
    },

    onRemove: function(map) {
        this._deactivateLive();
        L.DomEvent.off(this._container, 'click', this._handleControlClick, this);

        // Destroy chart
        if (this.altitudeChart) {
            this.altitudeChart.destroy();
            this.altitudeChart = null;
        }
        // Ensure chart container is hidden and map padding reset if control removed while chart visible
        if (this.altitudeChartContainer) {
             this.altitudeChartContainer.style.display = 'none';
             this.altitudeChartContainer.classList.add('hidden');
        }
        this._map.getContainer().style.paddingBottom = '0px';
        this._map.invalidateSize();

        Object.values(this.chartHoverMarkers).forEach(marker => marker.remove());
        this.chartHoverMarkers = {};
    },

    _handleControlClick: function(e) {
        L.DomEvent.stop(e);
        if (this.active) {
            if (this._configBadgeOpen) this._closeConfigBadge();
            else this._showConfigBadge();
        } else {
            this._activateLive();
        }
    },

    _activateLive: function() {
        if (this.active) return;
        console.log("Activating Live Mode");
        this.active = true;
        this._liveSettings.isActive = true;
        this._icon.src = this.options.activeIcon;
        this._container.classList.add('live-active');

        this.aircraftLayer.addTo(this._map);
        this.trackLayer.addTo(this._map);

        // Clear previous state
        this.aircraftLayer.clearLayers();
        this.trackLayer.clearLayers(); // Also clear tracks
        this.markers = {};
        this.tracks = {};
        this.lastUpdateTimestamps = {};
        this.activePopupOrder = [];
        this.activePopupColors = {};
        this.chartData.datasets = []; // Clear chart data
        this.pilotTracksForChart = {}; // Clear cached tracks
        if (this.chartVisible) this._hideAltitudeChart(); // Hide chart if open

        // Fetch recent aircraft data first
        this._fetchRecentAircraftData().then(() => {
            // Connect to WebSocket after recent data is processed
            this._connectWebSocket();
            // Note: 'moveend' listener is now attached within _connectWebSocket upon successful connection
        }).catch(error => {
            console.error("Failed to load recent aircraft, proceeding with WebSocket:", error);
            // Still connect to WebSocket even if recent data fails
            this._connectWebSocket();
            // Note: 'moveend' listener is now attached within _connectWebSocket upon successful connection
        });

        if (this._configBadgeOpen && this._configContainer) {
            const mainToggle = this._configContainer.querySelector('#live-toggle-main');
            if (mainToggle && !mainToggle.checked) mainToggle.checked = true;
        }
         document.dispatchEvent(new CustomEvent('xcmaps-preferences-changed'));
    },

    _deactivateLive: function() {
        if (!this.active) return;
        console.log("Deactivating Live Mode");
        this.active = false;
        this._liveSettings.isActive = false;
        this._icon.src = this.options.inactiveIcon;
        this._container.classList.remove('live-active');

        if (this._configBadgeOpen) this._closeConfigBadge();
        this._clearAllPopupTimers();
        this._disconnectWebSocket(); // This will also clear reconnectTimer and subscriptionRetryTimer
        this._map.off('moveend', this._updateBounds, this);

        // Clear state and layers
        this.lastUpdateTimestamps = {};
        this._map.removeLayer(this.aircraftLayer);
        this._map.removeLayer(this.trackLayer);
        this.aircraftLayer.clearLayers();
        this.trackLayer.clearLayers();
        this.markers = {};
        this.tracks = {};
        this.activePopupOrder = [];
        this.activePopupColors = {};
        this.chartData.datasets = []; // Clear chart data
        this.pilotTracksForChart = {}; // Clear cached tracks
        if (this.chartVisible) this._hideAltitudeChart(); // Hide chart
        this.selectedAircraft = null;

        if (this._configBadgeOpen && this._configContainer) {
            const mainToggle = this._configContainer.querySelector('#live-toggle-main');
            if (mainToggle && mainToggle.checked) mainToggle.checked = false;
        }
         document.dispatchEvent(new CustomEvent('xcmaps-preferences-changed'));
    },

    _connectWebSocket: function() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        // More robust check for existing socket
        if (this.socket && (this.socket.connected || this.socket.connecting)) {
            console.log(`WebSocket already exists and is ${this.socket.connected ? 'connected' : 'connecting'}. Socket ID: ${this.socket.id}`);
            return;
        } else if (this.socket) {
            console.log(`Stale WebSocket instance found (ID: ${this.socket.id}, connected: ${this.socket.connected}). Disconnecting before creating a new one.`);
            this.socket.disconnect();
            this.socket = null;
        }

        console.log("Attempting to establish a new WebSocket connection...");
        this.usingWebSocket = false;
        this.usingRESTFallback = false;

        this.socket = io('/ogn'); // Connect to OGN namespace

        this.socket.on('connect', () => {
            console.log(`WebSocket 'connect' event. Socket ID: ${this.socket.id}, Connected: ${this.socket.connected}`);
            this._boundsSubscribed = false; // Ensure re-subscription on any new connection
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            if (this.usingRESTFallback) {
                console.log("WebSocket reconnected, stopping REST fallback.");
                this.usingRESTFallback = false;
                if (this.refreshTimer) {
                    clearInterval(this.refreshTimer);
                    this.refreshTimer = null;
                }
                // Clear existing markers from REST and request full update from WebSocket
                this.aircraftLayer.clearLayers();
                this.markers = {};
                // Tracks and chart data are typically re-fetched on popup, but consider clearing if necessary
            } else if (this.refreshTimer) { // If not in REST fallback but somehow refreshTimer is active
                clearInterval(this.refreshTimer);
                this.refreshTimer = null;
            }

            this.usingWebSocket = true;
            this._attemptSubscriptionAndDataRequest(); // Start attempting to subscribe
        });

        this.socket.on('disconnect', (reason) => {
            console.log("Disconnected from WebSocket server. Reason:", reason);
            this.usingWebSocket = false;
            this.socket = null; // Ensure socket is nullified
            this._boundsSubscribed = false; // Reset subscription flag
            if (this.active) {
                // Always try to reconnect if active, regardless of REST fallback status
                console.log(`Attempting to reconnect WebSocket in ${this.options.reconnectInterval / 1000} seconds...`);
                this._tryReconnect();
            }
        });

        this.socket.on('connect_error', (error) => {
            console.error("WebSocket connection error:", error);
            this.usingWebSocket = false;
            this.socket = null; // Ensure socket is nullified
            this._boundsSubscribed = false; // Reset subscription flag
            if (this.active) {
                // Always try to reconnect if active, regardless of REST fallback status
                console.log(`Attempting to reconnect WebSocket due to connection error in ${this.options.reconnectInterval / 1000} seconds...`);
                this._tryReconnect();
            }
        });

        // Handle initial full aircraft data dump
        this.socket.on('aircraft-init', (data) => {
            if (!this.usingWebSocket) return;
            console.log("Received initial aircraft data:", data.length);
            this.aircraftLayer.clearLayers(); // Clear before full update
            this.markers = {};
            this._updateAircraft(data); // Process the full list
        });

        // Handle single aircraft updates
        this.socket.on('aircraft-update', (data) => {
            if (!this.usingWebSocket) return;
            this._updateSingleAircraft(data);
        });

        // Main listener for track data (WebSocket)
        this.socket.on('track-data', (data) => {
            if (!this.usingWebSocket) return;
            console.log("[WS Track Data] Received track data for:", data.aircraftId);
            const normalizedId = this._normalizeAircraftId(data.aircraftId);

            const trackInfo = this.tracks[normalizedId];
            const isRequested = this.activePopupOrder.includes(normalizedId);

            if (isRequested && trackInfo) {
                 console.log(`[WS Track Data] Processing track for selected pilot: ${normalizedId}`);
                 trackInfo.isLoading = false;

                 if (data.track && data.track.length > 0) {
                    const assignedColor = this.activePopupColors[normalizedId] || this.options.trackColor;
                     // Ensure track points have necessary data
                     const processedTrackData = data.track.map(p => ({
                         ...p,
                         last_lat: p.last_lat ?? p.lat,
                         last_lon: p.last_lon ?? p.lon,
                         last_alt_msl: p.last_alt_msl ?? p.altMsl, // No default 0
                         timestamp: p.timestamp || p.last_fix_epoch * 1000 || Date.now()
                     })).filter(p => p.last_lat !== undefined && p.last_lon !== undefined);

                     if (processedTrackData.length > 0) {
                         this.pilotTracksForChart[normalizedId] = processedTrackData;
                         this._displayAircraftTrack(normalizedId, processedTrackData, assignedColor);
                         this._addPilotDataToChart(normalizedId, processedTrackData, assignedColor);
                         if (this.chartData.datasets.length > 0) {
                             console.log("[WS Track Data] Attempting to show chart after receiving data.");
                             this._showAltitudeChart();
                         }
                     } else {
                          console.log(`[WS Track Data] No valid track points after processing for ${normalizedId}`);
                          this._removePilotDataFromChart(normalizedId);
                     }
                 } else {
                     console.log(`[WS Track Data] No track data in payload for ${normalizedId}`);
                     this._removePilotDataFromChart(normalizedId);
                 }
            } else if (this.pilotTracksForChart[normalizedId]) {
                 // Handle updates for tracks already displayed but maybe not the primary selected one
                 console.log(`[WS Track Data] Updating existing non-selected track/chart data for ${normalizedId}`);
                 const color = this.activePopupColors[normalizedId] || this.options.trackColor;
                 this.pilotTracksForChart[normalizedId] = data.track; // Update cache (might need processing like above)
                 this._displayAircraftTrack(normalizedId, data.track, color); // Update polyline
                 this._addPilotDataToChart(normalizedId, data.track, color); // Update chart
            } else {
                 console.log(`[WS Track Data] Ignoring track data for non-selected/non-tracked pilot: ${normalizedId}`);
            }
        });
    },

    _startRESTFallback: function() {
        if (this.usingRESTFallback) return;
        console.log("Starting REST API fallback mode");
        this.usingRESTFallback = true;
        this.usingWebSocket = false;

        // Clear existing markers before switching data sources
        this.aircraftLayer.clearLayers();
        this.markers = {};

        this._fetchAircraftDataREST(); // Fetch immediately
        if (!this.refreshTimer) {
            this.refreshTimer = setInterval(() => {
                this._fetchAircraftDataREST();
            }, this.options.refreshInterval);
        }
    },

    _disconnectWebSocket: function() {
        if (this.socket) {
            console.log("Disconnecting from WebSocket server");
            this.socket.disconnect();
            this.socket = null;
        }
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.subscriptionRetryTimer) {
            clearTimeout(this.subscriptionRetryTimer);
            this.subscriptionRetryTimer = null;
        }
        this.usingWebSocket = false;
        this.usingRESTFallback = false;
    },

    _attemptSubscriptionAndDataRequest: function() {
        if (this.subscriptionRetryTimer) {
            clearTimeout(this.subscriptionRetryTimer);
            this.subscriptionRetryTimer = null;
        }

        const socketId = this.socket ? this.socket.id : 'null';
        const socketConnected = this.socket ? this.socket.connected : 'N/A';
        const mapReady = !!this._map;
        console.log(`_attemptSubscriptionAndDataRequest: Socket ID: ${socketId}, Connected: ${socketConnected}, Map Ready: ${mapReady}, Live Active: ${this.active}`);

        if (this.socket && this.socket.connected && this._map && this.active) {
            console.log(`Conditions met for subscription. Socket ID: ${this.socket.id}`);
            const bounds = this._map.getBounds();
            const boundsData = {
                nwLat: bounds.getNorthWest().lat,
                nwLng: bounds.getNorthWest().lng,
                seLat: bounds.getSouthEast().lat,
                seLng: bounds.getSouthEast().lng
            };
            this.socket.emit('subscribe', boundsData);
            this._boundsSubscribed = true; // Mark as subscribed
            console.log("Emitted 'subscribe' with current bounds.");

            this.socket.emit('request-full-update');
            console.log("Requested full aircraft update.");

            // Attach moveend listener now that initial connection and subscription are done
            this._map.off('moveend', this._updateBounds, this); // Remove if already attached
            this._map.on('moveend', this._updateBounds, this);
            console.log("Attached 'moveend' listener for map bounds updates.");
        } else {
            console.warn(`Subscription attempt failed: Socket ID: ${socketId}, Connected: ${socketConnected}, Map Ready: ${mapReady}, Live Active: ${this.active}. Retrying in ${this.options.subscriptionRetryInterval / 1000}s.`);
            if (this.active) { // Only retry if live mode is still active
                this.subscriptionRetryTimer = setTimeout(() => {
                    this._attemptSubscriptionAndDataRequest();
                }, this.options.subscriptionRetryInterval);
            }
        }
    },

    _tryReconnect: function() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        // Try to reconnect if live mode is active and there's no current socket connection.
        // This will now also run if REST fallback is active, allowing WebSocket to take over.
        if (this.active && (!this.socket || !this.socket.connected)) {
            console.log("Scheduling WebSocket reconnection attempt...");
            this.reconnectTimer = setTimeout(() => {
                // Double check conditions before actually connecting
                if (this.active && (!this.socket || !this.socket.connected)) {
                    console.log("Executing scheduled WebSocket reconnection attempt.");
                    this._connectWebSocket();
                } else {
                    console.log("Scheduled WebSocket reconnection cancelled (conditions no longer met).");
                }
            }, this.options.reconnectInterval);
        } else if (!this.active) {
            console.log("Reconnect attempt skipped: Live mode is not active.");
        } else if (this.socket && this.socket.connected) {
            console.log("Reconnect attempt skipped: WebSocket is already connected.");
        }
    },

    _updateBounds: function() {
        if (!this.active) return;

        const bounds = this._map.getBounds();
        const boundsData = {
            nwLat: bounds.getNorthWest().lat,
            nwLng: bounds.getNorthWest().lng,
            seLat: bounds.getSouthEast().lat,
            seLng: bounds.getSouthEast().lng
        };

        if (this.usingWebSocket && this.socket && this.socket.connected) {
            // Send bounds update to server
            this.socket.emit('update-bounds', boundsData);
            // Subscribe if not already (e.g., on initial connect)
            if (!this._boundsSubscribed) {
                 this.socket.emit('subscribe', boundsData);
                 this._boundsSubscribed = true; // Assume subscription succeeds
                 console.log("Emitted 'subscribe' with current bounds upon re(connection).");
            }
        } else if (this.usingRESTFallback) {
            // Trigger REST fetch if using fallback
            this._fetchAircraftDataREST();
        }
    },

    _fetchRecentAircraftData: function() {
        console.log("Fetching recent aircraft data (last 15 minutes)");
        const url = `/api/ogn/aircraft/recent?minutes=15`; // Assuming this endpoint exists

        return fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                console.log("Received recent aircraft data:", data.length);
                this._updateAircraft(data); // Process the recent aircraft
            })
            .catch(error => {
                console.error('Error fetching recent aircraft data:', error);
                // Optionally, re-throw or handle as needed if you want to stop _activateLive
                throw error; // Re-throw to be caught by the caller in _activateLive
            });
    },

    _fetchAircraftDataREST: function() {
        if (!this.active || !this.usingRESTFallback) return;
        console.log("Fetching aircraft data via REST API (fallback)");
        const bounds = this._map.getBounds();
        const url = `/api/ogn/aircraft?nwLat=${bounds.getNorthWest().lat}&nwLng=${bounds.getNorthWest().lng}&seLat=${bounds.getSouthEast().lat}&seLng=${bounds.getSouthEast().lng}`;

        fetch(url)
            .then(response => response.json())
            .then(data => {
                if (this.usingRESTFallback) { // Check again in case state changed during fetch
                    this._updateAircraft(data);
                }
            })
            .catch(error => {
                console.error('Error fetching aircraft data via REST:', error);
            });
    },

    _updateAircraft: function(aircraftData) {
        if (!this.active) return;

        const activeAircraftIds = new Set();
        const now = Date.now();

        // Filter and process aircraft
        aircraftData.forEach(aircraft => {
            const agl = aircraft.last_alt_agl ?? 0;
            const speed = aircraft.last_speed_kmh ?? 0;
            let shouldDisplay = true;
            if (agl < 5) { // Ground states
                if (speed === 0 && !this._liveSettings.showResting) shouldDisplay = false;
                if (speed > 0 && speed <= 16 && !this._liveSettings.showHiking) shouldDisplay = false;
                if (speed > 16 && !this._liveSettings.showDriving) shouldDisplay = false;
            }

            if (shouldDisplay) {
                const normalizedId = this._normalizeAircraftId(aircraft.id);
                activeAircraftIds.add(normalizedId);

                const aircraftWithNormalizedId = {
                    ...aircraft,
                    id: normalizedId,
                    originalId: aircraft.id,
                    // Ensure essential fields have defaults if missing from source
                    last_lat: aircraft.last_lat ?? aircraft.lat,
                    last_lon: aircraft.last_lon ?? aircraft.lon,
                    last_alt_msl: aircraft.last_alt_msl ?? aircraft.altMsl, // No default 0
                    last_alt_agl: agl,
                    last_speed_kmh: speed,
                    last_course: aircraft.last_course ?? aircraft.course ?? 0,
                    last_vs: aircraft.last_vs ?? aircraft.vs ?? 0,
                    type: aircraft.type ?? aircraft.aircraftType ?? 0,
                    name: aircraft.name || normalizedId,
                    pilot_name: aircraft.pilot_name || aircraft.name || normalizedId,
                    last_seen: aircraft.last_seen || new Date().toISOString(),
                    timestamp: aircraft.timestamp || (aircraft.last_fix_epoch ? aircraft.last_fix_epoch * 1000 : Date.now()) // Ensure timestamp
                };

                if (aircraftWithNormalizedId.last_lat === undefined || aircraftWithNormalizedId.last_lon === undefined) {
                     console.warn("Skipping aircraft due to missing coordinates:", aircraft.id);
                     return; // Skip this aircraft
                }


                if (this.markers[normalizedId]) {
                    // Save popup state before updating
                    const wasPopupOpen = this.markers[normalizedId].isPopupOpen();
                    const shouldShowPopup = this.markers[normalizedId]._shouldShowPopup || false;
                    
                    // Update existing marker
                    this.markers[normalizedId].setLatLng([aircraftWithNormalizedId.last_lat, aircraftWithNormalizedId.last_lon]);
                    this._updateMarkerIcon(this.markers[normalizedId], aircraftWithNormalizedId);
                    
                    // Update stored data
                    this.markers[normalizedId].options.aircraftData = JSON.parse(JSON.stringify(aircraftWithNormalizedId));
                    
                    // Preserve popup state
                    this.markers[normalizedId]._shouldShowPopup = shouldShowPopup;
                    
                    // Update popup if open
                    if (wasPopupOpen) {
                        this._updatePopupContent(this.markers[normalizedId], aircraftWithNormalizedId, normalizedId);
                        
                        // Ensure popup stays open if it was open before
                        if (!this.markers[normalizedId].isPopupOpen() && shouldShowPopup) {
                            this.markers[normalizedId]._manuallyOpening = true;
                            this.markers[normalizedId].openPopup();
                            delete this.markers[normalizedId]._manuallyOpening;
                        }
                    }
                } else {
                    // Create new marker
                    const newMarker = this._createAircraftMarker(aircraftWithNormalizedId);
                    
                    // Check if this aircraft had an open popup before (e.g., if it temporarily disappeared and reappeared)
                    if (this.activePopupOrder.includes(normalizedId) && newMarker) {
                        console.log(`Reopening popup for reappeared aircraft ${normalizedId}`);
                        newMarker._shouldShowPopup = true;
                        newMarker._manuallyOpening = true;
                        newMarker.openPopup();
                        delete newMarker._manuallyOpening;
                    }
                }
            }
        });

        // Remove markers for aircraft no longer in the filtered list
        Object.keys(this.markers).forEach(normalizedId => {
            if (!activeAircraftIds.has(normalizedId)) {
                if (this.markers[normalizedId]) {
                    this.aircraftLayer.removeLayer(this.markers[normalizedId]);
                }
                delete this.markers[normalizedId];

                // Remove track and chart data
                if (this.tracks[normalizedId] && this.tracks[normalizedId].layer) {
                    this.trackLayer.removeLayer(this.tracks[normalizedId].layer);
                }
                delete this.tracks[normalizedId];
                this._removePilotDataFromChart(normalizedId); // Also removes from chart
            }
        });
    },

    _getAircraftIcon: function(aircraft) {
        let iconSize = [30, 30];
        let iconAnchor = [15, 15];
        let svgContent = null;
        let className = 'live-marker-icon';
        let html = '';
        let rotation = 0;
        let useRotation = false;
        let isFlyingType = false;

        const status = aircraft.status || 'unknown';
        switch (status) {
            case 'resting':
                return L.icon({
                    iconUrl: this.options.restingSvgUrl,
                    iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [23, 0], // Original value
                    className: className + ' status-resting'
                });
            case 'hiking':
                return L.icon({
                    iconUrl: this.options.hikingSvgUrl,
                    iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [23, 0], // Original value
                    className: className + ' status-hiking'
                });
            case 'driving':
                svgContent = this.drivingSvgContent;
                className += ' status-driving';
                useRotation = true;
                break;
            case 'flying':
            case 'started':
            case 'landed':
            case 'unknown':
            default:
                iconSize = [42, 42];
                iconAnchor = [21, 21];
                useRotation = true;
                className += ' status-flying';
                const isStale = (Date.now() - new Date(aircraft.last_seen).getTime()) > (10 * 60 * 1000);

                if (aircraft.type === 7) { // Paraglider
                    svgContent = isStale ? this.canopyInactiveSvgContent : this.canopySvgContent;
                    className += ' type-paraglider';
                    isFlyingType = true;
                } else if (aircraft.type === 6) { // Hang Glider
                    svgContent = isStale ? this.hangGliderInactiveSvgContent : this.hangGliderSvgContent;
                    className += ' type-hangglider';
                    isFlyingType = true;
                } else if (aircraft.type === 3) { // Helicopter
                    svgContent = this.helicopterSvgContent;
                    iconSize = [24, 24];
                    iconAnchor = [12, 12];
                    className += ' type-helicopter';
                    isFlyingType = false;
                } else { // Fallback
                    svgContent = isStale ? this.canopyInactiveSvgContent : this.canopySvgContent;
                    className += ' type-paraglider';
                    isFlyingType = true;
                }
                if (isStale) className += ' stale-aircraft';
                break;
        }

        if (!svgContent) {
            console.warn(`[LiveControl._getAircraftIcon] SVG content not ready for aircraft ${aircraft.id} (status: ${status}, type: ${aircraft.type}). Returning placeholder.`);
            const placeholderSize = (status === 'driving' || status === 'flying' || status === 'started' || status === 'landed' || status === 'unknown') ? [42, 42] : [30, 30];
            const placeholderAnchor = (status === 'driving' || status === 'flying' || status === 'started' || status === 'landed' || status === 'unknown') ? [21, 21] : [15, 15];
            return L.divIcon({
                 html: '?',
                 className: 'live-marker-loading',
                 iconSize: placeholderSize,
                 iconAnchor: placeholderAnchor
             });
        }

        if (useRotation && typeof aircraft.last_course === 'number' && aircraft.last_course >= 0) {
            rotation = aircraft.last_course;
        }

        let finalSvg = svgContent;
        if (isFlyingType) {
             const vsColor = this._getVSColor(aircraft.last_vs);
             const placeholder = aircraft.type === 7 ? this.options.canopyPlaceholderFill : this.options.hangGliderPlaceholderFill;
             if (placeholder && svgContent.includes(placeholder)) {
                finalSvg = svgContent.replace(placeholder, `fill:${vsColor};`);
             }
        }

        const sizedSvg = finalSvg.replace(/<svg/i, `<svg width="${iconSize[0]}" height="${iconSize[1]}"`);
        html = `<div class="marker-rotation-wrapper" style="transform: rotate(${rotation}deg);">${sizedSvg}</div>`;

        // Adjust popup anchor based on final icon size
        const popupAnchorY = -Math.round(iconSize[1] / 2); // Anchor popup slightly above center

        return L.divIcon({
            html: html,
            className: className,
            iconSize: iconSize,
            iconAnchor: iconAnchor,
            // Original logic based on status/size
            popupAnchor: (status === 'driving') ? [15, 0] : [30, 0]
        });
    },

    _createAircraftMarker: function(aircraft) {
        // Check visibility settings
        const agl = aircraft.last_alt_agl;
        const speed = aircraft.last_speed_kmh;
        if (agl < 5) {
             if (speed === 0 && !this._liveSettings.showResting) return null;
             if (speed > 0 && speed <= 16 && !this._liveSettings.showHiking) return null;
             if (speed > 16 && !this._liveSettings.showDriving) return null;
        }

        const icon = this._getAircraftIcon(aircraft);
        if (!icon) return null;

        const marker = L.marker([aircraft.last_lat, aircraft.last_lon], {
            icon: icon,
            title: aircraft.name || aircraft.id,
            alt: aircraft.name || aircraft.id,
            aircraftId: aircraft.id // Store normalized ID
        });

        // Store aircraft data directly on marker options for easier access in event handlers
        // Use deep copy to prevent issues if original aircraft object is modified elsewhere
        marker.options.aircraftData = JSON.parse(JSON.stringify(aircraft));

        // Store a flag on the marker to track if we want the popup to be shown
        marker._shouldShowPopup = false;

        // Use a custom div for the popup instead of Leaflet's popup system
        marker.on('click', (e) => {
            e.originalEvent.stopPropagation(); // Stop event propagation
            
            const clickedMarker = e.target;
            const currentAircraftData = clickedMarker.options.aircraftData;
            const normalizedId = currentAircraftData.id;
            
            console.log(`Marker clicked for ${normalizedId}`);
            
            // Check if we already have a custom popup for this aircraft
            let customPopup = document.getElementById(`custom-popup-${normalizedId}`);
            
            if (customPopup) {
                // If popup exists, remove it (toggle off)
                console.log(`Removing existing custom popup for ${normalizedId}`);
                document.body.removeChild(customPopup);
                
                // Clean up state
                this.selectedAircraft = null;
                
                // Remove from active popup order
                const index = this.activePopupOrder.indexOf(normalizedId);
                if (index > -1) {
                    this.activePopupOrder.splice(index, 1);
                }
                
                // Return color to pool
                const assignedColor = this.activePopupColors[normalizedId];
                if (assignedColor) {
                    this.availableColors.push(assignedColor);
                    delete this.activePopupColors[normalizedId];
                }
                
                // Remove track polyline
                if (this.tracks[normalizedId] && this.tracks[normalizedId].layer) {
                    this.trackLayer.removeLayer(this.tracks[normalizedId].layer);
                }
                delete this.tracks[normalizedId];
                
                // Remove pilot data from chart
                this._removePilotDataFromChart(normalizedId);
                
                // If this was the last active popup, hide the chart
                if (this.activePopupOrder.length === 0 && this.chartVisible) {
                    this._hideAltitudeChart();
                } else if (this.chartVisible) {
                    // Otherwise, update the chart to reflect the removed pilot
                    this._createOrUpdateAltitudeChart();
                }
                
                return;
            }
            
            // Create new custom popup
            console.log(`Creating new custom popup for ${normalizedId}`);
            
            // Assign a unique color if not already assigned
            if (!this.activePopupColors[normalizedId]) {
                let assignedColor = null;
                for (const preferredColor of this.options.trackHighlightColors) {
                    const availableIndex = this.availableColors.indexOf(preferredColor);
                    if (availableIndex > -1) {
                        // Found a preferred color that is available
                        assignedColor = this.availableColors.splice(availableIndex, 1)[0];
                        this.activePopupColors[normalizedId] = assignedColor;
                        console.log(`Assigned preferred color ${assignedColor} to ${normalizedId}. Available colors left: ${this.availableColors.length}`);
                        break; // Stop searching once a color is assigned
                    }
                }

                if (!assignedColor) {
                    // Fallback to default color if no preferred unique colors are available
                    this.activePopupColors[normalizedId] = this.options.trackColor;
                    console.warn(`No preferred unique colors available. Assigned default color ${this.options.trackColor} to ${normalizedId}.`);
                }
            }

            // Add to activePopupOrder if not already present
            if (!this.activePopupOrder.includes(normalizedId)) {
                this.activePopupOrder.push(normalizedId);
            }

            const color = this.activePopupColors[normalizedId];
            this.selectedAircraft = normalizedId;

            // Fetch track data for chart and polyline
            this._fetchAircraftTrack(normalizedId, color);
            
            // Create custom popup element
            customPopup = document.createElement('div');
            customPopup.id = `custom-popup-${normalizedId}`;
            
            // Get marker position on screen
            const markerPoint = this._map.latLngToContainerPoint(clickedMarker.getLatLng());
            
            // Position popup relative to marker
            customPopup.style.position = 'absolute';
            customPopup.style.left = `${markerPoint.x + 15}px`;
            customPopup.style.top = `${markerPoint.y - 18}px`;
            
            // Store the offsets as data attributes for consistent positioning during updates
            customPopup.dataset.leftOffset = '15';
            customPopup.dataset.topOffset = '-18';
            
            // Create popup content
            const lastSeenTimestamp = new Date(currentAircraftData.last_seen).getTime();
            const timeAgo = this._formatTimeAgo(lastSeenTimestamp);
            const vs = currentAircraftData.last_vs ?? 0;
            const vsColor = vs === 0 ? 'black' : (vs < 0 ? 'red' : 'green');
            const altMsl = currentAircraftData.last_alt_msl ?? 'N/A';
            const altAgl = currentAircraftData.last_alt_agl ?? 'N/A';
            
            customPopup.className = "aircraft-popup";
            customPopup.setAttribute("data-aircraft-id", normalizedId);
            customPopup.innerHTML = `
                <p style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="flex-grow: 1;"><strong style="color:${color};">${currentAircraftData.name}</strong></span>
                    <span class="live-time-ago" data-timestamp="${lastSeenTimestamp}" style="margin-left: 10px; white-space: nowrap;">${timeAgo}</span>
                </p>
                <p><strong>${altMsl}${altMsl !== 'N/A' ? ' m' : ''} </strong>[${altAgl}${altAgl !== 'N/A' ? ' AGL' : ''}]</strong> ${currentAircraftData.last_speed_kmh !== 'N/A' ? currentAircraftData.last_speed_kmh.toFixed(0) + ' km/h' : ''} <strong style="color: ${vsColor};">${vs.toFixed(1)} m/s</strong></p>
            `;
            
            // Add to DOM
            document.body.appendChild(customPopup);
            
            // Add click handler to the entire popup
            customPopup.addEventListener('click', () => {
                console.log(`Popup clicked for ${normalizedId}`);
                if (customPopup.parentNode) {
                    customPopup.parentNode.removeChild(customPopup);
                }
                
                // Clean up state
                this.selectedAircraft = null;
                
                // Remove from active popup order
                const index = this.activePopupOrder.indexOf(normalizedId);
                if (index > -1) {
                    this.activePopupOrder.splice(index, 1);
                }
                
                // Return color to pool
                const assignedColor = this.activePopupColors[normalizedId];
                if (assignedColor) {
                    this.availableColors.push(assignedColor);
                    delete this.activePopupColors[normalizedId];
                }
                
                // Remove track polyline
                if (this.tracks[normalizedId] && this.tracks[normalizedId].layer) {
                    this.trackLayer.removeLayer(this.tracks[normalizedId].layer);
                }
                delete this.tracks[normalizedId];
                
                // Remove pilot data from chart
                this._removePilotDataFromChart(normalizedId);
                
                // If this was the last active popup, hide the chart
                if (this.activePopupOrder.length === 0 && this.chartVisible) {
                    this._hideAltitudeChart();
                } else if (this.chartVisible) {
                    // Otherwise, update the chart to reflect the removed pilot
                    this._createOrUpdateAltitudeChart();
                }
            });
            
            // Start timer to update time ago
            const timeElement = customPopup.querySelector('.live-time-ago');
            if (timeElement) {
                const updateTimer = setInterval(() => {
                    const popup = document.getElementById(`custom-popup-${normalizedId}`);
                    if (!popup) {
                        clearInterval(updateTimer);
                        return;
                    }
                    
                    // Get the current timestamp from the data attribute, which may have been updated
                    const currentTimeElement = popup.querySelector('.live-time-ago');
                    if (currentTimeElement) {
                        const currentTimestamp = parseInt(currentTimeElement.getAttribute('data-timestamp'), 10);
                        if (!isNaN(currentTimestamp)) {
                            currentTimeElement.textContent = this._formatTimeAgo(currentTimestamp);
                        } else {
                            // Fallback to original timestamp if data attribute is missing or invalid
                            currentTimeElement.textContent = this._formatTimeAgo(lastSeenTimestamp);
                        }
                    }
                }, 1000);
                
                // Store timer reference for cleanup
                this.popupTimers[normalizedId] = updateTimer;
            }
            
            // Update popup position when map moves
            const updatePosition = () => {
                const popup = document.getElementById(`custom-popup-${normalizedId}`);
                if (!popup) return;
                
                const marker = this.markers[normalizedId];
                if (!marker) return;
                
                const point = this._map.latLngToContainerPoint(marker.getLatLng());
                const leftOffset = parseInt(popup.dataset.leftOffset || '15', 10);
                const topOffset = parseInt(popup.dataset.topOffset || '-18', 10);
                popup.style.left = `${point.x + leftOffset}px`;
                popup.style.top = `${point.y + topOffset}px`;
            };
            
            this._map.on('move', updatePosition);
            this._map.on('zoom', updatePosition);
            
            // Clean up event listeners when popup is closed
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList' && mutation.removedNodes.length) {
                        for (let i = 0; i < mutation.removedNodes.length; i++) {
                            if (mutation.removedNodes[i].id === `custom-popup-${normalizedId}`) {
                                this._map.off('move', updatePosition);
                                this._map.off('zoom', updatePosition);
                                observer.disconnect();
                                break;
                            }
                        }
                    }
                });
            });
            
            observer.observe(document.body, { childList: true });
        });

        // We're using custom DOM popups instead of Leaflet's popup system

        this.aircraftLayer.addLayer(marker);
        this.markers[aircraft.id] = marker; // Store marker reference

        return marker;
    },

    _getVSColor: function(vs) {
        if (vs <= -5.0) return '#8B0000'; // DarkRed
        if (vs <= -3.5) return '#FF0000'; // Red
        if (vs <= -2.5) return '#FF4500'; // OrangeRed
        if (vs <= -1.5) return '#FFA500'; // Orange
        if (vs <= -0.5) return '#FFD700'; // Gold
        if (vs === 0)   return '#FFFFFF'; // White
        if (vs >= 5.0) return '#0D400D'; // Dark Green
        if (vs >= 3.5) return '#289628'; // ForestGreen
        if (vs >= 2.5) return '#5CCD5C'; // MediumSeaGreen
        if (vs >= 1.5) return '#99E699'; // LightGreen
        if (vs >= 0.5) return '#CFF2CF'; // Honeydew
        return '#FFFFFF'; // Default
    },

     _updateMarkerIcon: function(marker, aircraft) {
         marker.setIcon(this._getAircraftIcon(aircraft));
         // Update stored data on marker as well, as icon depends on it
         marker.options.aircraftData = JSON.parse(JSON.stringify(aircraft));
     },

    _formatTimeAgo: function(timestamp) {
        const lastSeen = new Date(timestamp);
        const now = new Date();
        const diffSeconds = Math.max(0, Math.round((now - lastSeen) / 1000));

        if (diffSeconds < 60) return `-${String(diffSeconds).padStart(2, '0')} sec`;
        if (diffSeconds < 3600) {
            const minutes = String(Math.floor(diffSeconds / 60)).padStart(2, '0');
            const seconds = String(diffSeconds % 60).padStart(2, '0');
            return `-${minutes}:${seconds} min`;
        }
        const hours = String(Math.floor(diffSeconds / 3600)).padStart(2, '0');
        const minutes = String(Math.floor((diffSeconds % 3600) / 60)).padStart(2, '0');
        return `-${hours}:${minutes} h`;
    },

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

        // Start interval using the current aircraft data timestamp
        this.popupTimers[normalizedId] = setInterval(() => {
            // Re-fetch element inside interval for robustness
            const currentPopupElement = popup.getElement();
            const currentTimeElement = currentPopupElement?.querySelector('.live-time-ago');
            if (popup.isOpen() && currentTimeElement) {
                // Get the current timestamp from the data attribute, which may have been updated
                const currentTimestamp = parseInt(currentTimeElement.getAttribute('data-timestamp'), 10);
                if (!isNaN(currentTimestamp)) {
                    currentTimeElement.textContent = this._formatTimeAgo(currentTimestamp);
                }
            } else {
                this._stopPopupTimer(normalizedId); // Stop if popup closed or element gone
            }
        }, 1000);
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
        this.popupTimers = {}; // Reset
    },

     _createPopupContent: function(aircraft) {
        const lastSeenTimestamp = new Date(aircraft.last_seen).getTime();
        const initialFormattedTimeAgo = this._formatTimeAgo(lastSeenTimestamp);
        const assignedColor = this.activePopupColors[aircraft.id] || '#007bff'; // Use normalized ID
        const vs = aircraft.last_vs ?? 0; // Default vs to 0 if undefined
        const vsColor = vs === 0 ? 'black' : (vs < 0 ? 'red' : 'green');
        const altMsl = aircraft.last_alt_msl ?? 'N/A'; // Handle potentially missing altitude
        const altAgl = aircraft.last_alt_agl ?? 'N/A'; // Handle potentially missing AGL

        return `
            <div class="aircraft-popup" data-aircraft-id="${aircraft.id}" style="min-width: 150px; padding: 8px; background-color: white; border-radius: 4px; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">
                <p style="display: flex; justify-content: space-between; align-items: center; margin: 0 0 5px 0;">
                    <span style="flex-grow: 1;"><strong style="color:${assignedColor}; font-size: 14px;">${aircraft.name}</strong></span>
                    <span class="live-time-ago" data-timestamp="${lastSeenTimestamp}" style="margin-left: 10px; white-space: nowrap; font-size: 12px;">${initialFormattedTimeAgo}</span>
                </p>
                <p style="margin: 0; font-size: 13px;"><strong>${altMsl}${altMsl !== 'N/A' ? ' m' : ''} </strong>[${altAgl}${altAgl !== 'N/A' ? ' AGL' : ''}]</strong> ${aircraft.last_speed_kmh !== 'N/A' ? aircraft.last_speed_kmh.toFixed(0) + ' km/h' : ''} <strong style="color: ${vsColor};">${vs.toFixed(1)} m/s</strong></p>
                <div style="text-align: right; margin-top: 5px;">
                    <button class="close-popup-btn" style="background: none; border: none; color: #666; cursor: pointer; font-size: 12px;">Close</button>
                </div>
            </div>
        `;
    },

    _updatePopupContent: function(marker, aircraft, normalizedId) {
        const popup = marker.getPopup();
        if (popup) {
            const newContent = this._createPopupContent(aircraft);
            popup.setContent(newContent);
            
            // Force the popup to update its layout
            if (popup.isOpen()) {
                // Restart the timer with the updated timestamp
                this._startPopupTimer(popup, normalizedId);
                
                // Force the popup to update its position and layout
                popup.update();
                
                // Make sure the popup container is visible
                const popupContainer = popup.getElement();
                if (popupContainer) {
                    popupContainer.style.display = 'block';
                    popupContainer.style.visibility = 'visible';
                    popupContainer.style.opacity = '1';
                    
                    // Ensure the timestamp in the data attribute is updated
                    const timeElement = popupContainer.querySelector('.live-time-ago');
                    if (timeElement && aircraft.last_seen) {
                        const lastSeenTimestamp = new Date(aircraft.last_seen).getTime();
                        timeElement.setAttribute('data-timestamp', lastSeenTimestamp);
                    }
                }
            }
        }
    },

    _updateSingleAircraft: function(aircraft) {
        if (!this.active) return;

        const normalizedId = this._normalizeAircraftId(aircraft.id);
        // Use a more complete aircraft object for processing, ensuring defaults
        const processedAircraft = {
            ...aircraft, // Spread original data first
            id: normalizedId,
            originalId: aircraft.id,
            last_lat: aircraft.lat ?? aircraft.last_lat,
            last_lon: aircraft.lon ?? aircraft.last_lon,
            last_alt_msl: aircraft.last_alt_msl ?? aircraft.altMsl,
            last_alt_agl: aircraft.last_alt_agl ?? aircraft.altAgl, // No default to 0, let it be undefined if not present
            last_speed_kmh: aircraft.last_speed_kmh ?? aircraft.speedKmh ?? 0,
            last_course: aircraft.last_course ?? aircraft.course ?? 0,
            last_vs: aircraft.last_vs ?? aircraft.vs ?? 0,
            type: aircraft.type ?? aircraft.aircraftType ?? 0,
            name: aircraft.name || normalizedId,
            pilot_name: aircraft.pilot_name || aircraft.name || normalizedId,
            last_seen: aircraft.last_seen || new Date().toISOString(),
            timestamp: aircraft.timestamp || (aircraft.last_fix_epoch ? aircraft.last_fix_epoch * 1000 : Date.now())
        };


        // Check for duplicate updates
        if (processedAircraft.update_timestamp) { // Assuming update_timestamp exists on incoming 'aircraft'
            const lastTimestamp = this.lastUpdateTimestamps[normalizedId] || 0;
            if (processedAircraft.update_timestamp <= lastTimestamp) {
                return;
            }
            this.lastUpdateTimestamps[normalizedId] = processedAircraft.update_timestamp;
        }


        if (processedAircraft.last_lat === undefined || processedAircraft.last_lon === undefined) {
            console.warn("Skipping aircraft update due to missing coordinates:", processedAircraft.id);
            return;
        }

        // Filter based on settings
        let shouldDisplay = true;
        if (processedAircraft.last_alt_agl < 5) {
            if (processedAircraft.last_speed_kmh === 0 && !this._liveSettings.showResting) shouldDisplay = false;
            if (processedAircraft.last_speed_kmh > 0 && processedAircraft.last_speed_kmh <= 16 && !this._liveSettings.showHiking) shouldDisplay = false;
            if (processedAircraft.last_speed_kmh > 16 && !this._liveSettings.showDriving) shouldDisplay = false;
        }

        const existingMarker = this.markers[normalizedId];

        if (shouldDisplay) {
            if (existingMarker) {
                existingMarker.setLatLng([processedAircraft.last_lat, processedAircraft.last_lon]);
                this._updateMarkerIcon(existingMarker, processedAircraft);
                existingMarker.options.aircraftData = JSON.parse(JSON.stringify(processedAircraft)); // Update stored data

                // Check for and update custom DOM popup
                const customPopup = document.getElementById(`custom-popup-${normalizedId}`);
                if (customPopup) {
                    // Update custom popup content
                    const lastSeenTimestamp = new Date(processedAircraft.last_seen).getTime();
                    const timeElement = customPopup.querySelector('.live-time-ago');
                    if (timeElement) {
                        timeElement.setAttribute('data-timestamp', lastSeenTimestamp);
                    }
                    
                    // Update altitude and vertical speed display
                    const vs = processedAircraft.last_vs ?? 0;
                    const vsColor = vs === 0 ? 'black' : (vs < 0 ? 'red' : 'green');
                    const altMsl = processedAircraft.last_alt_msl ?? 'N/A';
                    const altAgl = processedAircraft.last_alt_agl ?? 'N/A';
                    
                    // Find and update the altitude/vs paragraph
                    const altParagraph = customPopup.querySelector('p:nth-child(2)');
                    if (altParagraph) {
                        altParagraph.innerHTML = `<strong>${altMsl}${altMsl !== 'N/A' ? ' m' : ''} </strong>[${altAgl}${altAgl !== 'N/A' ? ' AGL' : ''}]</strong> ${processedAircraft.last_speed_kmh !== 'N/A' ? processedAircraft.last_speed_kmh.toFixed(0) + ' km/h' : ''} <strong style="color: ${vsColor};">${vs.toFixed(1)} m/s</strong>`;
                    }
                    
                    // Update popup position to follow the marker
                    const markerPoint = this._map.latLngToContainerPoint(existingMarker.getLatLng());
                    const leftOffset = parseInt(customPopup.dataset.leftOffset || '15', 10);
                    const topOffset = parseInt(customPopup.dataset.topOffset || '-18', 10);
                    customPopup.style.left = `${markerPoint.x + leftOffset}px`;
                    customPopup.style.top = `${markerPoint.y + topOffset}px`;
                }
                
                // Also update Leaflet popup if it exists
                if (existingMarker.isPopupOpen()) {
                    this._updatePopupContent(existingMarker, processedAircraft, normalizedId);
                }

                if (this.tracks[normalizedId] && this.tracks[normalizedId].layer) {
                    this.tracks[normalizedId].layer.addLatLng([processedAircraft.last_lat, processedAircraft.last_lon]);
                }

                // Update chart data if this pilot is in the chart
                if (this.pilotTracksForChart[normalizedId]) {
                    // Create the new point, ensuring altitude is not defaulted to 0 if missing
                    const rawAlt = processedAircraft.last_alt_msl;
                    const numericAlt = typeof rawAlt === 'string' ? parseFloat(rawAlt.replace(/,/g, '')) : rawAlt;

                    const newPointForChartCache = { // Renamed to avoid confusion with visual chart points
                        timestamp: processedAircraft.timestamp,
                        last_fix_epoch: processedAircraft.last_fix_epoch, // Include for time sorting consistency
                        last_lat: processedAircraft.last_lat,
                        last_lon: processedAircraft.last_lon,
                        last_alt_msl: numericAlt, // Store parsed numeric altitude
                        alt_msl: numericAlt, // For consistency with historical data structure in _createOrUpdateAltitudeChart
                        alt_agl: processedAircraft.last_alt_agl, // Crucially add this for ground level calculation
                        // Ensure last_alt_agl from processedAircraft is used (which already checks .alt_agl fallback)
                    };

                    // Only add point to cache if it has valid (parsed) MSL altitude
                    if (typeof newPointForChartCache.last_alt_msl === 'number' && !isNaN(newPointForChartCache.last_alt_msl)) {
                        if (!Array.isArray(this.pilotTracksForChart[normalizedId])) {
                             this.pilotTracksForChart[normalizedId] = [];
                        }
                        this.pilotTracksForChart[normalizedId].push(newPointForChartCache);
                        // Sort the raw track data by time to ensure correct processing order
                        this.pilotTracksForChart[normalizedId].sort((a, b) => (a.timestamp || (a.last_fix_epoch * 1000)) - (b.timestamp || (b.last_fix_epoch * 1000)));

                        // Now, when _addPilotDataToChart is called, or _createOrUpdateAltitudeChart is called,
                        // it will use this updated pilotTracksForChart[normalizedId] which includes alt_agl.
                        if (this.chartVisible) {
                             // _addPilotDataToChart will itself call _createOrUpdateAltitudeChart
                             // It will use the full this.pilotTracksForChart[normalizedId] which now has the new point with AGL
                             const pilotDisplayName = processedAircraft.name || normalizedId;
                             this._addPilotDataToChart(normalizedId, this.pilotTracksForChart[normalizedId], this.activePopupColors[normalizedId] || this.options.trackColor, pilotDisplayName);
                        }
                    } else {
                         console.warn(`[UpdateSingle] Skipping adding point to chart cache for ${processedAircraft.name || normalizedId} due to invalid or unparsable MSL altitude:`, rawAlt);
                    }
                }
            } else {
                this._createAircraftMarker(processedAircraft);
            }
        } else if (existingMarker) {
            this.aircraftLayer.removeLayer(existingMarker);
            delete this.markers[normalizedId];
            if (this.tracks[normalizedId] && this.tracks[normalizedId].layer) {
                this.trackLayer.removeLayer(this.tracks[normalizedId].layer);
            }
            delete this.tracks[normalizedId];
            this._removePilotDataFromChart(normalizedId);
        }
    },

    _normalizeAircraftId: function(id) {
        if (!id) return id;
        return id.replace(/^(FLR|FNT|OGN|RND|ICA)/i, '');
    },

    _fetchAircraftTrack: function(normalizedId, color) {
        if (!this.active) return;

        const marker = this.markers[normalizedId];
        if (!marker || !marker.options.aircraftData) {
            console.warn(`[LiveControl._fetchAircraftTrack] Marker or aircraftData not found for ${normalizedId}. Cannot fetch track.`);
            if (this.tracks[normalizedId]) this.tracks[normalizedId].isLoading = false;
            return;
        }
        const apiId = marker.options.aircraftData.originalId || normalizedId;
        const assignedColor = color || this.activePopupColors[normalizedId] || this.options.trackColor;

        if (this.pilotTracksForChart[normalizedId] && this.pilotTracksForChart[normalizedId].length > 0) {
            console.log(`Using cached full track data for ${marker.options.aircraftData.name || normalizedId}`);
            const cachedTrackData = this.pilotTracksForChart[normalizedId];
            const pilotDisplayName = marker.options.aircraftData.name || normalizedId;
            this._displayAircraftTrack(normalizedId, cachedTrackData, assignedColor);
            this._addPilotDataToChart(normalizedId, cachedTrackData, assignedColor, pilotDisplayName);
            if (this.chartData.datasets.length > 0) this._showAltitudeChart();
            return;
        }

        if (this.tracks[normalizedId] && this.tracks[normalizedId].isLoading) {
            console.log(`Track fetch already in progress for ${normalizedId}`);
            return;
        }

        if (!this.tracks[normalizedId]) this.tracks[normalizedId] = { isLoading: false, layer: null };
        this.tracks[normalizedId].isLoading = true;

        console.log(`Fetching track for ${normalizedId} (API ID: ${apiId})`);

        const handleTrackDataResponse = (trackData) => {
            if (!this.tracks[normalizedId]) {
                console.log(`[Track Fetch] Request for ${normalizedId} no longer relevant.`);
                return;
            }
            this.tracks[normalizedId].isLoading = false;
            console.log(`[Track Fetch] Received track data for ${normalizedId}. Length: ${trackData?.length ?? 'N/A'}`);

            if (trackData && trackData.length > 0) {
                // Process track data, but DON'T default altitude to 0
                const processedTrackData = trackData.map(p => {
                    const rawAlt = p.last_alt_msl ?? p.altMsl;
                    const numericAlt = typeof rawAlt === 'string' ? parseFloat(rawAlt.replace(/,/g, '')) : rawAlt;
                    return {
                        ...p,
                        last_lat: p.last_lat ?? p.lat,
                        last_lon: p.last_lon ?? p.lon,
                        last_alt_msl: numericAlt, // Store parsed numeric altitude
                        timestamp: p.timestamp || p.last_fix_epoch * 1000 || Date.now()
                    };
                }).filter(p => p.last_lat !== undefined && p.last_lon !== undefined);

                if (processedTrackData.length > 0) {
                    const pilotDisplayName = marker.options.aircraftData.name || normalizedId;
                    console.log(`[Track Fetch] Processed ${processedTrackData.length} valid points for ${pilotDisplayName}`);
                    this.pilotTracksForChart[normalizedId] = processedTrackData;
                    this._displayAircraftTrack(normalizedId, processedTrackData, assignedColor);
                    this._addPilotDataToChart(normalizedId, processedTrackData, assignedColor, pilotDisplayName);
                    console.log(`[Track Fetch] Datasets count after adding ${pilotDisplayName}: ${this.chartData.datasets.length}`);
                    if (this.chartData.datasets.length > 0) {
                         console.log("[Track Fetch] Attempting to show altitude chart...");
                         this._showAltitudeChart();
                    } else {
                         console.log("[Track Fetch] No datasets available, not showing chart.");
                    }
                } else {
                     console.log(`[Track Fetch] No valid track points after processing for ${marker.options.aircraftData.name || normalizedId} (API ID: ${apiId})`);
                     this._removePilotDataFromChart(normalizedId);
                }
            } else {
                console.log(`[Track Fetch] No track data received for ${marker.options.aircraftData.name || normalizedId} (API ID: ${apiId})`);
                this._removePilotDataFromChart(normalizedId);
            }
        };

        const handleTrackDataError = (error) => {
            if (this.tracks[normalizedId]) this.tracks[normalizedId].isLoading = false;
            console.error(`Error fetching track for ${normalizedId} (API ID: ${apiId}):`, error);
            this._removePilotDataFromChart(normalizedId);
        };

        if (this.usingWebSocket && this.socket && this.socket.connected) {
            console.log(`Requesting track via WebSocket for: ${apiId}`);
            // The main 'track-data' listener in _connectWebSocket will handle the response.
            // We just need to ensure it knows this track was specifically requested.
            this.socket.emit('get-track', apiId);
        } else {
            console.log("Requesting track via REST API for:", apiId);
            fetch(`/api/ogn/track/${apiId}?minutes=720`)
                .then(response => response.ok ? response.json() : Promise.reject(`HTTP error! status: ${response.status}`))
                .then(trackData => {
                    console.log(`Received track via REST for ${apiId}. Length: ${trackData?.length ?? 'N/A'}`);
                    handleTrackDataResponse(trackData);
                })
                .catch(handleTrackDataError);
        }
    },

    _displayAircraftTrack: function(normalizedId, trackPoints, color) {
        if (!this.active) return;

        const trackColorToUse = color || this.activePopupColors[normalizedId] || this.options.trackColor;

        if (!trackPoints || trackPoints.length === 0) {
            if (this.tracks[normalizedId] && this.tracks[normalizedId].layer) {
                this.trackLayer.removeLayer(this.tracks[normalizedId].layer);
                this.tracks[normalizedId].layer = null;
            }
            console.log(`No track points to display for ${normalizedId}.`);
            return;
        }

        const latLngs = trackPoints.map(p => {
            const lat = p.last_lat ?? p.lat;
            const lon = p.last_lon ?? p.lon;
            if (lat === undefined || lon === undefined) return null;
            return [lat, lon];
        }).filter(p => p !== null);

        if (latLngs.length === 0) {
             console.warn(`No valid LatLngs found for ${normalizedId} track polyline.`);
             if (this.tracks[normalizedId] && this.tracks[normalizedId].layer) {
                this.trackLayer.removeLayer(this.tracks[normalizedId].layer);
                this.tracks[normalizedId].layer = null;
            }
             return;
        }


        if (this.tracks[normalizedId] && this.tracks[normalizedId].layer) {
            this.tracks[normalizedId].layer.setLatLngs(latLngs);
            this.tracks[normalizedId].layer.setStyle({ color: trackColorToUse });
            console.log(`Updated track polyline for ${normalizedId}`);
        } else {
            const trackPolyline = L.polyline(latLngs, {
                color: trackColorToUse,
                weight: this.options.trackWeight,
                opacity: this.options.trackOpacity,
                lineJoin: 'round'
            });
            this.trackLayer.addLayer(trackPolyline);
            if (!this.tracks[normalizedId]) this.tracks[normalizedId] = {};
            this.tracks[normalizedId].layer = trackPolyline;
            console.log(`Displayed new track polyline for ${normalizedId}`);
        }
        if (this.tracks[normalizedId]) this.tracks[normalizedId].isLoading = false;

        if (this.chartVisible) {
            this._createOrUpdateAltitudeChart();
        }
    },

    // --- Config Badge Methods ---
    _showConfigBadge: function() {
        if (this._configBadgeOpen) return;
        this._configBadgeOpen = true;

        this._configContainer = L.DomUtil.create('div', 'live-config-badge', this._map.getContainer().querySelector('.leaflet-control-container .leaflet-bottom.leaflet-right'));
        L.DomEvent.disableClickPropagation(this._configContainer);

        const headerRow = L.DomUtil.create('div', 'live-config-row live-config-header', this._configContainer);
        const headerSpan = L.DomUtil.create('span', '', headerRow);
        headerSpan.textContent = 'LIVE! Viewer';
        const mainToggleLabel = L.DomUtil.create('label', 'switch', headerRow);
        const mainToggleInput = L.DomUtil.create('input', '', mainToggleLabel);
        mainToggleInput.type = 'checkbox';
        mainToggleInput.id = 'live-toggle-main';
        mainToggleInput.checked = this._liveSettings.isActive;
        L.DomUtil.create('span', 'slider round', mainToggleLabel);

        L.DomEvent.on(mainToggleInput, 'change', (e) => {
            if (e.target.checked) this._activateLive();
            else this._deactivateLive();
        });

        L.DomUtil.create('hr', 'live-config-separator', this._configContainer);

        const createToggleRow = (labelText, settingKey) => {
            const row = L.DomUtil.create('div', 'live-config-row', this._configContainer);
            const span = L.DomUtil.create('span', '', row);
            span.textContent = labelText;
            const label = L.DomUtil.create('label', 'switch', row);
            const input = L.DomUtil.create('input', '', label);
            input.type = 'checkbox';
            input.checked = this._liveSettings[settingKey];
            input.dataset.settingKey = settingKey;
            L.DomUtil.create('span', 'slider round', label);

            L.DomEvent.on(input, 'change', (e) => {
                this._liveSettings[settingKey] = e.target.checked;
                console.log(`Live setting ${settingKey} changed to: ${this._liveSettings[settingKey]}`);
                this._triggerFullAircraftUpdate();
                 document.dispatchEvent(new CustomEvent('xcmaps-preferences-changed'));
            });
        };

        createToggleRow('Show Resting', 'showResting');
        createToggleRow('Show Hiking', 'showHiking');
        createToggleRow('Show Driving', 'showDriving');

        const controlRect = this._container.getBoundingClientRect();
        const mapRect = this._map.getContainer().getBoundingClientRect();
        this._configContainer.style.position = 'absolute';
        this._configContainer.style.bottom = (mapRect.height - controlRect.bottom + mapRect.top) + 'px';
        this._configContainer.style.right = (mapRect.width - controlRect.left + mapRect.left + 10) + 'px';
    },

    _closeConfigBadge: function() {
        if (!this._configBadgeOpen || !this._configContainer) return;
        this._configBadgeOpen = false;
        L.DomUtil.remove(this._configContainer);
        this._configContainer = null;
    },

    _triggerFullAircraftUpdate: function() {
        if (!this.active) return;
        if (this.usingWebSocket && this.socket && this.socket.connected) {
            console.log("Requesting full aircraft update from WebSocket due to settings change.");
            this.socket.emit('request-full-update');
        } else if (this.usingRESTFallback) {
            this._fetchAircraftDataREST();
        } else {
             console.log("Live mode active but no data source connected. Update will occur on next connection/map move.");
        }
    },

    updateLiveSettings: function(settings) {
        let changed = false;
        let needsFullUpdate = false;
        for (const key in settings) {
            if (this._liveSettings.hasOwnProperty(key) && this._liveSettings[key] !== settings[key]) {
                this._liveSettings[key] = settings[key];
                changed = true;
                console.log(`Live setting ${key} updated externally to: ${settings[key]}`);

                if (key === 'isActive') {
                    if (settings[key] && !this.active) this._activateLive();
                    else if (!settings[key] && this.active) this._deactivateLive();
                } else {
                    needsFullUpdate = true;
                }
            }
        }
        if (changed && this.active) {
             if (this._configBadgeOpen && this._configContainer) {
                 const mainToggle = this._configContainer.querySelector('#live-toggle-main');
                 if (mainToggle) mainToggle.checked = this._liveSettings.isActive;
                 const updateToggleUI = (settingKey) => {
                     const input = this._configContainer.querySelector(`input[data-setting-key="${settingKey}"]`);
                     if (input) input.checked = this._liveSettings[settingKey];
                 };
                 updateToggleUI('showResting');
                 updateToggleUI('showHiking');
                 updateToggleUI('showDriving');
             }
             if (needsFullUpdate) {
                this._triggerFullAircraftUpdate();
             }
        }
    },

    getLiveSettings: function() {
        return { ...this._liveSettings };
    }
});

L.control.live = function(options) {
    return new LiveControl(options);
};
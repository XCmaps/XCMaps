import './L.Control.Layers.Tree.js';
import '../css/L.Control.Layers.Tree.css';

import './leaflet.responsive.popup.js';
import './leaflet.responsive.popup.css';

import '../css/styles.css';
import '../css/user-control.css';
import InfoControl from '../../../components/info-control.js';
import moment from 'moment';
import 'moment-timezone';
 
// import './../../../components/airspaces.js'; // Removed EFG airspaces
import '../../../components/deprecated/airspaces-gliding.js';
import '../../../components/deprecated/airspaces-notam.js';
import './../../../components/airspaces-xc.js';
import './../../../components/windstations.js';
import '../../../components/spots-pg.js';
import '../../../components/spots-hg.js';
import '../../../components/spots-lz.js';
import '../../../components/obstacles.js';
import '../../../components/rainviewer.js';
import { initializeAirspaceXCMapListeners } from './../../../components/airspaces-xc.js';
import { initKeycloak, createUserControl, loadUserPreferences } from '../../../components/keycloak-auth.js'; // Import loadUserPreferences

// --- Global App Configuration ---
window.appConfig = {
  fullSpotsPopoup: false // Default value, will be overwritten by fetched config
};

async function fetchAppConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const config = await response.json();
    window.appConfig = { ...window.appConfig, ...config }; // Merge fetched config with defaults
    console.log('App configuration loaded:', window.appConfig);
  } catch (error) {
    console.error('Failed to fetch app configuration:', error);
    // Keep using default config in case of error
  }
}
// --- End Global App Configuration ---


// Initialize map and make necessary objects globally available
function initMap() {
  // Create the map object and make it globally accessible
  window.map = L.map('map', {
      center: [50, 6],
      zoom: 9,
      zoomControl: false,
      layers: [],
      timeDimension: true
  });

  L.control.zoom({
      position: 'bottomright',
  }).addTo(window.map);

  // Base Layers
  var awgTerrain = L.tileLayer('https://tile.jawg.io/jawg-terrain/{z}/{x}/{y}{r}.png?access-token=qBDXRu1KSlZGhx4ROlceBD9hcxmrumL34oj29tUkzDVkafqx08tFWPeRNb0KSoKa', {
      attribution: 'Jawg.io'
  }); // Don't add to map by default

  var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
  });

  var xcontest = L.tileLayer('https://topo.xcontest.app/elev/{z}/{x}/{y}.jpg', {
      attribution: 'XContest&copy; <a href="https://www.xcontest.org">XContest</a>',
      className: 'xcontest-layer'
  });

  /* JS */
    // Modified popupopen handler
  window.map.on('popupopen', function(ev){
    const el = document.getElementById('fullScreenInfo');
    const screenWidthThreshold = 768; // Match CSS media query
    const popupEl = ev.popup.getElement(); // Get popup DOM element

    // Helper function to show content in fullscreen modal
    function showInFullscreen(content) {
        console.log("Attempting to show content in fullscreen modal.");
        window.map.closePopup(); // Close small popup first
        try {
            // Add default close button and footer
            const closeButtonHTML = '<div id="default-fullscreen-close-btn" style="position: absolute; top: 10px; right: 10px;">' +
                                  '<button onclick="closeFullscreenInfo()" style="background: none; border: none; font-size: 20px; cursor: pointer;">✕</button>' +
                                  '</div>';
            const footerHTML = '<div id="default-fullscreen-footer" style="text-align: right; padding: 10px;">' +
                             '<button class="btn btn-dark btn-sm" onclick="closeFullscreenInfo()">Close</button>' +
                             '</div>';

            // Check if content is a node or string
            let contentHTML = '';
            if (typeof content === 'string') {
                contentHTML = content;
            } else if (content instanceof Node && typeof content.outerHTML === 'string') {
                contentHTML = content.outerHTML; // Use outerHTML if it's a DOM node
            } else {
                 console.warn("Popup content is neither string nor DOM node, cannot display in fullscreen.");
                 contentHTML = 'Error: Invalid popup content.';
            }
            el.innerHTML = closeButtonHTML + `<div id="fullscreen-content-area">${contentHTML}</div>` + footerHTML;

            // Show panel
            el.classList.add('visible');
            el.style.display = 'block';
            el.style.zIndex = '10000';
            document.getElementById('map').classList.add('map-covered');

        } catch (error) {
            console.error('Error processing content for fullscreen:', error);
            // Optionally show an error message in the fullscreen panel
            el.innerHTML = '<div style="padding: 20px;">Error displaying popup content.</div>' +
                           '<div style="text-align: right; padding: 10px;"><button class="btn btn-dark btn-sm" onclick="closeFullscreenInfo()">Close</button></div>';
            // Still show the panel even if there's an error
            el.classList.add('visible');
            el.style.display = 'block';
            el.style.zIndex = '10000';
            document.getElementById('map').classList.add('map-covered');
        }
    }

    // --- Small Screen Logic ---
    if (window.innerWidth < screenWidthThreshold) {

      // --- Handle Info Popup Specifically (Uses its own fullscreen logic) ---
      if (popupEl && popupEl.classList.contains('info-popup')) {
        console.log("Opening Info Popup in fullscreen mode.");
        window.map.closePopup(); // Close the small popup first
        try {
          const infoContentElement = ev.popup.getContent();
          if (typeof infoContentElement !== 'object' || !infoContentElement.querySelector) {
               console.error("Info popup content is not a valid DOM element."); return;
          }
          el.innerHTML = ''; // Clear previous content
          el.appendChild(infoContentElement); // Append the entire structure

          // Attach close handlers (assuming infoContentElement contains buttons with correct classes/onclick)
          const headerCloseBtn = infoContentElement.querySelector('.info-popup-close');
          const footerCloseBtn = infoContentElement.querySelector('.info-popup-footer-close');
          if (headerCloseBtn) L.DomEvent.on(headerCloseBtn, 'click', window.closeFullscreenInfo);
          if (footerCloseBtn) L.DomEvent.on(footerCloseBtn, 'click', window.closeFullscreenInfo);

          // Show the fullscreen panel
          el.classList.add('visible');
          el.style.display = 'block';
          el.style.zIndex = '10000';
          document.getElementById('map').classList.add('map-covered');
        } catch (error) {
          console.error('Error processing info popup for fullscreen:', error);
        }
        return; // Stop further processing
      }

      // --- Skip specific other popups ---
      if (popupEl && (
          popupEl.classList.contains('obstacle-popup') ||
          popupEl.classList.contains('airspace-popup')
          // Add other classes to skip here if needed
      )) {
        console.log("Skipping fullscreen for obstacle/airspace popup.");
        return; // Don't show these in fullscreen
      }

      // --- Handle Wind Station Popups (Always Fullscreen) ---
      if (popupEl && popupEl.querySelector('.wind-station-popup-content')) {
          console.log("Opening Wind Station popup in fullscreen mode.");
          showInFullscreen(ev.popup.getContent());
          return; // Stop further processing
      }

      // --- Handle Other Generic Popups (Conditional on Config) ---
      // Includes full spot popups if config is true, simplified spot popups are handled by Leaflet if config is false
      if (window.appConfig && window.appConfig.fullSpotsPopoup === true) {
          console.log("Opening generic popup in fullscreen mode (config enabled).");
          showInFullscreen(ev.popup.getContent());
          // Note: Simplified spot popups won't reach here if config is false
      } else {
          // If config is false, do nothing extra for other generic popups (like simplified spots).
          // Leaflet will handle the standard popup display.
          console.log("Skipping fullscreen for generic popup (config disabled).");
      }
    }
    // --- End Small Screen Logic ---
  });

  // closeFullscreenInfo function (no changes needed here)
  window.closeFullscreenInfo = function() {
    var el = document.getElementById('fullScreenInfo');
    el.classList.remove('visible');
    el.innerHTML = ''; // Clear the content
    document.getElementById('map').classList.remove('map-covered');
    window.map.closePopup(); // Close the Leaflet popup
  };

  // MapLibre GL layer
  var mapTilerTerrain = L.mapboxGL({
      style: '/assets/maps/maptiler_terrain_wob_testxc.json',
      apiKey: "c49iG8J3xvAkgCSZ8M8v",
      className: 'xcmap-layer',
      attribution: 'MapTiler Terrain'
  });

  var sat = L.tileLayer('http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}',{
      attribution: 'Map data: Google',
      maxZoom: 20,
      subdomains:['mt0','mt1','mt2','mt3']
  });

  var mbsat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{
    attribution: '© Esri',
    id: 'MapID',
  });

  var mapTilerTerrainOverlay = L.mapboxGL({
    style: '/assets/maps/maptiler_terrain_wob_testxc.json',
    apiKey: "c49iG8J3xvAkgCSZ8M8v",
    className: 'xcmap-layer satellite-overlay',
    attribution: 'MapTiler Terrain'
  });

  // Use the local proxy for kk7 thermals to avoid CORS issues
  var kk7thermals = L.tileLayer('/api/kk7thermals/{z}/{x}/{y}.png', {
    attribution: '<a href="https://thermal.kk7.ch">thermal.kk7.ch</a>',
    maxNativeZoom: 12,
    tms: true // Keep TMS if the original source uses it
    // Removed headers option as it's handled by the proxy
  });

// Create a simplified contour overlay specifically for use with satellite
var contourOverlay = L.tileLayer('https://api.maptiler.com/tiles/contours/{z}/{x}/{y}.pbf?key=c49iG8J3xvAkgCSZ8M8v', {
  attribution: 'MapTiler',
  opacity: 0.8,
  className: 'contour-overlay',
  style: {
      color: '#ffffff',
      weight: 1,
      opacity: 0.8
  }
});
  // Layer groups - make them globally accessible
  window.windLayer = L.layerGroup().addTo(window.map);

  window.oaipMap = L.tileLayer(`https://a.api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=${process.env.OAIP_KEY}`, {
      attribution: 'OpenAIP&copy; <a href="https://www.openaip.net">OpenAIP</a>',
      className: 'oaip-layer'
  });
  
  // Initialize RainViewer layers with error handling
  try {
    // Use different endpoints for radar and satellite to prevent conflicts
    window.rainviewerRadarLayer = L.timeDimension.layer.rainviewer("https://api.rainviewer.com/public/weather-maps.json", {
      opacity: 0.7,
      cache: 5, // Limit cache size to improve performance
      refreshInterval: 300000 // Refresh every 5 minutes
    }).addTo(window.map); // Add radar layer to map by default
    
    window.rainviewerSatelliteLayer = L.timeDimension.layer.rainviewer("https://api.rainviewer.com/public/weather-maps.json", {
      type: 'satellite',
      opacity: 0.7,
      cache: 5, // Limit cache size to improve performance
      refreshInterval: 300000 // Refresh every 5 minutes
    });
    
    console.log('RainViewer layers initialized successfully');
    
    // Ensure TimeDimension control is added to the map
    setTimeout(() => {
      updateTimeDimensionControlVisibility();
    }, 500); // Short delay to ensure the layer is fully added
  } catch (error) {
    console.error('Error initializing RainViewer layers:', error);
    // Create empty layers as fallbacks
    window.rainviewerRadarLayer = L.layerGroup();
    window.rainviewerSatelliteLayer = L.layerGroup();
  }
  
  // Create TimeDimension control with error handling
  try {
    window.timeDimensionControl = L.control.timeDimension({
      position: 'bottomleft',
      playerOptions: {
        transitionTime: 1000,
        loop: true,
        buffer: 2 // Reduce buffer size to improve performance
      },
      timeZones: ['Local'],
      autoPlay: true,
      speedSlider: false // Disable speed slider to simplify UI
    });
    console.log('TimeDimension control initialized successfully');
  } catch (error) {
    console.error('Error initializing TimeDimension control:', error);
    // Create a dummy control as fallback
    window.timeDimensionControl = {
      addTo: function() { console.log('Using dummy TimeDimension control'); }
    };
  }
  
  // Track if the TimeDimension control is added to the map
  window.isTimeDimensionControlAdded = false;
  // window.airspaceEFG = L.layerGroup([], { // Removed EFG airspaces
  //   attribution: 'OpenAIP&copy; <a href="https://www.openaip.net">OpenAIP</a>',
  // });
  window.airspaceGliding = L.layerGroup([], {
    attribution: 'OpenAIP&copy; <a href="https://www.openaip.net">OpenAIP</a>',
  });
  window.airspaceNotam = L.layerGroup([], {
    attribution: 'OpenAIP&copy; <a href="https://www.openaip.net">OpenAIP</a>',
  });
  window.airspaceXC = L.layerGroup([], {
    attribution: 'XContest&copy; <a href="https://xcontest.org">XContest</a>',
  });

  window.placesLayerPG = L.layerGroup( [], {
    attribution: '&copy; <a href="https://paraglidingspots.com">paraglidingspots.com</a>',
  });
  window.placesLayerHG = L.layerGroup([], {
    attribution: '&copy; <a href="https://paraglidingspots.com">paraglidingspots.com</a>',
  });
  window.placesLayerLZ = L.layerGroup([], {
    attribution: '&copy; <a href="https://paraglidingspots.com">paraglidingspots.com</a>',
  });

  function debugMapLayers() {
    console.log("Current map layers:");
    window.map.eachLayer(function(layer) {
        console.log(layer);
    });
  }

  // Generate dynamic airspace time options
  const airspaceTimeOptions = (() => {
    let options = '';
    for (let i = 0; i <= 6; i++) {
      const date = moment().add(i, 'days');
      const dayName = date.format('ddd');
      const dateValue = date.format('YYYY-MM-DD');
      options += `<option value="${dateValue}" ${i === 0 ? 'selected' : ''}>${
        i === 0 ? `Today` : dayName
      }</option>`;
    }
    return options;  // Removed the '+ '<option value="All">All</option>''
  })();


  // Tree structure
  var baseTree = {
    label: 'Base Maps',
    collapsed: true, // Add this line to collapse by default
    children: [
        { label: 'Terrain', layer: awgTerrain },
        { label: 'XContest', layer: L.layerGroup([xcontest, mapTilerTerrain])},
        { label: 'OpenStreetMap', layer: osm },
        { label: 'Satellite',  layer: sat },
    ]
};

  var overlayTree = {
      label: 'Overlays',
      children: [
          { label: 'Weather Stations',
            children: [
              { label: 'Weather Stations', layer: window.windLayer, checked: true  },
            ]
          },
          { html: '<hr class="leaflet-control-layers-separator">' }, // Separator
          { label: 'Rain Viewer',
            children: [
              { label: 'Radar', layer: window.rainviewerRadarLayer, checked: true  },
              { label: 'Satellite', layer: window.rainviewerSatelliteLayer },
            ]
          },
          { html: '<hr class="leaflet-control-layers-separator">' }, // Separator
          { label: 'Thermals',
            children: [
              { label: 'kk7 Thermals', layer: kk7thermals  },
            ]
          },
          { html: '<hr class="leaflet-control-layers-separator">' }, // Separator
          { label: 'Spots',
              children: [
                  { label: 'Take-off PG', layer: window.placesLayerPG },
                  { label: 'Take-off HG', layer: window.placesLayerHG },
                  { label: 'Landing Zones', layer: window.placesLayerLZ },
              ]
          },
          { html: '<hr class="leaflet-control-layers-separator">' }, // Separator
          { label: 'Airspaces',
              children: [
                      {
                        html: `
                            <div class="airspace-time-control">
                                Active:
                                <select class="airspace-time-select" id="airspaceTime">
                                    ${airspaceTimeOptions}
                                </select>
                            </div>
                        `
                      },
                      {
                        html: `
                            <div class="airspace-limit-control">
                                ↧ below:
                                <select class="lower-limit-select" id="airspaceLowerLimit">
                                    <option value="2000">2000m</option>
                                    <option value="2500">2500m</option>
                                    <option value="3000" selected>3000m</option>
                                    <option value="3500">3500m</option>
                                    <option value="4000">4000m</option>
                                    <option value="4500">4500m</option>
                                </select>
                            </div>
                        `
                      },
                  // { label: 'Airspaces', layer: window.airspaceEFG }, // Removed EFG airspaces layer from tree
                  { label: 'Airspaces', layer: window.airspaceXC },
                  { label: 'Obstacles', layer: window.obstacleLayer },
                  { label: 'OpenAIP Map', layer: window.oaipMap},
              ]
          },
      ]
  };


  new InfoControl({ position: 'bottomright' }).addTo(window.map);

  // Add logo control to the top left corner
  L.Control.Logo = L.Control.extend({
    onAdd: function(map) {
      const container = L.DomUtil.create('div', 'leaflet-control-logo');
      const img = L.DomUtil.create('img', 'logo-image', container);
      img.src = '/assets/images/XCmapsLogo.png';
      img.alt = 'XCmaps Logo';
      img.style.width = '120px'; // Adjust size as needed
      img.style.height = 'auto';

      // Prevent clicks on the logo from propagating to the map
      L.DomEvent.disableClickPropagation(container);

      return container;
    }
  });

  L.control.logo = function(opts) {
    return new L.Control.Logo(opts);
  };

  // Add the logo control to the map
  L.control.logo({ position: 'topleft' }).addTo(window.map);

  // Add locate control
  var lc = L.control
      .locate({
          drawCircle: false,
          keepCurrentZoomLevel: true,
          position: 'bottomright',
          icon: 'locate',
          iconLoading: 'loading',
          iconElementTag: 'div',
          setView: 'always', // Keep map centered on user's location
          flyTo: true // Use flyTo animation for smoother panning
      }).addTo(window.map);

  // Add layer control tree

  // Add layer control tree and make it global
  window.treeLayersControl = L.control.layers.tree(baseTree, overlayTree, {
    namedToggle: false,
    collapsed: true
  }).addTo(window.map);

  // Initialize with base tree collapsed and selected overlays expanded
  treeLayersControl.collapseTree(false).expandSelected(true);

  // Initialize AirspaceXC map listeners AFTER map and layer control are ready
  initializeAirspaceXCMapListeners(window.map);

  // Add touch support for mobile devices
  const layersControlContainer = treeLayersControl.getContainer();
  const layersControlToggle = layersControlContainer.querySelector('.leaflet-control-layers-toggle');

  // Function to detect if device is touch-only (no hover capability)
  const isTouchDevice = () => {
    return (('ontouchstart' in window) ||
            (navigator.maxTouchPoints > 0) ||
            (navigator.msMaxTouchPoints > 0));
  };

  // Add click handler for touch devices
  if (isTouchDevice()) {
    L.DomEvent.on(layersControlToggle, 'click', function(e) {
      L.DomEvent.stopPropagation(e);
      if (L.DomUtil.hasClass(layersControlContainer, 'leaflet-control-layers-expanded')) {
        L.DomUtil.removeClass(layersControlContainer, 'leaflet-control-layers-expanded');
      } else {
        L.DomUtil.addClass(layersControlContainer, 'leaflet-control-layers-expanded');
      }
    });

    // Close the control when clicking outside of it
    L.DomEvent.on(document, 'click', function() {
      if (L.DomUtil.hasClass(layersControlContainer, 'leaflet-control-layers-expanded')) {
        L.DomUtil.removeClass(layersControlContainer, 'leaflet-control-layers-expanded');
      }
    });

    // Prevent clicks inside the control from closing it
    L.DomEvent.on(layersControlContainer, 'click', function(e) {
      L.DomEvent.stopPropagation(e);
    });
  }



  // Central event handler for map movements
  // This will be the ONLY moveend handler for fetching data
  window.map.on('moveend', function() {
    console.log('Map moveend event triggered');

    // Check if windLayer is on the map and fetchWindStations exists
    if (window.map.hasLayer(window.windLayer) && typeof window.fetchWindStations === 'function') {
      console.log('Fetching wind stations after map move...');
      window.fetchWindStations();
    }

    // Only trigger fetch for visible spot layers
    if (window.map.hasLayer(window.placesLayerPG) && window.fetchPlacesPG) {
      console.log('Fetching PG spots after map move...');
      window.fetchPlacesPG();
    }

    if (window.map.hasLayer(window.placesLayerHG) && window.fetchPlacesHG) {
      console.log('Fetching HG spots after map move...');
      window.fetchPlacesHG();
    }

    if (window.map.hasLayer(window.placesLayerLZ) && window.fetchPlacesLZ) {
      console.log('Fetching LZ spots after map move...');
      window.fetchPlacesLZ();
    }

    // Airspaces EFG removed
    // if (window.map.hasLayer(window.airspaceEFG) && typeof window.fetchAirspaces === 'function') {
    //   console.log('Fetching airspaces after map move...');
    //   window.fetchAirspaces();
    // }
    // Airspaces Gliding
    if (window.map.hasLayer(window.airspaceGliding) && typeof window.fetchAirspacesGliding === 'function') {
      console.log('Fetching airspaces after map move...');
      window.fetchAirspacesGliding();
    }
    // Airspaces Notam
    if (window.map.hasLayer(window.airspaceNotam) && typeof window.fetchAirspacesNotam === 'function') {
      console.log('Fetching airspaces after map move...');
      window.fetchAirspacesNotam();
    }
    // Airspaces XContest
    if (window.map.hasLayer(window.airspaceXC) && typeof window.fetchAirspacesXC === 'function') {
      // Only fetch if no popup is currently open
      if (!window.map._popup) {
        console.log('Fetching XC airspaces after map move (no popup open)...');
        window.fetchAirspacesXC();
      } else {
        console.log('Skipping XC airspace fetch on moveend because popup is open.');
      }
    }
    // Obstacles XContest
    if (window.map.hasLayer(window.obstacleLayer) && typeof window.fetchObstacles === 'function') {
      console.log('Fetching airspaces after map move...');
      window.fetchObstacles();
    }
  });

  document.addEventListener('change', function(e) {
    if (e.target && e.target.id === 'airspaceLowerLimit') {
        console.log('Selected limit:', e.target.value);
    }
    // Add this new handler for the time selector
    if (e.target && e.target.id === 'airspaceTime') {
        console.log('Selected airspace date:', e.target.value);
    }
  });

  // Add layer change event listeners to fetch data when layers are added
  window.map.on('layeradd', function(e) {
    const layer = e.layer;

    // When a layer is added, fetch its data if needed
    if (layer === window.windLayer && typeof window.fetchWindStations === 'function') {
      window.fetchWindStations();
    } else if (layer === window.placesLayerPG && window.fetchPlacesPG) {
      window.fetchPlacesPG();
    } else if (layer === window.placesLayerHG && window.fetchPlacesHG) {
      window.fetchPlacesHG();
    } else if (layer === window.placesLayerLZ && window.fetchPlacesLZ) {
      window.fetchPlacesLZ();
    // } else if (layer === window.airspaceEFG && typeof window.fetchAirspaces === 'function') { // Removed EFG airspaces
    //   window.fetchAirspaces();
    } else if (layer === window.airspaceGliding && typeof window.fetchAirspacesGliding === 'function') {
      window.fetchAirspacesGliding();
    } else if (layer === window.airspaceNotam && typeof window.fetchAirspacesNotam === 'function') {
      window.fetchAirspacesNotam();
    } else if (layer === window.airspaceXC && typeof window.fetchAirspacesXC === 'function') {
      window.fetchAirspacesXC();
    } else if (layer === window.obstacleLayer && typeof window.fetchObstacles === 'function') {
      window.fetchObstacles();
    } else if (layer === window.rainviewerRadarLayer) {
      console.log('RainViewer Radar layer added via layeradd');
      updateTimeDimensionControlVisibility();
    } else if (layer === window.rainviewerSatelliteLayer) {
      console.log('RainViewer Satellite layer added via layeradd');
      updateTimeDimensionControlVisibility();
    }
  });
  
  // Function to check if any RainViewer layer is active
  function isAnyRainViewerLayerActive() {
    const hasRadar = window.map.hasLayer(window.rainviewerRadarLayer);
    const hasSatellite = window.map.hasLayer(window.rainviewerSatelliteLayer);
    console.log('RainViewer layer check - Radar:', hasRadar, 'Satellite:', hasSatellite);
    return hasRadar || hasSatellite;
  }
  
  // Function to update TimeDimension control visibility
  function updateTimeDimensionControlVisibility() {
    console.log('Updating TimeDimension control visibility');
    
    // Prevent multiple simultaneous calls
    if (window.isUpdatingTimeDimensionControl) {
      console.log('Already updating TimeDimension control, skipping');
      return;
    }
    
    window.isUpdatingTimeDimensionControl = true;
    
    try {
      const shouldBeVisible = isAnyRainViewerLayerActive();
      console.log('Should TimeDimension control be visible?', shouldBeVisible);
      console.log('Is TimeDimension control currently added?', window.isTimeDimensionControlAdded);
      
      if (shouldBeVisible) {
        if (!window.isTimeDimensionControlAdded) {
          try {
            console.log('Adding TimeDimension control to map');
            
            // Set a timeout to prevent hanging
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error('Adding TimeDimension control timed out')), 5000);
            });
            
            const addControlPromise = new Promise((resolve) => {
              window.timeDimensionControl.addTo(window.map);
              resolve();
            });
            
            // Use Promise.race to implement the timeout
            Promise.race([addControlPromise, timeoutPromise])
              .then(() => {
                window.isTimeDimensionControlAdded = true;
                console.log('TimeDimension control added to map successfully');
              })
              .catch(error => {
                console.error('Error adding TimeDimension control:', error);
              })
              .finally(() => {
                window.isUpdatingTimeDimensionControl = false;
              });
            
            return; // Exit early since we're handling the completion in the promise
          } catch (error) {
            console.error('Error adding TimeDimension control:', error);
          }
        } else {
          console.log('TimeDimension control already added, no action needed');
        }
      } else {
        if (window.isTimeDimensionControlAdded) {
          try {
            console.log('Removing TimeDimension control from map');
            window.map.removeControl(window.timeDimensionControl);
            window.isTimeDimensionControlAdded = false;
            console.log('TimeDimension control removed from map successfully');
          } catch (error) {
            console.error('Error removing TimeDimension control:', error);
          }
        } else {
          console.log('TimeDimension control already removed, no action needed');
        }
      }
    } catch (error) {
      console.error('Error in updateTimeDimensionControlVisibility:', error);
    }
    
    window.isUpdatingTimeDimensionControl = false;
  }
  
  // Handle RainViewer layer visibility with error handling and debouncing
  let rainviewerUpdateTimeout = null;
  
  // Function to format time display in 24-hour format (HH:MM)
  function updateTimeDisplay() {
    try {
      const timeControls = document.querySelectorAll('.leaflet-control-timecontrol.timecontrol-date');
      timeControls.forEach(control => {
        // Get the original text content
        const originalText = control.textContent || control.innerText;
        
        // Extract the time part including AM/PM using regex
        const timeMatch = originalText.match(/(\d{1,2}):(\d{2}):\d{2}\s*(AM|PM)?/i);
        if (timeMatch) {
          let hours = parseInt(timeMatch[1]);
          const minutes = timeMatch[2];
          const period = timeMatch[3] ? timeMatch[3].toUpperCase() : null;
          
          // Convert to 24-hour format if period is specified
          if (period === 'PM' && hours < 12) {
            hours += 12;
          } else if (period === 'AM' && hours === 12) {
            hours = 0;
          }
          
          // Format as HH:MM with leading zero
          const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes}`;
          
          // Update the text content
          control.textContent = formattedTime;
        }
      });
    } catch (error) {
      console.error('Error updating time display:', error);
    }
  }
  
  // Set up a MutationObserver to watch for changes to the time control
  function setupTimeControlObserver() {
    try {
      const observer = new MutationObserver(function(mutations) {
        updateTimeDisplay();
      });
      
      // Start observing the document with the configured parameters
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
      
      // Also update on initial load and periodically
      updateTimeDisplay();
      setInterval(updateTimeDisplay, 1000);
    } catch (error) {
      console.error('Error setting up time control observer:', error);
    }
  }
  
  // Call the setup function when the map is initialized
  document.addEventListener('map_initialized', setupTimeControlObserver);

  // Set up periodic refresh for RainViewer layers
  function setupRainViewerRefresh() {
    // Only set up the interval if not already set up
    if (!window.rainviewerRefreshInterval) {
      window.rainviewerRefreshInterval = setInterval(() => {
        try {
          // Check if either RainViewer layer is active
          const hasRadar = window.map.hasLayer(window.rainviewerRadarLayer);
          const hasSatellite = window.map.hasLayer(window.rainviewerSatelliteLayer);
          
          if (hasRadar || hasSatellite) {
            console.log('Refreshing RainViewer data...');
            
            // Refresh radar layer if active
            if (hasRadar) {
              fetchRainviewerMetadata("https://api.rainviewer.com/public/weather-maps.json")
                .then(metadata => {
                  window.rainviewerRadarLayer._metadata = metadata;
                  window.rainviewerRadarLayer._loaded = true;
                  if (window.map.hasLayer(window.rainviewerRadarLayer)) {
                    window.rainviewerRadarLayer._setAvailableTimes();
                  }
                })
                .catch(error => console.error('Error refreshing radar data:', error));
            }
            
            // Refresh satellite layer if active
            if (hasSatellite) {
              fetchRainviewerMetadata("https://api.rainviewer.com/public/weather-maps.json")
                .then(metadata => {
                  window.rainviewerSatelliteLayer._metadata = metadata;
                  window.rainviewerSatelliteLayer._loaded = true;
                  if (window.map.hasLayer(window.rainviewerSatelliteLayer)) {
                    window.rainviewerSatelliteLayer._setAvailableTimes();
                  }
                })
                .catch(error => console.error('Error refreshing satellite data:', error));
            }
          }
        } catch (error) {
          console.error('Error in RainViewer refresh:', error);
        }
      }, 60000); // 1 minute interval
    }
  }

  // Start the refresh when map is initialized
  document.addEventListener('map_initialized', setupRainViewerRefresh);
  
  function debouncedUpdateTimeDimensionControl() {
    // Clear any existing timeout
    if (rainviewerUpdateTimeout) {
      clearTimeout(rainviewerUpdateTimeout);
    }
    
    // Set a new timeout to update the control after a short delay
    rainviewerUpdateTimeout = setTimeout(() => {
      try {
        updateTimeDimensionControlVisibility();
        // Update time display after visibility is updated
        setTimeout(updateTimeDisplay, 500);
      } catch (error) {
        console.error('Error in debouncedUpdateTimeDimensionControl:', error);
      }
    }, 100); // 100ms debounce time
  }
  
  window.map.on('overlayadd', function(e) {
    try {
      console.log('overlayadd event triggered for layer:', e.name);
      if (e.layer === window.rainviewerRadarLayer) {
        console.log('RainViewer Radar layer added');
        debouncedUpdateTimeDimensionControl();
      } else if (e.layer === window.rainviewerSatelliteLayer) {
        console.log('RainViewer Satellite layer added');
        debouncedUpdateTimeDimensionControl();
      }
    } catch (error) {
      console.error('Error in overlayadd event handler:', error);
    }
  });
  
  window.map.on('overlayremove', function(e) {
    try {
      console.log('overlayremove event triggered for layer:', e.name);
      if (e.layer === window.rainviewerRadarLayer) {
        console.log('RainViewer Radar layer removed');
        debouncedUpdateTimeDimensionControl();
      } else if (e.layer === window.rainviewerSatelliteLayer) {
        console.log('RainViewer Satellite layer removed');
        debouncedUpdateTimeDimensionControl();
      }
    } catch (error) {
      console.error('Error in overlayremove event handler:', error);
    }
  });

  // Signal that the map is fully initialized
  window.mapInitialized = true;
  console.log("Map initialization complete");

  // Trigger an event that component scripts can listen for
  const mapReadyEvent = new Event('map_initialized');
  document.dispatchEvent(mapReadyEvent);
  console.log("Map initialized event dispatched");

  // Initialize Keycloak and create user control
  initKeycloak()
    .then(async (authenticated) => { // Make the callback async
      console.log('Keycloak initialized, authenticated:', authenticated);
      createUserControl();
      // Load preferences and check if a base layer was applied
      const baseLayerApplied = await loadUserPreferences();
      // If no base layer preference was loaded/applied, add the default
      if (!baseLayerApplied && window.map && !window.map.hasLayer(awgTerrain)) {
          console.log("No base layer preference found or applied, adding default Terrain layer.");
          awgTerrain.addTo(window.map);
          // Ensure the corresponding radio button is checked in the layer control
          const controlContainer = window.treeLayersControl?.getContainer();
          if (controlContainer) {
              const terrainRadio = controlContainer.querySelector('.leaflet-control-layers-base input[type="radio"]'); // Assuming Terrain is the first
              if (terrainRadio && !terrainRadio.checked) {
                  terrainRadio.checked = true; // Directly check it (less ideal than click, but avoids potential event issues)
              }
          }
      }
      loadUserPreferences(); // Load preferences after auth and control are ready
    })
    .catch(error => {
      console.error('Failed to initialize Keycloak:', error);
      // Still create the user control even if Keycloak fails
      createUserControl();
    });

  return window.map;
}

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', async function() { // Make listener async
    console.log("DOM content loaded, fetching config...");
    await fetchAppConfig(); // Fetch configuration first
    console.log("Config fetched, initializing map...");
    // Initialize the map
    const map = initMap();

// Setup geolocation after map is initialized
navigator.geolocation.getCurrentPosition(position => {
    console.log("Geolocation received");
    const userLat = position.coords.latitude;
    const userLng = position.coords.longitude;
    map.setView([userLat, userLng], 10);

    // Create a user location ready event
    const locationReadyEvent = new CustomEvent('user_location_ready', {
        detail: { lat: userLat, lng: userLng }
    });
    document.dispatchEvent(locationReadyEvent);
    console.log("User location event dispatched");
});

// Load component scripts after map is initialized

});

// Special patch for initial data loading
document.addEventListener('user_location_ready', function(e) {
console.log("Handling user location ready event");
setTimeout(() => {
    // Only call these functions if they exist, the map is fully initialized,
    // AND their respective layers are visible
    if (typeof window.fetchWindStations === 'function' &&
        window.mapInitialized &&
        window.map.hasLayer(window.windLayer)) {
        try {
            console.log("Fetching wind stations");
            window.fetchWindStations(e.detail.lat, e.detail.lng);
        } catch (error) {
            console.error('Error fetching wind stations:', error);
        }
    }

    if (typeof window.fetchAirspaces === 'function' &&
        window.mapInitialized &&
        window.map.hasLayer(window.airspaceEFG)) {
        try {
            console.log("Fetching airspaces");
            window.fetchAirspaces();
        } catch (error) {
            console.error('Error fetching airspaces:', error);
        }
    }

    if (typeof window.fetchAirspacesGliding === 'function' &&
      window.mapInitialized &&
      window.map.hasLayer(window.airspaceGliding)) {
      try {
          console.log("Fetching airspaces");
          window.fetchAirspacesGliding();
      } catch (error) {
          console.error('Error fetching airspaces:', error);
      }
    }

    if (typeof window.fetchAirspacesNotam === 'function' &&
      window.mapInitialized &&
      window.map.hasLayer(window.airspaceNotam)) {
      try {
          console.log("Fetching airspaces");
          window.fetchAirspacesNotam();
      } catch (error) {
          console.error('Error fetching airspaces:', error);
      }
    }

    if (typeof window.fetchAirspacesXC === 'function' &&
      window.mapInitialized &&
      window.map.hasLayer(window.airspaceXC)) {
      try {
          console.log("Fetching airspaces");
          window.fetchAirspacesXC();
      } catch (error) {
          console.error('Error fetching airspaces:', error);
      }
    }

    if (typeof window.fetchObstacles === 'function' &&
      window.mapInitialized &&
      window.map.hasLayer(window.obstacleLayer)) {
      try {
          console.log("Fetching obstacles");
          window.fetchObstacles();
      } catch (error) {
          console.error('Error fetching obstacles:', error);
      }
    }
}, 500); // Give a short delay to ensure all scripts are loaded
});
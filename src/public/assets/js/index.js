import L from 'leaflet'; // Explicitly import L first
import 'leaflet/dist/leaflet.css'; // Import Leaflet CSS
import { LocateControl } from 'leaflet.locatecontrol'; // Use named import
import 'leaflet.locatecontrol/dist/L.Control.Locate.min.css'; // Import locate control CSS
import 'maplibre-gl'; // Import maplibre-gl
import '@maplibre/maplibre-gl-leaflet'; // Use MapLibre GL Leaflet plugin (side-effect import)
import 'leaflet.markercluster'; // Import MarkerCluster JS for side effects
import 'leaflet.markercluster/dist/MarkerCluster.css'; // Import MarkerCluster CSS
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'; // Import MarkerCluster Default CSS

import './L.Control.Layers.Tree.js';
import '../css/L.Control.Layers.Tree.css';

import './leaflet.responsive.popup.js';
import './leaflet.responsive.popup.css';

// Import leaflet-timedimension
import 'leaflet-timedimension';
import 'leaflet-timedimension/dist/leaflet.timedimension.control.css';

// Ensure no duplicate locatecontrol imports remain

import '../css/styles.css';
import '../css/user-control.css';
import '../css/live.css';
import InfoControl from '../../../components/info-control.js';
import LiveControl from '../../../components/live.js';
import moment from 'moment';
import 'moment-timezone';

// Keep other imports as they are

// import './../../../components/airspaces.js'; // Removed EFG airspaces
import '../../../components/deprecated/airspaces-gliding.js';
import '../../../components/deprecated/airspaces-notam.js';
import './../../../components/airspaces-xc.js';
import './../../../components/windstations.js';
import { initSpotPG } from '../../../components/spots-pg.js';
import { initSpotHG } from '../../../components/spots-hg.js'; // Assuming similar export
import { initSpotLZ } from '../../../components/spots-lz.js'; // Assuming similar export
import '../../../components/obstacles.js';
import '../../../components/rainviewer.js';
import { initializeAirspaceXCMapListeners } from './../../../components/airspaces-xc.js';
import { keycloak, initKeycloak, createUserControl, loadUserPreferences, isUserAuthenticated } from '../../../components/keycloak-auth.js'; // Import necessary functions AND keycloak instance

// Define global layer objects and control states
window.baseLayers = {};
window.overlayLayers = {};
window.controlStates = {};

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


// Mappings for URL parameters to Leaflet layers/controls
const BASE_MAP_URL_MAP = {
  'terrain': 'jawgTerrain',
  'topo': 'esriTopo',
  'osm': 'osm',
  'satellite': 'sat'
};

const OVERLAY_URL_MAP = {
  'weather_stations': 'windStations',
  'radar': 'rainviewerRadar',
  'satellite': 'rainviewerSatellite',
  'kk7_thermals': 'kk7thermals',
  'kk7_skyways': 'kk7skyways',
  'take_off_pg': 'placesLayerPG',
  'take_off_hg': 'placesLayerHG',
  'landing_zones': 'placesLayerLZ',
  'airspaces': 'airspaceXC',
  'obstacles': 'obstacleLayer',
  'live': 'aircraftLayer'
};

// Function to parse URL parameters
window.parseUrlParameters = function() {
  const params = new URLSearchParams(window.location.search);
  const parsed = {
    baseMap: null,
    overlays: [],
    floorBelow: null,
    locateTrack: false
  };

  const baseParam = params.get('base');
  if (baseParam && BASE_MAP_URL_MAP[baseParam]) {
    parsed.baseMap = BASE_MAP_URL_MAP[baseParam];
  }

  const overlaysParam = params.get('overlays');
  if (overlaysParam) {
    const overlayKeys = overlaysParam.split(',');
    for (const key of overlayKeys) {
      if (OVERLAY_URL_MAP[key]) {
        parsed.overlays.push(OVERLAY_URL_MAP[key]);
      }
    }
  }

  const floorBelowParam = params.get('floor_below');
  if (floorBelowParam && !isNaN(parseInt(floorBelowParam))) {
    parsed.floorBelow = parseInt(floorBelowParam);
  }

  const locateTrackParam = params.get('locate_track');
  if (locateTrackParam === 'true') {
    parsed.locateTrack = true;
  }

  return parsed;
}

// Function to update URL parameters
window.updateUrlParameters = function() {
  if (window.isInitialLoad) {
    return;
  }
  const currentParams = new URLSearchParams(window.location.search);
  const newParams = new URLSearchParams();

  let currentBaseMapKey = null;
  for (const key in BASE_MAP_URL_MAP) {
    if (window.baseLayers[BASE_MAP_URL_MAP[key]] && window.map.hasLayer(window.baseLayers[BASE_MAP_URL_MAP[key]])) {
      currentBaseMapKey = key;
      break;
    }
  }
  if (currentBaseMapKey) {
    newParams.set('base', currentBaseMapKey);
  }

  const activeOverlays = [];
  for (const key in OVERLAY_URL_MAP) {
    const layerVarName = OVERLAY_URL_MAP[key];
    if (layerVarName === 'aircraftLayer') {
      if (window.aircraftLayer && window.map.hasLayer(window.aircraftLayer)) {
        activeOverlays.push(key);
      }
    } else if (window.overlayLayers[layerVarName] && window.map.hasLayer(window.overlayLayers[layerVarName])) {
      activeOverlays.push(key);
    }
  }
  if (activeOverlays.length > 0) {
    newParams.set('overlays', activeOverlays.join(','));
  } else {
    newParams.delete('overlays');
  }

  const airspaceLowerLimitSelect = document.getElementById('airspaceLowerLimit');
  if (airspaceLowerLimitSelect && airspaceLowerLimitSelect.value) {
    newParams.set('floor_below', airspaceLowerLimitSelect.value);
  } else {
    newParams.delete('floor_below');
  }

  if (window.lc && window.lc._active) {
    newParams.set('locate_track', 'true');
  } else {
    newParams.delete('locate_track');
  }

  const newUrl = `${window.location.pathname}?${newParams.toString()}${window.location.hash}`;
  if (window.location.search !== `?${newParams.toString()}`) {
    history.replaceState({}, '', newUrl);
  }
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
    return options;
  })();
function setupPostMapInitializationListeners(urlParams) {
var baseTree = {
    label: 'Base Maps',
    collapsed: true,
    children: [
        { label: 'Terrain - JawgMaps', layer: window.baseLayers.jawgTerrain },
        { label: 'Topo - Esri', layer: window.baseLayers.esriTopo },
        { label: 'OpenStreetMap', layer: window.baseLayers.osm },
        { label: 'Satellite',  layer: window.baseLayers.sat },
    ]
  };

  var overlayTree = {
      label: 'Overlays',
      children: [
          { label: 'Weather Stations',
            children: [
              { label: 'Weather Stations', layer: window.overlayLayers.windStations, checked: true  },
            ]
          },
          { html: '<hr class="leaflet-control-layers-separator">' },
          { label: 'Rain Viewer',
            children: [
              { label: 'Radar', layer: window.overlayLayers.rainviewerRadar, checked: true  },
              { label: 'Satellite', layer: window.overlayLayers.rainviewerSatellite },
            ]
          },
          { html: '<hr class="leaflet-control-layers-separator">' },
          { label: 'Thermals',
            children: [
              { label: 'kk7 Thermals', layer: window.overlayLayers.kk7thermals  },
              { label: 'kk7 Skyways', layer: window.overlayLayers.kk7skyways  },
            ]
          },
          { html: '<hr class="leaflet-control-layers-separator">' },
          { label: 'Spots',
              children: [
                  { label: 'Take-off PG', layer: window.placesLayerPG },
                  { label: 'Take-off HG', layer: window.placesLayerHG },
                  { label: 'Landing Zones', layer: window.placesLayerLZ },
              ]
          },
          { html: '<hr class="leaflet-control-layers-separator">' },
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
                                    <option value="3000">3000m</option>
                                    <option value="3500">3500m</option>
                                    <option value="4000">4000m</option>
                                    <option value="4500">4500m</option>
                                </select>
                            </div>
                        `
                      },
                  { label: 'Airspaces', layer: window.overlayLayers.airspaceXC },
                  { label: 'Trigger NOTAM', layer: window.airspaceTriggerNotam },
                  { label: 'Obstacles', layer: window.overlayLayers.obstacleLayer },
                  { label: 'OpenAIP Map', layer: window.overlayLayers.oaipMap},
              ]
          },
      ]
  };
  // Add layer control tree and make it global
  window.treeLayersControl = L.control.layers.tree(baseTree, overlayTree, {
    namedToggle: false,
    collapsed: true
  }).addTo(window.map);
const airspaceLowerLimitSelect = document.getElementById('airspaceLowerLimit');
  if (airspaceLowerLimitSelect && urlParams.floorBelow !== null) {
    const optionExists = Array.from(airspaceLowerLimitSelect.options).some(option => parseInt(option.value) === urlParams.floorBelow);
    if (optionExists) {
      airspaceLowerLimitSelect.value = urlParams.floorBelow;
      console.log(`Set airspace lower limit from URL: ${urlParams.floorBelow}`);
      airspaceLowerLimitSelect.dispatchEvent(new Event('change'));
    } else {
      console.warn(`URL parameter floor_below=${urlParams.floorBelow} is not a valid option.`);
    }
  }
// Apply airspace lower limit from URL parameters

  // Initialize with base tree collapsed and selected overlays expanded
  window.treeLayersControl.collapseTree(false).expandSelected(true);

  const layersControlContainer = window.treeLayersControl.getContainer();
  const layersControlToggle = layersControlContainer.querySelector('.leaflet-control-layers-toggle');

  const isTouchDevice = () => {
    return (('ontouchstart' in window) ||
            (navigator.maxTouchPoints > 0) ||
            (navigator.msMaxTouchPoints > 0));
  };

  if (isTouchDevice()) {
    L.DomEvent.on(layersControlToggle, 'click', function(e) {
      L.DomEvent.stopPropagation(e);
      if (L.DomUtil.hasClass(layersControlContainer, 'leaflet-control-layers-expanded')) {
        L.DomUtil.removeClass(layersControlContainer, 'leaflet-control-layers-expanded');
      } else {
        L.DomUtil.addClass(layersControlContainer, 'leaflet-control-layers-expanded');
      }
    });

    L.DomEvent.on(document, 'click', function() {
      if (L.DomUtil.hasClass(layersControlContainer, 'leaflet-control-layers-expanded')) {
        L.DomUtil.removeClass(layersControlContainer, 'leaflet-control-layers-expanded');
      }
    });

    L.DomEvent.on(layersControlContainer, 'click', function(e) {
      L.DomEvent.stopPropagation(e);
    });
  }

  // Update URL parameters when base layer changes

  // Update URL parameters when overlay layers are added or removed
  window.map.on('overlayadd', function (e) {
    console.log('Overlay added:', e.name);
    window.updateUrlParameters();
  });

  window.map.on('overlayremove', function (e) {
    console.log('Overlay removed:', e.name);
    window.updateUrlParameters();
  });

  // Update URL parameters when airspace lower limit changes
}
const airspaceLowerLimitSelect = document.getElementById('airspaceLowerLimit');
  if (airspaceLowerLimitSelect) {
    airspaceLowerLimitSelect.addEventListener('change', function() {
      console.log('Airspace lower limit changed:', this.value);
      window.updateUrlParameters();
    });
  }

// Initialize map and make necessary objects globally available
let mapInitialized = false; // Flag to prevent multiple initializations

function initMap() {
  if (mapInitialized) {
      console.log("Map already initialized, skipping re-initialization.");
      return window.map; // Return existing map instance
  }
  mapInitialized = true; // Set flag early
  console.log("Initializing map for the first time...");

  // Define Base Layers
  window.baseLayers.esriTopo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Esri; © <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors'
  });

  window.baseLayers.jawgTerrain = L.maplibreGL({
    style: `https://api.jawg.io/styles/jawg-terrain.json?access-token=${process.env.JAWG_ACCESS_TOKEN}&lang=&extrude=&worldview=&draft=`,
    attribution: '<a href="https://jawg.io" title="Tiles Courtesy of Jawg Maps" target="_blank" class="jawg-attrib">&copy; <b>Jawg</b>Maps</a> | <a href="https://www.openstreetmap.org/copyright" title="OpenStreetMap is open data licensed under ODbL" target="_blank" class="osm-attrib">&copy; OSM contributors</a>',
    maxZoom: 22
  });

  window.baseLayers.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
  });

  window.baseLayers.sat = L.tileLayer('http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}',{
      attribution: 'Map data: Google',
      maxZoom: 20,
      subdomains:['mt0','mt1','mt2','mt3']
  });
window.overlayLayers.windStations = L.layerGroup();
  window.windLayer = window.overlayLayers.windStations; // Expose windLayer globally for windstations.js
  window.overlayLayers.airspaceXC = L.layerGroup([], {
    attribution: '&copy; <a href="https://xcontest.org">XContest</a>',
  });
  window.airspaceXC = window.overlayLayers.airspaceXC; // Expose airspaceXC globally for airspaces-xc.js
  window.airspaceTriggerNotam = L.layerGroup([], {
    attribution: '&copy; <a href="https://xcontest.org">XContest</a>',
  });

  // Define Overlay Layers
  window.overlayLayers.kk7thermals = L.tileLayer('/api/kk7thermals/{z}/{x}/{y}.png', {
    attribution: '<a href="https://thermal.kk7.ch">thermal.kk7.ch</a>',
    maxNativeZoom: 12,
    tms: true
  });
  window.overlayLayers.kk7skyways = L.tileLayer('/api/kk7skyways/{z}/{x}/{y}.png', {
    attribution: '<a href="https://thermal.kk7.ch">thermal.kk7.ch</a>',
    maxNativeZoom: 12,
    tms: true
  });
  window.placesLayerPG = L.layerGroup();
  window.placesLayerHG = L.layerGroup();
  window.placesLayerLZ = L.layerGroup();

  // Add these to overlayLayers for URL parameter handling and layer control
  window.overlayLayers.placesLayerPG = window.placesLayerPG;
  window.overlayLayers.placesLayerHG = window.placesLayerHG;
  window.overlayLayers.placesLayerLZ = window.placesLayerLZ;
  window.overlayLayers.obstacleLayer = L.layerGroup(); // Initialize obstacleLayer
  window.overlayLayers.oaipMap = L.tileLayer(`https://a.api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=${process.env.OAIP_KEY}`, {
      attribution: '&copy; <a href="https://www.openaip.net">OpenAIP</a>',
      className: 'oaip-layer'
  });

  // Initialize RainViewer layers with error handling
  try {
    window.overlayLayers.rainviewerRadar = L.timeDimension.layer.rainviewer("https://api.rainviewer.com/public/weather-maps.json", {
      opacity: 0.7,
      cache: 5,
      refreshInterval: 300000
    });
    window.overlayLayers.rainviewerSatellite = L.timeDimension.layer.rainviewer("https://api.rainviewer.com/public/weather-maps.json", {
      type: 'satellite',
      opacity: 0.7,
      cache: 5,
      refreshInterval: 300000
    });
    console.log('RainViewer layers initialized successfully');
  } catch (error) {
    console.error('Error initializing RainViewer layers:', error);
    window.overlayLayers.rainviewerRadar = L.layerGroup();
    window.overlayLayers.rainviewerSatellite = L.layerGroup();
  }

  // Parse URL parameters for initial map state
  const urlParams = parseUrlParameters();
  let initialBaseLayer = window.baseLayers.jawgTerrain; // Default base layer

  if (urlParams.baseMap && window.baseLayers[urlParams.baseMap]) {
    initialBaseLayer = window.baseLayers[urlParams.baseMap];
    console.log(`Setting initial base map from URL: ${urlParams.baseMap}`);
  }

  // Create the map object and make it globally accessible
  window.map = L.map('map', {
      center: [50, 6],
      zoom: 9,
      zoomControl: false,
      layers: [
        initialBaseLayer,
        window.airspaceTriggerNotam
      ],
      dragging: true,
      timeDimension: true,
      maxZoom: 22
  });

  L.control.zoom({
      position: 'bottomright',
  }).addTo(window.map);

  /* JS */
    // Modified popupopen handler
  window.map.on('popupopen', function(ev){
    const el = document.getElementById('fullScreenInfo');
    const screenWidthThreshold = 768; // Match CSS media query
    const popupEl = ev.popup.getElement(); // Get popup DOM element

    // Helper function to show content in fullscreen modal
    window.showInFullscreen = function(content) { // Make it global
        console.log("Attempting to show content in fullscreen modal.");
        window.map.closePopup(); // Close small popup first
        const el = document.getElementById('fullScreenInfo'); // Get el here, as it's needed by this global function
        if (!el) {
            console.error("Fullscreen info element not found!");
            return;
        }
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
   // var mapTilerTerrain = L.mapboxGL({
   //     style: '/assets/maps/maptiler_terrain_wob_testxc.json',
   //     apiKey: "c49iG8J3xvAkgCSZ8M8v",
   //     className: 'xcmap-layer',
    //    attribution: 'MapTiler Terrain'
   // });

  // Create TimeDimension control with error handling
  try {
    window.timeDimensionControl = L.control.timeDimension({
      position: 'bottomleft',
      playerOptions: {
        transitionTime: 1000,
        loop: true,
        buffer: 2
      },
      timeZones: ['Local'],
      autoPlay: true,
      speedSlider: false
    });
    console.log('TimeDimension control initialized successfully');
  } catch (error) {
    console.error('Error initializing TimeDimension control:', error);
    window.timeDimensionControl = {
      addTo: function() { console.log('Using dummy TimeDimension control'); }
    };
  }

  window.isTimeDimensionControlAdded = false;
  window.airspaceGliding = L.layerGroup([], {
    attribution: '&copy; <a href="https://www.openaip.net">OpenAIP</a>',
  });
  window.airspaceNotam = L.layerGroup([], {
    attribution: '&copy; <a href="https://www.openaip.net">OpenAIP</a>',
  });
  window.airspaceTriggerNotam = L.layerGroup([], {
    attribution: '&copy; <a href="https://xcontest.org">XContest</a>',
  });

  function debugMapLayers() {
    console.log("Current map layers:");
    window.map.eachLayer(function(layer) {
        console.log(layer);
    });
  }

  // Generate dynamic airspace time options

  // Tree structure for layer control


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
  // Define icon paths for the locate control
  const locateInactiveIcon = '/assets/images/track-inactive.svg';
  const locateActiveIcon = '/assets/images/track-active.svg';

  // Create a custom locate control that uses XCTrack.getLocation() when available
  window.lc = new LocateControl({
      position: 'bottomright',
      drawCircle: false,
      keepCurrentZoomLevel: true,
      setView: 'always',
      flyTo: true,
      strings: {
          title: "Show current location"
      },
      icon: 'leaflet-control-locate-location-arrow',
      iconLoading: 'leaflet-control-locate-spinner',
      iconElementTag: 'span',
      // Use default marker style (blue dot with white circle)
      // Override the default locate method to use XCTrack when available
      getLocationBounds: function() {
          return null; // We'll handle this ourselves
      },
      getLocationOptions: function() {
          return {}; // We'll handle this ourselves
      }
  }).addTo(window.map);

  // Override the locate method to use XCTrack.getLocation() when available
  const originalStartLocate = window.lc.start;
  const originalStopLocate = window.lc.stop; // Store original stop method
  const originalIconLoading = window.lc.options.iconLoading; // Store original iconLoading

  window.lc.start = function() {
      console.log("Custom locate control activated");
      if (typeof XCTrack !== 'undefined' && typeof XCTrack.getLocation === 'function') {
          console.log("Using XCTrack.getLocation() for locate control");
          
          // Use the spinner class to indicate that the locate control is active
          this._icon.classList.remove(this.options.icon);
          this._icon.classList.add(originalIconLoading); // Add the spinner class
          
          // Clear any existing tracking interval
          if (this._xcTrackTrackingInterval) {
              clearInterval(this._xcTrackTrackingInterval);
              this._xcTrackTrackingInterval = null;
          }
          
          // Function to update location from XCTrack
          const updateLocationFromXCTrack = () => {
              try {
                  // Get location data from XCTrack
                  let location = XCTrack.getLocation();
                  
                  // Handle the case where it might be a string (from some XCTrack versions)
                  if (typeof location === 'string') {
                      try {
                          location = JSON.parse(location);
                      } catch (e) {
                          console.error("Failed to parse XCTrack location string:", e);
                      }
                  }
                  
                  // Check if location is valid with proper type checking
                  if (location && typeof location.lat !== 'undefined' && typeof location.lon !== 'undefined') {
                      const userLat = location.lat;
                      const userLng = location.lon;
                      
                      // Only log if position has changed significantly
                      if (!this._lastPosition ||
                          Math.abs(this._lastPosition.lat - userLat) > 0.00001 ||
                          Math.abs(this._lastPosition.lng - userLng) > 0.00001) {
                          console.log("XCTrack position updated:", location);
                          this._lastPosition = { lat: userLat, lng: userLng };
                      }
                      
                      // Update the map view if this is the first location or if follow is enabled
                      if (!this._marker || this._following) {
                          window.map.setView([userLat, userLng], window.map.getZoom());
                      }
                      
                      // Set the locate control as active
                      this._active = true;
                      this._updateContainerStyle();
                      
                      // Ensure spinner class remains applied during tracking
                      this._icon.classList.remove(this.options.icon);
                      this._icon.classList.add(originalIconLoading);
                      
                      // Create or update the marker using the default style (blue dot with white circle)
                      if (!this._marker) {
                          // Create a marker with the exact style used by leaflet-control-locate-location
                          this._marker = L.circleMarker([userLat, userLng], {
                              color: '#fff',          // stroke color
                              weight: 3,              // stroke width
                              fillColor: '#2A93EE',   // fill color
                              fillOpacity: 1,         // fill opacity
                              opacity: 1,             // stroke opacity
                              radius: 7               // slightly larger radius to match the standard marker
                          }).addTo(this._layer);
                      } else {
                          this._marker.setLatLng([userLat, userLng]);
                      }
                      
                      // Dispatch a custom event for other components
                      const locationReadyEvent = new CustomEvent('user_location_ready', {
                          detail: { lat: userLat, lng: userLng }
                      });
                      document.dispatchEvent(locationReadyEvent);
                  } else {
                      console.warn("XCTrack location data is incomplete:", location);
                  }
              } catch (error) {
                  console.error("Error updating location from XCTrack:", error);
                  // Don't fallback to standard geolocation here, just log the error
                  // We'll try again on the next interval
              }
          };
          
          // Immediately update location and then set interval
          updateLocationFromXCTrack();
          this._xcTrackTrackingInterval = setInterval(updateLocationFromXCTrack, 1000); // Poll every 1 second
          
          // Set the locate control as active and ensure spinner is shown
          this._active = true;
          this._updateContainerStyle();
          
          // Make sure the spinner class stays applied
          this._icon.classList.remove(this.options.icon);
          this._icon.classList.add(originalIconLoading);
          
      } else {
          // If XCTrack is not available, call the original start method
          originalStartLocate.apply(this, arguments);
      }
  };

  window.lc.stop = function() {
      console.log("Custom locate control deactivated");
      // No need to restore the original iconLoading option as we're not changing it anymore
      
      // Clear the XCTrack tracking interval if it exists
      if (this._xcTrackTrackingInterval) {
          clearInterval(this._xcTrackTrackingInterval);
          this._xcTrackTrackingInterval = null;
      }
      
      // Call the original stop method
      originalStopLocate.apply(this, arguments);
  };


  initializeAirspaceXCMapListeners(window.map);

  let windRefreshIntervalId = null;
  const refreshWindStations = () => {
    if (window.map.hasLayer(window.overlayLayers.windStations)) {
      console.log('[Wind Refresh Interval] Calling fetchWindStations...');
      fetchWindStations();
    } else {
      console.log('[Wind Refresh Interval] Layer not active, skipping refresh and clearing interval.');
      if (windRefreshIntervalId) {
        clearInterval(windRefreshIntervalId);
        windRefreshIntervalId = null;
        console.log('Cleared wind refresh interval due to layer removal.');
      }
    }
  };

  window.map.on('layeradd', function(e) {
      if (e.layer === window.overlayLayers.windStations) {
          console.log('[Wind Layer] Layer added. Initial fetch and starting refresh interval.');
          if (windRefreshIntervalId) {
              console.log('[Wind Layer] Clearing pre-existing interval ID:', windRefreshIntervalId);
              clearInterval(windRefreshIntervalId);
          }
          refreshWindStations();
          windRefreshIntervalId = setInterval(refreshWindStations, 60000);
          console.log('[Wind Layer] Refresh interval started with ID:', windRefreshIntervalId);
      }
      updateUrlParameters();
  });

  window.map.on('layerremove', function(e) {
      if (e.layer === window.overlayLayers.windStations) {
          console.log('[Wind Layer] Layer removed, clearing refresh interval ID:', windRefreshIntervalId);
          if (windRefreshIntervalId) {
              clearInterval(windRefreshIntervalId);
              windRefreshIntervalId = null;
          }
      }
      updateUrlParameters();
  });


  window.map.on('moveend', function() {
    console.log('Map moveend event triggered');

    if (window.map.hasLayer(window.overlayLayers.windStations) && typeof window.fetchWindStations === 'function') {
      console.log('Fetching wind stations after map move...');
      window.fetchWindStations();
    }

    if (window.map.hasLayer(window.overlayLayers.placesLayerPG) && window.fetchPlacesPG) {
      console.log('Fetching PG spots after map move...');
      window.fetchPlacesPG();
    }

    if (window.map.hasLayer(window.overlayLayers.placesLayerHG) && window.fetchPlacesHG) {
      console.log('Fetching HG spots after map move...');
      window.fetchPlacesHG();
    }

    if (window.map.hasLayer(window.overlayLayers.placesLayerLZ) && window.fetchPlacesLZ) {
      console.log('Fetching LZ spots after map move...');
      window.fetchPlacesLZ();
    }

    if (window.map.hasLayer(window.airspaceGliding) && typeof window.fetchAirspacesGliding === 'function') {
      console.log('Fetching airspaces after map move...');
      window.fetchAirspacesGliding();
    }
    if (window.map.hasLayer(window.airspaceNotam) && typeof window.fetchAirspacesNotam === 'function') {
      console.log('Fetching airspaces after map move...');
      window.fetchAirspacesNotam();
    }
    if ((window.map.hasLayer(window.overlayLayers.airspaceXC) || window.map.hasLayer(window.airspaceTriggerNotam)) && typeof window.fetchAirspacesXC === 'function') {
      if (!window.map._popup) {
        console.log('Fetching XC/Trigger airspaces after map move (no popup open)...');
        window.fetchAirspacesXC();
      } else {
        console.log('Skipping XC airspace fetch on moveend because popup is open.');
      }
    }
    if (window.map.hasLayer(window.overlayLayers.obstacleLayer) && typeof window.fetchObstacles === 'function') {
      console.log('Fetching obstacles after map move...');
      window.fetchObstacles();
    }
  });

  document.addEventListener('change', function(e) {
    if (e.target && e.target.id === 'airspaceLowerLimit') {
        console.log('Selected limit:', e.target.value);
        updateUrlParameters();
if (window.lc) {
    window.lc.on('start', function() {
      console.log('Locate control started');
      window.updateUrlParameters();
    });
    window.lc.on('stop', function() {
      console.log('Locate control stopped');
      window.updateUrlParameters();
    });


    window.map.on('locateactivate', function() {
        console.log("Locate activated");
        updateUrlParameters();
    });

    window.map.on('locatedeactivate', function() {
        console.log("Locate deactivated");
        updateUrlParameters();
    });

    window.map.on('locationfound', function(e) {
        console.log("Location found");
    });

    window.map.on('locationerror', function(e) {
        console.error("Location error:", e.message);
        updateUrlParameters();
    });
  }
    }
    if (e.target && e.target.id === 'airspaceTime') {
        console.log('Selected airspace date:', e.target.value);
    }
  });

  window.map.on('layeradd', function(e) {
    const layer = e.layer;

    if (layer === window.overlayLayers.windStations && typeof window.fetchWindStations === 'function') {
      window.fetchWindStations();
    } else if (layer === window.overlayLayers.placesLayerPG && window.fetchPlacesPG) {
      window.fetchPlacesPG();
    } else if (layer === window.overlayLayers.placesLayerHG && window.fetchPlacesHG) {
      window.fetchPlacesHG();
    } else if (layer === window.overlayLayers.placesLayerLZ && window.fetchPlacesLZ) {
      window.fetchPlacesLZ();
    } else if (layer === window.airspaceGliding && typeof window.fetchAirspacesGliding === 'function') {
      window.fetchAirspacesGliding();
    } else if (layer === window.airspaceNotam && typeof window.fetchAirspacesNotam === 'function') {
      window.fetchAirspacesNotam();
    } else if ((layer === window.overlayLayers.airspaceXC || layer === window.airspaceTriggerNotam) && typeof window.fetchAirspacesXC === 'function') {
      window.fetchAirspacesXC();
    } else if (layer === window.overlayLayers.obstacleLayer && typeof window.fetchObstacles === 'function') {
      window.fetchObstacles();
    } else if (layer === window.overlayLayers.rainviewerRadar) {
      console.log('RainViewer Radar layer added via layeradd');
      debouncedUpdateTimeDimensionControl();
    } else if (layer === window.overlayLayers.rainviewerSatellite) {
      console.log('RainViewer Satellite layer added via layeradd');
      debouncedUpdateTimeDimensionControl();
    }
    updateUrlParameters();
  });

  function isAnyRainViewerLayerActive() {
    const hasRadar = window.map.hasLayer(window.overlayLayers.rainviewerRadar);
    const hasSatellite = window.map.hasLayer(window.overlayLayers.rainviewerSatellite);
    console.log('RainViewer layer check - Radar:', hasRadar, 'Satellite:', hasSatellite);
    return hasRadar || hasSatellite;
  }

  function updateTimeDimensionControlVisibility() {
    console.log('Updating TimeDimension control visibility');

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

            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error('Adding TimeDimension control timed out')), 5000);
            });

            const addControlPromise = new Promise((resolve) => {
              window.timeDimensionControl.addTo(window.map);
              resolve();
            });

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

            return;
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

  let rainviewerUpdateTimeout = null;

  function updateTimeDisplay() {
    try {
      const timeControls = document.querySelectorAll('.leaflet-control-timecontrol.timecontrol-date');
      timeControls.forEach(control => {
        const originalText = control.textContent || control.innerText;
        const timeMatch = originalText.match(/(\d{1,2}):(\d{2}):\d{2}\s*(AM|PM)?/i);
        if (timeMatch) {
          let hours = parseInt(timeMatch[1]);
          const minutes = timeMatch[2];
          const period = timeMatch[3] ? timeMatch[3].toUpperCase() : null;

          if (period === 'PM' && hours < 12) {
            hours += 12;
          } else if (period === 'AM' && hours === 12) {
            hours = 0;
          }

          const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes}`;
          control.textContent = formattedTime;
        }
      });
    } catch (error) {
      console.error('Error updating time display:', error);
    }
  }

  function setupTimeControlObserver() {
    try {
      const observer = new MutationObserver(function(mutations) {
        updateTimeDisplay();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      updateTimeDisplay();
      setInterval(updateTimeDisplay, 1000);
    } catch (error) {
      console.error('Error setting up time control observer:', error);
    }
  }

  document.addEventListener('map_initialized', setupTimeControlObserver);

  function setupRainViewerRefresh() {
    if (!window.rainviewerRefreshInterval) {
      window.rainviewerRefreshInterval = setInterval(() => {
        try {
          const hasRadar = window.map.hasLayer(window.overlayLayers.rainviewerRadar);
          const hasSatellite = window.map.hasLayer(window.overlayLayers.rainviewerSatellite);

          if (hasRadar || hasSatellite) {
            console.log('Refreshing RainViewer data...');

            if (hasRadar) {
              fetch("https://api.rainviewer.com/public/weather-maps.json")
                .then(response => response.json())
                .then(metadata => {
                  window.overlayLayers.rainviewerRadar._metadata = metadata;
                  window.overlayLayers.rainviewerRadar._loaded = true;
                  if (window.map.hasLayer(window.overlayLayers.rainviewerRadar)) {
                    window.overlayLayers.rainviewerRadar._setAvailableTimes();
                  }
                })
                .catch(error => console.error('Error refreshing radar data:', error));
            }

            if (hasSatellite) {
              fetch("https://api.rainviewer.com/public/weather-maps.json")
                .then(response => response.json())
                .then(metadata => {
                  window.overlayLayers.rainviewerSatellite._metadata = metadata;
                  window.overlayLayers.rainviewerSatellite._loaded = true;
                  if (window.map.hasLayer(window.overlayLayers.rainviewerSatellite)) {
                    window.overlayLayers.rainviewerSatellite._setAvailableTimes();
                  }
                })
                .catch(error => console.error('Error refreshing satellite data:', error));
            }
          }
        } catch (error) {
          console.error('Error in RainViewer refresh:', error);
        }
      }, 60000);
    }
  }

  document.addEventListener('map_initialized', setupRainViewerRefresh);

  function debouncedUpdateTimeDimensionControl() {
    if (rainviewerUpdateTimeout) {
      clearTimeout(rainviewerUpdateTimeout);
    }

    rainviewerUpdateTimeout = setTimeout(() => {
      try {
        updateTimeDimensionControlVisibility();
        setTimeout(updateTimeDisplay, 500);
      } catch (error) {
        console.error('Error in debouncedUpdateTimeDimensionControl:', error);
      }
    }, 100);
  }

  window.map.on('overlayadd', function(e) {
    try {
      console.log('overlayadd event triggered for layer:', e.name);
      if (e.layer === window.overlayLayers.rainviewerRadar) {
        console.log('RainViewer Radar layer added');
        debouncedUpdateTimeDimensionControl();
      } else if (e.layer === window.overlayLayers.rainviewerSatellite) {
        console.log('RainViewer Satellite layer added');
        debouncedUpdateTimeDimensionControl();
      }
      updateUrlParameters();
    } catch (error) {
      console.error('Error in overlayadd event handler:', error);
    }
  });

  window.map.on('overlayremove', function(e) {
    try {
      console.log('overlayremove event triggered for layer:', e.name);
      if (e.layer === window.overlayLayers.rainviewerRadar) {
        console.log('RainViewer Radar layer removed');
        debouncedUpdateTimeDimensionControl();
      } else if (e.layer === window.overlayLayers.rainviewerSatellite) {
        console.log('RainViewer Satellite layer removed');
        debouncedUpdateTimeDimensionControl();
      }
      updateUrlParameters();
    } catch (error) {
      console.error('Error in overlayremove event handler:', error);
    }
  });

  window.map.on('baselayerchange', function(e) {
      console.log('baselayerchange event triggered for layer:', e.name);
      updateUrlParameters();
  });

  window.mapInitialized = true;
  console.log("Map initialization complete");

  const mapReadyEvent = new Event('map_initialized');
  document.dispatchEvent(mapReadyEvent);
  console.log("Map initialized event dispatched");

  return window.map;
} // End of initMap function

// Function to add the Live Control if conditions are met
function addLiveControlIfNeeded() {
  console.log("Checking if Live Control should be added...");
  console.log("Config live:", window.appConfig?.live);
  console.log("Keycloak authenticated:", keycloak?.authenticated);
  console.log("User has 'live' role:", keycloak?.hasRealmRole('live'));

  const urlParams = parseUrlParameters();

  if ((window.appConfig?.live === true) || (keycloak?.authenticated && keycloak?.hasRealmRole('live')) || urlParams.overlays.includes('aircraftLayer')) {
    console.log("Adding Live Control to map.");
    window.aircraftLayer = L.layerGroup();
    window.aircraftTrackLayer = L.layerGroup();

    window.aircraftLayer._live = true;

    window.lcLive = L.control.live({
        position: 'bottomright',
        refreshInterval: 30000,
        trackColor: '#FF5500',
        trackWeight: 3,
        trackOpacity: 0.8
    }).addTo(window.map);

    console.log("Activating Live Control by default.");
    window.lcLive._activateLive();

    if (urlParams.overlays.includes('aircraftLayer')) {
      if (!window.map.hasLayer(window.aircraftLayer)) {
        window.map.addLayer(window.aircraftLayer);
        console.log("Live layer added from URL parameter.");
      }
      const liveCheckbox = document.querySelector('input[type="checkbox"][data-layer-name="Live"]');
      if (liveCheckbox) {
        liveCheckbox.checked = true;
        console.log("Live layer checkbox checked from URL parameter.");
      }
    }

  } else {
    console.log("Conditions not met, Live Control will not be added.");
  }
}

// Wait for DOM to be fully loaded
window.isInitialLoad = true;
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM content loaded, fetching config...');
  try {
      await fetchAppConfig();
  } catch (error) {
      console.error("Failed to fetch app config, proceeding with defaults:", error);
  }

  console.log('Config fetched/defaulted, initializing map...');
  const map = initMap();

  const urlParams = parseUrlParameters();

  if (!urlParams.baseMap) {
      urlParams.baseMap = 'jawgTerrain'; // Set default base map if not in URL
      console.log("No base map in URL, defaulting to Terrain.");
  }

  if (urlParams.overlays.length === 0) {
      urlParams.overlays.push('windStations'); // Default weather stations
      urlParams.overlays.push('rainviewerRadar'); // Default radar
      console.log("No overlays in URL, defaulting to Weather Stations and Radar.");
  }

  if (urlParams.floorBelow === null) {
      urlParams.floorBelow = 3000; // Default floor_below
      console.log("No floor_below in URL, defaulting to 3000.");
  }

  for (const layerName of urlParams.overlays) {
    // Use direct window properties for places layers
    if (layerName === 'placesLayerPG' && window.placesLayerPG && !window.map.hasLayer(window.placesLayerPG)) {
      window.map.addLayer(window.placesLayerPG);
      console.log(`Added overlay layer from URL: ${layerName}`);
    } else if (layerName === 'placesLayerHG' && window.placesLayerHG && !window.map.hasLayer(window.placesLayerHG)) {
      window.map.addLayer(window.placesLayerHG);
      console.log(`Added overlay layer from URL: ${layerName}`);
    } else if (layerName === 'placesLayerLZ' && window.placesLayerLZ && !window.map.hasLayer(window.placesLayerLZ)) {
      window.map.addLayer(window.placesLayerLZ);
      console.log(`Added overlay layer from URL: ${layerName}`);
    }
    // For other layers, use window.overlayLayers
    else if (window.overlayLayers[layerName] && !window.map.hasLayer(window.overlayLayers[layerName])) {
      window.map.addLayer(window.overlayLayers[layerName]);
      console.log(`Added overlay layer from URL: ${layerName}`);
    }
  }


  if (urlParams.locateTrack && window.lc && !window.lc._active) {
    window.lc.start();
    console.log("Locate control activated from URL parameter.");
  }

  try {
    console.log('Attempting to initialize Keycloak...');
    const authenticated = await initKeycloak();
    console.log(`Keycloak init finished. Authenticated: ${authenticated}`);

    console.log('Calling createUserControl()...');
    createUserControl();
    console.log('createUserControl() called.');

    let baseLayerApplied = false;
    if (authenticated) {
        console.log("User authenticated, loading preferences...");
        baseLayerApplied = await loadUserPreferences();
        console.log("Preferences loaded, base layer applied:", baseLayerApplied);
    } else {
        console.log("User not authenticated, skipping preference loading.");
    }

    // Only apply default base layer if no preference was loaded AND no base map was specified in the URL
    if (!baseLayerApplied && !urlParams.baseMap) {
        console.log("No base layer preference found/applied and no base map in URL, ensuring default Terrain layer is active.");
        if (window.map && window.baseLayers.jawgTerrain) {
             if (!window.map.hasLayer(window.baseLayers.jawgTerrain)) {
                 window.map.addLayer(window.baseLayers.jawgTerrain);
                 console.log("Default Terrain layer added.");
             } else {
                 console.log("Default Terrain layer was already present.");
             }
             const controlContainer = window.treeLayersControl?.getContainer();
             if (controlContainer) {
                 const terrainRadio = controlContainer.querySelector('input[type="radio"][value="jawgTerrain"]');
                 if (terrainRadio && !terrainRadio.checked) {
                     terrainRadio.checked = true;
                     console.log("Default Terrain radio button checked in layer control.");
                 }
             }
        } else {
             console.warn("Map or default base layer (jawgTerrain) not available to set default.");
        }
    }

    initSpotPG();
    initSpotHG();
    initSpotLZ();

  } catch (error) {
    console.error('Error during Keycloak initialization or subsequent setup:', error);
    createUserControl();
    if (window.map && window.baseLayers.jawgTerrain && !window.map.hasLayer(window.baseLayers.jawgTerrain)) {
         console.log("Applying default base layer after Keycloak init error.");
         window.map.addLayer(window.baseLayers.jawgTerrain);
         const controlContainer = window.treeLayersControl?.getContainer();
         if (controlContainer) {
             const terrainRadio = controlContainer.querySelector('input[type="radio"][value="jawgTerrain"]');
             if (terrainRadio && !terrainRadio.checked) {
                 terrainRadio.checked = true;
                 console.log("Default Terrain radio button checked in layer control after error.");
             }
         }
    }
    initSpotPG();
    initSpotHG();
    initSpotLZ();

  } finally {
      console.log("Initial setup sequence complete (Keycloak attempted).");
      console.log('Calling addLiveControlIfNeeded()...');
      addLiveControlIfNeeded();
      console.log('addLiveControlIfNeeded() called.');
window.isInitialLoad = false;
setupPostMapInitializationListeners(urlParams);

        try {
          const topRightContainer = document.querySelector('.leaflet-top.leaflet-right');
          if (topRightContainer) {
            const userControl = topRightContainer.querySelector('.leaflet-control-user');
            const layersControl = topRightContainer.querySelector('.leaflet-control-layers');

            if (userControl && layersControl) {
              console.log('Found both controls, reordering...');
              topRightContainer.insertBefore(userControl, topRightContainer.firstChild);
              console.log('Controls reordered successfully');
            } else {
              console.log('Could not find both controls', {
                userControl: !!userControl,
                layersControl: !!layersControl
              });
            }
          } else {
            console.log('Could not find top-right container');
          }
        } catch (error) {
          console.error('Error reordering controls:', error);
        }
window.updateUrlParameters();
window.isInitialLoad = false;
      // Function to get user location, prioritizing XCTrack.getLocation()
      function getUserLocation() {
        if (typeof XCTrack !== 'undefined' && typeof XCTrack.getLocation === 'function') {
          try {
            // Get location data from XCTrack
            let location = XCTrack.getLocation();
            
            // Handle the case where it might be a string (from some XCTrack versions)
            if (typeof location === 'string') {
              try {
                location = JSON.parse(location);
              } catch (e) {
                console.error("Failed to parse XCTrack location string:", e);
              }
            }
            
            console.log("XCTrack.getLocation()=", location);
            
            // Check if location is valid with proper type checking
            if (location && typeof location.lat !== 'undefined' && typeof location.lon !== 'undefined') {
              const userLat = location.lat;
              const userLng = location.lon;
              console.log("XCTrack Geolocation received:", location);
              updateMapAndDispatchEvent(userLat, userLng);
            } else {
              console.warn("XCTrack location data is incomplete:", location);
              fallbackToStandardGeolocation();
            }
          } catch (error) {
            console.error("Error with XCTrack.getLocation():", error);
            // Fallback to standard geolocation if XCTrack fails
            fallbackToStandardGeolocation();
          }
        } else {
          console.log("XCTrack.getLocation() is not available. Falling back to standard geolocation.");
          fallbackToStandardGeolocation();
        }
      }

      function fallbackToStandardGeolocation() {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(position => {
            console.log("Standard Geolocation received");
            const userLat = position.coords.latitude;
            const userLng = position.coords.longitude;
            updateMapAndDispatchEvent(userLat, userLng);
          }, error => {
            console.error("Standard Geolocation error:", error);
          }, { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 });
        } else {
          console.log("Geolocation is not supported by this browser.");
        }
      }

      function updateMapAndDispatchEvent(userLat, userLng) {
        const currentMap = window.map;
        if (currentMap) {
          currentMap.setView([userLat, userLng], 10);
        } else {
          console.error("Map object not available for geolocation setView.");
        }
        const locationReadyEvent = new CustomEvent('user_location_ready', { detail: { lat: userLat, lng: userLng } });
        document.dispatchEvent(locationReadyEvent);
        console.log("User location event dispatched");
      }

      // Call the new function to get user location
      getUserLocation();
  }
});

document.addEventListener('user_location_ready', function(e) {
console.log("Handling user location ready event");
setTimeout(() => {
    if (typeof window.fetchWindStations === 'function' &&
        window.mapInitialized &&
        window.map.hasLayer(window.overlayLayers.windStations)) {
        try {
            console.log("Fetching wind stations");
            window.fetchWindStations(e.detail.lat, e.detail.lng);
        } catch (error) {
            console.error('Error fetching wind stations:', error);
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
      window.map.hasLayer(window.overlayLayers.airspaceXC)) {
      try {
          console.log("Fetching airspaces");
          window.fetchAirspacesXC();
      } catch (error) {
          console.error('Error fetching airspaces:', error);
      }
    }

    if (typeof window.fetchObstacles === 'function' &&
      window.mapInitialized &&
      window.map.hasLayer(window.overlayLayers.obstacleLayer)) {
      try {
          console.log("Fetching obstacles");
          window.fetchObstacles();
      } catch (error) {
          console.error('Error fetching obstacles:', error);
      }
    }
}, 500);
});
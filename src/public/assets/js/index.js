import './L.Control.Layers.Tree.js';
import '../css/L.Control.Layers.Tree.css';

import './leaflet.responsive.popup.js';
import './leaflet.responsive.popup.css';

import '../css/styles.css';
import InfoControl from './../../../components/InfoControl.js';
import moment from 'moment';
import 'moment-timezone';

import './../../../components/airspaces.js';
import '../../../components/deprecated/airspaces-gliding.js';
import '../../../components/deprecated/airspaces-notam.js';
import './../../../components/airspaces-xc.js';
import './../../../components/windstations.js';
import '../../../components/spots-pg.js';
import '../../../components/spots-hg.js';
import '../../../components/spots-lz.js';
import '../../../components/obstacles.js';



// Initialize map and make necessary objects globally available
function initMap() {
  // Create the map object and make it globally accessible
  window.map = L.map('map', {
      center: [50, 6],
      zoom: 11,
      zoomControl: false,
      layers: []
  });

  L.control.zoom({
      position: 'bottomright',
  }).addTo(window.map);

  // Base Layers
  var awgTerrain = L.tileLayer('https://tile.jawg.io/jawg-terrain/{z}/{x}/{y}{r}.png?access-token=qBDXRu1KSlZGhx4ROlceBD9hcxmrumL34oj29tUkzDVkafqx08tFWPeRNb0KSoKa', {
      attribution: 'Jawg.io terrain'
  }).addTo(window.map);

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
    var el = document.getElementById('fullScreenInfo');
    var screenWidthThreshold = 768; // Match CSS media query

    if (window.innerWidth < screenWidthThreshold) {
      // Force close any existing popup
      window.map.closePopup();

      try {
        // Create content with close button
        var content = ev.popup.getContent();
        var closeButton = '<div style="position: absolute; top: 10px; right: 10px;">' +
                          '<button onclick="closeFullscreenInfo()" style="background: none; border: none; font-size: 20px; cursor: pointer;">✕</button>' +
                          '</div>';

        el.innerHTML = closeButton + content;
        el.classList.add('visible');
        el.style.display = 'block'; // Set display to block
        el.style.zIndex = '10000'; // High z-index
        document.getElementById('map').classList.add('map-covered');
      } catch (error) {
        console.error('Error in popupopen handler:', error);
      }
    }
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
  window.airspaceEFG = L.layerGroup([], {
    attribution: 'OpenAIP&copy; <a href="https://www.openaip.net">OpenAIP</a>',
  });
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
          { label: 'Wind Stations',
            children: [
              { label: 'Wind Stations', layer: window.windLayer, checked: true  },
          ]
          },

          { label: 'Spots',
              children: [
                  { label: 'Take-off PG', layer: window.placesLayerPG },
                  { label: 'Take-off HG', layer: window.placesLayerHG },
                  { label: 'Landing Zones', layer: window.placesLayerLZ },
              ]
          },
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
                  // { label: 'Airspaces', layer: window.airspaceEFG },
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
          iconElementTag: 'div'
      }).addTo(window.map);

  // Add layer control tree

  var treeLayersControl = L.control.layers.tree(baseTree, overlayTree, {
    namedToggle: false,
    collapsed: true
  }).addTo(window.map);

  // Initialize with collapsed tree but expanded selected layers
  treeLayersControl.collapseTree().expandSelected();

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

    // Airspaces
    if (window.map.hasLayer(window.airspaceEFG) && typeof window.fetchAirspaces === 'function') {
      console.log('Fetching airspaces after map move...');
      window.fetchAirspaces();
    }
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
      console.log('Fetching airspaces after map move...');
      window.fetchAirspacesXC();
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
    } else if (layer === window.airspaceEFG && typeof window.fetchAirspaces === 'function') {
      window.fetchAirspaces();
    } else if (layer === window.airspaceGliding && typeof window.fetchAirspacesGliding === 'function') {
      window.fetchAirspacesGliding();
    } else if (layer === window.airspaceNotam && typeof window.fetchAirspacesNotam === 'function') {
      window.fetchAirspacesNotam();
    } else if (layer === window.airspaceXC && typeof window.fetchAirspacesXC === 'function') {
      window.fetchAirspacesXC();
    } else if (layer === window.obstacleLayer && typeof window.fetchObstacles === 'function') {
      window.fetchObstacles();
    }
  });

  // Signal that the map is fully initialized
  window.mapInitialized = true;
  console.log("Map initialization complete");

  // Trigger an event that component scripts can listen for
  const mapReadyEvent = new Event('map_initialized');
  document.dispatchEvent(mapReadyEvent);
  console.log("Map initialized event dispatched");

  return window.map;
}

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
console.log("DOM content loaded, initializing map");
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
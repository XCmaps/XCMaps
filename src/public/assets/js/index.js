// With these
import './L.Control.Layers.Tree.js';
import '../css/L.Control.Layers.Tree.css';
import '../css/styles.css';


import './../../../components/airspaces.js';
import './../../../components/windstations.js';
import './../../../components/spotsPG.js';
import './../../../components/spotsHG.js';
import './../../../components/spotsLZ.js';


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
      attribution: '© OpenStreetMap contributors'
  });
  
  var xcontest = L.tileLayer('https://topo.xcontest.app/elev/{z}/{x}/{y}.jpg', {
      attribution: 'XContest&copy; <a href="https://www.xcontest.org">XContest</a>',
      className: 'xcontest-layer'
  });

  // MapLibre GL layer
  var mapTilerTerrain = L.mapboxGL({
      style: '/assets/maps/maptiler_terrain_wob_testxc.json',
      apiKey: "c49iG8J3xvAkgCSZ8M8v",
      className: 'xcmap-layer'
  });
  
  var sat = L.tileLayer('http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}',{
      maxZoom: 20,
      subdomains:['mt0','mt1','mt2','mt3']
  });
   
  // Layer groups - make them globally accessible
  window.windLayer = L.layerGroup().addTo(window.map);
  window.oaipMap = L.tileLayer(`https://a.api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=${process.env.OAIP_KEY}`, {
      attribution: 'OpenAIP&copy; <a href="https://www.openaip.net">OpenAIP</a>',
      className: 'oaip-layer'
  });
  window.airspaceEFG = L.layerGroup([]);
  window.placesLayerPG = L.layerGroup(); 
  window.placesLayerHG = L.layerGroup(); 
  window.placesLayerLZ = L.layerGroup();

  // Tree structure
  var baseTree = {
      label: 'Base Maps',
      children: [
          { label: 'Terrain', layer: awgTerrain },
          { label: 'XContest', layer: L.layerGroup([xcontest, mapTilerTerrain])},
          { label: 'OpenStreetMap', layer: osm },
          { label: 'Satellite', layer: L.layerGroup([mapTilerTerrain, sat])}
      ]
  };

  var overlayTree = {
      label: 'Overlays',
      children: [
          { label: 'Wind Stations', layer: window.windLayer, checked: true },
          { label: 'Spots',              
              children: [
                  { label: 'Take-off PG', layer: window.placesLayerPG },
                  { label: 'Take-off HG', layer: window.placesLayerHG },
                  { label: 'Landing Zones', layer: window.placesLayerLZ },
              ]
          },
          { label: 'Airspaces', 
              children: [
                  { label: 'Airspaces', layer: window.airspaceEFG },
                  { label: 'Gliding', layer: window.airspaceEFG },
                  { label: 'Notam', layer: window.airspaceEFG },
                  { label: 'OpenAIP Map', layer: window.oaipMap},
              ]
          }
      ]
  };

  // Add info control
  var InfoControl = L.Control.extend({
      onAdd: function(map) {
          var container = L.DomUtil.create('div', 'info-control leaflet-bar leaflet-control');
          var link = L.DomUtil.create('a', 'leaflet-control-button', container);
          link.href = '#';
          // Create image element instead of text
          var img = L.DomUtil.create('img', 'info-control-icon', link);
          img.src = 'assets/images/info.png';
          img.alt = 'Information';
          img.style.width = '24px';
          img.style.height = '24px';
          img.style.padding = '4px';

          L.DomEvent.disableClickPropagation(container);
          L.DomEvent.on(link, 'click', function(e) {
              L.DomEvent.stop(e);
              var popupContent = '<div style="padding: 10px; max-width: 800px;"><h3>About XC Maps</h3>' +
                  '<p><strong>Data Sources:</strong></p>' +
                  '<ul>' +
                  '<li>Terrain tiles by <a href="https://www.jawg.io" target="_blank">Jawg</a></li>' +
                  '<li>OpenStreetMap contributors</li>' +
                  '<li>XContest terrain data</li>' +
                  '<li>MapTiler for GL layer</li>' +
                  '<li>OpenAIP airspace data: Airspaces are imported from openaip:"OpenAIP data is not certified and must not be used for primary navigation or flight planning. Never rely on openAIP data! OpenAIP data contains errors. Using openAIP data may result in serious injury or death."</li>' +
                  '</ul>' +
                  '<p>This map combines various data sources for aerial sports navigation.</p></div>';
              
              L.popup({ className: 'info-popup', autoPan: true })
                  .setLatLng(map.getCenter())
                  .setContent(popupContent)
                  .openOn(map);
          });

          return container;
      }
  });

  new InfoControl({ position: 'bottomright' }).addTo(window.map);

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
      namedToggle: true,
      collapsed: false
  }).addTo(window.map);

  treeLayersControl.collapseTree().expandSelected();
  
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

  // Attach moveend event listener after ensuring map is created
  map.on('moveend', function () {
    console.log('Map moveend event triggered');
    if (window.fetchWindStations) {
        console.log('Fetching wind stations after map move...');
        window.fetchWindStations();
    } else {
        console.warn("fetchWindStations is not available yet.");
    }  
  });
  
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
});


// Function to dynamically load scripts
function loadScript(url, isModule = false) {
  return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      if (isModule) {
          script.type = 'module';
      }
      script.onload = () => {
          console.log(`Loaded script: ${url}`);
          resolve();
      };
      script.onerror = (error) => {
          console.error(`Failed to load script: ${url}`, error);
          reject(error);
      };
      document.body.appendChild(script);
  });
}

console.log('fetchWindStations type:', typeof window.fetchWindStations);

// Load component scripts after map is initialized
document.addEventListener('map_initialized', async function() {
  console.log("Loading component scripts");
  try {
      // Load regular scripts first
      await loadScript('../components/windstations.js');
      await loadScript('../components/airspaces.js');

        // Add event listener for map moveend to update wind stations
      window.map.on('moveend', function() {
        console.log('Map moveend event triggered'); // Add this
          if (typeof window.fetchWindStations === 'function') {
              console.log('Map moved, fetching wind stations...');
              window.fetchWindStations();
          }
      });
      
    // Verify listener count
    console.log("Moveend listeners:", window.map.listens('moveend'));
  
      // Load module scripts with a slight delay to ensure regular scripts are fully processed
      setTimeout(async () => {
          try {
              await loadScript('../components/spotsPG.js', true);
              await loadScript('../components/spotsHG.js', true);
              await loadScript('../components/spotsLZ.js', true);
              console.log('All module scripts loaded successfully');
          } catch (moduleError) {
              console.error('Failed to load module scripts:', moduleError);
          }
      }, 500);
      
      console.log('Regular scripts loaded successfully');
  } catch (error) {
      console.error('Failed to load component scripts:', error);
  }
});

// Special patch for windstations.js and airspaces.js
document.addEventListener('user_location_ready', function(e) {
  console.log("Handling user location ready event");
  setTimeout(() => {
      // Only call these functions if they exist and the map is fully initialized
      if (typeof fetchWindStations === 'function' && window.mapInitialized) {
          try {
              console.log("Fetching wind stations");
              fetchWindStations(e.detail.lat, e.detail.lng);
          } catch (error) {
              console.error('Error fetching wind  stations:', error);
          }
      } else {
          console.warn("fetchWindStations not available yet");
      }
      
      if (typeof fetchAirspaces === 'function' && window.mapInitialized) {
          try {
              console.log("Fetching airspaces");
              fetchAirspaces();
          } catch (error) {
              console.error('Error fetching airspaces:', error);
          }
      } else {
          console.warn("fetchAirspaces not available yet");
      }
  }, 500); // Give a short delay to ensure all scripts are loaded
});


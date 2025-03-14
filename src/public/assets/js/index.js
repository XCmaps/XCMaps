import './L.Control.Layers.Tree.js';
import '../css/L.Control.Layers.Tree.css';
import '../css/styles.css';
import InfoControl from './../../../components/InfoControl.js';

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
      attribution: '© OpenStreetMap'
  });
  
  var xcontest = L.tileLayer('https://topo.xcontest.app/elev/{z}/{x}/{y}.jpg', {
      attribution: 'XContest&copy; <a href="https://www.xcontest.org">XContest</a>',
      className: 'xcontest-layer'
  });


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
   
  // Layer groups - make them globally accessible
  window.windLayer = L.layerGroup().addTo(window.map);
  window.oaipMap = L.tileLayer(`https://a.api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=${process.env.OAIP_KEY}`, {
      attribution: 'OpenAIP&copy; <a href="https://www.openaip.net">OpenAIP</a>',
      className: 'oaip-layer'
  });
  window.airspaceEFG = L.layerGroup([], {
    attribution: 'OpenAIP&copy; <a href="https://www.openaip.net">OpenAIP</a>',
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
  }, 500); // Give a short delay to ensure all scripts are loaded
});
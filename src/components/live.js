/**
 * Live Control Component
 * Toggles the live layer for displaying pilot locations
 */

// Create a LiveControl class that extends L.Control
const LiveControl = L.Control.extend({
    options: {
        position: 'bottomright',
        activeIcon: 'assets/images/live-active.svg',
        inactiveIcon: 'assets/images/live-inactive.svg',
        title: 'Toggle live pilots'
    },

    initialize: function(options) {
        L.Util.setOptions(this, options);
        this.active = false;
        this.marker = null;
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
        if (this.marker) {
            map.removeLayer(this.marker);
            this.marker = null;
        }
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
        this._icon.src = this.options.activeIcon;

        // For demonstration purposes, add a marker at the center of the map
        // In a real implementation, this would show actual pilot locations
        const center = this._map.getCenter();
        this.marker = L.marker(center).addTo(this._map);
        this.marker.bindPopup("Demo Pilot").openPopup();
    },

    _deactivateLive: function() {
        // Update UI to inactive state
        this.active = false;
        this._icon.src = this.options.inactiveIcon;

        // Remove marker
        if (this.marker) {
            this._map.removeLayer(this.marker);
            this.marker = null;
        }
    }
});

// Factory function to create the control
L.control.live = function(options) {
    return new LiveControl(options);
};

export default LiveControl;
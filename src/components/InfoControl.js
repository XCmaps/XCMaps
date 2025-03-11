import L from 'leaflet';

export default L.Control.extend({
    onAdd: function(map) {
        const container = L.DomUtil.create('div', 'info-control leaflet-bar leaflet-control');
        const link = L.DomUtil.create('a', 'leaflet-control-button', container);
        link.href = '#';
        
        const img = L.DomUtil.create('img', 'info-control-icon', link);
        img.src = './images/info.png';
        img.alt = 'Map Information';
        
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(link, 'click', function(e) {
            L.DomEvent.stop(e);
            this.showInfoPopup(map);
        }.bind(this));

        return container;
    },

    showInfoPopup: function(map) {
        const popupContent = `
            <div class="info-popup-content">
                <h3>About This Map</h3>
                <p><strong>Data Sources:</strong></p>
                <ul>
                    <li>Terrain tiles by <a href="https://www.jawg.io" target="_blank">Jawg</a></li>
                    <li>OpenStreetMap contributors</li>
                    <li>XContest terrain data</li>
                    <li>MapTiler for GL layer</li>
                    <li>OpenAIP airspace data</li>
                </ul>
                <p>This map combines various data sources for aerial sports navigation.</p>
            </div>
        `;
        
        L.popup({ 
            className: 'info-popup',
            autoPan: true,
            maxWidth: 300
        })
        .setLatLng(map.getCenter())
        .setContent(popupContent)
        .openOn(map);
    }
});
const L = window.L;

const InfoControl = L.Control.extend({
    onAdd: function(map) {
        var container = L.DomUtil.create('div', 'info-control leaflet-bar leaflet-control');
        var link = L.DomUtil.create('a', 'leaflet-control-button', container);
        link.href = '#';
        var img = L.DomUtil.create('img', 'info-control-icon', link);
        img.src = 'assets/images/info.png';
        img.alt = 'Information';
        img.style.width = '24px';
        img.style.height = '24px';
        img.style.padding = '4px';

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(link, 'click', function(e) {
            L.DomEvent.stop(e);
            var popupContent = '<div class="info-popup-content" style="padding: 10px;"><h3 class="popup-logo-container"><img class="popup-logo" src="/assets/images/XCmapsLogo.png" alt="XCmaps"></h3>' +
                '<p>You can contact us by email, or report any issue on github.</p>'+
                '<p><strong>Credits:</strong></p>' +
                '<ul>' +
                '<li>Terrain tiles by <a href="https://www.jawg.io" target="_blank">Jawg</a></li>' +
                '<li>OpenStreetMap</li>' +
                '<li>XContest terrain data</li>' +
                '<li>MapTiler for GL layer</li>' +
                '<li>Airspaces: Airspaces are imported from openaip:"OpenAIP data is not certified and must not be used for primary navigation or flight planning. Never rely on openAIP data! OpenAIP data contains errors. Using openAIP data may result in serious injury or death."</li>' +
                '<li>Wind Stations: based on <a href="https://github.com/winds-mobi/" target="_blank">winds.mobi</a> by Yann Savary and additional data sources</li>' +
                '<li>Spots: © <a href="https://paraglidingspots.com" target="_blank">paraglidingspots.com</a> by Karsten Ehlers</li>' +
                '<li>and many more open source libraries, projects, and artwork</li>' +
                '</ul>' +
                '<p>This map combines various data sources for aerial sports navigation.</p></div>';
            
            L.popup({
                className: 'info-popup',
                autoPan: true,
                maxWidth: 700,
                offset: [0, 300]
            })
                .setLatLng(map.getCenter())
                .setContent(popupContent)
                .openOn(map);
        });

        return container;
    }
});

export default InfoControl;
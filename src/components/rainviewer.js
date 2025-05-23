

L.TimeDimension.Layer.Rainviewer = L.TimeDimension.Layer.extend({

    initialize: function(endpoint, options={}) {
      
      options['attribution'] = options['attribution'] || "<a href='https://www.rainviewer.com/api.html' rel='noopener noreferrer' target='_blank'>RainViewer</a>";
  
      L.TimeDimension.Layer.prototype.initialize.call(this, L.tileLayer(''), options);
          this._endpoint = endpoint; // Store endpoint for refresh
          this._refreshInterval = this.options.refreshInterval || 0; // Refresh interval in ms (0 = disabled)
          this._refreshTimer = null; // Timer ID
          this._metadata = {};
          this._frames = {};
          this._layers = {};
          this._defaultTime = 12;
          this._availableTimes = [];
          this._timeCacheBackward = this.options.cacheBackward || this.options.cache || 0;
          this._timeCacheForward = this.options.cacheForward || this.options.cache || 0;
          this._updateTimeDimension = this.options.updateTimeDimension  || true ;
          this._updateTimeDimensionMode = this.options.updateTimeDimensionMode || 'union'; // 'union', 'replace' or extremes
          this._type = this.options.type || 'radar';
          this._loaded = false;
  
          fetchRainviewerMetadata(this._endpoint).then((metadata) => {
            this._metadata = metadata;
            this._loaded = true;
            if(this._map && this._map.hasLayer(this)){
              this._setAvailableTimes();
            }
          });
  
          this._baseLayer.on('load', (function() {
              this._baseLayer.setLoaded(true);
              this.fire('timeload', {
                  time: this._defaultTime
              });
          }).bind(this));
      },
      onAdd: function(map) {
          L.TimeDimension.Layer.prototype.onAdd.call(this, map);
          if (this._loaded) {
              this._setAvailableTimes();
          }
          // Start refresh timer if interval is set
          if (this._refreshInterval > 0 && !this._refreshTimer) {
              this._refreshTimer = setInterval(this._refreshData.bind(this), this._refreshInterval);
          }
      },
      onRemove: function(map) {
          L.TimeDimension.Layer.prototype.onRemove.call(this, map);
          // Clear refresh timer
          if (this._refreshTimer) {
              clearInterval(this._refreshTimer);
              this._refreshTimer = null;
          }
      },
      _setAvailableTimes() {
        if(this._type == 'radar'){
          let times = [...this._metadata['radar'].nowcast, ...this._metadata['radar'].past];
          times.forEach(frame => this._frames[frame.time * 1000] = frame);
        }else if(this._type == 'satellite'){
          let times = this._metadata['satellite'].infrared;
          times.forEach(frame => this._frames[frame.time * 1000] = frame);
        }
  
        this._availableTimes = L.TimeDimension.Util.sort_and_deduplicate(Object.keys(this._frames).map(time => Number(time)));
        this._updateCurrentTime = this._updateCurrentTime || (this._timeDimension && this._timeDimension.getAvailableTimes().length == 0);
        if (this._timeDimension && (this._updateTimeDimension || this._timeDimension.getAvailableTimes().length == 0)) {
            this._timeDimension.setAvailableTimes(this._availableTimes, this._updateTimeDimensionMode);
        }
        if (this._updateCurrentTime && this._timeDimension && this._availableTimes.length) {
            this._timeDimension.setCurrentTime(this._availableTimes[this._defaultTime]);
        }
      },
      _refreshData: async function() {
        console.log('Refreshing Rainviewer data (' + this._type + ')...');
        try {
          const metadata = await fetchRainviewerMetadata(this._endpoint);
          this._metadata = metadata;
          // Clear old frames before setting new ones
          this._frames = {};
          this._setAvailableTimes(); // This updates _availableTimes and the timeDimension control

          // Explicitly set the current time after refresh to the default index
          if (this._timeDimension && this._availableTimes.length > this._defaultTime) {
              this._timeDimension.setCurrentTime(this._availableTimes[this._defaultTime]);
          }

          this._update(); // This updates the currently displayed layer
          console.log('Rainviewer data refreshed (' + this._type + ').');
        } catch (error) {
          console.error('Error refreshing Rainviewer data:', error);
        }
      },
      eachLayer: function(method, context) {
          for (var prop in this._layers) {
              if (this._layers.hasOwnProperty(prop)) {
                  method.call(context, this._layers[prop]);
              }
          }
          return L.TimeDimension.Layer.prototype.eachLayer.call(this, method, context);
      },
  
      _onNewTimeLoading: function(ev) {
          var layer = this._getLayerForTime(ev.time);
          if (!this._map.hasLayer(layer)) {
              this._map.addLayer(layer);
          }
      },
  
      isReady: function(time) {
          var layer = this._getLayerForTime(time);
          var currentZoom = this._map.getZoom();
          if (layer.options.minZoom && currentZoom < layer.options.minZoom){
              return true;
          }
          if (layer.options.maxZoom && currentZoom > layer.options.maxZoom){
              return true;
          }
          return layer.isLoaded();
      },
  
      _update: function() {
          if (!this._map)
              return;
          var time = this._timeDimension.getCurrentTime();
          // It will get the layer for this time (create or get)
          // Then, the layer will be loaded if necessary, adding it to the map (and show it after loading).
          // If it already on the map (but probably hidden), it will be shown
          var layer = this._getLayerForTime(time);
          if (this._currentLayer == null) {
              this._currentLayer = layer;
          }
          if (!this._map.hasLayer(layer)) {
              this._map.addLayer(layer);
          } else {
              this._showLayer(layer, time);
          }
      },
  
      setOpacity: function(opacity) {
          L.TimeDimension.Layer.prototype.setOpacity.apply(this, arguments);
          // apply to all preloaded caches
          for (var prop in this._layers) {
              if (this._layers.hasOwnProperty(prop) && this._layers[prop].setOpacity) {
                  this._layers[prop].setOpacity(opacity);
              }
          }
      },
      
      setZIndex: function(zIndex){
          L.TimeDimension.Layer.prototype.setZIndex.apply(this, arguments);
          // apply to all preloaded caches
          for (var prop in this._layers) {
              if (this._layers.hasOwnProperty(prop) && this._layers[prop].setZIndex) {
                  this._layers[prop].setZIndex(zIndex);
              }
          }
      },
  
      _unvalidateCache: function() {
          var time = this._timeDimension.getCurrentTime();
          for (var prop in this._layers) {
              if (time != prop && this._layers.hasOwnProperty(prop)) {
                  this._layers[prop].setLoaded(false); // mark it as unloaded
                  this._layers[prop].redraw();
              }
          }
      },
  
      _evictCachedTimes: function(keepforward, keepbackward) {
          // Cache management
          var times = this._getLoadedTimes();
          var strTime = String(this._currentTime);
          var index = times.indexOf(strTime);
          var remove = [];
          // remove times before current time
          if (keepbackward > -1) {
              var objectsToRemove = index - keepbackward;
              if (objectsToRemove > 0) {
                  remove = times.splice(0, objectsToRemove);
                  this._removeLayers(remove);
              }
          }
          if (keepforward > -1) {
              index = times.indexOf(strTime);
              var objectsToRemove = times.length - index - keepforward - 1;
              if (objectsToRemove > 0) {
                  remove = times.splice(index + keepforward + 1, objectsToRemove);
                  this._removeLayers(remove);
              }
          }
      },
  
      _showLayer: function(layer, time) {
          if (this._currentLayer && this._currentLayer !== layer) {
              this._currentLayer.hide();
          }
          layer.show();
          if (this._currentLayer && this._currentLayer === layer) {
              return;
          }
          this._currentLayer = layer;
          this._currentTime = time;
  
          this._evictCachedTimes(this._timeCacheForward, this._timeCacheBackward);
      },
  
      _getLayerForTime: function(time) {
          if (time == 0 || time == this._defaultTime || time == null || !this._loaded) {
              return this._baseLayer;
          }
          if (this._layers.hasOwnProperty(time)) {
              return this._layers[time];
          }
          var nearestTime = this._getNearestTime(time);
          if (this._layers.hasOwnProperty(nearestTime)) {
              return this._layers[nearestTime];
          }
          if (!this._frames.hasOwnProperty(nearestTime)){
              return this._baseLayer;
          }
  
          var newLayer = this._createLayerForTime(nearestTime);
         
          this._layers[time] = newLayer;
  
          newLayer.on('load', (function(layer, time) {
              layer.setLoaded(true);
              // this time entry should exists inside _layers
              // but it might be deleted by cache management
              if (!this._layers[time]) {
                  this._layers[time] = layer;
              }
              if (this._timeDimension && time == this._timeDimension.getCurrentTime() && !this._timeDimension.isLoading()) {
                  this._showLayer(layer, time);
              }
              // console.log('Loaded layer ' + layer.wmsParams.layers + ' with time: ' + new Date(time).toISOString());
              this.fire('timeload', {
                  time: time
              });
          }).bind(this, newLayer, time));
  
          // Hack to hide the layer when added to the map.
          // It will be shown when timeload event is fired from the map (after all layers are loaded)
          newLayer.onAdd = (function(map) {
              Object.getPrototypeOf(this).onAdd.call(this, map);
              this.hide();
          }).bind(newLayer);
          return newLayer;
      },
      
      _createLayerForTime:function(time){
        var options = this.options;
        var url = this._metadata.host;
        let color = 2;
        if(this._type == 'satellite'){
          color = 0;
        }
  
        return new L.TileLayer(url + this._frames[time].path + "/256/{z}/{x}/{y}/" + color + "/1_1.png", options);
      },
  
      _getLoadedTimes: function() {
          var result = [];
          for (var prop in this._layers) {
              if (this._layers.hasOwnProperty(prop)) {
                  result.push(prop);
              }
          }
          return result.sort(function(a, b) {
              return a - b;
          });
      },
  
      _removeLayers: function(times) {
          for (var i = 0, l = times.length; i < l; i++) {
              if (this._map)
                  this._map.removeLayer(this._layers[times[i]]);
              delete this._layers[times[i]];
          }
      },
  
      setMinimumForwardCache: function(value) {
          if (value > this._timeCacheForward) {
              this._timeCacheForward = value;
          }
      },
  
      _getNearestTime: function(time) {
          if (this._layers.hasOwnProperty(time)) {
              return time;
          }
          if (this._availableTimes.length == 0) {
              return time;
          }
          var index = 0;
          var len = this._availableTimes.length;
          for (; index < len; index++) {
              if (time < this._availableTimes[index]) {
                  break;
              }
          }
          // We've found the first index greater than the time. Get the previous
          if (index > 0) {
              index--;
          }
          // if (time != this._availableTimes[index]) {
          //     console.log('Search layer time: ' + new Date(time).toISOString());
          //     console.log('Return layer time: ' + new Date(this._availableTimes[index]).toISOString());
          // }
          return this._availableTimes[index];
      },
  });
  
  L.timeDimension.layer.rainviewer = function(endpoint, options) {
      return new L.TimeDimension.Layer.Rainviewer(endpoint, options);
  };
  
  async function fetchRainviewerMetadata(endpoint){
    let response = await fetch(endpoint);
    let metadata = await response.json();
    return metadata;
  
  }
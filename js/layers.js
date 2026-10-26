/* =========================================================
   layers.js — موتور نقشه (تک‌نمونه)
   - نمونه نقشه یک بار ساخته می‌شود؛ اگر SDK نشان بارگیری شده باشد
     همان نمونه به‌عنوان نقشه نشان کار می‌کند (کلید + استایل).
   - تعویض منبع: حذف/افزودن لایه کاشی پایه (نشان / OSM / آفلاین)
   - ذخیره خودکار کاشی‌های آنلاین در IndexedDB
   - لایه برداری استان‌های ایران + برچسب شهرهای بزرگ (همیشه محلی)
   - دانلود محدوده برای استفاده آفلاین
   ========================================================= */
(function (global) {
  'use strict';

  var U = global.Util;
  var TS = global.TileStore;

  /* ---------- اتصال دوباره افزونه‌های Leaflet پس از بارگیری SDK نشان ----------
     SDK نشان نسخه خودش از Leaflet را روی window.L می‌گذارد (و در چرخه راه‌اندازی
     ممکن است دوباره این کار را بکند) و افزونه‌های محلی (خوشه‌بندی/حرارتی) که به
     Leaflet محلی وصل شده بودند از دست می‌روند؛ این تابع هر بار ارجاع‌های
     ذخیره‌شده را به L فعلی برمی‌گرداند و در نقاط حساس صدا زده می‌شود. */
  global.ensureLeafletPlugins = function () {
    var plug = global.__leafletPlugins;
    if (!plug || !global.L) return false;
    var touched = false;
    try {
      if (typeof L.heatLayer !== 'function' && typeof plug.heatLayer === 'function') {
        L.heatLayer = plug.heatLayer;
        if (plug.HeatLayer) L.HeatLayer = plug.HeatLayer;
        touched = true;
      }
      if (typeof L.markerClusterGroup !== 'function' && typeof plug.markerClusterGroup === 'function') {
        L.markerClusterGroup = plug.markerClusterGroup;
        if (plug.MarkerClusterGroup) L.MarkerClusterGroup = plug.MarkerClusterGroup;
        if (plug.MarkerCluster) L.MarkerCluster = plug.MarkerCluster;
        if (plug.MarkerClusterNonAnimated) L.MarkerClusterNonAnimated = plug.MarkerClusterNonAnimated;
        touched = true;
      }
    } catch (e) { /* بدون افزونه‌ها هم برنامه کار می‌کند */ }
    return touched;
  };
  global.ensureLeafletPlugins();

  /* ---------- شهرهای بزرگ برای برچسب برداری ---------- */
  var CITIES = [
    { name: 'تهران', lat: 35.69, lng: 51.39, z: 5 },
    { name: 'مشهد', lat: 36.30, lng: 59.60, z: 5 },
    { name: 'اصفهان', lat: 32.65, lng: 51.67, z: 5 },
    { name: 'شیراز', lat: 29.60, lng: 52.53, z: 5 },
    { name: 'تبریز', lat: 38.08, lng: 46.29, z: 5 },
    { name: 'قم', lat: 34.64, lng: 50.87, z: 5 },
    { name: 'اهواز', lat: 31.32, lng: 48.67, z: 5 },
    { name: 'کرمانشاه', lat: 34.31, lng: 47.07, z: 7 },
    { name: 'ارومیه', lat: 37.55, lng: 45.08, z: 7 },
    { name: 'رشت', lat: 37.28, lng: 49.58, z: 7 },
    { name: 'زاهدان', lat: 29.50, lng: 60.86, z: 7 },
    { name: 'کرمان', lat: 30.29, lng: 57.08, z: 7 },
    { name: 'یزد', lat: 31.90, lng: 54.37, z: 7 },
    { name: 'همدان', lat: 34.80, lng: 48.51, z: 7 },
    { name: 'اراک', lat: 34.09, lng: 49.69, z: 7 },
    { name: 'سنندج', lat: 35.32, lng: 46.99, z: 7 },
    { name: 'خرم‌آباد', lat: 33.49, lng: 48.36, z: 7 },
    { name: 'بندرعباس', lat: 27.19, lng: 56.28, z: 7 },
    { name: 'زنجان', lat: 36.67, lng: 48.48, z: 7 },
    { name: 'ساری', lat: 36.56, lng: 53.06, z: 7 },
    { name: 'قزوین', lat: 36.27, lng: 50.00, z: 7 },
    { name: 'بجنورد', lat: 37.47, lng: 57.33, z: 7 },
    { name: 'بیرجند', lat: 32.87, lng: 59.22, z: 7 },
    { name: 'بوشهر', lat: 28.92, lng: 50.84, z: 7 },
    { name: 'شهرکرد', lat: 32.32, lng: 50.86, z: 7 },
    { name: 'سمنان', lat: 35.57, lng: 53.40, z: 7 },
    { name: 'ایلام', lat: 33.64, lng: 46.51, z: 7 },
    { name: 'یاسوج', lat: 30.67, lng: 51.59, z: 7 },
    { name: 'اردبیل', lat: 38.25, lng: 48.29, z: 7 },
    { name: 'گرگان', lat: 36.84, lng: 54.44, z: 7 }
  ];

  /* ================= لایه کاشی آنلاین با ذخیره خودکار ================= */
  var CachedTileLayer = L.TileLayer.extend({
    initialize: function (url, options) {
      options = L.extend({ maxNativeZoom: 18, maxZoom: 20, crossOrigin: true }, options);
      L.TileLayer.prototype.initialize.call(this, url, options);
      this._inflight = {};
    },
    createTile: function (coords, done) {
      var tile = document.createElement('img');
      tile.alt = '';
      tile.setAttribute('role', 'presentation');

      var url = this.getTileUrl(coords);
      var self = this;
      var cacheStyle = this.options._cacheStyle || 'default';
      var cacheSrc = this.options._cacheSrc || 'osm';

      if (!('fetch' in window) || !window.TileStore) {
        tile.onload = function () { L.TileLayer.prototype._tileOnLoad.call(self, done, tile); };
        tile.onerror = function () { L.TileLayer.prototype._tileOnError.call(self, done, tile); };
        tile.src = url;
        return tile;
      }

      var key = url;
      if (this._inflight[key]) {
        this._inflight[key].push(function (blob) { self._finishTile(tile, blob, url, done); });
        return tile;
      }
      this._inflight[key] = [];

      fetch(url, { mode: 'cors', credentials: 'omit' })
        .then(function (r) {
          if (!r.ok) throw new Error(String(r.status));
          return r.blob();
        })
        .then(function (blob) {
          TS.putTile(cacheSrc, cacheStyle, coords.z, coords.x, coords.y, blob);
          var waiters = self._inflight[key] || [];
          delete self._inflight[key];
          self._finishTile(tile, blob, url, done);
          waiters.forEach(function (cb) { cb(blob); });
        })
        .catch(function () {
          var waiters = self._inflight[key] || [];
          delete self._inflight[key];
          self._finishTile(tile, null, url, done);
          waiters.forEach(function (cb) { cb(null); });
        });

      return tile;
    },
    _finishTile: function (tile, blob, url, done) {
      var self = this;
      if (blob) {
        tile._objUrl = URL.createObjectURL(blob);
        tile.onload = function () { L.TileLayer.prototype._tileOnLoad.call(self, done, tile); };
        tile.onerror = function () { L.TileLayer.prototype._tileOnError.call(self, done, tile); };
        tile.src = tile._objUrl;
      } else {
        /* بدون کش (مثلاً CORS بسته یا خطا) — نمایش مستقیم */
        tile.onload = function () { L.TileLayer.prototype._tileOnLoad.call(self, done, tile); };
        tile.onerror = function () { L.TileLayer.prototype._tileOnError.call(self, done, tile); };
        tile.src = url;
      }
    }
  });

  /* ================= لایه کاشی آفلاین (از IndexedDB) ================= */
  var _placeholderUrl = null;
  function offlinePlaceholderDataUrl() {
    if (_placeholderUrl) return _placeholderUrl;
    var c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = '#edf1ef';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#dfe6e2';
    g.lineWidth = 1;
    for (var i = 0; i <= 256; i += 32) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
    }
    g.fillStyle = '#a9b8b1';
    g.font = '13px Vazirmatn, Tahoma';
    g.textAlign = 'center';
    g.fillText('کاشی ذخیره نشده', 128, 124);
    _placeholderUrl = c.toDataURL('image/png');
    return _placeholderUrl;
  }

  var OfflineTileLayer = L.TileLayer.extend({
    initialize: function (options) {
      options = L.extend({ maxNativeZoom: 18, maxZoom: 20, tileSize: 256 }, options);
      L.TileLayer.prototype.initialize.call(this, '', options);
    },
    createTile: function (coords, done) {
      var tile = document.createElement('img');
      tile.alt = '';
      tile.setAttribute('role', 'presentation');
      var self = this;
      var srcs = this.options._srcs || ['neshan', 'osm'];
      var style = this.options._style || 'dreamy';

      TS.getTileAuto(srcs, style, coords.z, coords.x, coords.y)
        .then(function (rec) {
          if (rec && rec.blob) {
            tile._objUrl = URL.createObjectURL(rec.blob);
            tile.onload = function () { L.TileLayer.prototype._tileOnLoad.call(self, done, tile); };
            tile.onerror = function () { L.TileLayer.prototype._tileOnError.call(self, done, tile); };
            tile.src = tile._objUrl;
          } else {
            /* کاشی ذخیره نشده: کاشی «خالی» نشان می‌دهیم تا صفحه نپرد */
            tile.onload = function () { L.TileLayer.prototype._tileOnLoad.call(self, done, tile); };
            tile.src = offlinePlaceholderDataUrl();
          }
        })
        .catch(function () {
          done(null, tile);
        });
      return tile;
    }
  });

  /* ================= موتور نقشه ================= */
  function MapEngine(opts) {
    var self = this;
    this.settings = opts.settings;
    this.onSourceFail = opts.onSourceFail || function () {};
    this.onCaptureProgress = opts.onCaptureProgress || function () {};
    this.onNeedRedrawMarkers = null;

    this.map = null;
    this.currentSource = null;
    this.neshanBase = null;    /* لایه کاشی داخلی SDK نشان (در صورت وجود) */
    this.osmLayer = null;
    this.offlineLayer = null;
    this.markerLayer = null;
    this.markerMode = 'plain';  /* plain | cluster */
    this.heatLayer = null;      /* لایه نقشه حرارتی */
    this.heatOn = false;
    this.cityLayer = null;
    this.provinceLayer = null;
    this._provData = null;
    this._captured = 0;
    this._tileErrors = 0;
  }

  MapEngine.prototype._isNeshanL = function () {
    return typeof this.map.setMapType === 'function';
  };

  /* ---------- حالت نمایش نشانگرها: معمولی یا خوشه‌بندی (پیاده‌سازی داخلی سبک) ----------
     نکته مهم: افزونهٔ Leaflet.markercluster با نسخهٔ Leaflet داخل SDK نشان ناسازگار است
     (دو کپی از Leaflet در یک صفحه ترکیب‌شدنی نیستند)؛ بنابراین خوشه‌بندی به‌صورت بومی
     و فقط با همان L فعالِ نقشه انجام می‌شود — بدون هیچ وابستگی خارجی. */
  MapEngine.prototype._clusterRadiusPx = 64;

  MapEngine.prototype._markerContainer = function () {
    return this.markerLayer;
  };

  /* تعویض حالت نمایش نشانگرها (بلافاصله بازرسم می‌کند) */
  MapEngine.prototype.setMarkerMode = function (mode) {
    this.markerMode = (mode === 'cluster') ? 'cluster' : 'plain';
    if (!this.map) return true;
    this._renderMarkerSet();
    return true;
  };

  /* داده نشانگرها را تنظیم و رسم می‌کند (در هر دو حالت) */
  MapEngine.prototype.setMarkerSet = function (pts, numbered) {
    this._setPoints = pts || [];
    this._setNumbered = numbered !== false;
    this._renderMarkerSet();
  };

  /* گروه‌بندی نقاط نزدیک به‌هم بر اساس فاصله پیکسلی در زوم فعلی */
  MapEngine.prototype._clusterGroups = function (pts) {
    var map = this.map;
    var R = this._clusterRadiusPx;
    var groups = [];
    pts.forEach(function (p) {
      var pt = map.latLngToContainerPoint([p.lat, p.lng]);
      var best = null, bestD = Infinity;
      for (var i = 0; i < groups.length; i++) {
        var g0 = groups[i];
        var dx = g0.cx - pt.x, dy = g0.cy - pt.y;
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = g0; }
      }
      if (best && bestD <= R * R) {
        var n = best.length;
        best.cx = (best.cx * n + pt.x) / (n + 1);
        best.cy = (best.cy * n + pt.y) / (n + 1);
        best.push(p);
      } else {
        var g = [p]; g.cx = pt.x; g.cy = pt.y;
        groups.push(g);
      }
    });
    return groups;
  };

  /* رسم نشانگرها: حالت معمولی = دایره‌ها، حالت خوشه = حباب‌های شمارنده */
  MapEngine.prototype._renderMarkerSet = function () {
    var self = this;
    if (!this.map || !this.markerLayer) return;
    this.markerLayer.clearLayers();
    var pts = this._setPoints || [];
    pts.forEach(function (p) { p._marker = null; });   /* حذف ارجاع نشانگرهای قدیمی */
    var numbered = this._setNumbered !== false;

    if (this.markerMode === 'cluster' && pts.length > 1) {
      this._clusterGroups(pts).forEach(function (g) {
        if (g.length === 1) { self._addPlainMarker(g[0], pts.indexOf(g[0]), numbered); return; }
        var lat = 0, lng = 0;
        g.forEach(function (p) { lat += p.lat; lng += p.lng; });
        lat /= g.length; lng /= g.length;
        var n = g.length;
        var cls = 'clu clu-s';
        if (n >= 50) cls = 'clu clu-l'; else if (n >= 10) cls = 'clu clu-m';
        var m = L.marker([lat, lng], {
          icon: L.divIcon({
            html: '<div class="' + cls + '"><span>' + U.faNum(n) + '</span></div>',
            className: '', iconSize: [42, 42], iconAnchor: [21, 21]
          }),
          title: U.faNum(n) + ' نقطه در این خوشه — برای باز شدن کلیک کنید'
        });
        m.on('click', function () {
          var b = L.latLngBounds(g.map(function (p) { return [p.lat, p.lng]; }));
          self.map.fitBounds(b.pad(0.3), { maxZoom: 16 });
        });
        m.addTo(self.markerLayer);
      });
    } else {
      pts.forEach(function (p, i) { self._addPlainMarker(p, i, numbered); });
    }

    /* اگر منتظر باز شدن پاپ‌آپِ یک نقطه بودیم (حالت خوشه) و اکنون نشانگرش آماده است */
    var pend = this._pendingOpen;
    if (pend && pend._marker) {
      this._pendingOpen = null;
      setTimeout(function () { try { pend._marker.openPopup(); } catch (e) {} }, 350);
    }
  };

  MapEngine.prototype._addPlainMarker = function (p, i, numbered) {
    p.province = this.provinceAt(p.lat, p.lng);
    this.addMarker(p, i, numbered);
  };

  /* ---------- نقشه حرارتی ---------- */
  MapEngine.prototype.setHeat = function (points, on) {
    global.ensureLeafletPlugins();
    this.heatOn = !!on;
    if (!this.map) return false;
    if (this.heatLayer) {
      try { this.map.removeLayer(this.heatLayer); } catch (e) {}
      this.heatLayer = null;
    }
    if (!on || !points || !points.length) return true;
    if (typeof L.heatLayer !== 'function') return false;
    var latlngs = points.map(function (p) { return [p.lat, p.lng, 1]; });
    this.heatLayer = L.heatLayer(latlngs, {
      radius: 30,
      blur: 20,
      maxZoom: 12,
      minOpacity: 0.35,
      max: 1,
      gradient: {
        0.25: '#1e88e5',
        0.45: '#43a047',
        0.65: '#fdd835',
        0.82: '#fb8c00',
        1.0: '#c0392b'
      }
    });
    this.map.addLayer(this.heatLayer);
    return true;
  };

  /* به‌روزرسانی داده حرارتی (فقط وقتی روشن است) */
  MapEngine.prototype.updateHeat = function (points) {
    if (this.heatOn) this.setHeat(points, true);
  };

  MapEngine.prototype.init = function (container) {
    var self = this;
    var st = this.settings;

    var key = (st.neshanKey || '').trim();
    var map = L.map(container, {
      key: key,
      maptype: st.neshanStyle,
      center: [35.699756, 51.338076],
      zoom: 5,
      zoomControl: true,
      minZoom: 3,
      maxZoom: 19
    });
    this.map = map;

    try {
      map.attributionControl.setPrefix('');
      map.attributionControl.addAttribution('© نشان | © OpenStreetMap contributors');
    } catch (e) {}

    this.markerLayer = L.layerGroup();
    this.cityLayer = L.layerGroup();

    if (st.lastView) {
      try { map.setView([st.lastView.lat, st.lastView.lng], st.lastView.zoom); } catch (e) {}
    }

    map.on('zoomend', function () { self._updateCityLayer(); });
    /* در حالت خوشه‌بندی، با هر تغییر نما/زوم خوشه‌ها بازمحاسبه می‌شوند.
       اگر پاپ‌آپی باز باشد بازرسم نمی‌کنیم تا پاپ‌آپ با حرکت خودش بسته نشود. */
    var debRender = null;
    var popupOpen = function () {
      try { return !!map._popup; } catch (e) { return false; }
    };
    map.on('zoomend moveend', function () {
      if (self.markerMode !== 'cluster' || popupOpen()) return;
      clearTimeout(debRender);
      debRender = setTimeout(function () {
        if (popupOpen()) return;
        self._renderMarkerSet();
      }, 150);
    });
    map.on('moveend zoomend', function () {
      var c = map.getCenter();
      self.settings.lastView = { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
      global.AppConfig.save(self.settings);
    });

    this._loadProvinces();
    this._findNeshanBase();
    /* اتصال فوری + نگهبان دوره‌ای برای مقابله با چرخه حیات SDK نشان */
    setTimeout(function () { self._ensureOverlays(); }, 0);
    setTimeout(function () { self._ensureOverlays(); }, 1200);
    setTimeout(function () { self._ensureOverlays(); }, 3000);
    setTimeout(function () { self._ensureOverlays(); }, 5500);
    self._startOverlayWatchdog();

    return map;
  };

  /* سگ نگهبان: SDK نشان گاهی لایه‌ها را در چرخه راه‌اندازی خودش جدا می‌کند؛
     اتصال لایه‌های همپوشانی را به‌صورت خودترمیم تضمین می‌کنیم */
  MapEngine.prototype._ensureOverlays = function () {
    var self = this;
    var needRedraw = false;
    var map = self.map;
    if (!map) return;
    global.ensureLeafletPlugins();
    var cont = self._markerContainer();
    if (!cont._map || cont._map !== map) {
      try { map.addLayer(cont); } catch (e) {}
      if (cont._map === map) needRedraw = true;
    }
    if (!self.cityLayer._map || self.cityLayer._map !== map) {
      try { map.addLayer(self.cityLayer); } catch (e) {}
    }
    if (self.provinceLayer && (!self.provinceLayer._map || self.provinceLayer._map !== map) && self.settings.showProvinces) {
      try { map.addLayer(self.provinceLayer); } catch (e) {}
    }
    if (self.heatLayer && self.heatOn && (!self.heatLayer._map || self.heatLayer._map !== map)) {
      try { map.addLayer(self.heatLayer); } catch (e) {}
    }
    if (needRedraw) {
      self.onNeedRedrawMarkers && self.onNeedRedrawMarkers();
    }
  };

  /* نگهبان دوره‌ای سبک: هر یک ثانیه بررسی و در صورت لزوم ترمیم */
  MapEngine.prototype._startOverlayWatchdog = function () {
    var self = this;
    if (this._watchdog) clearInterval(this._watchdog);
    this._watchdog = setInterval(function () {
      if (!self.map) return;
      var map = self.map;
      var cont = self._markerContainer();
      var detached = !cont._map || cont._map !== map;
      var cityDetached = !self.cityLayer._map || self.cityLayer._map !== map;
      if (detached || cityDetached) {
        self._ensureOverlays();
      }
      /* ترمیم لایه پایه مطابق منبع انتخابی */
      if (self.currentSource === 'osm') {
        if (self.neshanBase && map.hasLayer(self.neshanBase)) {
          try { map.removeLayer(self.neshanBase); } catch (e) {}
        }
        if (self.osmLayer && (!self.osmLayer._map || self.osmLayer._map !== map)) {
          try { map.addLayer(self.osmLayer); } catch (e) {}
        }
      } else if (self.currentSource === 'offline') {
        if (self.neshanBase && map.hasLayer(self.neshanBase)) {
          try { map.removeLayer(self.neshanBase); } catch (e) {}
        }
        if (self.offlineLayer && (!self.offlineLayer._map || self.offlineLayer._map !== map)) {
          try { map.addLayer(self.offlineLayer); } catch (e) {}
        }
      }
    }, 1000);
  };

  /* یافتن لایه کاشی داخلی SDK نشان (با تاخیر چندباره) */
  MapEngine.prototype._findNeshanBase = function () {
    var self = this;
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var m = self.map;
      var layer = m.__tileLayer || null;
      if (!layer) {
        m.eachLayer(function (l) { if (!layer && (l instanceof L.TileLayer)) layer = l; });
      }
      if (layer) {
        clearInterval(timer);
        self.neshanBase = layer;
        layer.on('tileerror', function () { self._tileErrors++; });
      } else if (tries > 15) {
        clearInterval(timer);
      }
    }, 300);
  };

  /* ---------- تعویض منبع نقشه ---------- */
  MapEngine.prototype.setSource = function (source, style) {
    var st = this.settings;
    var map = this.map;
    style = style || st.neshanStyle;
    this.currentSource = source;

    /* اطمینان از اتصال لایه‌های همپوشانی */
    this._ensureOverlays();

    /* برداشتن لایه‌های پایه قبلی (به‌جز نشانگر و برداری) */
    if (this.osmLayer) { map.removeLayer(this.osmLayer); this.osmLayer = null; }
    if (this.offlineLayer) { map.removeLayer(this.offlineLayer); this.offlineLayer = null; }

    if (source === 'neshan') {
      if (!this._isNeshanL()) {
        this.onSourceFail('sdk', 'کیت توسعه نشان بارگیری نشده (اینترنت قطع است یا مسدود شده). منبع «OSM» یا «آفلاین» را انتخاب کنید.');
        return false;
      }
      /* لایه کاشی نشان ممکن است کمی بعد ساخته شود؛ منتظر می‌مانیم */
      var self = this;
      if (this.neshanBase && !map.hasLayer(this.neshanBase)) {
        try { map.addLayer(this.neshanBase); } catch (e) {}
      }
      if (typeof map.setMapType === 'function') {
        try { map.setMapType(style); } catch (e) {}
      }
      this._syncVectorLayers();
      this._updateCityLayer();
      this._verifyNeshanTiles();
      return true;
    }

    if (source === 'osm') {
      this._hideNeshanBase();
      this.osmLayer = new CachedTileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        _cacheSrc: 'osm', _cacheStyle: 'default'
      });
      map.addLayer(this.osmLayer);
      this._syncVectorLayers();
      this._updateCityLayer();
      return true;
    }

    if (source === 'offline') {
      this._hideNeshanBase();
      var srcs = st.offlineSrc === 'neshan' ? ['neshan'] :
                 st.offlineSrc === 'osm' ? ['osm'] : ['neshan', 'osm'];
      this.offlineLayer = new OfflineTileLayer({ _srcs: srcs, _style: st.neshanStyle });
      map.addLayer(this.offlineLayer);
      this._syncVectorLayers();
      this._updateCityLayer();
      return true;
    }
    return false;
  };

  MapEngine.prototype._hideNeshanBase = function () {
    if (this.neshanBase && this.map.hasLayer(this.neshanBase)) {
      try { this.map.removeLayer(this.neshanBase); } catch (e) {}
    }
  };

  /* ---------- تغییر استایل نشان ---------- */
  MapEngine.prototype.setStyle = function (style) {
    this.settings.neshanStyle = style;
    global.AppConfig.save(this.settings);
    if (this.currentSource === 'neshan' && this._isNeshanL()) {
      try { this.map.setMapType(style); return true; } catch (e) {}
    }
    if (this.currentSource === 'offline' && this.offlineLayer) {
      this.offlineLayer.options._style = style;
      this.offlineLayer.redraw();
    }
    return false;
  };

  /* ---------- صحت‌سنجی نمایش واقعی کاشی نشان ---------- */
  MapEngine.prototype._verifyNeshanTiles = function () {
    var self = this;
    this._tileErrors = 0;
    /* اگر لایه کاشی وجود ندارد یا getTileUrl کاشی خالی می‌دهد و
       هیچ درخواست تازه‌ای به سرور کاشی نشان نمی‌رود → کلید وب لازم است */
    setTimeout(function () {
      if (self.currentSource !== 'neshan') return;
      var m = self.map;
      var layer = m.__tileLayer || self.neshanBase;
      var realUrls = false;
      if (layer) {
        try {
          var u = layer.getTileUrl({ x: 10528, y: 6449, z: 14 });
          realUrls = !!(u && /^https?:/.test(u) && u.indexOf('tile-empty') === -1);
        } catch (e) {}
      }
      if (realUrls) {
        self.onSourceFail(null); /* سالم */
        return;
      }
      /* اندازه‌گیری درخواست‌های تازه به سرور کاشی نشان */
      var before = 0, after = 0;
      try {
        before = performance.getEntriesByType('resource').filter(function (r) {
          return /tile\d*\.neshan\.org/.test(r.name);
        }).length;
      } catch (e) {}
      try { m.panBy([2, 2]); } catch (e) {}
      setTimeout(function () {
        try {
          after = performance.getEntriesByType('resource').filter(function (r) {
            return /tile\d*\.neshan\.org/.test(r.name);
          }).length;
        } catch (e) {}
        if (after <= before) {
          self.onSourceFail('key', 'نقشه نشان بارگیری نشد. کلید واردشده از نوع «سرویس» است و برای نمایش نقشه تعاملی وب مناسب نیست؛ در پنل توسعه‌دهندگان نشان یک کلید از نوع «وب» بسازید و در تب تنظیمات وارد کنید. تا آن‌هنگام می‌توانید از OSM یا حالت آفلاین استفاده کنید.');
        } else {
          self.onSourceFail(null);
        }
      }, 3500);
    }, 1500);
  };

  /* ---------- دستگیری و ذخیره کاشی‌های نشان (وقتی سالم است) ---------- */
  MapEngine.prototype._hookNeshanCapture = function () {
    var self = this;
    var layer = this.map.__tileLayer || this.neshanBase;
    if (!layer || layer.__captureHooked) return;
    layer.__captureHooked = true;
    layer.on('tileloadstart', function (e) {
      var coords = e.coords;
      if (!coords) return;
      var url = null;
      try { url = layer.getTileUrl(coords); } catch (err) {}
      if (url && /^https?:/.test(url) && url.indexOf('tile-empty') === -1) {
        fetch(url, { mode: 'cors' })
          .then(function (r) { if (!r.ok) throw 0; return r.blob(); })
          .then(function (blob) {
            TS.putTile('neshan', self.settings.neshanStyle, coords.z, coords.x, coords.y, blob);
            self._captured++;
            self.onCaptureProgress(self._captured);
          })
          .catch(function () {});
      }
    });
  };

  /* ---------- آدرس کاشی نشان برای دانلود آفلاین ---------- */
  MapEngine.prototype.probeNeshanUrl = function () {
    var layer = this.map.__tileLayer || this.neshanBase;
    if (layer && this._isNeshanL()) {
      try {
        var u = layer.getTileUrl({ x: 10528, y: 6449, z: 14 });
        if (u && /^https?:/.test(u) && u.indexOf('tile-empty') === -1) return u;
      } catch (e) {}
    }
    return null;
  };

  /* ---------- لایه برداری استان‌ها ---------- */
  MapEngine.prototype._loadProvinces = function () {
    var self = this;
    fetch('data/iran-provinces.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        self._provData = data;
        self._syncVectorLayers();
        /* اگر نشانگرها قبل از رسیدن داده رسم شده‌اند، برای درج نام استان دوباره رسم کن */
        self.onNeedRedrawMarkers && self.onNeedRedrawMarkers();
      })
      .catch(function () { /* بدون لایه برداری ادامه بده */ });
  };

  MapEngine.prototype._syncVectorLayers = function () {
    var map = this.map;
    if (!map) return;
    var st = this.settings;
    if (this.provinceLayer && map.hasLayer(this.provinceLayer)) {
      map.removeLayer(this.provinceLayer);
      this.provinceLayer = null;
    }
    if (st.showProvinces && this._provData) {
      var styleFn = function () {
        return { color: '#7a9e8f', weight: 1, opacity: 0.85, fillColor: '#dcefe6', fillOpacity: 0.12 };
      };
      this.provinceLayer = L.geoJSON(this._provData, {
        style: styleFn,
        onEachFeature: function (feature, layer) {
          if (feature.properties && feature.properties.name) {
            layer.bindTooltip(feature.properties.name, { sticky: true, className: 'province-tip' });
          }
        },
        smoothFactor: 1.2
      });
      this.provinceLayer.addTo(map);
      /* لایه برداری باید زیر نشانگرها ولی روی کاشی خاکستری باشد */
      try {
        if (this.provinceLayer.bringToBack) this.provinceLayer.bringToBack();
      } catch (e) {}
    }
    this._updateCityLayer();
  };

  MapEngine.prototype._updateCityLayer = function () {
    var map = this.map;
    if (!map) return;
    var st = this.settings;
    var zoom = map.getZoom();
    this.cityLayer.clearLayers();
    if (!st.showCities) return;
    if (!map.hasLayer(this.cityLayer) || this.cityLayer._map !== map) {
      try { map.addLayer(this.cityLayer); } catch (e) {}
    }
    CITIES.forEach(function (c) {
      if (zoom >= c.z) {
        var m = L.marker([c.lat, c.lng], {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({ className: 'city-label', html: c.name, iconSize: null, iconAnchor: [16, 8] })
        });
        this.cityLayer.addLayer(m);
      }
    }, this);
  };

  /* ---------- نام استان برای پاپ‌آپ ---------- */
  function pointInRing(pt, ring) {
    var x = pt[0], y = pt[1], inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      var intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  function pointInPolygon(pt, polygon) {
    for (var k = 0; k < polygon.length; k++) {
      if (pointInRing(pt, polygon[k])) return k === 0;
    }
    return false;
  }
  MapEngine.prototype.provinceAt = function (lat, lng) {
    if (!this._provData) return '';
    var pt = [lng, lat];
    var feats = this._provData.features || [];
    for (var i = 0; i < feats.length; i++) {
      var g = feats[i].geometry;
      if (!g) continue;
      if (g.type === 'Polygon') {
        if (pointInPolygon(pt, g.coordinates)) return feats[i].properties.name;
      } else if (g.type === 'MultiPolygon') {
        for (var p = 0; p < g.coordinates.length; p++) {
          if (pointInPolygon(pt, g.coordinates[p])) return feats[i].properties.name;
        }
      }
    }
    return '';
  };

  /* ---------- دانلود محدوده برای آفلاین ---------- */
  function lng2tile(lng, z) { return Math.floor((lng + 180) / 360 * Math.pow(2, z)); }
  function lat2tile(lat, z) {
    var rad = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z));
  }

  MapEngine.prototype.listAreaTiles = function (bounds, zMin, zMax) {
    var jobs = [];
    for (var z = zMin; z <= zMax; z++) {
      var x0 = lng2tile(bounds.getWest(), z), x1 = lng2tile(bounds.getEast(), z);
      var y0 = lat2tile(bounds.getNorth(), z), y1 = lat2tile(bounds.getSouth(), z);
      for (var x = x0; x <= x1; x++) {
        for (var y = y0; y <= y1; y++) {
          jobs.push({ z: z, x: x, y: y });
        }
      }
    }
    return jobs;
  };

  MapEngine.prototype.prefetch = function (jobs, opts) {
    var self = this;
    opts = opts || {};
    var concurrency = opts.concurrency || 6;
    var onProgress = opts.onProgress || function () {};
    var shouldStop = opts.shouldStop || function () { return false; };
    var src = opts.src || 'osm';
    var style = opts.style || this.settings.neshanStyle;

    var total = jobs.length, done = 0, okCount = 0, errCount = 0, bytes = 0;
    var idx = 0;
    var cancelled = false;

    function nextJob() {
      if (cancelled || shouldStop()) return;
      if (idx >= total) return;
      var job = jobs[idx++];
      var p = (src === 'neshan') ? self._fetchNeshanTile(job, style) : self._fetchOsmTile(job);
      p.then(function (rec) {
        done++;
        if (rec !== null) { okCount++; bytes += rec; } else { errCount++; }
        onProgress({ done: done, total: total, ok: okCount, err: errCount, bytes: bytes, finished: done >= total });
        nextJob();
      });
    }
    for (var i = 0; i < Math.min(concurrency, Math.max(total, 1)); i++) nextJob();

    return {
      cancel: function () { cancelled = true; }
    };
  };

  MapEngine.prototype._fetchOsmTile = function (job) {
    var url = 'https://tile.openstreetmap.org/' + job.z + '/' + job.x + '/' + job.y + '.png';
    return fetch(url, { mode: 'cors' })
      .then(function (r) { if (!r.ok) throw 0; return r.blob(); })
      .then(function (b) { return TS.putTile('osm', 'default', job.z, job.x, job.y, b).then(function () { return b.size; }); })
      .catch(function () { return null; });
  };

  MapEngine.prototype._fetchNeshanTile = function (job, style) {
    var layer = this.map.__tileLayer || this.neshanBase;
    var url = null;
    if (layer) {
      try { url = layer.getTileUrl(job); } catch (e) {}
    }
    if (!url || url.indexOf('tile-empty') !== -1) return Promise.resolve(null);
    return fetch(url, { mode: 'cors' })
      .then(function (r) { if (!r.ok) throw 0; return r.blob(); })
      .then(function (b) { return TS.putTile('neshan', style, job.z, job.x, job.y, b).then(function () { return b.size; }); })
      .catch(function () { return null; });
  };

  /* ---------- نشانگرها ---------- */
  /* برچسب‌های هشدار بالای پاپ‌آپ: وضعیت پیگیری و کدملی */
  function buildAlertBadges(point) {
    var out = '';
    if (point.followupKind === 'overdue') {
      out += '<div class="pop-badge pop-err">⏰ موعد پیگیری گذشته: ' + U.faNum(point.followupDays) + ' روز</div>';
    } else if (point.followupKind === 'today') {
      out += '<div class="pop-badge pop-warn">⏰ موعد پیگیری: امروز</div>';
    } else if (point.followupKind === 'soon') {
      out += '<div class="pop-badge pop-warn">⏰ پیگیری تا ' + U.faNum(point.followupDays) + ' روز آینده</div>';
    }
    if (point.ninState === 'invalid') {
      out += '<div class="pop-badge pop-err">🪪 کدملی نامعتبر — ' + U.escapeHtml(point.ninReason || 'رقم کنترل صحیح نیست') + '</div>';
    }
    return out;
  }

  /* ساخت محتوای پاپ‌آپ: نام (با نماد رنگ) + استان + همه فیلدهای فایل + مختصات */
  function buildPopupHtml(point) {
    var titleSw = point.color ? '<span class="sw" style="background:' + point.color + '"></span>' : '';
    var html = '<div class="popup-title">' + titleSw + U.escapeHtml(point.name) + '</div>';
    var badges = buildAlertBadges(point);
    if (badges) html += badges;
    if (point.province) {
      html += '<div class="popup-prov">📍 استان: ' + U.escapeHtml(point.province) + '</div>';
    }
    var fs = point.fields || [];
    if (fs.length) {
      var rows = '';
      for (var i = 0; i < fs.length; i++) {
        var f = fs[i];
        var sw = f.swatch ? '<span class="sw" style="background:' + f.swatch + '"></span>' : '';
        var valHtml;
        if (f.link) {
          valHtml = sw + '<a href="' + U.escapeHtml(f.link) + '" target="_blank" rel="noopener noreferrer">'
            + U.escapeHtml(f.value && f.value.indexOf('http') !== 0 ? f.value : 'مشاهده لینک ↗')
            + '</a>';
        } else {
          valHtml = sw + U.escapeHtml(f.value);
        }
        rows += '<tr><td class="pf-l">' + U.escapeHtml(f.label) + '</td><td class="pf-v">' + valHtml + '</td></tr>';
      }
      html += '<table class="popup-fields">' + rows + '</table>';
    }
    html += '<div class="popup-coords" dir="ltr">' + point.lat.toFixed(6) + ', ' + point.lng.toFixed(6) + '</div>';
    return html;
  }

  /* آیا رنگ روشن است؟ (برای انتخاب حاشیه و رنگ متن دایره) */
  function isLightColor(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return false;
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 205;
  }

  /* نشانگر دایره‌ای — رنگ از ستون «رنگ بندی» فایل (یا رنگ دسته) */
  MapEngine.prototype.addMarker = function (point, index, numbered) {
    if (!this.map) return;
    var cont = this._markerContainer();
    /* اگر لایه نشانگر به نقشه وصل نیست، الان وصلش کنیم */
    if (!this.map.hasLayer(cont) || cont._map !== this.map) {
      try { this.map.addLayer(cont); } catch (e) {}
    }
    var color = point.color || '#0e8a5f';
    var size = numbered ? 27 : 17;
    var cls = 'marker-circle' + (isLightColor(color) ? ' marker-circle-light' : '');
    if (point.followupKind === 'overdue') cls += ' marker-overdue';
    var ring = point.followupKind === 'overdue' ? '<i class="pulse-ring"></i>' : '';
    var html = '<div class="' + cls + '" style="background:' + color + '">'
      + ring + (numbered ? '<span>' + (index + 1) + '</span>' : '') + '</div>';
    var icon = L.divIcon({
      className: '',
      html: html,
      iconSize: [size, size],
      iconAnchor: [Math.round(size / 2), Math.round(size / 2)]
    });
    var m = L.marker([point.lat, point.lng], { icon: icon, title: point.name });
    m.bindPopup(buildPopupHtml(point), { maxWidth: 320, minWidth: 220, maxHeight: 360, autoPan: true });
    m.bindTooltip(U.escapeHtml(point.name), { direction: 'top', offset: [0, -16] });
    point._marker = m;
    cont.addLayer(m);
  };

  /* رفتن روی یک نقطه و بازکردن پاپ‌آپ آن */
  MapEngine.prototype.openPoint = function (point) {
    var self = this;
    if (!this.map || !point) return;
    if (this.markerMode === 'cluster') {
      /* در حالت خوشه، حرکت نقشه باعث بازرسم خوشه‌ها می‌شود؛ پاپ‌آپ را به
         «بازرسم بعدی» می‌سپاریم (و برای اطمینان یک زمان‌سنج پشتیبان هم داریم) */
      this._pendingOpen = point;
      this.map.flyTo([point.lat, point.lng], Math.max(this.map.getZoom() + 2, 13), { duration: 0.6 });
      setTimeout(function () {
        if (self._pendingOpen === point && point._marker) {
          self._pendingOpen = null;
          try { point._marker.openPopup(); } catch (e) {}
        }
      }, 900);
      return;
    }
    var marker = point._marker;
    if (!marker) return;
    this.map.flyTo([point.lat, point.lng], Math.max(this.map.getZoom(), 14), { duration: 0.6 });
    setTimeout(function () { try { marker.openPopup(); } catch (e) {} }, 650);
  };

  MapEngine.prototype.clearMarkers = function () {
    this._setPoints = [];
    this._pendingOpen = null;
    if (this.markerLayer) this.markerLayer.clearLayers();
  };

  MapEngine.prototype.flyTo = function (lat, lng, zoom) {
    if (!this.map) return;
    this.map.flyTo([lat, lng], zoom || 14, { duration: 0.7 });
  };

  MapEngine.prototype.fitPoints = function (points) {
    if (!this.map || !points.length) return;
    var bounds = L.latLngBounds(points.map(function (p) { return [p.lat, p.lng]; }));
    this.map.fitBounds(bounds.pad(0.18), { maxZoom: 15 });
  };

  global.MapEngine = MapEngine;
  global._MapBits = { CachedTileLayer: CachedTileLayer, OfflineTileLayer: OfflineTileLayer };
})(window);

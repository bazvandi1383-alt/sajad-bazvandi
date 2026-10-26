/* =========================================================
   tilestore.js — حافظه آفلاین کاشی‌های نقشه (IndexedDB)
   کلید: src|style|z|x|y   مقدار: {blob, ts, size}
   روی file:// هم کار می‌کند (برخلاف Service Worker)
   ========================================================= */
(function (global) {
  'use strict';

  var DB_NAME = 'neshanExcelMapCache';
  var DB_VERSION = 1;
  var STORE = 'tiles';

  var _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error('این مرورگر از IndexedDB پشتیبانی نمی‌کند؛ حالت آفلاین کاشی‌ها در دسترس نیست.'));
        return;
      }
      var req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var st = db.createObjectStore(STORE);
          st.createIndex('ts', 'ts');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('خطا در باز کردن حافظه آفلاین')); };
    });
    return _dbPromise;
  }

  function tx(mode) {
    return openDB().then(function (db) {
      return db.transaction(STORE, mode).objectStore(STORE);
    });
  }

  function tileKey(src, style, z, x, y) {
    return src + '|' + (style || '-') + '|' + z + '/' + x + '/' + y;
  }

  function putTile(src, style, z, x, y, blob) {
    return tx('readwrite').then(function (st) {
      return new Promise(function (resolve, reject) {
        var rec = { blob: blob, ts: Date.now(), size: blob ? blob.size : 0 };
        var req = st.put(rec, tileKey(src, style, z, x, y));
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { reject(req.error); };
      });
    }).catch(function () { return false; });
  }

  function getTile(src, style, z, x, y) {
    return tx('readonly').then(function (st) {
      return new Promise(function (resolve, reject) {
        var req = st.get(tileKey(src, style, z, x, y));
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  /* برای حالت «خودکار»: اول نشان، بعد OSM */
  function getTileAuto(srcs, style, z, x, y) {
    var i = 0;
    function next() {
      if (i >= srcs.length) return Promise.resolve(null);
      var s = srcs[i++];
      return getTile(s, s === 'osm' ? 'default' : style, z, x, y).then(function (rec) {
        return rec || next();
      });
    }
    return next();
  }

  function hasAnyTile(srcs, style, z, x, y) {
    return getTileAuto(srcs, style, z, x, y).then(Boolean);
  }

  function hasTileExact(src, style, z, x, y) {
    return getTile(src, style, z, x, y).then(Boolean);
  }

  /* آمار حافظه: تعداد و حجم به تفکیک منبع */
  function stats() {
    return tx('readonly').then(function (st) {
      return new Promise(function (resolve) {
        var out = { total: 0, bytes: 0, bySrc: { neshan: { count: 0, bytes: 0 }, osm: { count: 0, bytes: 0 } } };
        if (!st.openCursor) { resolve(out); return; }
        var req = st.openCursor();
        req.onsuccess = function (ev) {
          var cur = ev.target.result;
          if (!cur) { resolve(out); return; }
          var rec = cur.value || {};
          var size = rec.size || (rec.blob && rec.blob.size) || 0;
          out.total++; out.bytes += size;
          var src = cur.key ? String(cur.key).split('|')[0] : '?';
          if (!out.bySrc[src]) out.bySrc[src] = { count: 0, bytes: 0 };
          out.bySrc[src].count++; out.bySrc[src].bytes += size;
          cur.continue();
        };
        req.onerror = function () { resolve(out); };
      });
    }).catch(function () {
      return { total: 0, bytes: 0, bySrc: {} };
    });
  }

  function clearAll() {
    return tx('readwrite').then(function (st) {
      return new Promise(function (resolve) {
        var req = st.clear();
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { resolve(false); };
      });
    }).catch(function () { return false; });
  }

  global.TileStore = {
    putTile: putTile,
    getTile: getTile,
    getTileAuto: getTileAuto,
    hasTileExact: hasTileExact,
    hasAnyTile: hasAnyTile,
    stats: stats,
    clearAll: clearAll,
    tileKey: tileKey
  };
})(window);

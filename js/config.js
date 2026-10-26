/* =========================================================
   config.js — تنظیمات سراسری برنامه
   کلید اولیه نشان (از کاربر) + ذخیره/خواندن تنظیمات
   ========================================================= */
(function (global) {
  'use strict';

  var DEFAULT_NESHAN_KEY = 'web.2482839e4eac4f2697f6b8662381a20e';

  /* کلیدهای قدیمی — برای مهاجرت خودکار تنظیمات ذخیره‌شده */
  var OLD_KEYS = [
    'service.60ade760f48144d8a3b9b2e9c9700275',
    'web.619f9e555c494d6a81facf84cdac5b7a'
  ];

  var LS_KEY = 'neshanExcelMap.settings';

  var defaults = {
    neshanKey: DEFAULT_NESHAN_KEY,
    source: 'neshan',        // neshan | osm | offline
    neshanStyle: 'dreamy',   // dreamy | standard | standard-night | gray | pastel
    offlineSrc: 'auto',      // auto | neshan | osm
    showProvinces: true,
    showCities: true,
    numberedMarkers: true,
    clusterMarkers: false,   // خوشه‌بندی نشانگرها
    heatMap: false,          // نقشه حرارتی تراکم
    lastView: null           // {lat, lng, zoom}
  };

  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      var saved = raw ? JSON.parse(raw) : {};
      var merged = Object.assign({}, defaults, saved);
      /* مهاجرت: اگر کلید قدیمی ذخیره شده باشد، با کلید وب جدید جایگزین می‌شود */
      if (merged.neshanKey && OLD_KEYS.indexOf(merged.neshanKey) !== -1) {
        merged.neshanKey = DEFAULT_NESHAN_KEY;
        save(merged);
      }
      return merged;
    } catch (e) {
      return Object.assign({}, defaults);
    }
  }

  function save(settings) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(settings));
    } catch (e) {
      /* حافظه پر یا مسدود است — بی‌خیال */
    }
  }

  global.AppConfig = {
    DEFAULT_NESHAN_KEY: DEFAULT_NESHAN_KEY,
    NESHAN_SDK_CSS: 'https://static.neshan.org/sdk/leaflet/v1.9.4/neshan-sdk/v1.0.8/index.css',
    load: load,
    save: save
  };
})(window);

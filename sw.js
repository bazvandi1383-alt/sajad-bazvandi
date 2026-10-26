/* =========================================================
   sw.js — سرویس‌کار برنامه «سامانه مدیریت منابع انسانی» (PWA)
   -----------------------------------------------------------
   - پوسته برنامه (HTML/CSS/JS/فونت/آیکون) کش می‌شود تا آفلاین هم باز شود.
   - کاشی‌های نقشه اینجا کش نمی‌شوند؛ آن‌ها از قبل در IndexedDB
     توسط خود برنامه ذخیره می‌شوند (tilestore.js) و به SW نیازی ندارند.
   - درخواست‌های cross-origin (SDK نشان و کاشی‌های آنلاین) دست‌نخورده
     عبور می‌کنند تا منطق کش خود برنامه به‌هم نخورد.
   ========================================================= */
(function () {
  'use strict';

  var CACHE = 'nema-epi-map-v13';

  var CORE = [
    './',
    './index.html',
    './admin.html',
    './support.html',
    'manifest.json',
    'css/fonts.css',
    'css/style.css',
    'js/config.js',
    'js/util.js',
    'js/jdate.js',
    'js/cloud.js',
    'js/auth.js',
    'js/registry.js',
    'js/tilestore.js',
    'js/excel.js',
    'js/layers.js',
    'js/app.js',
    'lib/leaflet/leaflet.js',
    'lib/leaflet/leaflet.css',
    'lib/xlsx.full.min.js',
    'lib/heat/leaflet-heat.js',
    'lib/fonts/Vazirmatn-Regular.woff2',
    'lib/fonts/Vazirmatn-Medium.woff2',
    'lib/fonts/Vazirmatn-Bold.woff2',
    'lib/leaflet/images/marker-icon.png',
    'lib/leaflet/images/marker-icon-2x.png',
    'lib/leaflet/images/marker-shadow.png',
    'lib/leaflet/images/layers.png',
    'lib/leaflet/images/layers-2x.png',
    'icons/icon-192.png',
    'icons/icon-512.png'
  ];

  /* ---------- نصب: کش پوسته برنامه ---------- */
  self.addEventListener('install', function (e) {
    e.waitUntil(
      caches.open(CACHE).then(function (c) {
        /* هر فایل جداگانه کش می‌شود تا خطای یکی، بقیه را از کش کردن بازندارد */
        return Promise.all(CORE.map(function (url) {
          return c.add(new Request(url, { cache: 'reload' })).catch(function () { /* فایل نبود؟ مهم نیست */ });
        }));
      }).then(function () { return self.skipWaiting(); })
    );
  });

  /* ---------- فعال‌سازی: پاک‌کردن کش نسخه‌های قدیمی ---------- */
  self.addEventListener('activate', function (e) {
    e.waitUntil(
      caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k !== CACHE) return caches.delete(k);
          return null;
        }));
      }).then(function () { return self.clients.claim(); })
    );
  });

  /* ---------- واکشی ---------- */
  self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (req.method !== 'GET') return;

    /* فقط درخواست‌های same-origin — بقیه (کاشی نشان/OSM و SDK) رد می‌شود */
    var url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    /* ناوبری صفحه: اول شبکه، در قطعی اینترنت از کش (خود صفحه اگر کش بود) */
    if (req.mode === 'navigate') {
      e.respondWith(
        fetch(req).catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match('index.html') || caches.match('./');
          });
        })
      );
      return;
    }

    /* بقیه دارایی‌ها: استراتژی «کش کهنه + به‌روزرسانی پس‌زمینه» (stale-while-revalidate)
       تا برنامه فوراً باز شود و در همان حال نسخه تازه هم دریافت و ذخیره گردد */
    e.respondWith(
      caches.match(req).then(function (hit) {
        var fresh = fetch(req).then(function (res) {
          if (res && res.ok && res.type === 'basic') {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { try { c.put(req, copy); } catch (er) {} });
          }
          return res;
        }).catch(function () {
          return hit || Response.error();
        });
        return hit || fresh;
      })
    );
  });
})();

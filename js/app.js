/* =========================================================
   app.js — رابط کاربری و اتصال ماژول‌ها
   ========================================================= */
(function (global) {
  'use strict';

  var U = global.Util;
  var CFG = global.AppConfig;
  var TS = global.TileStore;
  var XL = global.ExcelModule;

  var settings = CFG.load();
  var engine = null;
  var points = [];           /* همه رکوردهای خوانده‌شده از فایل */
  /* ستون‌های meta سامانه منابع انسانی — طبق درخواست کاربر */
  var meta = {
    sheetName: '', headerDetected: false,
    baseLabel: '', houseLabel: '', centerLabel: '',
    popTotalLabel: '', popUnder1Label: '', popUnder5Label: '', caregiverCountLabel: '',
    caregiverLabel: '', behvarzLabel: '', observerLabel: '',
    envExpertLabel: '', occExpertLabel: '', doctorLabel: '', dentistLabel: '',
    servicesLabel: '', receptionLabel: '',
    colorLabel: '', followupLabel: '', ninLabel: '', monthLabel: ''
  };
  var filters = { center: '', base: '', house: '', pop: '' };   /* فیلترهای فعال سامانه منابع انسانی */
  var currentDownload = null;
  var simulatedOffline = false;

  /* پالت رنگ پیش‌فرض برای دسته‌ها (وقتی فایل کد رنگ نداشته باشد) */
  var CAT_PALETTE = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1',
                     '#c0392b', '#7cb342', '#3949ab', '#f06292', '#00897b', '#ffb300'];
  function assignCategoryColors(list) {
    /* در سامانه منابع انسانی، کلید دسته‌بندی اولویت با مرکز، سپس پایگاه است */
    function keyOf(p) { return (p.center || p.base || p.house || '').trim(); }
    var uniq = [], seen = {};
    list.forEach(function (p) {
      var k = keyOf(p);
      if (k && !seen[k]) { seen[k] = true; uniq.push(k); }
    });
    var map = {};
    uniq.forEach(function (k, i) { map[k] = CAT_PALETTE[i % CAT_PALETTE.length]; });
    list.forEach(function (p) { if (!p.color) p.color = map[keyOf(p)] || '#0e8a5f'; });
  }

  /* ---------- ابزار DOM ---------- */
  function $(id) { return document.getElementById(id); }
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  /* ---------- وضعیت شبکه ---------- */
  var netOnline = navigator.onLine;
  function effectiveOnline() { return netOnline && !simulatedOffline; }

  function updateNetStatus() {
    var chip = $('netStatus');
    var badge = $('offlineBadge');
    if (effectiveOnline()) {
      chip.textContent = '● آنلاین';
      chip.className = 'status-chip status-online';
      hide(badge);
    } else {
      chip.textContent = '● آفلاین';
      chip.className = 'status-chip status-offline';
      show(badge);
    }
    /* اگر منبع فعلی آنلاین است و شبکه قطع شد → راهنمایی */
    if (!effectiveOnline() && settings.source !== 'offline') {
      showBanner('اینترنت در دسترس نیست. برای ادامه می‌توانید منبع نقشه را روی «آفلاین» بگذارید (کاشی‌های ذخیره‌شده + نقشه برداری ایران).', 'warn');
    } else if (bannerKind === 'net') {
      hideBanner();
    }
  }
  var bannerKind = null;
  function showBanner(html, kind) {
    var b = $('mapBanner');
    b.innerHTML = html;
    b.className = 'map-banner ' + (kind || '');
    bannerKind = kind;
  }
  function hideBanner() {
    var b = $('mapBanner');
    b.className = 'map-banner hidden';
    bannerKind = null;
  }

  /* ---------- تب‌ها ---------- */
  function activateTab(name) {
    /* هم تب‌های پنل کناری و هم نوار تب‌های موبایل همگام می‌شوند */
    document.querySelectorAll('.tab, .mtab').forEach(function (x) {
      var on = x.dataset.tab === name;
      x.classList.toggle('active', on);
      if (x.getAttribute('aria-selected') !== null) x.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'tab-' + name);
    });
  }

  function initTabs() {
    var tabs = document.querySelectorAll('.tab');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () { activateTab(t.dataset.tab); });
    });
    /* نوار تب‌های موبایل: فعال‌سازی بخش + بازکردن پنل در صفحه‌های کوچک */
    document.querySelectorAll('.mtab').forEach(function (t) {
      t.addEventListener('click', function () {
        activateTab(t.dataset.tab);
        var sb = $('sidebar');
        if (sb && sb.classList.contains('collapsed')) {
          sb.classList.remove('collapsed');
          setTimeout(function () { engine && engine.map && engine.map.invalidateSize(); }, 280);
        }
      });
    });
  }

  /* ---------- آپلود فایل ---------- */
  function initUpload() {
    var dz = $('dropZone');
    var fi = $('fileInput');

    dz.addEventListener('click', function () { fi.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('dragover'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault();
      dz.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    fi.addEventListener('change', function () {
      if (fi.files && fi.files[0]) handleFile(fi.files[0]);
      fi.value = '';
    });

    $('btnTemplate').addEventListener('click', function () {
      try {
        var blob = XL.makeTemplate();
        U.downloadBlob(blob, 'قالب_نمونه_نقاط.xlsx');
        U.toast('فایل قالب نمونه دانلود شد.', 'ok');
      } catch (e) {
        U.toast('ساخت قالب ناموفق بود: ' + e.message, 'error');
      }
    });

    $('btnClear').addEventListener('click', function () {
      if (!points.length) { U.toast('نقطه‌ای برای پاک‌سازی نیست.', 'warn'); return; }
      points = [];
      meta = { sheetName: '', headerDetected: false, diseaseLabel: '', monthLabel: '', baseLabel: '', colorLabel: '', followupLabel: '', ninLabel: '' };
      filters = { center: '', base: '', house: '', pop: '' };
      savePointsLocal();
      buildFilterOptions();
      renderPoints();
      engine && engine.clearMarkers();
      applyHeat();
      U.toast('همه نقاط پاک شد.', 'ok');
    });
  }

  /* ---------- فیلتر و دسته‌بندی (مرکز / پایگاه / خانه بهداشت / جمعیت) ---------- */
  var FLTD_MAP = { fltCenter: 'center', fltBase: 'base', fltHouse: 'house', fltPop: 'pop' };
  /* بازه‌های جمعیت برای فیلتر — مطابق index.html */
  var POP_RANGES = [
    { key: '0-500',    min: 0,    max: 500,    label: 'کمتر از ۵۰۰' },
    { key: '500-1000', min: 500,  max: 1000,   label: '۵۰۰ تا ۱٬۰۰۰' },
    { key: '1000-2000', min: 1000, max: 2000,  label: '۱٬۰۰۰ تا ۲٬۰۰۰' },
    { key: '2000-5000', min: 2000, max: 5000,  label: '۲٬۰۰۰ تا ۵٬۰۰۰' },
    { key: '5000+',    min: 5000, max: Infinity, label: 'بیشتر از ۵٬۰۰۰' }
  ];

  function normFaText(s) {
    return U.toLatinDigits(s === null || s === undefined ? '' : String(s))
      .replace(/[\u200c\u200f\u200e]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function anyFilter() { return !!(filters.center || filters.base || filters.house || filters.pop); }

  function matchFilters(p) {
    if (filters.center && (p.center || '') !== filters.center) return false;
    if (filters.base && (p.base || '') !== filters.base) return false;
    if (filters.house && (p.house || '') !== filters.house) return false;
    if (filters.pop) {
      /* فیلتر بازه جمعیت — بر اساس ستون «کل جمعیت» */
      var range = null;
      for (var i = 0; i < POP_RANGES.length; i++) {
        if (POP_RANGES[i].key === filters.pop) { range = POP_RANGES[i]; break; }
      }
      if (range) {
        var pop = p.popTotal || 0;
        if (range.max === Infinity) {
          if (!(pop >= range.min)) return false;
        } else {
          if (!(pop >= range.min && pop < range.max)) return false;
        }
      }
    }
    return true;
  }

  /* همه ردیف‌های منطبق با فیلتر (همراه اندیس اصلی در points) */
  function filteredRows() {
    var out = [];
    points.forEach(function (p, i) {
      if (matchFilters(p)) out.push({ p: p, i: i });
    });
    return out;
  }

  /* رکوردهای معتبر و غیرتکراریِ منطبق با فیلتر → همان‌هایی که روی نقشه رسم می‌شوند */
  function filteredPoints() {
    return filteredRows()
      .filter(function (x) { return x.p.valid && !x.p.duplicate; })
      .map(function (x) { return x.p; });
  }

  /* مقادیر یکتا + تعداد تکرار (شمارش دقیق مستقل از ترتیب ردیف‌ها) */
  function uniqueWithCount(list, get) {
    var seen = {}, out = [];
    list.forEach(function (p) {
      var v = get(p);
      if (v === null || v === undefined || v === '') return;
      if (!seen[v]) { seen[v] = { v: v, n: 0 }; out.push(seen[v]); }
      seen[v].n++;
    });
    return out;
  }

  function sortPairsFa(pairs) {
    return pairs.slice().sort(function (a, b) { return String(a.v).localeCompare(String(b.v), 'fa'); });
  }

  function fillFilterSelect(id, pairs, current) {
    var sel = $(id);
    sel.innerHTML = '';
    var all = document.createElement('option');
    all.value = '';
    all.textContent = 'همه';
    sel.appendChild(all);
    pairs.forEach(function (pr) {
      var o = document.createElement('option');
      o.value = pr.v;
      o.textContent = pr.v + ' (' + U.faNum(pr.n) + ')';
      sel.appendChild(o);
    });
    sel.value = current || '';
    if (sel.value !== (current || '')) sel.value = '';
  }

  /* برای فیلتر جمعیت، گزینه‌های ثابت را نگه می‌داریم و فقط شمارش را به‌روز می‌کنیم */
  function fillPopFilter(current) {
    var sel = $('fltPop');
    if (!sel) return;
    /* شمارش رکوردهای هر بازه */
    var counts = {};
    POP_RANGES.forEach(function (r) { counts[r.key] = 0; });
    validPoints().forEach(function (p) {
      var pop = p.popTotal || 0;
      for (var i = 0; i < POP_RANGES.length; i++) {
        var r = POP_RANGES[i];
        if (r.max === Infinity) {
          if (pop >= r.min) { counts[r.key]++; break; }
        } else {
          if (pop >= r.min && pop < r.max) { counts[r.key]++; break; }
        }
      }
    });
    sel.innerHTML = '';
    var all = document.createElement('option');
    all.value = '';
    all.textContent = 'همه';
    sel.appendChild(all);
    POP_RANGES.forEach(function (r) {
      var o = document.createElement('option');
      o.value = r.key;
      o.textContent = r.label + ' (' + U.faNum(counts[r.key]) + ')';
      sel.appendChild(o);
    });
    sel.value = current || '';
  }

  function buildFilterOptions() {
    var vps = validPoints();
    fillFilterSelect('fltCenter', sortPairsFa(uniqueWithCount(vps, function (p) { return p.center; })), filters.center);
    fillFilterSelect('fltBase', sortPairsFa(uniqueWithCount(vps, function (p) { return p.base; })), filters.base);
    fillFilterSelect('fltHouse', sortPairsFa(uniqueWithCount(vps, function (p) { return p.house; })), filters.house);
    fillPopFilter(filters.pop);
  }

  function initFilters() {
    Object.keys(FLTD_MAP).forEach(function (id) {
      $(id).addEventListener('change', function () {
        filters[FLTD_MAP[id]] = this.value;
        renderPoints();
        drawPoints(true);
      });
    });
    $('btnClearFilters').addEventListener('click', function () {
      filters = { center: '', base: '', house: '', pop: '' };
      ['fltCenter', 'fltBase', 'fltHouse', 'fltPop'].forEach(function (id) { $(id).value = ''; });
      renderPoints();
      drawPoints(true);
    });
  }

  /* ---------- ماندگاری محلی نقاط ----------
     نقاط پس از بستن مرورگر/ریفرش هم می‌مانند تا admin آن‌ها را پاک نکرده است.
     (پشتیبان کامل این داده در فایل پشتیبان‌گیری پنل مدیریت هم می‌آید.) */
  var LS_POINTS = 'nema.points.v1';
  function savePointsLocal() {
    try {
      localStorage.setItem(LS_POINTS, JSON.stringify({ points: points, meta: meta }));
    } catch (e) {
      /* حافظه پر است (دادهٔ بسیار بزرگ) — بدون توقف برنامه */
    }
  }
  function restoreSavedPoints() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS_POINTS) || 'null'); } catch (e) { saved = null; }
    if (!saved || !Array.isArray(saved.points) || !saved.points.length) return;
    points = saved.points;
    meta = saved.meta || meta;
    filters = { center: '', base: '', house: '', pop: '' };
    assignCategoryColors(points);
    buildFilterOptions();
    renderPoints();
    drawPoints();
    U.toast(fa(points.length) + ' نقطهٔ بارگذاری‌شدهٔ قبلی بازیابی شد.', 'ok', 3500);
  }
  function fa(n) { return String(n).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[Number(d)]; }); }

  function handleFile(file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (['xlsx', 'xls', 'csv'].indexOf(ext) === -1) {
      U.toast('فرمت فایل پشتیبانی نمی‌شود. از xlsx / xls / csv استفاده کنید.', 'error');
      return;
    }
    U.toast('در حال خواندن «' + file.name + '» …', 'ok', 1600);
    XL.parseFile(file).then(function (res) {
      points = res.points;
      meta.sheetName = res.sheetName;
      meta.headerDetected = res.headerDetected;
      /* ستون‌های اصلی سامانه منابع انسانی */
      meta.baseLabel = res.baseLabel || '';
      meta.houseLabel = res.houseLabel || '';
      meta.centerLabel = res.centerLabel || '';
      meta.popTotalLabel = res.popTotalLabel || '';
      meta.popUnder1Label = res.popUnder1Label || '';
      meta.popUnder5Label = res.popUnder5Label || '';
      meta.caregiverCountLabel = res.caregiverCountLabel || '';
      meta.caregiverLabel = res.caregiverLabel || '';
      meta.behvarzLabel = res.behvarzLabel || '';
      meta.observerLabel = res.observerLabel || '';
      meta.envExpertLabel = res.envExpertLabel || '';
      meta.occExpertLabel = res.occExpertLabel || '';
      meta.doctorLabel = res.doctorLabel || '';
      meta.dentistLabel = res.dentistLabel || '';
      meta.servicesLabel = res.servicesLabel || '';
      meta.receptionLabel = res.receptionLabel || '';
      meta.colorLabel = res.colorLabel || '';
      meta.followupLabel = res.followupLabel || '';
      meta.ninLabel = res.ninLabel || '';
      meta.monthLabel = res.monthLabel || '';
      filters = { center: '', base: '', house: '', pop: '' };
      assignCategoryColors(points);   /* رکوردها بدون کد رنگ → رنگ دسته (مرکز/پایگاه) */
      savePointsLocal();
      buildFilterOptions();
      renderPoints();
      drawPoints();
      /* ثبت خودکار داده در فهرست «داده‌ها»ی پنل مدیریت */
      if (global.Registry && global.Registry.addDataset) {
        try {
          var _valid = points.filter(function (p) { return p.valid && !p.duplicate; }).length;
          global.Registry.addDataset({
            name: file.name, sheet: res.sheetName || '',
            rows: points.length, valid: _valid, invalid: Math.max(0, points.length - _valid),
            disease: res.diseaseLabel || ''
          });
        } catch (e) { /* ثبت داده حیاتی نیست */ }
      }
      /* ثبت خودکار رکوردهای منابع انسانی در پنل مدیریت */
      if (global.Registry && global.Registry.saveHr) {
        try {
          var _hrSaved = 0;
          points.forEach(function (p) {
            if (!p.valid || p.duplicate) return;
            if (!p.base && !p.house && !p.center) return;
            global.Registry.saveHr({
              base: p.base || '', house: p.house || '', center: p.center || '',
              caregiver: p.caregiver || '', behvarz: p.behvarz || '',
              observer: p.observer || '', envExpert: p.envExpert || '',
              occExpert: p.occExpert || '', doctor: p.doctor || '',
              dentist: p.dentist || '', services: p.services || '',
              reception: p.reception || '',
              popTotal: p.popTotal || 0, popUnder1: p.popUnder1 || 0,
              popUnder5: p.popUnder5 || 0, caregiverCount: p.caregiverCount || 0,
              lat: p.lat, lng: p.lng
            });
            _hrSaved++;
          });
          if (_hrSaved) U.toast(_hrSaved + ' رکورد پرسنل در پنل مدیریت ثبت شد.', 'ok', 3500);
        } catch (e) { /* ثبت پنل حیاتی نیست */ }
      }
    }).catch(function (err) {
      showPointsAlert('error', 'خطا در پردازش فایل: ' + err.message);
      U.toast('پردازش فایل ناموفق بود.', 'error');
    });
  }

  /* ---------- نمایش جدول نقاط ---------- */
  function validPoints() {
    return points.filter(function (p) { return p.valid && !p.duplicate; });
  }

  function showPointsAlert(kind, html) {
    var a = $('pointsAlert');
    a.className = 'alert ' + kind;
    a.innerHTML = html;
  }
  function hidePointsAlert() {
    var a = $('pointsAlert');
    a.className = 'alert hidden';
    a.innerHTML = '';
  }

  function renderPoints() {
    var body = $('pointsBody');
    var thead = document.querySelector('#pointsTable thead tr');
    body.innerHTML = '';
    var empty = $('emptyPoints');
    var rows = filteredRows();

    /* آمار کل (مستقل از فیلتر) */
    var stats = { valid: 0, dup: 0, bad: 0 };
    points.forEach(function (p) {
      if (!p.valid) stats.bad++;
      else if (p.duplicate) stats.dup++;
      else stats.valid++;
    });

    /* سرستون جدول: پایگاه / مرکز / جمعیت (بسته به فایل) */
    thead.innerHTML =
      '<th>#</th>' +
      '<th>پایگاه / خانه بهداشت</th>' +
      (meta.centerLabel ? '<th>' + U.escapeHtml(meta.centerLabel) + '</th>' : '<th>مرکز</th>') +
      (meta.popTotalLabel ? '<th>' + U.escapeHtml(meta.popTotalLabel) + '</th>' : '<th>جمعیت</th>') +
      '<th>عرض</th><th>طول</th><th></th>';

    rows.forEach(function (x, n) {
      var p = x.p;
      var tr = document.createElement('tr');
      if (!p.valid) tr.className = 'row-invalid';
      if (p.valid && !p.duplicate) {
        tr.dataset.idx = x.i;
        tr.title = 'برای نمایش جزئیات روی نقشه کلیک کنید';
      }
      var dot = '<span class="dot" style="background:' + (p.color || '#0e8a5f') + '"></span>';
      var alarm = (p.followupKind === 'overdue' || p.followupKind === 'today')
        ? ' <span class="td-alarm" title="موعد پیگیری ' + (p.followupKind === 'today' ? 'امروز است' : U.faNum(p.followupDays) + ' روز گذشته') + '">⏰</span>' : '';
      /* نام نمایشی: پایگاه → خانه بهداشت → مرکز */
      var displayName = p.base || p.house || p.center || p.name || '—';
      tr.innerHTML =
        '<td>' + U.faNum(n + 1) + '</td>' +
        '<td>' + dot + '<span title="' + U.escapeHtml(displayName) + '">' + U.escapeHtml(displayName) + '</span></td>' +
        '<td>' + U.escapeHtml(p.center || '—') + '</td>' +
        '<td class="num">' + U.faNum(p.popTotal || 0) + '</td>' +
        '<td class="num">' + (p.lat === null ? '—' : p.lat.toFixed(5)) + '</td>' +
        '<td class="num">' + (p.lng === null ? '—' : p.lng.toFixed(5)) + '</td>' +
        '<td>' + (p.valid
          ? (p.duplicate ? '<span style="color:var(--warn)">تکراری</span>' : '✓' + alarm)
          : '<span title="' + U.escapeHtml(p.note || '') + '">✕</span>') + '</td>';
      body.appendChild(tr);
    });

    $('statValid').textContent = U.faNum(stats.valid);
    $('statDup').textContent = U.faNum(stats.dup);
    $('statBad').textContent = U.faNum(stats.bad);
    $('statAll').textContent = U.faNum(points.length);
    $('statsBar').hidden = points.length === 0;

    /* شمارنده فیلتر */
    var shownValid = rows.filter(function (x) { return x.p.valid && !x.p.duplicate; }).length;
    $('filterCount').textContent = 'نمایش ' + U.faNum(shownValid) + ' از ' + U.faNum(stats.valid) + ' رکورد';
    $('filterBar').hidden = points.length === 0;

    if (points.length) hide(empty); else show(empty);

    $('btnFit').disabled = stats.valid === 0;
    $('btnExportGeo').disabled = stats.valid === 0;
    $('btnExportCsv').disabled = stats.valid === 0;

    /* پیام‌های راهنما */
    if (points.length) {
      var msgs = [];
      if (!meta.headerDetected) {
        msgs.push('سرستون استاندارد یافت نشد؛ ستون‌های ۱ تا ۳ به‌عنوان پایگاه/خانه بهداشت/مرکز فرض شدند.');
      } else if (meta.centerLabel || meta.baseLabel || meta.houseLabel) {
        msgs.push('ستون‌های فایل شناسایی شدند؛ با «🔎 دسته‌بندی و فیلتر» می‌توانید بر اساس مرکز، پایگاه، خانه بهداشت و جمعیت رکوردها را جدا کنید.');
      }
      if (anyFilter()) {
        msgs.push('فیلتر فعال است؛ نقشه، جدول و خروجی‌ها فقط رکوردهای فیلترشده را نشان می‌دهند.');
      }
      if (stats.bad) msgs.push(U.faNum(stats.bad) + ' ردیف نامعتبر نمایش داده نمی‌شود (علت با نگه‌داشتن ماوس روی ✕ دیده می‌شود).');
      if (stats.dup) msgs.push(U.faNum(stats.dup) + ' ردیف تکراری نادیده گرفته شد.');
      var ninBad = points.filter(function (p) { return p.valid && p.ninState === 'invalid'; }).length;
      if (ninBad) msgs.push('🪪 ' + U.faNum(ninBad) + ' کدملی با رقم کنترل نامعتبر شناسایی شد (جزئیات در پاپ‌آپ و تب آمار).');
      var fuDue = points.filter(function (p) { return p.valid && (p.followupKind === 'overdue' || p.followupKind === 'today' || p.followupKind === 'soon'); }).length;
      if (fuDue) msgs.push('⏰ ' + U.faNum(fuDue) + ' مورد نیازمند پیگیری است (فهرست در کادر «هشدار تاریخ پیگیری»).');
      if (msgs.length) showPointsAlert(stats.bad ? 'warn' : 'info', msgs.join('<br/>'));
      else hidePointsAlert();
    } else {
      hidePointsAlert();
    }

    /* کلیک روی ردیف‌های معتبر → زوم + بازکردن پاپ‌آپ */
    body.querySelectorAll('tr[data-idx]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        var p = points[Number(tr.dataset.idx)];
        if (p && p.valid) engine && engine.openPoint(p);
      });
    });

    /* هشدارهای پیگیری (تابع فیلترها) */
    renderReminders();

    /* به‌روزرسانی تب آمار (KPI + نمودارهای دسته‌بندی) */
    renderStats();
  }

  /* ---------- هشدار تاریخ پیگیری ---------- */
  var REM_KINDS = { overdue: null, today: null, soon: null };
  function remBadge(p) {
    if (p.followupKind === 'overdue') return '<span class="rem-badge rem-bad">' + U.faNum(p.followupDays) + ' روز گذشته</span>';
    if (p.followupKind === 'today') return '<span class="rem-badge rem-warn">امروز</span>';
    if (p.followupKind === 'soon') return '<span class="rem-badge rem-warn">' + U.faNum(p.followupDays) + ' روز آینده</span>';
    return '';
  }
  function remSortKey(p) {
    if (p.followupKind === 'overdue') return -1000 - p.followupDays;  /* بیشترین تأخیر اول */
    if (p.followupKind === 'today') return -1;
    if (p.followupKind === 'soon') return p.followupDays;
    return 9999;
  }
  function renderReminders() {
    var box = $('remindersBox');
    if (!box) return;
    var rows = filteredRows()
      .filter(function (x) { return x.p.valid && !x.p.duplicate && Object.prototype.hasOwnProperty.call(REM_KINDS, x.p.followupKind); })
      .map(function (x) { return x.p; });
    rows.sort(function (a, b) { return remSortKey(a) - remSortKey(b); });
    if (!rows.length) { box.hidden = true; $('remList').innerHTML = ''; return; }
    box.hidden = false;
    var urgent = rows.filter(function (p) { return p.followupKind === 'overdue' || p.followupKind === 'today'; }).length;
    $('remCount').innerHTML = '<b>' + U.faNum(rows.length) + '</b> مورد' +
      (urgent ? ' — <i class="rem-hot">' + U.faNum(urgent) + ' مورد فوری</i>' : '');
    var list = $('remList');
    list.innerHTML = '';
    rows.forEach(function (p) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rem-row' + (p.followupKind === 'overdue' ? ' rem-row-bad' : '');
      btn.title = 'نمایش روی نقشه';
      btn.innerHTML =
        '<span class="rem-dot" style="background:' + (p.color || '#0e8a5f') + '"></span>' +
        '<span class="rem-name" title="' + U.escapeHtml(p.name) + '">' + U.escapeHtml(p.name) + '</span>' +
        '<span class="rem-meta">' + U.escapeHtml([p.disease, p.base].filter(Boolean).join(' — ') || '—') + '</span>' +
        remBadge(p);
      btn.addEventListener('click', function () { engine && engine.openPoint(p); });
      list.appendChild(btn);
    });
  }

  /* ---------- نقشه حرارتی: به‌روزرسانی مطابق وضعیت روشن/خاموش ---------- */
  function applyHeat() {
    if (!engine || typeof engine.setHeat !== 'function') return;
    if (settings.heatMap) engine.setHeat(filteredPoints(), true);
    else engine.setHeat(null, false);
  }

  /* ---------- رسم نقاط روی نقشه (فقط نقاط فیلترشده) ---------- */
  function drawPoints(fit) {
    if (!engine) return;
    var vps = filteredPoints();
    engine.setMarkerSet(vps, settings.numberedMarkers);
    if (vps.length && fit !== false) engine.fitPoints(vps);
    applyHeat();
  }

  /* ---------- خروجی‌ها ---------- */
  function initExports() {
    $('btnFit').addEventListener('click', function () {
      var vps = filteredPoints();
      if (vps.length) engine && engine.fitPoints(vps);
    });
    $('btnExportGeo').addEventListener('click', function () {
      var fc = {
        type: 'FeatureCollection',
        features: filteredPoints().map(function (p) {
          var props = { name: p.name, province: p.province || '', color: p.color || '' };
          (p.fields || []).forEach(function (f) { props[f.label] = f.value; });
          return {
            type: 'Feature',
            properties: props,
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] }
          };
        })
      };
      U.downloadText(JSON.stringify(fc, null, 2), 'points.geojson', 'application/geo+json');
      U.toast('خروجی GeoJSON آماده شد.', 'ok');
    });
    $('btnExportCsv').addEventListener('click', function () {
      /* کلید عمومی ردیف‌ها: همه سرستون‌های به‌جز مختصات + مختصات در انتها */
      var cols = [];
      var seenC = {};
      filteredPoints().forEach(function (p) {
        (p.fields || []).forEach(function (f) {
          if (!seenC[f.label]) { seenC[f.label] = true; cols.push(f.label); }
        });
      });
      var rows = [cols.concat(['عرض جغرافیایی', 'طول جغرافیایی'])];
      filteredPoints().forEach(function (p) {
        var byLabel = {};
        (p.fields || []).forEach(function (f) { byLabel[f.label] = f.value; });
        rows.push(cols.map(function (c) { return byLabel[c] || ''; })
          .concat([p.lat.toFixed(6), p.lng.toFixed(6)]));
      });
      var csv = rows.map(function (r) {
        return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
      }).join('\r\n');
      U.downloadText('\ufeff' + csv, 'points.csv', 'text/csv');
      U.toast('خروجی CSV آماده شد.', 'ok');
    });
    $('btnExportXlsx').addEventListener('click', exportXlsx);
    $('btnPrint').addEventListener('click', function () {
      buildPrintReport();
      window.print();
    });
  }

  /* ---------- منبع نقشه و تنظیمات نمایش ---------- */
  var SOURCE_HINTS = {
    neshan: 'نقشه تعاملی نشان با کلید ذخیره‌شده. اگر کلید از نوع «سرویس» باشد، باید کلید «وب» بسازید (تب تنظیمات).',
    osm: 'OpenStreetMap — بدون کلید کار می‌کند و کاشی‌ها به‌صورت خودکار برای استفاده آفلاین ذخیره می‌شوند.',
    offline: 'فقط از کاشی‌های ذخیره‌شده در حافظه مرورگر + لایه برداری ایران استفاده می‌کند. بدون اینترنت کار می‌کند.'
  };

  function initMapSettings() {
    var segBtns = document.querySelectorAll('.seg-btn');
    segBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        segBtns.forEach(function (x) { x.classList.remove('active'); x.setAttribute('aria-checked', 'false'); });
        b.classList.add('active');
        b.setAttribute('aria-checked', 'true');
        settings.source = b.dataset.source;
        CFG.save(settings);
        applySource();
        updateHints();
      });
    });

    $('styleSelect').value = settings.neshanStyle;
    $('styleSelect').addEventListener('change', function () {
      settings.neshanStyle = this.value;
      CFG.save(settings);
      engine && engine.setStyle(this.value);
    });

    $('offlineSrcSelect').value = settings.offlineSrc;
    $('offlineSrcSelect').addEventListener('change', function () {
      settings.offlineSrc = this.value;
      CFG.save(settings);
      if (settings.source === 'offline') applySource();
    });

    $('chkProvinces').checked = settings.showProvinces;
    $('chkProvinces').addEventListener('change', function () {
      settings.showProvinces = this.checked;
      CFG.save(settings);
      engine && engine._syncVectorLayers();
    });
    $('chkCityLabels').checked = settings.showCities;
    $('chkCityLabels').addEventListener('change', function () {
      settings.showCities = this.checked;
      CFG.save(settings);
      engine && engine._updateCityLayer();
    });
    $('chkNumbered').checked = settings.numberedMarkers;
    $('chkNumbered').addEventListener('change', function () {
      settings.numberedMarkers = this.checked;
      CFG.save(settings);
      if (points.length) drawPoints();
    });

    /* نقشه حرارتی تراکم */
    $('chkHeat').checked = !!settings.heatMap;
    $('chkHeat').addEventListener('change', function () {
      settings.heatMap = this.checked;
      CFG.save(settings);
      applyHeat();
    });

    /* خوشه‌بندی نشانگرها (پیاده‌سازی داخلی، مستقل از افزونه) */
    $('chkCluster').checked = !!settings.clusterMarkers;
    $('chkCluster').addEventListener('change', function () {
      settings.clusterMarkers = this.checked;
      CFG.save(settings);
      if (engine) engine.setMarkerMode(this.checked ? 'cluster' : 'plain');
    });

    updateHints();
  }

  function updateHints() {
    $('sourceHint').textContent = SOURCE_HINTS[settings.source] || '';
    $('neshanStyleRow').style.display = settings.source === 'neshan' ? '' : 'none';
    $('offlineSrcRow').style.display = settings.source === 'offline' ? '' : 'none';
  }

  function applySource() {
    if (!engine) return;
    hideBanner();
    var ok = engine.setSource(settings.source, settings.neshanStyle);
    if (!ok) {
      /* بازگشت هوشمند به جایگزین */
      var fallback = effectiveOnline() ? 'osm' : 'offline';
      settings.source = fallback;
      document.querySelectorAll('.seg-btn').forEach(function (x) {
        x.classList.toggle('active', x.dataset.source === fallback);
        x.setAttribute('aria-checked', String(x.dataset.source === fallback));
      });
      CFG.save(settings);
      engine.setSource(fallback, settings.neshanStyle);
      updateHints();
    } else {
      engine._hookNeshanCapture();
    }
  }

  /* ---------- تب آفلاین ---------- */
  function initOfflineTab() {
    $('btnEstimate').addEventListener('click', updateEstimate);
    $('btnDownload').addEventListener('click', startDownload);
    $('btnCancelDl').addEventListener('click', function () {
      if (currentDownload) { currentDownload.cancel(); currentDownload = null; }
      hide($('dlProgressWrap'));
      show($('btnDownload'));
      hide($('btnCancelDl'));
      U.toast('دانلود لغو شد.', 'warn');
    });
    $('btnRefreshCache').addEventListener('click', refreshCacheInfo);
    $('btnClearCache').addEventListener('click', function () {
      if (!confirm('همه کاشی‌های ذخیره‌شده حذف شوند؟')) return;
      TS.clearAll().then(function () {
        refreshCacheInfo();
        U.toast('حافظه آفلاین پاک شد.', 'ok');
        if (settings.source === 'offline') engine && engine.setSource('offline', settings.neshanStyle);
      });
    });
    $('chkSimulateOffline').addEventListener('change', function () {
      simulatedOffline = this.checked;
      updateNetStatus();
    });
    refreshCacheInfo();
  }

  function currentBounds() {
    var area = document.querySelector('input[name="dlArea"]:checked').value;
    var vps = filteredPoints();
    if (area === 'points' && vps.length) {
      var b = L.latLngBounds(vps.map(function (p) { return [p.lat, p.lng]; }));
      return b.pad(0.25);
    }
    return engine.map.getBounds().pad(-0.05);
  }

  function updateEstimate() {
    var zMin = U.clamp(Number($('zoomMin').value) || 5, 3, 18);
    var zMax = U.clamp(Number($('zoomMax').value) || 14, zMin, 18);
    var jobs = engine.listAreaTiles(currentBounds(), zMin, zMax);
    var est = jobs.length * 14 * 1024; /* ~14KB متوسط هر کاشی */
    $('dlEstimate').innerHTML =
      'تعداد کاشی: <b>' + U.faNum(jobs.length) + '</b> — حجم تقریبی: <b>' + U.faBytes(est) + '</b>' +
      (jobs.length > 20000 ? '<br/>⚠️ تعداد کاشی‌ها زیاد است؛ بازه زوم را کوچک‌تر کنید.' : '');
  }

  function startDownload() {
    if (!effectiveOnline()) { U.toast('برای دانلود آفلاین ابتدا به اینترنت وصل شوید.', 'error'); return; }
    var zMin = U.clamp(Number($('zoomMin').value) || 5, 3, 18);
    var zMax = U.clamp(Number($('zoomMax').value) || 14, zMin, 18);
    var jobs = engine.listAreaTiles(currentBounds(), zMin, zMax);
    if (!jobs.length) { U.toast('محدوده‌ای برای دانلود یافت نشد.', 'warn'); return; }

    /* منبع دانلود: اگر کاشی نشان در دسترس است از آن، وگرنه OSM */
    var src = engine.probeNeshanUrl() ? 'neshan' : 'osm';
    if (src === 'neshan') engine._hookNeshanCapture();

    show($('dlProgressWrap'));
    hide($('btnDownload'));
    show($('btnCancelDl'));

    currentDownload = engine.prefetch(jobs, {
      src: src,
      style: settings.neshanStyle,
      concurrency: 6,
      onProgress: function (st) {
        var pct = st.total ? Math.round(st.done * 100 / st.total) : 0;
        $('dlProgressFill').style.width = pct + '%';
        $('dlProgressText').textContent =
          U.faNum(pct) + '٪ — ' + U.faNum(st.done) + ' از ' + U.faNum(st.total) +
          ' کاشی (' + U.faNum(st.ok) + ' موفق، ' + U.faNum(st.err) + ' خطا، ' + U.faBytes(st.bytes) + ')';
        if (st.finished) {
          currentDownload = null;
          hide($('dlProgressWrap'));
          show($('btnDownload'));
          hide($('btnCancelDl'));
          refreshCacheInfo();
          U.toast('دانلود آفلاین کامل شد: ' + U.faNum(st.ok) + ' کاشی ذخیره شد.', 'ok', 5000);
          if (settings.source !== 'offline') {
            U.toast('اکنون می‌توانید منبع نقشه را روی «آفلاین» بگذارید و اینترنت را قطع کنید.', 'ok', 6000);
          }
        }
      }
    });
  }

  function refreshCacheInfo() {
    TS.stats().then(function (s) {
      var lines = [];
      lines.push('مجموع کاشی‌های ذخیره‌شده: <b>' + U.faNum(s.total) + '</b> (' + U.faBytes(s.bytes) + ')');
      if (s.bySrc.neshan && s.bySrc.neshan.count) {
        lines.push('کاشی‌های نشان: <b>' + U.faNum(s.bySrc.neshan.count) + '</b> (' + U.faBytes(s.bySrc.neshan.bytes) + ')');
      }
      if (s.bySrc.osm && s.bySrc.osm.count) {
        lines.push('کاشی‌های OSM: <b>' + U.faNum(s.bySrc.osm.count) + '</b> (' + U.faBytes(s.bySrc.osm.bytes) + ')');
      }
      if (!s.total) lines.push('هنوز چیزی ذخیره نشده است. در تب «آفلاین» محدوده دلخواه را دانلود کنید یا مدتی نقشه آنلاین را مرور کنید — کاشی‌ها خودکار ذخیره می‌شوند.');
      $('cacheInfo').innerHTML = lines.join('<br/>');
    });
  }

  /* ---------- پنل، راهنما، تم و خروج ---------- */
  function initChrome() {
    $('btnSidebar').addEventListener('click', function () {
      $('sidebar').classList.toggle('collapsed');
      setTimeout(function () { engine && engine.map && engine.map.invalidateSize(); }, 280);
    });
    $('btnHelp').addEventListener('click', function () { show($('helpModal')); });
    $('btnCloseHelp').addEventListener('click', function () { hide($('helpModal')); });
    $('helpModal').addEventListener('click', function (e) {
      if (e.target === this) hide(this);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hide($('helpModal'));
    });
    initTheme();
    initLogout();
  }

  /* حالت تاریک/روشن — ذخیره در localStorage و اعمال قبل از بارگیری استایل */
  function initTheme() {
    var btn = $('btnDark');
    if (!btn) return;
    var LS_THEME = 'neshanExcelMap.theme';
    function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
    function sync() {
      btn.textContent = isDark() ? '☀️' : '🌙';
      btn.title = isDark() ? 'رفتن به حالت روشن' : 'رفتن به حالت تاریک';
    }
    btn.addEventListener('click', function () {
      var dark = !isDark();
      if (dark) document.documentElement.setAttribute('data-theme', 'dark');
      else document.documentElement.removeAttribute('data-theme');
      try { localStorage.setItem(LS_THEME, dark ? 'dark' : 'light'); } catch (e) {}
      sync();
    });
    sync();
  }

  /* خروج از حساب — بازگشت به درگاه ورود */
  function initLogout() {
    var btn = $('btnLogout');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (!window.confirm('از حساب کاربری خارج می‌شوید؟')) return;
      if (global.Auth) global.Auth.logout();
      location.replace('index.html');
    });
  }

  /* نام کاربر جاری — چیپ ریز کنار دکمهٔ خروج */
  function initUserChip() {
    var chip = $('userChip');
    if (!chip) return;
    var u = (global.Auth && global.Auth.sessionUser) ? global.Auth.sessionUser() : null;
    chip.textContent = '👤 ' + (u || '—');
    chip.title = 'حساب کاربری جاری' + (u ? ': ' + u : '');
  }

  /* ---------- تب آمار (دسته‌بندی دیداری و گزارش) ---------- */
  var GENDER_HINTS = ['جنس', 'جنسیت', 'gender', 'sex'];
  var BIRTH_HINTS = ['تاریج تولد', 'تاریخ تولد', 'تولد', 'سن', 'birth', 'age'];
  var PHONE_HINTS = ['شماره تماس', 'شماره تلفن', 'تلفن', 'همراه', 'موبایل', 'phone', 'tel', 'mobile'];
  var ADDR_HINTS = ['آدرس', 'نشانی', 'address'];
  var GENDER_M = ['مرد', 'مذکر', 'آقا', 'پسر', 'م', 'male', 'm'];
  var GENDER_F = ['زن', 'زنانه', 'خانم', 'دختر', 'مؤنث', 'انثی', 'أنثی', 'female', 'f'];
  var SH_NOW_YEAR = 1405, GR_NOW_YEAR = 2026;
  var lastShownCount = 0;

  function normLabel(s) {
    return U.toLatinDigits(String(s || ''))
      .replace(/[\u200c\u200f\u200e]/g, ' ')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /* یافتن مقدار یک فیلد بر اساس فهرست سرنام‌های احتمالی */
  function fieldOf(p, hints) {
    var fs = p.fields || [];
    for (var j = 0; j < hints.length; j++) {
      var hint = normLabel(hints[j]);
      for (var i = 0; i < fs.length; i++) {
        var l = normLabel(fs[i].label);
        if (l === hint || (hint.length >= 3 && l.indexOf(hint) !== -1)) return fs[i].value;
      }
    }
    return '';
  }

  function genderOf(v) {
    var s = normLabel(v);
    if (!s) return '';
    if (s === 'م' || s === 'm') return 'مرد';
    if (s === 'ز' || s === 'f') return 'زن';
    var i;
    for (i = 0; i < GENDER_M.length; i++) if (s.indexOf(normLabel(GENDER_M[i])) === 0) return 'مرد';
    for (i = 0; i < GENDER_F.length; i++) if (s.indexOf(normLabel(GENDER_F[i])) === 0) return 'زن';
    return '';
  }

  /* سن تقریبی از سال تولد (شمسی ۱۳۰۰–۱۴۵۰ یا میلادی ۱۹۰۰–۲۰۲۶) */
  function ageFromBirth(v) {
    var s = U.toLatinDigits(String(v || ''));
    var m = s.match(/\d{3,4}/g);
    if (!m) return null;
    for (var i = 0; i < m.length; i++) {
      var y = Number(m[i]);
      if (y >= 1300 && y <= 1450) return Math.max(0, SH_NOW_YEAR - y);
      if (y >= 1900 && y <= GR_NOW_YEAR) return Math.max(0, GR_NOW_YEAR - y);
    }
    return null;
  }

  function syncFilterSelects() {
    $('fltCenter').value = filters.center || '';
    $('fltBase').value = filters.base || '';
    $('fltHouse').value = filters.house || '';
    $('fltPop').value = filters.pop || '';
  }

  function renderBarList(containerId, pairs, filterKey) {
    var box = $(containerId);
    if (!box) return;
    box.innerHTML = '';
    var group = box.closest ? box.closest('.bar-group') : null;
    if (group) group.hidden = pairs.length === 0;
    var max = 0;
    pairs.forEach(function (pr) { if (pr.n > max) max = pr.n; });
    pairs.forEach(function (pr) {
      var pct = max ? Math.round(pr.n * 100 / max) : 0;
      var share = lastShownCount ? Math.round(pr.n * 100 / lastShownCount) : 0;
      var active = filters[filterKey] === pr.v;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'stat-row' + (active ? ' active' : '');
      btn.title = 'کلیک: فیلتر بر اساس «' + pr.v + '» — کلیک دوباره: حذف فیلتر';
      btn.innerHTML =
        '<span class="stat-row-label" title="' + U.escapeHtml(pr.v) + '">' + U.escapeHtml(pr.v) + '</span>' +
        '<span class="stat-row-bar"><i style="width:' + pct + '%"></i></span>' +
        '<span class="stat-row-num">' + U.faNum(pr.n) + ' <small>(' + U.faNum(share) + '٪)</small></span>';
      btn.addEventListener('click', function () {
        filters[filterKey] = filters[filterKey] === pr.v ? '' : pr.v;
        syncFilterSelects();
        renderPoints();
        drawPoints(true);
      });
      box.appendChild(btn);
    });
  }

  function renderStats() {
    if (!$('tab-stats')) return;
    var vps = validPoints();
    var shown = filteredPoints();
    lastShownCount = shown.length;

    /* KPI های اصلی */
    $('kpiTotal').textContent = U.faNum(vps.length);
    $('kpiShown').textContent = U.faNum(shown.length);

    /* شمارش دسته‌های اصلی — مرکز / پایگاه / خانه بهداشت */
    var centers = sortPairsFa(uniqueWithCount(shown, function (p) { return p.center; }));
    var bases = sortPairsFa(uniqueWithCount(shown, function (p) { return p.base; }));
    var houses = sortPairsFa(uniqueWithCount(shown, function (p) { return p.house; }));
    $('kpiDiseases').textContent = U.faNum(centers.length); /* نام کپی: تعداد مراکز */
    $('kpiBases').textContent = U.faNum(bases.length);

    /* KPI خانه‌های بهداشت */
    var kpiHouses = $('kpiHouses');
    if (kpiHouses) kpiHouses.textContent = U.faNum(houses.length);

    /* کل جمعیت تحت پوشش */
    var popTotalSum = shown.reduce(function (s, p) { return s + (p.popTotal || 0); }, 0);
    var kpiPop = $('kpiPop');
    if (kpiPop) kpiPop.textContent = U.faNum(popTotalSum);

    /* جمعیت زیر ۵ سال */
    var popUnder5Sum = shown.reduce(function (s, p) { return s + (p.popUnder5 || 0); }, 0);
    var kpiPopUnder5 = $('kpiPopUnder5');
    if (kpiPopUnder5) kpiPopUnder5.textContent = U.faNum(popUnder5Sum);

    /* کل تعداد مراقبان سلامت */
    var caregiverSum = shown.reduce(function (s, p) { return s + (p.caregiverCount || 0); }, 0);
    var kpiCaregiverCount = $('kpiCaregiverCount');
    if (kpiCaregiverCount) kpiCaregiverCount.textContent = U.faNum(caregiverSum);

    /* جنسیت (ستون «جنس» در صورت وجود) */
    var gm = 0, gf = 0, gFound = false;
    shown.forEach(function (p) {
      var g = genderOf(fieldOf(p, GENDER_HINTS));
      if (g === 'مرد') { gm++; gFound = true; }
      else if (g === 'زن') { gf++; gFound = true; }
    });
    var genderCard = $('kpiGenderCard');
    if (genderCard) {
      if (gFound) {
        genderCard.classList.remove('hidden');
        $('kpiGender').textContent = U.faNum(gm) + ' م / ' + U.faNum(gf) + ' ز';
      } else genderCard.classList.add('hidden');
    }

    /* میانگین سن تقریبی (ستون «تاریج/تاریخ تولد» در صورت وجود) */
    var ages = [];
    shown.forEach(function (p) {
      var a = ageFromBirth(fieldOf(p, BIRTH_HINTS));
      if (a !== null) ages.push(a);
    });
    var ageCard = $('kpiAgeCard');
    if (ageCard) {
      if (ages.length) {
        var avg = ages.reduce(function (s, x) { return s + x; }, 0) / ages.length;
        ageCard.classList.remove('hidden');
        $('kpiAge').textContent = U.faNum(avg, 1) + ' سال';
      } else ageCard.classList.add('hidden');
    }

    /* نمودارهای میله‌ای — مرکز / خانه بهداشت / پایگاه */
    renderBarList('barCenter', centers, 'center');
    renderBarList('barHouse', houses, 'house');
    renderBarList('barBase', bases, 'base');

    /* نمودار توزیع جمعیت بر اساس مرکز */
    renderTrend();

    /* موعد پیگیری و کدملی نامعتبر (از رکوردهای نمایش‌داده‌شده) */
    var fuCount = 0, ninBad = 0;
    shown.forEach(function (p) {
      if (p.followupKind === 'overdue' || p.followupKind === 'today') fuCount++;
      if (p.ninState === 'invalid') ninBad++;
    });
    var fuCard = $('kpiFollowupCard');
    if (fuCard) {
      if (fuCount) { fuCard.classList.remove('hidden'); $('kpiFollowup').textContent = U.faNum(fuCount); }
      else fuCard.classList.add('hidden');
    }
    var ninCard = $('kpiNinCard');
    if (ninCard) {
      if (ninBad) { ninCard.classList.remove('hidden'); $('kpiNin').textContent = U.faNum(ninBad); }
      else ninCard.classList.add('hidden');
    }

    var empty = $('statsEmpty');
    var body = $('statsBody');
    if (empty) empty.hidden = vps.length > 0;
    if (body) body.hidden = vps.length === 0;
  }

  /* ---------- نمودار خطی روند زمانی موارد (SVG بدون وابستگی) ---------- */
  function niceMax(n) {
    if (n <= 4) return Math.max(2, n);
    var step = n <= 10 ? 2 : (n <= 25 ? 5 : Math.ceil(n / 50) * 10);
    return Math.ceil(n / step) * step;
  }

  function trendData() {
    var shown = filteredPoints();
    /* توزیع جمعیت بر اساس مرکز — مراکز دسته‌ای هستند نه زمانی */
    var centers = sortPairsFa(uniqueWithCount(shown, function (p) { return p.center; }));
    if (!centers.length) return null;
    var cVals = centers.map(function (c) { return c.v; });
    /* جمعیت کل هر مرکز */
    var popByCenter = cVals.map(function (c) {
      return shown.filter(function (p) { return p.center === c; })
                  .reduce(function (s, p) { return s + (p.popTotal || 0); }, 0);
    });
    /* برای سازگاری با ساختار renderTrend، آن را به‌صورت سری «مجموع» می‌دهیم */
    return {
      months: cVals,                                     /* برچسب‌های افقی = مراکز */
      popVals: popByCenter,                              /* جمعیت هر مرکز */
      series: [{
        name: 'جمعیت تحت پوشش', color: '#0e8a5f', total: true,
        vals: popByCenter
      }]
    };
  }

  function renderTrend() {
    var group = $('trendGroup');
    var box = $('trendChart');
    if (!group || !box) return;
    var data = trendData();
    if (!data) { group.hidden = true; box.innerHTML = ''; return; }
    group.hidden = false;

    var W = 660, H = 300;
    var padL = 50, padR = 12, padT = 16, padB = 80; /* padB بیشتر برای چرخش برچسب مراکز */
    var iw = W - padL - padR, ih = H - padT - padB;
    var centers = data.months; /* برچسب‌های افقی = مراکز */
    var popVals = data.popVals;
    var maxY = Math.max.apply(null, popVals.concat([1]));
    var yMax = niceMax(maxY);
    var barW = Math.min(40, Math.max(12, iw / centers.length - 8));
    function X(i) {
      var slot = iw / centers.length;
      return padL + slot * i + slot / 2 - barW / 2;
    }
    function Y(v) { return padT + ih - ih * v / yMax; }

    var svg = [];
    svg.push('<svg class="trend-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="توزیع جمعیت تحت پوشش بر اساس مرکز" preserveAspectRatio="xMidYMid meet">');
    svg.push('<defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#0e8a5f" stop-opacity="0.85"/>' +
      '<stop offset="100%" stop-color="#0e8a5f" stop-opacity="0.45"/></linearGradient></defs>');

    /* شبکه افقی + برچسب محور عمودی */
    var ticks = yMax <= 6 ? yMax : 5;
    for (var t = 0; t <= ticks; t++) {
      var v = Math.round(yMax * t / ticks);
      var y = Y(v);
      svg.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#e4ece7" stroke-width="1"/>');
      svg.push('<text x="' + (padL - 7) + '" y="' + (y + 3.5) + '" text-anchor="end" class="trend-tick">' + U.faNum(v) + '</text>');
    }

    /* میله‌های جمعیت + برچسب مراکز */
    centers.forEach(function (c, i) {
      var x = X(i);
      var v = popVals[i];
      var y = Y(v);
      var active = filters.center === c;
      var h = padT + ih - y;
      /* میله */
      svg.push('<rect class="trend-bar" x="' + x + '" y="' + y + '" width="' + barW + '" height="' + h +
        '" rx="3" fill="url(#trendFill)" stroke="' + (active ? '#1d2b25' : '#0e8a5f') +
        '" stroke-width="' + (active ? 2 : 0.6) + '"><title>' +
        U.escapeHtml(c + ' — جمعیت: ' + U.faNum(v) + ' نفر — کلیک: فیلتر مرکز') + '</title></rect>');
      /* برچسب مقدار بالای میله */
      if (v > 0) {
        svg.push('<text x="' + (x + barW / 2) + '" y="' + (y - 4) + '" text-anchor="middle" class="trend-bar-val">' + U.faNum(v) + '</text>');
      }
      /* برچسب مرکز (چرخیده) */
      var cx = x + barW / 2;
      var yy = H - padB + 14;
      svg.push('<text x="' + cx + '" y="' + yy + '" text-anchor="end" transform="rotate(-38 ' + cx + ' ' + yy + ')" class="trend-x' + (active ? ' trend-x-active' : '') + '">' + U.escapeHtml(c) + '</text>');
    });
    svg.push('</svg>');
    box.innerHTML = svg.join('');

    /* کلیک روی میله‌ها = فیلتر همان مرکز */
    var bars = box.querySelectorAll('.trend-bar');
    bars.forEach(function (b, n) {
      b.style.cursor = 'pointer';
      b.addEventListener('click', function () {
        filters.center = filters.center === centers[n] ? '' : centers[n];
        syncFilterSelects();
        renderPoints();
        drawPoints(true);
      });
    });
  }

  /* ---------- خروجی اکسل و چاپ گزارش ---------- */
  function exportXlsx() {
    var fps = filteredPoints();
    if (!fps.length) { U.toast('موردی برای خروجی نیست.', 'warn'); return; }
    if (!global.XLSX) { U.toast('کتابخانه اکسل بارگذاری نشده است.', 'error'); return; }
    var cols = [], seenC = {};
    fps.forEach(function (p) {
      (p.fields || []).forEach(function (f) {
        if (!seenC[f.label]) { seenC[f.label] = true; cols.push(f.label); }
      });
    });
    var aoa = [cols.concat(['عرض جغرافیایی', 'طول جغرافیایی'])];
    fps.forEach(function (p) {
      var by = {};
      (p.fields || []).forEach(function (f) { by[f.label] = f.value; });
      aoa.push(cols.map(function (c) { return by[c] || ''; }).concat([p.lat, p.lng]));
    });
    try {
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = aoa[0].map(function () { return { wch: 16 }; });
      try { ws['!views'] = [{ RTL: true }]; } catch (e0) {}
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'منابع انسانی');
      var data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      U.downloadBlob(
        new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        'گزارش_منابع_انسانی.xlsx'
      );
      U.toast('خروجی اکسل (' + U.faNum(fps.length) + ' رکورد) آماده شد.', 'ok');
    } catch (e) {
      U.toast('ساخت خروجی اکسل ناموفق بود: ' + e.message, 'error');
    }
  }

  function buildPrintReport() {
    var el = $('printReport');
    if (!el) return;
    var fps = filteredPoints();
    var vps = validPoints();
    var now = new Date();
    var dateStr = now.toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' });
    var timeStr = now.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

    var parts = [];
    if (filters.center) parts.push('مرکز: ' + filters.center);
    if (filters.base) parts.push('پایگاه: ' + filters.base);
    if (filters.house) parts.push('خانه بهداشت: ' + filters.house);
    if (filters.pop) {
      for (var i = 0; i < POP_RANGES.length; i++) {
        if (POP_RANGES[i].key === filters.pop) { parts.push('جمعیت: ' + POP_RANGES[i].label); break; }
      }
    }
    var filterTxt = parts.length ? parts.join(' — ') : 'همه رکوردها';

    var hasPhone = fps.some(function (p) { return fieldOf(p, PHONE_HINTS); });
    var hasAddr = fps.some(function (p) { return fieldOf(p, ADDR_HINTS); });

    /* ستون‌های گزارش: شماره / پایگاه / مرکز / جمعیت / شماره تماس / آدرس */
    var cols = ['#', 'پایگاه / خانه بهداشت', 'مرکز', 'جمعیت'];
    if (hasPhone) cols.push('شماره تماس');
    if (hasAddr) cols.push('آدرس');

    var rows = fps.map(function (p, i) {
      var displayName = p.base || p.house || p.center || p.name || '—';
      var tds = '<td>' + U.faNum(i + 1) + '</td>' +
                '<td>' + U.escapeHtml(displayName) + '</td>' +
                '<td>' + U.escapeHtml(p.center || '—') + '</td>' +
                '<td>' + U.faNum(p.popTotal || 0) + '</td>';
      if (hasPhone) tds += '<td>' + U.escapeHtml(fieldOf(p, PHONE_HINTS) || '—') + '</td>';
      if (hasAddr) tds += '<td>' + U.escapeHtml(fieldOf(p, ADDR_HINTS) || '—') + '</td>';
      return '<tr>' + tds + '</tr>';
    }).join('');

    el.innerHTML =
      '<h1 class="pr-title">گزارش منابع انسانی پایگاه‌های بهداشت</h1>' +
      '<p class="pr-meta">تاریخ چاپ: ' + U.escapeHtml(dateStr) + ' — ' + U.escapeHtml(timeStr) +
      ' | دامنه: ' + U.escapeHtml(filterTxt) + ' | تعداد: ' + U.faNum(fps.length) + ' از ' + U.faNum(vps.length) + ' رکورد</p>' +
      '<table class="pr-table"><thead><tr>' +
      cols.map(function (c) { return '<th>' + U.escapeHtml(c) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="pr-foot">سامانه مدیریت منابع انسانی — گزارش دسته‌بندی بر اساس مرکز، پایگاه، خانه بهداشت و جمعیت</p>';
  }

  /* ---------- PWA: ثبت سرویس‌کار (دکمهٔ نصب در «پنل مدیریت» و فقط برای حساب اصلی است) ---------- */
  function initPWA() {
    /* ثبت سرویس‌کار فقط در بستر امن (https یا localhost) — با file:// لازم و ممکن نیست */
    if ('serviceWorker' in navigator &&
        (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* بی‌صدا: برنامه بدون SW هم کار می‌کند */ });
    }
  }

  /* رفتن از KPI آمار به کادر هشدارهای تب نقاط */
  function initKpiActions() {
    var c = $('kpiFollowupCard');
    if (!c) return;
    function go() {
      $('sidebar').classList.remove('collapsed');
      activateTab('points');
      var box = $('remindersBox');
      if (box && !box.hidden) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    c.addEventListener('click', go);
    c.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  }

  /* ---------- راه‌اندازی ---------- */
  function startApp() {
    initUserChip();
    engine = new MapEngine({
      settings: settings,
      onNeedRedrawMarkers: function () { drawPoints(false); },
      onSourceFail: function (kind, msg) {
        if (!kind) { hideBanner(); return; }
        showBanner(msg, kind === 'key' ? 'error' : 'warn');
        if (kind === 'key' && effectiveOnline()) {
          showBanner(msg + ' <button id="bnOsm">رفتن به OSM</button>', 'error');
          var btn = document.getElementById('bnOsm');
          if (btn) btn.addEventListener('click', function () {
            hideBanner();
            settings.source = 'osm';
            CFG.save(settings);
            document.querySelectorAll('.seg-btn').forEach(function (x) {
              x.classList.toggle('active', x.dataset.source === 'osm');
              x.setAttribute('aria-checked', String(x.dataset.source === 'osm'));
            });
            engine.setSource('osm', settings.neshanStyle);
            updateHints();
          });
        }
      },
      onCaptureProgress: function () { /* شمارش کاشی‌های گرفته‌شده از نشان */ }
    });
    engine.init($('map'));

    /* منبع اولیه: اگر شبکه نیست مستقیم آفلاین */
    if (!navigator.onLine) settings.source = 'offline';
    document.querySelectorAll('.seg-btn').forEach(function (x) {
      x.classList.toggle('active', x.dataset.source === settings.source);
      x.setAttribute('aria-checked', String(x.dataset.source === settings.source));
    });
    updateHints();
    engine.setSource(settings.source, settings.neshanStyle);
    engine._hookNeshanCapture();

    /* اعمال حالت‌های ذخیره‌شده‌ی نمایش (خوشه‌بندی) روی موتور نقشه */
    if (settings.clusterMarkers) engine.setMarkerMode('cluster');

    /* در نمایشگرهای کوچک، پنل ابتدا بسته باشد */
    if (window.innerWidth <= 860) $('sidebar').classList.add('collapsed');

    updateNetStatus();
    global.__engineRef = engine; /* برای اشکال‌زدایی */

    /* بازیابی نقاط ذخیره‌شدهٔ جلسهٔ قبل (تا وقتی admin پاک نکرده است) */
    restoreSavedPoints();
  }

  function unlockNow() {
    document.body.classList.remove('auth-locked');
    startApp();
    setTimeout(function () { engine && engine.map && engine.map.invalidateSize(); }, 80);
    U.toast('ورود موفق بود؛ خوش آمدید.', 'ok');
  }

  function boot() {
    /* اشکال‌زدایی: ثبت همه removeLayer/addLayer ها */
    if (window.L && L.Map) {
      var _orRm = L.Map.prototype.removeLayer;
      L.Map.prototype.removeLayer = function (layer) {
        window.__rmLog = window.__rmLog || [];
        try {
          window.__rmLog.push({
            kind: layer && layer.constructor ? layer.constructor.name : String(layer),
            isGroup: !!(layer && layer.getLayers),
            stack: (new Error().stack || '').split('\n').slice(2, 4).join(' | ').slice(0, 220)
          });
        } catch (e) {}
        return _orRm.apply(this, arguments);
      };
    }
    initTabs();
    initChrome();
    initUpload();
    initFilters();
    initExports();
    initMapSettings();
    initOfflineTab();
    initKpiActions();
    initPWA();

    /* درگاه ورود: تا احراز هویت موفق، برنامه آغاز نمی‌شود (تنها ورودِ برنامه) */
    if (global.Auth && global.Auth.isAuthenticated()) {
      /* بررسی مجوز و شمارش باز شدن برای نشست ذخیره‌شده (ورود با «به خاطر بسپار») */
      var _su = (global.Auth.isPrimary && global.Auth.isPrimary())
        ? null : (global.Auth.sessionUser ? global.Auth.sessionUser() : null);
      var _rc = (_su && global.Registry && global.Registry.sessionRestoreCheck)
        ? global.Registry.sessionRestoreCheck(_su) : { ok: true };
      if (_rc && _rc.ok) {
        document.body.classList.remove('auth-locked');
        startApp();
      } else {
        /* نخستین نقض محدودیت (قفل/انقضا/اتمام سقف) → خروج اجباری با نمایش دلیل */
        global.Auth.logout();
        document.body.classList.add('auth-locked');
        global.Auth.showLogin(unlockNow, (_rc && _rc.error) || 'دسترسی این حساب فعال نیست.');
      }
    } else if (global.Auth) {
      document.body.classList.add('auth-locked');
      global.Auth.showLogin(unlockNow);
    } else {
      startApp();
    }

    renderStats();
    window.addEventListener('online', function () { netOnline = true; updateNetStatus(); });
    window.addEventListener('offline', function () { netOnline = false; updateNetStatus(); });

    /* ذخیره خودکار کاشی‌های OSM/نشان هنگام مرور */
    console.log('[سامانه مدیریت منابع انسانی] آماده است.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);

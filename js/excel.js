/* =========================================================
   excel.js — خواندن فایل اکسل/CSV و استخراج نقاط (نسخه چندستونه)
   -----------------------------------------------------------
   - ستون‌های ضروری: «عرض جغرافیایی» و «طول جغرافیایی» (در هر جای فایل)
   - همه ستون‌های دیگر (نام، نام خانوادگی، کدملی، بیماری، آدرس و…)
     به‌صورت خودکار شناسایی و در پاپ‌آپ هر نقطه نمایش داده می‌شوند.
   - اگر «نام» و «نام خانوادگی» موجود باشند، برچسب نشانگر = نام و نام خانوادگی
   - ستون «رنگ بندی» (یا «کلیک کنید») کد رنگ هر نقطه را تعیین می‌کند؛
     پشتیبانی از: ‎#RRGGBB / ‎#RGB / rgb(r,g,b) / نام رنگ فارسی و انگلیسی /
     رنگ پرشدن (Fill) خود سلول در اکسل
   - ستون «ماه تشخیص» و «نام پایگاه» برای دسته‌بندی و فیلتر استفاده می‌شوند
   - لینک‌های اکسل و هر مقدار URL در ستون‌ها حفظ و قابل کلیک می‌شوند
   - شناسایی خودکار سرستون‌ها (فارسی/انگلیسی) و در غیر این صورت ترتیب ستون‌ها
   - نرمال‌سازی ارقام فارسی/عربی، جداکننده اعشار، فرمت درجه-دقیقه-ثانیه
   - تشخیص جابه‌جایی عرض/طول (|عرض|>90 و |طول|<=90)
   - اعتبارسنجی محدوده‌ها و شناسایی تکراری‌ها
   ========================================================= */
(function (global) {
  'use strict';

  var U = global.Util;

  /* ---------- واژه‌نامه سرستون‌ها ---------- */
  /* ستون‌های جغرافیایی (اختیاری در سامانه منابع انسانی) */
  var LAT_HINTS = ['عرض جغرافیایی', 'عرض', 'عرض جعرافیایی', 'lat', 'latitude', 'y'];
  var LNG_HINTS = ['طول جغرافیایی', 'طول', 'طول جعرافیایی', 'lng', 'lon', 'long', 'longitude', 'x'];
  var LAST_HINTS = ['نام خانوادگی', 'نام خانوادگ', 'فامیل', 'فامیلی', 'last name', 'lastname', 'surname', 'family name'];
  var FATHER_HINTS = ['نام پدر', 'نام پدر ', 'father name', 'father'];

  /* ستون‌های اصلی سامانه منابع انسانی — طبق درخواست کاربر */
  /* پایگاه = Base / Station — کوچک‌ترین واحد ارائه خدمت */
  var BASE_HINTS = ['پایگاه', 'نام پایگاه', 'پایگاه بهداشت', 'base', 'station'];
  /* خانه بهداشت = Health House — واحد بالاتر از پایگاه */
  var HOUSE_HINTS = ['خانه بهداشت', 'خانه بهدست', 'خانه سلامت', 'health house', 'house'];
  /* مرکز = Center — بزرگ‌ترین واحد سازمانی (مرکز بهداشت شهرستان/منطقه) */
  var CENTER_HINTS = ['مرکز', 'نام مرکز', 'مرکز بهداشت', 'center', 'district'];

  /* ستون‌های اسم پرسنل — هر ستون نام یک نقش را در خود دارد */
  var CAREGIVER_HINTS = ['نام مراقب سلامت', 'مراقب سلامت', 'مراقب', 'caregiver'];
  var BEHVARZ_HINTS = ['نام بهورز', 'بهورز', 'behvarz'];
  var OBSERVER_HINTS = ['نام ناظر بیماریها', 'ناظر بیماری', 'ناظر بیماریها', 'ناظر', 'observer'];
  var ENV_EXPERT_HINTS = ['نام کارشناس محیط', 'کارشناس محیط', 'محیط', 'env expert', 'environmental'];
  var OCC_EXPERT_HINTS = ['نام کارشناس حرفه ای', 'نام کارشناس حرفه‌ای', 'کارشناس حرفه', 'حرفه ای', 'حرفه‌ای', 'occupational'];
  var DOCTOR_HINTS = ['نام پزشک', 'پزشک', 'doctor', 'physician'];
  var DENTIST_HINTS = ['نام دندانپزشک', 'دندانپزشک', 'dentist'];
  var SERVICES_HINTS = ['نام خدمات', 'خدمات', 'services'];
  var RECEPTION_HINTS = ['نام پذیرش', 'پذیرش', 'reception'];

  /* ستون‌های جمعیت */
  var POP_TOTAL_HINTS = ['کل جمعیت', 'جمعیت کل', 'جمعیت', 'total population', 'population'];
  var POP_UNDER1_HINTS = ['زیریک سال', 'زیر یک سال', 'زیر 1 سال', 'زیر ۱ سال', 'under 1', 'under1'];
  var POP_UNDER5_HINTS = ['زیر5سال', 'زیر 5 سال', 'زیر ۵ سال', 'زیر5 سال', 'under 5', 'under5'];
  var CAREGIVER_COUNT_HINTS = ['تعداد مراقب', 'تعداد مراقبان', 'caregiver count'];

  var LINK_HINTS = ['لینک', 'آدرس اینترنتی', 'وب‌سایت', 'وبسایت', 'لینک گزارش', 'link', 'url'];
  /* ستون رنگ: «رنگ بندی» جدید یا «کلیک کنید» قدیمی — هر دو رنگ نقطه را تعیین می‌کنند */
  var COLOR_HINTS = ['رنگ بندی', 'رنگ‌بندی', 'رنگ', 'کد رنگ', 'کلیک کنید', 'کلیک', 'color', 'colour', 'color code'];
  var MONTH_HINTS = ['ماه تشخیص', 'ماه تشانیس', 'ماه', 'month'];
  var NIN_HINTS = ['کدملی', 'کد ملی', 'کد ملى', 'national id', 'nationalid', 'national code', 'nin', 'ssn'];
  var FOLLOWUP_HINTS = ['تاریخ پیگیری', 'تاریج پیگیری', 'تاریخ پیگری', 'پیگیری بعدی', 'موعد پیگیری', 'followup', 'follow up', 'follow-up', 'next visit', 'followup date'];
  var NAME_HINTS = ['نام محل', 'نام مکان', 'نام', 'عنوان', 'محل', 'مکان', 'نام‌محل', 'name', 'title', 'place', 'location', 'site'];
  /* برچسب استاندارد ستون رنگ در جدول و پاپ‌آپ */
  var COLOR_LABEL = 'رنگ بندی';
  /* واژه‌های رزروشده که نباید به‌عنوان «نام فرد» برداشت شوند */
  var RESERVED_IN_NAME = ['خانوادگی', 'پدر', 'بیماری', 'پایگاه', 'مکان', 'محل', 'کاربری', 'واحد',
                          'مرکز', 'خانه', 'بهورز', 'ناظر', 'کارشناس', 'پزشک', 'دندانپزشک', 'خدمات', 'پذیرش',
                          'مراقب', 'جمعیت'];

  function normHeader(h) {
    return U.toLatinDigits(h === null || h === undefined ? '' : String(h))
      .replace(/[\u200c\u200f\u200e]/g, '')   /* نیم‌فاصله و کاراکترهای جهت */
      .replace(/[#.:()\-_/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function hasKeyword(header, hints) {
    var h = normHeader(header);
    if (!h) return false;
    for (var i = 0; i < hints.length; i++) {
      var k = normHeader(hints[i]);
      if (h === k) return true;
      if (k.length >= 3 && h.indexOf(k) !== -1) return true;
    }
    return false;
  }

  /* دسته‌بندی یک سرستون — ترتیب بررسی مهم است */
  function classifyHeader(cell) {
    var h = normHeader(cell);
    if (!h) return null;
    if (hasKeyword(h, LAT_HINTS) && !hasKeyword(h, LNG_HINTS)) return 'lat';
    if (hasKeyword(h, LNG_HINTS)) return 'lng';
    if (hasKeyword(h, LAST_HINTS)) return 'last';
    /* ستون‌های اصلی سامانه منابع انسانی — اولویت با این ستون‌هاست */
    /* ستون‌های اسم پرسنل */
    if (hasKeyword(h, CAREGIVER_HINTS)) return 'caregiver';
    if (hasKeyword(h, BEHVARZ_HINTS)) return 'behvarz';
    if (hasKeyword(h, OBSERVER_HINTS)) return 'observer';
    if (hasKeyword(h, ENV_EXPERT_HINTS)) return 'envExpert';
    if (hasKeyword(h, OCC_EXPERT_HINTS)) return 'occExpert';
    if (hasKeyword(h, DOCTOR_HINTS)) return 'doctor';
    if (hasKeyword(h, DENTIST_HINTS)) return 'dentist';
    if (hasKeyword(h, SERVICES_HINTS)) return 'services';
    if (hasKeyword(h, RECEPTION_HINTS)) return 'reception';
    /* ستون‌های جمعیت */
    if (hasKeyword(h, POP_TOTAL_HINTS)) return 'popTotal';
    if (hasKeyword(h, POP_UNDER1_HINTS)) return 'popUnder1';
    if (hasKeyword(h, POP_UNDER5_HINTS)) return 'popUnder5';
    if (hasKeyword(h, CAREGIVER_COUNT_HINTS)) return 'caregiverCount';
    /* ستون‌های ساختار سازمانی */
    if (hasKeyword(h, CENTER_HINTS) && !hasKeyword(h, BASE_HINTS) && !hasKeyword(h, HOUSE_HINTS)) return 'center';
    if (hasKeyword(h, HOUSE_HINTS)) return 'house';
    if (hasKeyword(h, BASE_HINTS)) return 'base';
    if (hasKeyword(h, COLOR_HINTS)) return 'color';
    if (hasKeyword(h, LINK_HINTS)) return 'link';
    if (hasKeyword(h, FATHER_HINTS)) return 'father';
    if (hasKeyword(h, NIN_HINTS)) return 'nin';
    if (hasKeyword(h, FOLLOWUP_HINTS)) return 'followup';
    if (hasKeyword(h, MONTH_HINTS)) return 'month';
    /* نام فرد: «نام»، «نام محل»، «عنوان» و… اما نه «نام بیماری» و امثال آن */
    if (hasKeyword(h, NAME_HINTS)) {
      for (var i = 0; i < RESERVED_IN_NAME.length; i++) {
        if (h.indexOf(RESERVED_IN_NAME[i]) !== -1) return null;
      }
      return 'name';
    }
    return null;
  }

  /* یافتن سطر و ستون‌های سرستون در چند سطر اول */
  function findHeader(rows) {
    var scan = Math.min(rows.length, 12);
    for (var r = 0; r < scan; r++) {
      var row = rows[r] || [];
      if (!row.length) continue;
      var idx = {
        lat: -1, lng: -1, name: -1, last: -1, father: -1,
        /* ستون‌های اصلی سامانه منابع انسانی */
        center: -1, base: -1, house: -1,
        /* ستون‌های اسم پرسنل */
        caregiver: -1, behvarz: -1, observer: -1,
        envExpert: -1, occExpert: -1, doctor: -1, dentist: -1,
        services: -1, reception: -1,
        /* ستون‌های جمعیت */
        popTotal: -1, popUnder1: -1, popUnder5: -1, caregiverCount: -1,
        /* ستون‌های جانبی (در صورت وجود) */
        link: -1, color: -1, month: -1, nin: -1, followup: -1
      };
      var labels = {};
      for (var c = 0; c < row.length; c++) {
        var kind = classifyHeader(row[c]);
        if (kind && idx[kind] === -1) {
          idx[kind] = c;
          labels[kind] = String(row[c] === undefined ? '' : row[c]).trim();
        }
      }
      /* در سامانه منابع انسانی، کافی است یکی از ستون‌های اصلی (پایگاه/خانه بهداشت/مرکز) شناسایی شود.
         ستون‌های جغرافیایی (lat/lng) اختیاری هستند و فقط برای نمایش روی نقشه استفاده می‌شوند. */
      var hasHR = idx.center !== -1 || idx.base !== -1 || idx.house !== -1;
      var hasGeo = idx.lat !== -1 && idx.lng !== -1;
      if (hasHR || hasGeo) {
        return {
          headerRow: r,
          idx: idx,
          labels: labels,
          headers: row.map(function (h, i) { return { idx: i, label: String(h === undefined ? '' : h).trim() }; }),
          detected: true
        };
      }
    }
    /* بدون سرستون معتبر: پیش‌فرض — ردیف اول = ستون‌های اصلی */
    return {
      headerRow: -1,
      idx: {
        lat: -1, lng: -1, name: -1, last: -1, father: -1,
        base: 0, house: 1, center: 2,
        caregiver: 3, behvarz: 4, observer: 5,
        envExpert: 6, occExpert: 7, doctor: 8, dentist: 9,
        services: 10, reception: 11,
        popTotal: 12, popUnder1: 13, popUnder5: 14, caregiverCount: 15,
        link: -1, color: -1, month: -1, nin: -1, followup: -1
      },
      labels: {},
      headers: [],
      detected: false
    };
  }

  /* استخراج لینک‌های واقعی سلول‌های اکسل (هایپرلینک) → نقشه‌ی «row:col» → URL */
  var ADDR_RE = /^([A-Z]+)([0-9]+)$/;
  function addrToRowCol(addr) {
    var m = ADDR_RE.exec(addr);
    if (!m) return null;
    var col = 0;
    for (var i = 0; i < m[1].length; i++) col = col * 26 + (m[1].charCodeAt(i) - 64); /* A=1 */
    return { r: parseInt(m[2], 10) - 1, c: col - 1 };
  }
  function extractHyperlinks(ws) {
    var map = {};
    if (!ws) return map;
    Object.keys(ws).forEach(function (addr) {
      if (addr.charAt(0) === '!') return;
      var cell = ws[addr];
      if (cell && cell.l && cell.l.Target) {
        var rc = addrToRowCol(addr);
        if (rc) map[rc.r + ':' + rc.c] = String(cell.l.Target);
      }
    });
    return map;
  }

  function looksLikeUrl(s) {
    return /^https?:\/\/\S+$/i.test(String(s || '').trim());
  }

  /* ---------- رنگ‌ها ---------- */
  /* نام رنگ → کد هگز (فارسی و انگلیسی) */
  var NAMED_COLORS_RAW = [
    ['قرمز', '#e53935'], ['سرخ', '#c0392b'], ['آبی', '#1e88e5'], ['آبی آسمانی', '#4fc3f7'],
    ['سرمه‌ای', '#1a237e'], ['سبز', '#43a047'], ['سبز روشن', '#81c784'], ['سبز تیره', '#2e7d32'],
    ['زرد', '#fdd835'], ['نارنجی', '#fb8c00'], ['بنفش', '#8e24aa'], ['یاسی', '#9575cd'],
    ['صورتی', '#ec407a'], ['قهوه‌ای', '#6d4c41'], ['خاکستری', '#757575'], ['طوسی', '#90a4ae'],
    ['سیاه', '#212121'], ['مشکی', '#212121'], ['سفید', '#ffffff'], ['فیروزه‌ای', '#00acc1'],
    ['زیتونی', '#9e9d24'], ['طلایی', '#ffb300'], ['طلائی', '#ffb300'], ['نقره‌ای', '#bdbdbd'],
    ['بژ', '#d7bfa0'], ['کرم', '#f0e2b6'], ['لیمویی', '#dce775'], ['لبنی', '#f06292'],
    ['red', '#e53935'], ['blue', '#1e88e5'], ['green', '#43a047'], ['yellow', '#fdd835'],
    ['orange', '#fb8c00'], ['purple', '#8e24aa'], ['violet', '#7e57c2'], ['pink', '#ec407a'],
    ['brown', '#6d4c41'], ['gray', '#757575'], ['grey', '#757575'], ['black', '#212121'],
    ['white', '#ffffff'], ['cyan', '#00acc1'], ['turquoise', '#00acc1'], ['navy', '#1a237e'],
    ['gold', '#ffb300'], ['silver', '#bdbdbd'], ['olive', '#9e9d24'], ['magenta', '#d81b60'],
    ['maroon', '#8b1e1e'], ['teal', '#00897b'], ['lime', '#cddc39']
  ];
  var NAMED_COLORS = {};
  NAMED_COLORS_RAW.forEach(function (p) { NAMED_COLORS[normHeader(p[0])] = p[1]; });

  function expandHex3(h) {
    return h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
  }

  /* تبدیل مقدار متنی سلول → کد هگز یا null */
  function parseColorValue(v) {
    if (v === null || v === undefined) return null;
    var s = U.toLatinDigits(String(v)).replace(/\s+/g, '').trim();
    if (!s) return null;
    var m = /^#?([0-9a-fA-F]{6})$/.exec(s);
    if (m) return '#' + m[1].toLowerCase();
    m = /^#?([0-9a-fA-F]{3})$/.exec(s);
    if (m) return '#' + expandHex3(m[1]).toLowerCase();
    m = /^rgb\((\d{1,3}),(\d{1,3}),(\d{1,3})\)$/i.exec(s) || /^(\d{1,3}),(\d{1,3}),(\d{1,3})$/.exec(s);
    if (m) {
      var r = +m[1], g = +m[2], b = +m[3];
      if (r <= 255 && g <= 255 && b <= 255) {
        var hex = ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
        return '#' + hex;
      }
    }
    return NAMED_COLORS[normHeader(s)] || null;
  }

  /* نرمال‌سازی rgb خوانده‌شده از استایل سلول (ARGB/RGB) → ‎#rrggbb */
  function normalizeArgb(rgb) {
    var s = String(rgb).replace(/[^0-9a-fA-F]/g, '');
    if (s.length === 8) s = s.slice(2);       /* حذف آلفا */
    else if (s.length === 3) s = expandHex3(s);
    if (s.length !== 6 || /[^0-9a-fA-F]/.test(s)) return null;
    return '#' + s.toLowerCase();
  }

  /* استخراج رنگ پرشدن (Fill) یا رنگ قلم سلول‌ها از استایل اکسل
     — SheetJS بسته به نسخه استایل را تودرتو (s.fill.fgColor) یا تخت (s.fgColor) می‌دهد */
  function extractFillColors(ws) {
    var map = {};
    if (!ws) return map;
    Object.keys(ws).forEach(function (addr) {
      if (addr.charAt(0) === '!') return;
      var cell = ws[addr];
      var st = cell && cell.s;
      if (!st) return;
      var rgb = null;
      var fill = st.fill || st;   /* ساختار تودرتو یا تخت */
      if (fill && fill.patternType !== 'none' && fill.fgColor && typeof fill.fgColor.rgb === 'string') rgb = fill.fgColor.rgb;
      var font = st.font;
      if (!rgb && font && font.color && typeof font.color.rgb === 'string') rgb = font.color.rgb;
      if (!rgb) return;
      var hex = normalizeArgb(rgb);
      if (!hex) return;
      var rc = addrToRowCol(addr);
      if (rc) map[rc.r + ':' + rc.c] = hex;
    });
    return map;
  }

  /* متن نمایشی یک مقدار خام */
  function displayValue(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') {
      /* جلوگیری از نماد علمی برای شماره‌های بلند مثل کدملی/تلفن */
      if (Number.isInteger(v) && Math.abs(v) >= 1e6) return U.toLatinDigits(String(v));
      return U.toLatinDigits(String(v));
    }
    return U.toLatinDigits(String(v).replace(/\s+/g, ' ').trim());
  }

  /* پردازش ردیف‌ها → آرایه Point */
  function extractPoints(rowsRaw, rowsFmt, hdr, linkMap, fillMap) {
    var points = [];
    var seen = {};
    var I = hdr.idx;

    for (var r = hdr.headerRow + 1; r < rowsRaw.length; r++) {
      var rowRaw = rowsRaw[r] || [];
      var rowFmt = (rowsFmt && rowsFmt[r]) || rowRaw;
      if (!rowRaw.length) continue;

      var rawLat = I.lat !== -1 ? rowRaw[I.lat] : '';
      var rawLng = I.lng !== -1 ? rowRaw[I.lng] : '';
      if (rawLat === undefined) rawLat = '';
      if (rawLng === undefined) rawLng = '';

      /* همه فیلدهای متنی سطر (به‌جز عرض/طول) برای پاپ‌آپ */
      var fields = [];
      var firstName = '', lastName = '', baseName = '', houseName = '', centerName = '', nameCol = '';
      /* مقادیر اسم پرسنل */
      var caregiverName = '', behvarzName = '', observerName = '';
      var envExpertName = '', occExpertName = '', doctorName = '', dentistName = '';
      var servicesName = '', receptionName = '';
      /* مقادیر جمعیت (عددی) */
      var popTotalVal = 0, popUnder1Val = 0, popUnder5Val = 0, caregiverCountVal = 0;
      var linkUrl = '', colorRaw = '', colorHex = null, month = '';
      var ninRaw = '', followupRaw = '';

      for (var c = 0; c < rowFmt.length; c++) {
        if (c === I.lat || c === I.lng) continue;
        var label = colLabel(hdr, c, c + 1);
        var val = displayValue(rowFmt[c]);
        var isLinkCol = (c === I.link);
        var link = null;
        if (linkMap && linkMap[r + ':' + c]) link = linkMap[r + ':' + c];
        else if ((isLinkCol || looksLikeUrl(val)) && looksLikeUrl(val)) link = String(rowFmt[c]).trim();

        /* اجزای نام و فیلدهای ویژه */
        if (c === I.name) nameCol = val;
        if (I.last !== -1 && c === I.last) lastName = val;
        if (c === I.base) baseName = val;
        if (I.house !== -1 && c === I.house) houseName = val;
        if (I.center !== -1 && c === I.center) centerName = val;
        if (I.caregiver !== -1 && c === I.caregiver) caregiverName = val;
        if (I.behvarz !== -1 && c === I.behvarz) behvarzName = val;
        if (I.observer !== -1 && c === I.observer) observerName = val;
        if (I.envExpert !== -1 && c === I.envExpert) envExpertName = val;
        if (I.occExpert !== -1 && c === I.occExpert) occExpertName = val;
        if (I.doctor !== -1 && c === I.doctor) doctorName = val;
        if (I.dentist !== -1 && c === I.dentist) dentistName = val;
        if (I.services !== -1 && c === I.services) servicesName = val;
        if (I.reception !== -1 && c === I.reception) receptionName = val;
        /* ستون‌های جمعیت: تبدیل به عدد */
        if (I.popTotal !== -1 && c === I.popTotal) popTotalVal = parsePopulation(val);
        if (I.popUnder1 !== -1 && c === I.popUnder1) popUnder1Val = parsePopulation(val);
        if (I.popUnder5 !== -1 && c === I.popUnder5) popUnder5Val = parsePopulation(val);
        if (I.caregiverCount !== -1 && c === I.caregiverCount) caregiverCountVal = parsePopulation(val);
        if (I.month !== -1 && c === I.month) month = val;
        if (I.nin !== -1 && c === I.nin) ninRaw = U.toLatinDigits(val).replace(/[^0-9۰-۹]/g, '');
        if (I.followup !== -1 && c === I.followup) followupRaw = val;
        if (c === I.link && link) linkUrl = link;
        if (I.color !== -1 && c === I.color) {
          colorRaw = val;
          var tHex = parseColorValue(val);
          /* اگر متن کد رنگ نبود، رنگ پرشدن (Fill) سلول در اکسل ملاک است */
          if (!tHex && fillMap && fillMap[r + ':' + c]) tHex = fillMap[r + ':' + c];
          if (tHex) colorHex = tHex;
          if (!val && colorHex) val = colorHex;
          label = COLOR_LABEL;
        }

        if (val !== '' || link || (c === I.color && colorHex)) {
          fields.push({ label: label, value: val, link: link, swatch: (c === I.color && colorHex) ? colorHex : null });
          if (c === I.name && !firstName) firstName = val;
        }
      }

      /* نام نمایشی: پایگاه → خانه بهداشت → مرکز → نام + نام خانوادگی → اولین فیلد متنی */
      var full = baseName.trim() || houseName.trim() || centerName.trim() ||
                 (firstName + ' ' + lastName).replace(/\s+/g, ' ').trim() ||
                 nameCol.trim() ||
                 (fields.length ? fields[0].value : '') || '';

      /* ردیف کاملاً خالی را رد کن */
      if (!full && (rawLat === '') && (rawLng === '')) continue;

      var lat = I.lat !== -1 ? U.parseCoord(rawLat) : NaN;
      var lng = I.lng !== -1 ? U.parseCoord(rawLng) : NaN;

      var issues = [];
      var swapped = false;
      var hasGeo = I.lat !== -1 && I.lng !== -1;

      if (hasGeo) {
        if (isNaN(lat) || isNaN(lng)) {
          /* در سامانه منابع انسانی، مختصات اختیاری است — هشدار غیرتخریبی */
          if (isNaN(lat) && isNaN(lng)) issues.push('مختصات قابل خواندن نیست (اختیاری)');
          else if (isNaN(lat)) issues.push('عرض جغرافیایی نامعتبر (اختیاری)');
          else issues.push('طول جغرافیایی نامعتبر (اختیاری)');
        } else {
          var inIranBox = function (la, ln) { return la >= 24.3 && la <= 40.5 && ln >= 43.5 && ln <= 64.2; };
          if (Math.abs(lat) > 90 && Math.abs(lat) <= 180 && Math.abs(lng) <= 90) {
            var t = lat; lat = lng; lng = t;
            swapped = true;
            issues.push('عرض و طول جابه‌جا بود؛ اصلاح شد');
          }
          if (!swapped && !inIranBox(lat, lng) && inIranBox(lng, lat)) {
            var t2 = lat; lat = lng; lng = t2;
            swapped = true;
            issues.push('عرض و طول جابه‌جا بود؛ اصلاح شد');
          }
          if (lat < -90 || lat > 90) issues.push('عرض جغرافیایی خارج از بازه [-90, 90]');
          if (lng < -180 || lng > 180) issues.push('طول جغرافیایی خارج از بازه [-180, 180]');
          if (!issues.length && !inIranBox(lat, lng)) issues.push('خارج از مرزهای ایران (نمایش داده می‌شود)');
        }
      }

      /* در سامانه منابع انسانی، رکورد «معتبر» است اگر حداقل یکی از ستون‌های اصلی (پایگاه/خانه/مرکز) داشته باشد.
         مختصات جغرافیایی برای نمایش روی نقشه دل‌خواه است. */
      var ok = !!baseName || !!houseName || !!centerName;
      if (hasGeo && !isNaN(lat) && !isNaN(lng)) {
        ok = ok && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
      }

      /* تشخیص تکراری — بر اساس نام پایگاه/خانه بهداشت/مرکز (بدون مختصات) */
      var dupKey = ok ? (baseName + '|' + houseName + '|' + centerName || full) : null;
      var duplicate = false;
      if (dupKey) {
        if (seen[dupKey]) duplicate = true;
        else seen[dupKey] = true;
      }

      /* اعتبارسنجی کدملی و وضعیت پیگیری (اگر JDate در دسترس باشد) */
      var JD = global.JDate;
      var ninState = null, ninReason = '';
      if (JD && ninRaw !== '') {
        var v = JD.validateNationalId(ninRaw);
        ninState = v.state;
        ninReason = v.reason || '';
      }
      var followupDate = null, followupKind = null, followupDays = null;
      if (JD && followupRaw) {
        followupDate = JD.parseFlexibleDate(followupRaw);
        if (followupDate) {
          var st = JD.followupStatus(followupDate, JD.todayJalali());
          if (st) { followupKind = st.kind; followupDays = st.days; }
        }
      }

      points.push({
        row: r + 1,
        name: full || ('بدون نام (سطر ' + (r + 1) + ')'),
        /* ستون‌های اصلی سامانه منابع انسانی */
        base: baseName,
        house: houseName,
        center: centerName,
        /* ستون‌های اسم پرسنل */
        caregiver: caregiverName,
        behvarz: behvarzName,
        observer: observerName,
        envExpert: envExpertName,
        occExpert: occExpertName,
        doctor: doctorName,
        dentist: dentistName,
        services: servicesName,
        reception: receptionName,
        /* ستون‌های جمعیت */
        popTotal: popTotalVal,
        popUnder1: popUnder1Val,
        popUnder5: popUnder5Val,
        caregiverCount: caregiverCountVal,
        /* فیلدهای قدیمی (برای سازگاری با کد قدیمی) */
        month: month,
        disease: '',
        color: colorHex,
        colorRaw: colorRaw,
        link: linkUrl,
        ninRaw: ninRaw,
        ninState: ninState,
        ninReason: ninReason,
        followupRaw: followupRaw,
        followupDate: followupDate,
        followupKind: followupKind,
        followupDays: followupDays,
        fields: fields,
        lat: ok && !isNaN(lat) ? lat : null,
        lng: ok && !isNaN(lng) ? lng : null,
        rawLat: rawLat === undefined ? '' : String(rawLat),
        rawLng: rawLng === undefined ? '' : String(rawLng),
        valid: ok,
        swapped: swapped,
        duplicate: duplicate,
        note: issues.join('؛ ')
      });
    }
    return points;
  }

  /* برچسب ستون: اگر سرستون شناخته‌شده بود از برچسب آن، وگرنه «ستون n» */
  function colLabel(hdr, colIdx, fallbackNo) {
    for (var i = 0; i < hdr.headers.length; i++) {
      if (hdr.headers[i].idx === colIdx) {
        var lb = hdr.headers[i].label;
        return lb || ('ستون ' + U.faNum(fallbackNo));
      }
    }
    return 'ستون ' + U.faNum(fallbackNo);
  }

  /* خواندن کاربرگ اول → دو نسخه خام و فرمت‌شده */
  function sheetToRows(wb) {
    var sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error('کاربری در فایل یافت نشد.');
    var ws = wb.Sheets[sheetName];
    if (!ws) throw new Error('کاربرگ اول خالی است.');
    var rowsRaw = global.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    var rowsFmt = global.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    if (!rowsRaw.length) throw new Error('فایل خالی است.');
    return { rowsRaw: rowsRaw, rowsFmt: rowsFmt, sheetName: sheetName, ws: ws };
  }

  /* تبدیل متن/عدد جمعیت به عدد صحیح — پشتیبانی از ارقام فارسی، جداکننده و Comma */
  function parsePopulation(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return Math.max(0, Math.floor(v));
    var s = U.toLatinDigits(String(v)).replace(/[,٬،\s]/g, '').trim();
    if (!s) return 0;
    var n = parseInt(s, 10);
    return isNaN(n) ? 0 : Math.max(0, n);
  }

  /* خواندن ArrayBuffer با SheetJS */
  function parseBuffer(buffer) {
    var wb;
    try {
      wb = global.XLSX.read(buffer, { type: 'array', cellDates: false, cellStyles: true });
    } catch (e) {
      throw new Error('فایل قابل خواندن نیست. فرمت‌های xlsx، xls و csv پشتیبانی می‌شوند.');
    }
    return finish(wb);
  }

  /* خواندن CSV به‌صورت متن UTF-8 (تا نام‌های فارسی خراب نشوند) */
  function parseCsvText(text) {
    var wb;
    try {
      wb = global.XLSX.read(text, { type: 'string', cellDates: false, raw: false });
    } catch (e) {
      throw new Error('فایل CSV قابل خواندن نیست.');
    }
    return finish(wb);
  }

  function finish(wb) {
    var sr = sheetToRows(wb);
    var hdr = findHeader(sr.rowsRaw);
    var linkMap = extractHyperlinks(sr.ws);
    var fillMap = extractFillColors(sr.ws);
    var points = extractPoints(sr.rowsRaw, sr.rowsFmt, hdr, linkMap, fillMap);
    return {
      sheetName: sr.sheetName,
      headerDetected: hdr.detected,
      headers: hdr.labels,
      /* ستون‌های اصلی سامانه منابع انسانی */
      baseLabel: hdr.labels && hdr.labels.base ? hdr.labels.base : '',
      houseLabel: hdr.labels && hdr.labels.house ? hdr.labels.house : '',
      centerLabel: hdr.labels && hdr.labels.center ? hdr.labels.center : '',
      popTotalLabel: hdr.labels && hdr.labels.popTotal ? hdr.labels.popTotal : '',
      popUnder1Label: hdr.labels && hdr.labels.popUnder1 ? hdr.labels.popUnder1 : '',
      popUnder5Label: hdr.labels && hdr.labels.popUnder5 ? hdr.labels.popUnder5 : '',
      caregiverCountLabel: hdr.labels && hdr.labels.caregiverCount ? hdr.labels.caregiverCount : '',
      caregiverLabel: hdr.labels && hdr.labels.caregiver ? hdr.labels.caregiver : '',
      behvarzLabel: hdr.labels && hdr.labels.behvarz ? hdr.labels.behvarz : '',
      observerLabel: hdr.labels && hdr.labels.observer ? hdr.labels.observer : '',
      envExpertLabel: hdr.labels && hdr.labels.envExpert ? hdr.labels.envExpert : '',
      occExpertLabel: hdr.labels && hdr.labels.occExpert ? hdr.labels.occExpert : '',
      doctorLabel: hdr.labels && hdr.labels.doctor ? hdr.labels.doctor : '',
      dentistLabel: hdr.labels && hdr.labels.dentist ? hdr.labels.dentist : '',
      servicesLabel: hdr.labels && hdr.labels.services ? hdr.labels.services : '',
      receptionLabel: hdr.labels && hdr.labels.reception ? hdr.labels.reception : '',
      /* فیلدهای قدیمی برای سازگاری */
      monthLabel: hdr.labels && hdr.labels.month ? hdr.labels.month : '',
      diseaseLabel: '',
      followupLabel: hdr.labels && hdr.labels.followup ? hdr.labels.followup : '',
      ninLabel: hdr.labels && hdr.labels.nin ? hdr.labels.nin : '',
      colorLabel: COLOR_LABEL,
      points: points
    };
  }

  function parseFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('خواندن فایل ناموفق بود.')); };
      reader.onload = function (e) {
        try {
          var buf = new Uint8Array(e.target.result);
          var name = (file.name || '').toLowerCase();
          /* تشخیص CSV: پسوند یا نبود امضای ZIP (xlsx) */
          var isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4B;
          var isCsv = name.slice(-4) === '.csv' || (!isZip && name.slice(-4) !== '.xls');
          if (isCsv) {
            var hasBom = buf.length > 2 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
            var text = new TextDecoder('utf-8').decode(buf);
            if (hasBom) text = text.replace(/^\ufeff/, '');
            resolve(parseCsvText(text));
          } else {
            resolve(parseBuffer(buf));
          }
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /* ساخت فایل قالب نمونه (xlsx) مطابق ساختار سامانه مدیریت منابع انسانی
     — ۱۶ ستون اصلی + ۲ ستون اختیاری جغرافیایی برای نمایش روی نقشه */
  function makeTemplate() {
    /* عنوان ستون‌ها دقیقاً مطابق درخواست کاربر — ردیف اول اکسل */
    var HEAD = [
      'پایگاه',
      'خانه بهداشت',
      'مرکز',
      'نام مراقب سلامت',
      'نام بهورز',
      'نام ناظر بیماریها',
      'نام کارشناس محیط',
      'نام کارشناس حرفه ای',
      'نام پزشک',
      'نام دندانپزشک',
      'نام خدمات',
      'نام پذیرش',
      'کل جمعیت',
      'زیریک سال',
      'زیر5سال',
      'تعداد مراقب',
      /* ستون‌های اختیاری جغرافیایی (در صورت وجود، روی نقشه نمایش داده می‌شوند) */
      'عرض جغرافیایی',
      'طول جغرافیایی'
    ];
    /* نمونه‌های داده‌ای — سه پایگاه نمونه از دو مرکز شهرستانی */
    var data = [
      HEAD,
      ['پایگاه ۱', 'خانه بهداشت علی‌آباد', 'مرکز بهداشت دشت',
       'مریم احمدی', 'رضا کریمی', 'سعید محمدی', 'نازنین رستمی', 'حسن موسوی',
       'دکتر سجاد بازوندی', 'دکتر فاطمه علوی', 'زهرا کاظمی', 'محمد نجفی',
       1250, 85, 240, 4, 35.699756, 51.338076],
      ['پایگاه ۲', 'خانه بهداشت رحمت‌آباد', 'مرکز بهداشت دشت',
       'سارا حسینی', 'علی رضایی', 'مهدی قاسمی', 'بهاره سالمی', 'جواد اکبری',
       'دکتر سجاد بازوندی', 'دکتر فاطمه علوی', 'نگار صادقی', 'حسین رحیمی',
       980, 62, 175, 3, 36.287987, 59.615744],
      ['پایگاه ۳', 'خانه بهداشت شریف‌آباد', 'مرکز بهداشت کوهستان',
       'الهام صالحی', 'مبینا یوسفی', 'آرش نیکخواه', 'سمیرا عباسی', 'کورش جعفری',
       'دکتر سجاد بازوندی', 'دکتر فاطمه علوی', 'پری شیرازی', 'بابک مرادی',
       1580, 110, 320, 5, 32.657298, 51.677243]
    ];
    var ws = global.XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = HEAD.map(function (h) { return { wch: Math.max(14, h.length + 4) }; });
    var wb = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(wb, ws, 'منابع انسانی');
    var out = global.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([out], { type: 'application/octet-stream' });
  }

  global.ExcelModule = {
    parseFile: parseFile,
    parseBuffer: parseBuffer,
    makeTemplate: makeTemplate
  };
})(window);

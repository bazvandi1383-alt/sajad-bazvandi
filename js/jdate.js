/* =========================================================
   jdate.js — تاریخ شمسی/میلادی و اعتبارسنجی کدملی
   -----------------------------------------------------------
   - تبدیل دقیق شمسی ↔ میلادی با الگوریتم استاندارد jalaali
   - parseFlexibleDate: خواندن تاریخ از متن آزاد فایل اکسل
     (۱۴۰۵/۰۷/۱۹ ، 2026-10-11 ، ۱۴۰۵۰۷۱۹ ، ارقام فارسی و…)
   - todayJalali: تاریخ امروز به شمسی
   - followupStatus: وضعیت پیگیری (گذشته / امروز / نزدیک / آینده)
   - validateNationalId: رقم کنترل کد ملی ایران (الگوریتم رسمی)
   - بدون وابستگی؛ در مرورگر (window.JDate) و Node (module.exports)
   ========================================================= */
(function (global) {
  'use strict';

  var FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

  function toLatinDigits(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[۰-۹٠-٩]/g, function (d) {
      var i = FA_DIGITS.indexOf(d);
      if (i === -1) { /* ارقام عربی ٠-٩ */ var j = '٠١٢٣٤٥٦٧٨٩'.indexOf(d); return j >= 0 ? String(j) : d; }
      return String(i);
    });
  }

  /* ---------- الگوریتم جلالی (برگرفته از jalaali-js — دقیق برای ۱۱۷۸ تا ۳۳۴۱ شمسی) ---------- */
  function div(a, b) { return ~~(a / b); }
  function mod(a, b) { return a - ~~(a / b) * b; }

  var BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

  function jalCal(jy, withoutLeap) {
    var bl = BREAKS.length, gy = jy + 621, leapJ = -14, jp = BREAKS[0], jm, jump = 0, leap, leapG, march, n, i;
    if (jy < jp || jy >= BREAKS[bl - 1]) return null;
    for (i = 1; i < bl; i += 1) {
      jm = BREAKS[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    march = 20 + leapJ - leapG;
    if (!withoutLeap) {
      if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
      leap = mod(mod(n + 1, 33) - 1, 4);
      if (leap === -1) leap = 4;
    }
    return { leap: leap, gy: gy, march: march };
  }

  /* تاریخ میلادی → عدد روز ژولین (JDN) و برعکس */
  function g2d(gy, gm, gd) {
    var d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
      + div(153 * mod(gm + 9, 12) + 2, 5)
      + gd - 34840408;
    d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
  }

  function d2g(jdn) {
    var j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    var i = div(mod(j, 1461), 4) * 5 + 308;
    var gd = div(mod(i, 153), 5) + 1;
    var gm = mod(div(i, 153), 12) + 1;
    var gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return { gy: gy, gm: gm, gd: gd };
  }

  /* شمسی → JDN */
  function j2d(jy, jm, jd) {
    var r = jalCal(jy, true);
    if (!r) return null;
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }

  /* JDN → شمسی */
  function d2j(jdn) {
    var gy = d2g(jdn).gy;
    var jy = gy - 621;
    var r = jalCal(jy, false);
    var jdn1f = g2d(gy, 3, r.march);
    var jd, jm, k;
    k = jdn - jdn1f;
    if (k >= 0) {
      if (k <= 185) {
        jm = 1 + div(k, 31);
        jd = mod(k, 31) + 1;
        return { jy: jy, jm: jm, jd: jd };
      }
      k -= 186;
    } else {
      jy -= 1;
      k += 179;
      if (r.leap === 1) k += 1;
    }
    jm = 7 + div(k, 30);
    jd = mod(k, 30) + 1;
    return { jy: jy, jm: jm, jd: jd };
  }

  function isLeapJalaaliYear(jy) {
    var r = jalCal(jy, false);
    return r ? r.leap === 0 : false;
  }

  function jalaaliMonthLength(jy, jm) {
    if (jm < 1 || jm > 12) return 0;
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    return isLeapJalaaliYear(jy) ? 30 : 29;
  }

  function isValidJalaaliDate(jy, jm, jd) {
    if (!jalCal(jy, true)) return false;
    return jm >= 1 && jm <= 12 && jd >= 1 && jd <= jalaaliMonthLength(jy, jm);
  }

  function toJalaali(gy, gm, gd) { return d2j(g2d(gy, gm, gd)); }
  function toGregorian(jy, jm, jd) {
    var jdn = j2d(jy, jm, jd);
    return jdn === null ? null : d2g(jdn);
  }

  /* ---------- امروز ---------- */
  function todayJalali(now) {
    var t = now || new Date();
    var j = toJalaali(t.getFullYear(), t.getMonth() + 1, t.getDate());
    j.jdn = g2d(t.getFullYear(), t.getMonth() + 1, t.getDate());
    return j;
  }

  /* ---------- خواندن تاریخ از متن آزاد ---------- */
  /* خروجی: {cal, jy,jm,jd, gy,gm,gd, jdn} یا null
     پشتیبانی: 1405/07/19 ، 1405-7-19 ، 1405.7.19 ، ۱۴۰۵/۰۷/۱۹ ،
               19/07/1405 (روز/ماه/سال)، 2026-10-11 میلادی، 14050719 */
  function parseFlexibleDate(raw) {
    if (raw === null || raw === undefined) return null;
    var s = toLatinDigits(String(raw)).trim();
    if (!s) return null;
    s = s.replace(/[٫،ـ\-—–.\\ ]+/g, '/')
      .replace(/\//g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\/|\/$/g, '');
    var m = /^(\d{1,4})\/(\d{1,2})\/(\d{1,4})$/.exec(s);
    if (!m) {
      var m8 = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
      if (m8) m = [null, m8[1], String(Number(m8[2])), String(Number(m8[3]))];
      else return null;
    }
    var a = Number(m[1]), b = Number(m[2]), c = Number(m[3]);
    var y, mo, dd;
    if (a > 31) { y = a; mo = b; dd = c; }            /* سال/ماه/روز */
    else if (c > 31) { y = c; mo = b; dd = a; }       /* روز/ماه/سال */
    else return null;                                   /* مبهم */
    if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;

    var jy, jm, jd, gy, gm, gd, jdn, cal;
    if (y >= 1178 && y <= 1633) {
      cal = 'jalali';
      if (!isValidJalaaliDate(y, mo, dd)) return null;
      jy = y; jm = mo; jd = dd;
      jdn = j2d(jy, jm, jd);
      var g = d2g(jdn); gy = g.gy; gm = g.gm; gd = g.gd;
    } else if (y >= 1800 && y <= 2200) {
      cal = 'gregorian';
      var probe = new Date(y, mo - 1, dd);
      if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== dd) return null;
      gy = y; gm = mo; gd = dd;
      jdn = g2d(gy, gm, gd);
      var j = d2j(jdn); jy = j.jy; jm = j.jm; jd = j.jd;
    } else {
      return null;
    }
    return { cal: cal, jy: jy, jm: jm, jd: jd, gy: gy, gm: gm, gd: gd, jdn: jdn };
  }

  /* ---------- وضعیت پیگیری نسبت به امروز ---------- */
  /* خروجی: {kind: overdue|today|soon|later, days} یا null */
  var SOON_WINDOW_DAYS = 7;
  function followupStatus(parsedDate, today) {
    if (!parsedDate || typeof parsedDate.jdn !== 'number' || !today) return null;
    var diff = parsedDate.jdn - (typeof today.jdn === 'number' ? today.jdn : todayJalali().jdn);
    if (diff < 0) return { kind: 'overdue', days: -diff };
    if (diff === 0) return { kind: 'today', days: 0 };
    if (diff <= SOON_WINDOW_DAYS) return { kind: 'soon', days: diff };
    return { kind: 'later', days: diff };
  }

  /* ---------- قالب‌بندی شمسی ---------- */
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function formatJalali(jy, jm, jd, persianDigits) {
    var s = jy + '/' + pad2(jm) + '/' + pad2(jd);
    if (persianDigits) {
      s = s.replace(/[0-9]/g, function (d) { return FA_DIGITS[Number(d)]; });
    }
    return s;
  }
  function formatParsed(pd, persianDigits) {
    if (!pd) return '';
    return formatJalali(pd.jy, pd.jm, pd.jd, persianDigits);
  }

  var JMONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
                 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  function jalaliMonthName(jm) { return JMONTHS[jm - 1] || ''; }

  /* ---------- اعتبارسنجی کد ملی ایران ---------- */
  /* خروجی: {state:'ok'|'invalid'|'empty', reason?, value?} */
  function validateNationalId(raw) {
    var s = toLatinDigits(raw === null || raw === undefined ? '' : String(raw)).replace(/[^0-9]/g, '');
    if (!s) return { state: 'empty' };
    if (s.length !== 10) {
      return { state: 'invalid', reason: 'کدملی باید ۱۰ رقم باشد (شامل ' + toFaNum(s.length) + ' رقم است)' };
    }
    if (/^(\d)\1{9}$/.test(s)) {
      return { state: 'invalid', reason: 'ارقام کدملی نمی‌توانند همه یکسان باشند' };
    }
    var sum = 0, i;
    for (i = 0; i < 9; i++) sum += Number(s.charAt(i)) * (10 - i);
    var r = sum % 11;
    var check = Number(s.charAt(9));
    var ok = (r < 2) ? (check === r) : (check === 11 - r);
    if (!ok) return { state: 'invalid', reason: 'رقم کنترل (رقم دهم) کدملی صحیح نیست' };
    return { state: 'ok', value: s };
  }

  /* ساخت کدملی معتبر از ۹ رقم اول (برای قالب نمونه و تست) */
  function completeNationalId(base9) {
    var s = toLatinDigits(String(base9)).replace(/[^0-9]/g, '');
    if (s.length !== 9) return '';
    var sum = 0, i;
    for (i = 0; i < 9; i++) sum += Number(s.charAt(i)) * (10 - i);
    var r = sum % 11;
    var check = r < 2 ? r : 11 - r;
    return s + String(check);
  }

  function toFaNum(v) {
    return String(v).replace(/[0-9]/g, function (d) { return FA_DIGITS[Number(d)]; });
  }

  var api = {
    toLatinDigits: toLatinDigits,
    toFaNum: toFaNum,
    toJalaali: toJalaali,
    toGregorian: toGregorian,
    isLeapJalaaliYear: isLeapJalaaliYear,
    jalaaliMonthLength: jalaaliMonthLength,
    isValidJalaaliDate: isValidJalaaliDate,
    todayJalali: todayJalali,
    parseFlexibleDate: parseFlexibleDate,
    followupStatus: followupStatus,
    SOON_WINDOW_DAYS: SOON_WINDOW_DAYS,
    formatJalali: formatJalali,
    formatParsed: formatParsed,
    jalaliMonthName: jalaliMonthName,
    validateNationalId: validateNationalId,
    completeNationalId: completeNationalId
  };

  global.JDate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : global);

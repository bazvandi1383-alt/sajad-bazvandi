/* =========================================================
   util.js — ابزارهای عمومی
   نرمال‌سازی اعداد فارسی/عربی، قالب‌بندی، توست، دانلود فایل
   ========================================================= */
(function (global) {
  'use strict';

  /* تبدیل ارقام فارسی/عربی به لاتین */
  var FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  var AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

  function toLatinDigits(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[۰-۹٠-٩]/g, function (d) {
      var i = FA_DIGITS.indexOf(d);
      if (i === -1) i = AR_DIGITS.indexOf(d);
      return i >= 0 ? String(i) : d;
    });
  }

  /* پاک‌سازی رشته مختصات → عدد اعشاری یا NaN
     پشتیبانی: ۳۵٫۶۹۹۷ / 35,6997 / 35° 41' 58.9" E / فاصله‌ها */
  function parseCoord(raw) {
    if (raw === null || raw === undefined) return NaN;
    if (typeof raw === 'number') return isFinite(raw) ? raw : NaN;
    var s = toLatinDigits(String(raw)).trim();
    if (!s) return NaN;

    /* درجه-دقیقه-ثانیه مانند 35°41'58.9"N یا 35 41 58.9 */
    var dms = s.match(/^(-?\d+(?:\.\d+)?)\s*[°d°\s]\s*(\d+(?:\.\d+)?)\s*['′\s]?\s*(\d+(?:\.\d+)?)?\s*(?:["″''\s])?\s*([NnSsEeWwشریدیغج]?)/);
    if (dms && (s.indexOf('°') !== -1 || s.indexOf("'") !== -1 || s.indexOf('′') !== -1)) {
      var deg = parseFloat(dms[1]);
      var min = parseFloat(dms[2] || 0);
      var sec = parseFloat(dms[3] || 0);
      var val = Math.abs(deg) + min / 60 + sec / 3600;
      if (deg < 0 || /[SsWwغج]/.test(dms[4] || '')) val = -val;
      return val;
    }

    /* جداکننده اعشار فارسی «٫» یا کاملا اروپایی */
    s = s.replace(/[٫،]/g, '.');
    /* اگر هم «,» به‌عنوان اعشار و هم «.» باشد، کاما را حذف کن */
    if (s.indexOf('.') !== -1) s = s.replace(/,/g, '');
    else s = s.replace(/,/g, '.');

    s = s.replace(/[°'"″′\s]/g, '');
    s = s.replace(/[NnEeشرید]/g, '');
    if (/^[SsWwغج]/.test(s)) { s = s.slice(1); }

    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  /* قالب‌بندی اعداد فارسی برای نمایش */
  function faNum(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    var s = Number(n).toLocaleString('fa-IR', { maximumFractionDigits: digits === undefined ? 0 : digits });
    return s;
  }

  function faBytes(bytes) {
    if (!bytes || bytes < 0) return '۰';
    if (bytes < 1024) return faNum(bytes) + ' بایت';
    if (bytes < 1024 * 1024) return faNum(bytes / 1024, 1) + ' کیلوبایت';
    return faNum(bytes / (1024 * 1024), 1) + ' مگابایت';
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* توست ساده */
  var toastTimer = null;
  function toast(msg, kind, ms) {
    var el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.style.cssText = 'position:fixed;bottom:18px;right:50%;transform:translateX(50%);z-index:4000;' +
        'padding:10px 18px;border-radius:10px;font-size:13px;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.25);' +
        'transition:opacity .25s;max-width:92vw;text-align:center;line-height:1.9;';
      document.body.appendChild(el);
    }
    var bg = kind === 'error' ? '#c0392b' : kind === 'warn' ? '#b9770e' : '#0e8a5f';
    el.style.background = bg;
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.opacity = '0'; }, ms || 3400);
  }

  /* دانلود فایل متنی/باینری از مرورگر */
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 400);
  }

  function downloadText(text, filename, mime) {
    downloadBlob(new Blob(['\ufeff' + text], { type: (mime || 'text/plain') + ';charset=utf-8' }), filename);
  }

  /* تبدیل عدد به رقم فارسی برای پیشرفت */
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  /* تاخیر */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  global.Util = {
    toLatinDigits: toLatinDigits,
    parseCoord: parseCoord,
    faNum: faNum,
    faBytes: faBytes,
    escapeHtml: escapeHtml,
    toast: toast,
    downloadBlob: downloadBlob,
    downloadText: downloadText,
    clamp: clamp,
    sleep: sleep
  };
})(window);

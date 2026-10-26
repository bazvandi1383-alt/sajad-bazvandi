/* =========================================================
   auth.js — ورود و مدیریت حساب کاربری (کاملاً محلی، بدون سرور)
   - گذرواژه به‌صورت هش SHA-256 + نمک یکتا در localStorage ذخیره می‌شود
     (هیچ گذرواژه‌ای به‌صورت متن ساده نگهداری نمی‌شود)
   - نشست با تاریخ انقضا: «مرا به خاطر بسپار» = ۳۰ روز، بدون آن = ۱۲ ساعت
   - محدودیت تلاش ناموفق: ۵ بار خطا → قفل موقت ۳۰ ثانیه‌ای
   - پیاده‌سازی SHA-256 خالص جاوااسکریپت → کارکرد کامل آفلاین و روی file://
   ========================================================= */
(function (global) {
  'use strict';

  var LS_AUTH = 'neshanExcelMap.auth';
  var LS_SESSION = 'neshanExcelMap.session';
  var SS_SESSION = 'neshanExcelMap.session.tmp';

  var DEFAULT_USER = 'admin';
  var DEFAULT_PASS = 'admin123';
  var REMEMBER_MS = 30 * 24 * 3600 * 1000;
  var SESSION_MS = 12 * 3600 * 1000;
  var MAX_TRIES = 5;
  var LOCK_MS = 30 * 1000;

  /* ---------- SHA-256 خالص (بدون وابستگی به crypto.subtle) ---------- */
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8Bytes(str) {
    if (global.TextEncoder) return new global.TextEncoder().encode(str);
    /* پشتیبان دستی UTF-8 */
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
          i++;
        } else out.push(0xef, 0xbf, 0xbd);
      }
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256Bytes(bytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var l = bytes.length;
    var padded = ((l + 9 + 63) >> 6) << 6;   /* طول نهایی مضرب ۶۴ */
    var m = new Uint8Array(padded);
    m.set(bytes);
    m[l] = 0x80;
    var bits = l * 8;                        /* گذرواژه‌ها کوچک‌اند؛ سرریز ۳۲ بیتی موضوعیت ندارد */
    m[padded - 4] = (bits >>> 24) & 255;
    m[padded - 3] = (bits >>> 16) & 255;
    m[padded - 2] = (bits >>> 8) & 255;
    m[padded - 1] = bits & 255;

    var w = new Array(64);
    var i, t, a, b, c, d, e, f, g, h, s0, s1, ch, maj, t1, t2;
    for (i = 0; i < padded; i += 64) {
      for (t = 0; t < 16; t++) {
        w[t] = (m[i + t * 4] << 24) | (m[i + t * 4 + 1] << 16) | (m[i + t * 4 + 2] << 8) | m[i + t * 4 + 3];
      }
      for (t = 16; t < 64; t++) {
        s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      a = H[0]; b = H[1]; c = H[2]; d = H[3]; e = H[4]; f = H[5]; g = H[6]; h = H[7];
      for (t = 0; t < 64; t++) {
        s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        ch = (e & f) ^ (~e & g);
        t1 = (h + s1 + ch + K[t] + w[t]) >>> 0;
        s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        maj = (a & b) ^ (a & c) ^ (b & c);
        t2 = (s0 + maj) >>> 0;
        h = g; g = f; f = e;
        e = (d + t1) >>> 0;
        d = c; c = b; b = a;
        a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var hex = '';
    for (i = 0; i < 8; i++) hex += ('00000000' + H[i].toString(16)).slice(-8);
    return hex;
  }

  function sha256Hex(str) { return sha256Bytes(utf8Bytes(String(str))); }

  /* ---------- ذخیره‌سازی (با محافظت در برابر حافظه مسدود) ---------- */
  function lsGet(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { global.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { global.localStorage.removeItem(k); } catch (e) {} }
  function ssGet(k) { try { return global.sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { global.sessionStorage.setItem(k, v); } catch (e) {} }
  function ssDel(k) { try { global.sessionStorage.removeItem(k); } catch (e) {} }

  function randomSalt() {
    var s = '';
    if (global.crypto && global.crypto.getRandomValues) {
      var a = new Uint8Array(8);
      global.crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
    } else {
      s = String(Date.now()) + String(Math.random()).slice(2);
    }
    return s;
  }

  /* ---------- رکورد حساب (پیش‌فرض admin / admin123) ---------- */
  function getRecord() {
    try { return JSON.parse(lsGet(LS_AUTH) || 'null'); } catch (e) { return null; }
  }
  function putRecord(rec) { lsSet(LS_AUTH, JSON.stringify(rec)); }

  function ensureRecord() {
    var rec = getRecord();
    if (rec && rec.salt && rec.user && rec.pass) return rec;
    var salt = randomSalt();
    rec = {
      salt: salt,
      user: sha256Hex(salt + ':u:' + DEFAULT_USER.toLowerCase()),
      pass: sha256Hex(salt + ':p:' + DEFAULT_PASS),
      changed: false,
      createdAt: Date.now()
    };
    putRecord(rec);
    return rec;
  }

  function check(user, pass) {
    var rec = ensureRecord();
    var u = sha256Hex(rec.salt + ':u:' + String(user || '').trim().toLowerCase());
    var p = sha256Hex(rec.salt + ':p:' + String(pass || ''));
    return u === rec.user && p === rec.pass;
  }

  function checkPass(pass) {
    var rec = ensureRecord();
    return sha256Hex(rec.salt + ':p:' + String(pass || '')) === rec.pass;
  }

  function setCredentials(username, password) {
    var rec = ensureRecord();
    rec.user = sha256Hex(rec.salt + ':u:' + String(username || '').trim().toLowerCase());
    rec.pass = sha256Hex(rec.salt + ':p:' + String(password || ''));
    rec.changed = true;
    rec.updatedAt = Date.now();
    putRecord(rec);
  }

  function resetToDefaults() {
    var rec = ensureRecord();
    rec.user = sha256Hex(rec.salt + ':u:' + DEFAULT_USER.toLowerCase());
    rec.pass = sha256Hex(rec.salt + ':p:' + DEFAULT_PASS);
    rec.changed = false;
    putRecord(rec);
  }

  function isDefault() {
    var r = getRecord();
    return !(r && r.changed);
  }

  /* ---------- نشست ---------- */
  function parseSession(v) {
    if (!v) return null;
    try {
      var s = JSON.parse(v);
      return (s && s.exp && s.exp > Date.now()) ? s : null;
    } catch (e) { return null; }
  }
  function isAuthenticated() {
    return !!(parseSession(lsGet(LS_SESSION)) || parseSession(ssGet(SS_SESSION)));
  }
  function createSession(remember, username, opts) {
    var exp = Date.now() + (remember ? REMEMBER_MS : SESSION_MS);
    var v = JSON.stringify({ exp: exp, remember: !!remember, user: String(username || '').toLowerCase(), primary: !!(opts && opts.primary) });
    if (remember) { lsSet(LS_SESSION, v); ssDel(SS_SESSION); }
    else { ssSet(SS_SESSION, v); lsDel(LS_SESSION); }
  }
  function logout() {
    lsDel(LS_SESSION); ssDel(SS_SESSION);
    /* خروج صریح = نشست تمام؛ ورود دوباره دوباره شمرده می‌شود */
    try { global.sessionStorage.removeItem('nema.openCounted'); } catch (e) {}
  }
  /* نام کاربری نشست فعلی (برای پیش‌پرکردن فرم درخواست) */
  function sessionUser() {
    var s = parseSession(lsGet(LS_SESSION)) || parseSession(ssGet(SS_SESSION));
    return (s && s.user) ? s.user : null;
  }
  /* آیا نشست فعلی متعلق به حساب اصلی برنامه است؟ (بدون محدودیت؛ دکمهٔ نصب و …) */
  function isPrimary() {
    var s = parseSession(lsGet(LS_SESSION)) || parseSession(ssGet(SS_SESSION));
    if (!s) return false;
    if (s.primary === true) return true;
    /* نشست‌های قدیمی (قبل از افزودن نشان primary): حساب اصلی با نام کاربری پیش‌فرض */
    if (s.primary === undefined && s.user === DEFAULT_USER && isDefault()) return true;
    return false;
  }

  /* ---------- رابط کاربری ورود ---------- */
  var onSuccess = null, bound = false;
  var tries = 0, lockTimer = null;
  var SS_LOCK = 'neshanExcelMap.lock';

  function getLockUntil() { var t = Number(ssGet(SS_LOCK) || 0); return isFinite(t) ? t : 0; }
  function setLockUntil(t) { if (t) ssSet(SS_LOCK, String(t)); else ssDel(SS_LOCK); }

  function $(id) { return document.getElementById(id); }
  function toFa(n) { return String(n).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[Number(d)]; }); }

  function toastMsg(msg, kind) {
    if (global.Util && global.Util.toast) global.Util.toast(msg, kind);
    else global.alert(msg);
  }

  function showGate() {
    var gate = $('loginGate');
    if (!gate) return;
    gate.classList.remove('hidden');
  }
  function hideGate() { var g = $('loginGate'); if (g) g.classList.add('hidden'); }

  function setError(msg) {
    var e = $('loginError');
    if (!e) return;
    if (!msg) { e.classList.add('hidden'); e.innerHTML = ''; return; }
    e.innerHTML = msg;
    e.classList.remove('hidden');
    var card = document.querySelector('.login-card');
    if (card) { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); }
  }

  function tickLock() {
    var btn = $('btnLogin');
    if (!btn) return;
    var lockedUntil = getLockUntil();
    var remain = Math.ceil((lockedUntil - Date.now()) / 1000);
    if (remain > 0) {
      btn.disabled = true;
      btn.textContent = '⏳ قفل موقت — ' + toFa(remain) + ' ثانیه';
      lockTimer = setTimeout(tickLock, 250);
    } else {
      setLockUntil(0);
      tries = 0;
      btn.disabled = false;
      btn.textContent = 'ورود';
    }
  }

  function submitLogin(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (Date.now() < getLockUntil()) { tickLock(); return; }
    var uEl = $('loginUser'), pEl = $('loginPass'), rEl = $('loginRemember');
    var u = (uEl && uEl.value) || '';
    var p = (pEl && pEl.value) || '';
    var remember = !!(rEl && rEl.checked);
    if (!String(u).trim() || !p) { setError('نام کاربری و گذرواژه را وارد کنید.'); return; }
    /* ۱) حساب اصلی برنامه (admin یا تغییر‌یافته) — همیشه محلی */
    if (check(u, p)) {
      tries = 0;
      setError('');
      setLockUntil(0);
      createSession(remember, u, { primary: true });
      hideGate();
      if (pEl) pEl.value = '';
      if (onSuccess) onSuccess();
      return;
    }
    /* ۲) کاربران ثبت‌شدهٔ سامانه — اگر «همگام‌سازی ابری» تنظیم شده باشد،
          نخست وضعیت تازهٔ حساب‌ها/مجوزها از سرور گرفته و نصب می‌شود؛
          در صورت قطعی سرور، آخرین وضعیت محلی ملاک است (برنامه از کار نمی‌افتد). */
    var NC = global.NemaCloud;
    if (NC && NC.enabled && NC.enabled()) {
      NC.pullState().then(function (r) {
        if (r && r.ok && r.data) { try { NC.installState(r.data, r.version); } catch (e) {} }
        verifyLocalLogin(u, p, remember);
      }).catch(function () { verifyLocalLogin(u, p, remember); });
      return;
    }
    verifyLocalLogin(u, p, remember);
  }

  /* احراز هویت محلی کاربران ثبت‌شده + پیام‌های خطا (گام‌های ۲ و ۳ قبلی) */
  function verifyLocalLogin(u, p, remember) {
    var pEl = $('loginPass');
    if (global.Registry) {
      var ext = global.Registry.verifyLogin(u, p);
      if (ext && ext.ok) {
        tries = 0;
        setError('');
        setLockUntil(0);
        createSession(remember, (ext.user && ext.user.username) || u);
        hideGate();
        if (pEl) pEl.value = '';
        if (onSuccess) onSuccess();
        return;
      }
      if (ext && ext.known && ext.error) {
        /* کاربر شناخته‌شده است اما گذرواژه غلط یا مجوز مسدود است */
        tries++;
        var leftK = MAX_TRIES - tries;
        if (leftK <= 0) {
          setLockUntil(Date.now() + LOCK_MS);
          setError('۵ تلاش ناموفق؛ ورود موقتاً قفل شد.');
          if (lockTimer) clearTimeout(lockTimer);
          tickLock();
        } else setError(ext.error);
        return;
      }
    }
    /* ۳) هیچ‌کدام — پیام عمومی */
    tries++;
    var left = MAX_TRIES - tries;
    if (left <= 0) {
      setLockUntil(Date.now() + LOCK_MS);
      setError('۵ تلاش ناموفق؛ ورود موقتاً قفل شد.');
      if (lockTimer) clearTimeout(lockTimer);
      tickLock();
    } else {
      setError('نام کاربری یا گذرواژه نادرست است. (' + toFa(left) + ' تلاش باقی مانده)');
    }
  }

  function showLogin(cb, preError) {
    onSuccess = cb || null;
    ensureRecord();
    showGate();
    if (preError) setError(preError);
    if (Date.now() < getLockUntil()) tickLock();
    if (bound) return;
    bound = true;
    var form = $('loginForm');
    if (form) form.addEventListener('submit', submitLogin);
    var eye = $('btnEye');
    if (eye) eye.addEventListener('click', function () {
      var inp = $('loginPass');
      if (!inp) return;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      eye.textContent = inp.type === 'password' ? '👁' : '🙈';
    });
    var u = $('loginUser');
    if (u) setTimeout(function () { u.focus(); }, 120);
  }

  /* ---------- بخش «حساب کاربری» در تب تنظیمات ---------- */
  function clearAccFields() {
    ['accCurrent', 'accNew', 'accNew2'].forEach(function (id) {
      var el = $(id);
      if (el) el.value = '';
    });
  }

  function initAccountUI() {
    ensureRecord();
    var save = $('btnSaveAccount');
    if (save) save.addEventListener('click', function () {
      var cur = ($('accCurrent') || {}).value || '';
      var nu = (($('accUser') || {}).value || '').trim();
      var np = ($('accNew') || {}).value || '';
      var np2 = ($('accNew2') || {}).value || '';
      if (!checkPass(cur)) { toastMsg('گذرواژهٔ فعلی نادرست است.', 'error'); return; }
      if (!nu) { toastMsg('نام کاربری نمی‌تواند خالی باشد.', 'error'); return; }
      if (np.length < 4) { toastMsg('گذرواژهٔ جدید باید دست‌کم ۴ نویسه باشد.', 'error'); return; }
      if (np !== np2) { toastMsg('تکرار گذرواژه با گذرواژهٔ جدید یکسان نیست.', 'error'); return; }
      setCredentials(nu, np);
      clearAccFields();
      toastMsg('اطلاعات ورود به‌روزرسانی شد. ورود بعدی با نام کاربری/گذرواژهٔ جدید.', 'ok', 5000);
    });

    var reset = $('btnResetAccount');
    if (reset) reset.addEventListener('click', function () {
      var cur = ($('accCurrent') || {}).value || '';
      if (!checkPass(cur)) { toastMsg('برای بازگردانی، گذرواژهٔ فعلی را درست وارد کنید.', 'error'); return; }
      if (!global.confirm('نام کاربری و گذرواژه به حالت پیش‌فرض (admin / admin123) برگردد؟')) return;
      resetToDefaults();
      clearAccFields();
      toastMsg('اطلاعات ورود به پیش‌فرض بازگشت: admin / admin123', 'ok', 5000);
    });

    var eye2 = $('btnEye2');
    if (eye2) eye2.addEventListener('click', function () {
      var inp = $('accNew');
      if (!inp) return;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      eye2.textContent = inp.type === 'password' ? '👁' : '🙈';
    });
  }

  /* ---------- API عمومی ---------- */
  global.Auth = {
    sha256Hex: sha256Hex,
    ensureRecord: ensureRecord,
    check: check,
    checkPass: checkPass,
    setCredentials: setCredentials,
    resetToDefaults: resetToDefaults,
    isDefault: isDefault,
    isAuthenticated: isAuthenticated,
    sessionUser: sessionUser,
    isPrimary: isPrimary,
    createSession: createSession,
    logout: logout,
    showLogin: showLogin,
    initAccountUI: initAccountUI,
    DEFAULT_USER: DEFAULT_USER,
    DEFAULT_PASS: DEFAULT_PASS
  };
})(window);

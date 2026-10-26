/* =========================================================
   registry.js — سامانهٔ محلی کاربران، مجوزها و داده‌ها
   جایگزین کامل بک‌اند کیت Admin-Support-Kit روی میزبانی استاتیک:
   - کاربران (کاربر / مدیر میانی) با سلسله‌مراتب گروهی
   - مجوز اختصاصی هر حساب: محدودیت زمانی (شمسی) و/یا تعدادی
   - اتصال زیرمجموعه به مدیران میانی (MidLinks)
   - فهرست داده‌های بارگذاری‌شدهٔ اکسل (ثبت خودکار از برنامه)
   همهٔ داده‌ها در localStorage همان مرورگر ذخیره می‌شود؛
   حساب اصلی «admin» خارج از این فهرست و بدون محدودیت است.
   وابستگی: auth.js (SHA-256) و jdate.js — قبل از این فایل بارگذاری شود.
   ========================================================= */
(function (global) {
  'use strict';

  var LS_USERS = 'nema.users.v1';
  var LS_LIC = 'nema.licenses.v1';
  var LS_LINKS = 'nema.midlinks.v1';
  var LS_DATA = 'nema.datasets.v1';
  var MAX_DATASETS = 60;

  /* ---------- ابزار ذخیره‌سازی امن ---------- */
  function lsGet(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { global.localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  function readJSON(k, fb) {
    try {
      var v = JSON.parse(lsGet(k) || 'null');
      return (v == null) ? fb : v;
    } catch (e) { return fb; }
  }
  function writeJSON(k, v) {
    /* هر تغییر دادهٔ پنل = «تغییرات ارسال‌نشده» برای همگام‌سازی ابری */
    try { localStorage.setItem('nema.cloud.dirty', '1'); } catch (e) {}
    return lsSet(k, JSON.stringify(v));
  }

  function uid() {
    return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function faNum(s) {
    return String(s).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[Number(d)]; });
  }

  /* ---------- hash گذرواژه (با SHA-256 ماژول auth) ---------- */
  function hashPass(salt, pass) {
    if (global.Auth && global.Auth.sha256Hex) return global.Auth.sha256Hex(salt + ':p:' + String(pass));
    /* پشتیبان ساده (هرگز نباید رخ دهد) */
    return 'raw:' + salt + ':' + String(pass);
  }
  function randomSalt() {
    var s = '';
    if (global.crypto && global.crypto.getRandomValues) {
      var a = new Uint8Array(8);
      global.crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
    } else s = String(Date.now()) + String(Math.random()).slice(2);
    return s;
  }

  /* ---------- کاربران ---------- */
  function users() {
    var v = readJSON(LS_USERS, []);
    return Array.isArray(v) ? v : [];
  }
  function saveUsers(arr) { writeJSON(LS_USERS, arr); }

  function findByUsername(username) {
    var u = String(username || '').trim().toLowerCase();
    return users().filter(function (x) { return x.username === u; })[0] || null;
  }

  var ROLE_LABEL = { USER: 'کاربر', MID_ADMIN: 'مدیر میانی', ADMIN: 'مدیر' };

  /* افزودن کاربر — خروجی: {ok, error?, user?} */
  function addUser(o) {
    var username = String(o.username || '').trim().toLowerCase();
    var pass = String(o.pass || '');
    var fullName = String(o.fullName || '').trim();
    var role = (o.role === 'MID_ADMIN') ? 'MID_ADMIN' : 'USER';
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      return { ok: false, error: 'نام کاربری باید ۳ تا ۳۲ نویسهٔ لاتین/عدد/نقطه/خط تیره باشد.' };
    }
    if (username === 'admin') return { ok: false, error: 'نام کاربری «admin» برای حساب اصلی رزرو است.' };
    if (pass.length < 6) return { ok: false, error: 'گذرواژه باید دست‌کم ۶ نویسه باشد.' };
    if (findByUsername(username)) return { ok: false, error: 'این نام کاربری قبلاً ثبت شده است.' };

    var managerId = null;
    if (role === 'USER' && o.managerId && o.managerId !== 'none') {
      var m = users().filter(function (x) { return x.id === o.managerId && x.role === 'MID_ADMIN'; })[0];
      if (m) managerId = m.id;
    }

    var salt = randomSalt();
    var user = {
      id: uid(), username: username, fullName: fullName,
      salt: salt, hash: hashPass(salt, pass),
      role: role, managerId: managerId,
      createdAt: Date.now()
    };
    var arr = users();
    arr.push(user);
    saveUsers(arr);
    return { ok: true, user: user };
  }

  /* ویرایش کاربر — patch: {fullName?, pass?, role?, managerId?} */
  function updateUser(id, patch) {
    var arr = users();
    var u = arr.filter(function (x) { return x.id === id; })[0];
    if (!u) return { ok: false, error: 'کاربر یافت نشد.' };
    if (patch.fullName != null) u.fullName = String(patch.fullName).trim();
    if (patch.pass) {
      if (String(patch.pass).length < 6) return { ok: false, error: 'گذرواژه باید دست‌کم ۶ نویسه باشد.' };
      u.salt = randomSalt();
      u.hash = hashPass(u.salt, String(patch.pass));
    }
    if (patch.role) {
      if (patch.role !== 'USER' && patch.role !== 'MID_ADMIN') return { ok: false, error: 'نقش نامعتبر است.' };
      u.role = patch.role;
      if (patch.role === 'MID_ADMIN') u.managerId = null;
    }
    if (patch.managerId !== undefined) {
      if (patch.managerId && patch.managerId !== 'none') {
        var m = arr.filter(function (x) { return x.id === patch.managerId && x.role === 'MID_ADMIN'; })[0];
        if (!m) return { ok: false, error: 'مدیر میانی انتخاب‌شده یافت نشد.' };
        u.managerId = m.id;
      } else u.managerId = null;
    }
    saveUsers(arr);
    return { ok: true, user: u };
  }

  /* حذف کاربر + پاک‌سازی ارجاع‌ها */
  function removeUser(id) {
    var arr = users().filter(function (x) { return x.id !== id; });
    saveUsers(arr);
    /* حذف از اتصال‌های مدیران میانی */
    var links = readJSON(LS_LINKS, {});
    var changed = false;
    Object.keys(links).forEach(function (mid) {
      var before = links[mid].length;
      if (mid === id) { delete links[mid]; changed = true; return; }
      links[mid] = links[mid].filter(function (x) { return x !== id; });
      if (links[mid].length !== before) changed = true;
    });
    if (changed) writeJSON(LS_LINKS, links);
    /* پاک‌سازی managerId زیرمجموعه‌ها و مجوز */
    var us = users();
    us.forEach(function (x) { if (x.managerId === id) x.managerId = null; });
    saveUsers(us);
    var lic = readJSON(LS_LIC, {});
    if (lic[id]) { delete lic[id]; writeJSON(LS_LIC, lic); }
    return { ok: true };
  }

  /* ---------- مجوزها ---------- */
  function licenses() {
    var v = readJSON(LS_LIC, {});
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  }
  function licenseOf(id) {
    var l = licenses()[id];
    return l || { useTime: false, startAt: null, expiryAt: null, useCount: false, openLimit: null, openCount: 0, manualLock: false, updatedAt: null };
  }
  /* patch کامل جایگزین می‌شود؛ شارژ مجدد = صفر شدن شمارنده */
  function setLicense(id, patch) {
    var lic = licenses();
    var cur = licenseOf(id);
    var next = {
      useTime: !!patch.useTime,
      startAt: patch.useTime ? (patch.startAt || null) : null,
      expiryAt: patch.useTime ? (patch.expiryAt || null) : null,
      useCount: !!patch.useCount,
      openLimit: patch.useCount ? (Number(patch.openLimit) || null) : null,
      openCount: 0,                                  /* شارژ مجدد */
      manualLock: (patch.manualLock != null) ? !!patch.manualLock : !!cur.manualLock,
      updatedAt: Date.now()
    };
    if (next.useTime && (!next.startAt || !next.expiryAt)) return { ok: false, error: 'شروع و پایان اعتبار زمانی را کامل وارد کنید.' };
    if (next.useTime && next.expiryAt <= next.startAt) return { ok: false, error: 'پایان اعتبار باید بعد از شروع آن باشد.' };
    if (next.useCount && (!next.openLimit || next.openLimit < 1 || next.openLimit > 100000)) {
      return { ok: false, error: 'سقف تعداد باز شدن باید عددی بین ۱ تا ۱۰۰٬۰۰۰ باشد.' };
    }
    lic[id] = next;
    writeJSON(LS_LIC, lic);
    return { ok: true, license: next };
  }

  function setManualLock(id, locked) {
    var lic = licenses();
    var cur = licenseOf(id);
    cur.manualLock = !!locked;
    cur.updatedAt = Date.now();
    lic[id] = cur;
    writeJSON(LS_LIC, lic);
    return { ok: true, license: cur };
  }

  /* وضعیت نمایشی مجوز — برای بَج‌های پنل مدیریت */
  function licenseStatus(id, now) {
    var l = licenseOf(id);
    now = now || Date.now();
    if (l.manualLock) return { kind: 'locked', label: 'قفل دستی', license: l };
    var parts = [];
    if (l.useTime) {
      if (l.startAt && now < l.startAt) return { kind: 'notstarted', label: 'اعتبار هنوز شروع نشده', license: l };
      if (l.expiryAt && now > l.expiryAt) return { kind: 'expired', label: 'مهلت اعتبار تمام شده', license: l };
      parts.push('زمانی');
    }
    if (l.useCount) {
      if (l.openLimit && l.openCount >= l.openLimit) return { kind: 'exhausted', label: 'سقف باز شدن تمام شده', license: l };
      parts.push('تعدادی');
    }
    if (!parts.length) return { kind: 'none', label: 'بدون محدودیت', license: l };
    return { kind: 'ok', label: 'فعال — محدودیت ' + parts.join(' و '), license: l };
  }

  /* ---------- کنترل ورود (از auth.js صدا زده می‌شود) ---------- */
  /* خروجی: {ok:true, user} یا {ok:false, error} */
  function verifyLogin(username, pass) {
    var u = findByUsername(username);
    if (!u) return { ok: false, error: '' };            /* ناشناخته → پیام عمومی */
    if (u.hash !== hashPass(u.salt, String(pass || ''))) {
      return { ok: false, error: 'نام کاربری یا گذرواژه نادرست است.', known: true };
    }
    var st = licenseStatus(u.id);
    if (st.kind === 'locked') return { ok: false, error: 'دسترسی این حساب توسط مدیر سامانه قفل شده است. با پشتیبانی تماس بگیرید: 09163638297', known: true };
    if (st.kind === 'notstarted') return { ok: false, error: 'اعتبار این حساب هنوز شروع نشده است (' + faNum(st.label) + ').', known: true };
    if (st.kind === 'expired') return { ok: false, error: 'مهلت اعتبار این حساب به پایان رسیده است. برای شارژ مجدد با پشتیبانی تماس بگیرید: 09163638297', known: true };
    if (st.kind === 'exhausted') return { ok: false, error: 'سقف تعداد باز شدن این حساب به اتمام رسیده است. برای شارژ مجدد با پشتیبانی تماس بگیرید: 09163638297', known: true };
    /* شمارش باز شدن + علامت‌گذاری نشست جاری تا رفرش صفحه دوباره شمرده نشود */
    if (st.license.useCount) {
      var lic = licenses();
      st.license.openCount = (st.license.openCount || 0) + 1;
      lic[u.id] = st.license;
      writeJSON(LS_LIC, lic);
      try { global.sessionStorage.setItem('nema.openCounted', u.id); } catch (e2) {}
    }
    return { ok: true, user: { id: u.id, username: u.username, fullName: u.fullName, role: u.role } };
  }

  /* ---------- بررسی مجوز هنگام باز شدن برنامه با نشست ذخیره‌شده ----------
     تا پیش از این نسخه، بررسی و شمارش محدودیت‌ها فقط هنگام ورود از فرم انجام می‌شد؛
     با «مرا به خاطر بسپار» برنامه بدون هیچ بررسی/شمارشی باز می‌شد و سقف تعدادی هرگز پر نمی‌شد.
     اکنون: هر باز شدن برنامه در نشست تازهٔ مرورگر یک بار شمرده می‌شود (رفرش همان نشست شمرده نمی‌شود)
     و با نخستین نقض (قفل/انقضا/اتمام سقف) نشست باطل و پیام نمایش داده می‌شود. */
  function sessionRestoreCheck(username) {
    var u = findByUsername(username);
    if (!u) return { ok: true };                       /* حساب اصلی/ناشناخته — بدون محدودیت */
    var st = licenseStatus(u.id);
    if (st.kind === 'locked')     return { ok: false, error: 'دسترسی این حساب توسط مدیر سامانه قفل شده است. با پشتیبانی تماس بگیرید: 09163638297' };
    if (st.kind === 'notstarted') return { ok: false, error: 'اعتبار این حساب هنوز شروع نشده است.' };
    if (st.kind === 'expired')    return { ok: false, error: 'مهلت اعتبار این حساب به پایان رسیده است. برای شارژ مجدد با پشتیبانی تماس بگیرید: 09163638297' };
    if (st.kind === 'exhausted')  return { ok: false, error: 'سقف تعداد باز شدن این حساب به اتمام رسیده است. برای شارژ مجدد با پشتیبانی تماس بگیرید: 09163638297' };
    if (st.license && st.license.useCount) {
      var ssFlag = 'nema.openCounted';
      var counted = false;
      try { counted = (global.sessionStorage.getItem(ssFlag) === u.id); } catch (e) {}
      if (!counted) {
        var lic = licenses();
        var l = lic[u.id] || st.license;
        l.openCount = (Number(l.openCount) || 0) + 1;
        lic[u.id] = l;
        writeJSON(LS_LIC, lic);
        try { global.sessionStorage.setItem(ssFlag, u.id); } catch (e2) {}
        if (l.openLimit && l.openCount >= l.openLimit) {
          return { ok: false, error: 'سقف تعداد باز شدن این حساب به اتمام رسیده است. برای شارژ مجدد با پشتیبانی تماس بگیرید: 09163638297' };
        }
      }
    }
    return { ok: true, user: { id: u.id, username: u.username, fullName: u.fullName, role: u.role } };
  }

  /* ---------- سلسله‌مراتب: اتصال زیرمجموعه به مدیر میانی ---------- */
  function links() {
    var v = readJSON(LS_LINKS, {});
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  }
  function linksOf(midId) {
    var l = links()[midId];
    return Array.isArray(l) ? l : [];
  }
  function setLinks(midId, ids) {
    var l = links();
    var arr = (ids || []).map(String).filter(function (x, i, a) { return a.indexOf(x) === i; });
    if (!arr.length) delete l[midId]; else l[midId] = arr;
    writeJSON(LS_LINKS, l);
    /* همگام‌سازی managerId کاربران متصل */
    var us = users();
    us.forEach(function (u) {
      if (u.role !== 'MID_ADMIN') {
        var inList = (l[midId] || []).indexOf(u.id) !== -1;
        if (inList) u.managerId = midId;
        else if (u.managerId === midId) u.managerId = null;
      }
    });
    saveUsers(us);
    return { ok: true };
  }
  function countsByMid() {
    var c = {}, l = links();
    Object.keys(l).forEach(function (mid) { c[mid] = (l[mid] || []).length; });
    return c;
  }

  /* ---------- داده‌های بارگذاری‌شده (ثبت خودکار از برنامه) ---------- */
  function datasets() {
    var v = readJSON(LS_DATA, []);
    return Array.isArray(v) ? v : [];
  }
  function addDataset(d) {
    var arr = datasets();
    arr.unshift({
      id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: String(d.name || 'بدون نام'),
      sheet: String(d.sheet || ''),
      rows: Number(d.rows) || 0,
      valid: Number(d.valid) || 0,
      invalid: Number(d.invalid) || 0,
      disease: String(d.disease || ''),
      ts: Date.now()
    });
    if (arr.length > MAX_DATASETS) arr = arr.slice(0, MAX_DATASETS);
    writeJSON(LS_DATA, arr);
    return { ok: true };
  }
  function removeDatasets(ids) {
    var set = {};
    (ids || []).forEach(function (x) { set[String(x)] = 1; });
    writeJSON(LS_DATA, datasets().filter(function (d) { return !set[d.id]; }));
    return { ok: true };
  }

  /* ---------- رکوردهای منابع انسانی (پرسنل پایگاه‌های بهداشت) ----------
     ساختار هر رکورد مطابق excel.js است:
     base, hh, center, caregiver, behvarz, observer, envExpert,
     occExpert, doctor, dentist, services, reception,
     popTotal, popUnder1, popUnder5, caregiverCount,
     lat, lng, ts (تاریخ ثبت), id, deleted
  */
  var LS_HR = 'nema.hr.v1';
  var MAX_HR = 5000;   /* سقف رکوردهای پرسنل */

  function hrRecords() {
    var v = readJSON(LS_HR, []);
    return Array.isArray(v) ? v : [];
  }
  function hrActive() {
    return hrRecords().filter(function (r) { return !r.deleted; });
  }
  function hrById(id) {
    var arr = hrRecords();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) return arr[i];
    }
    return null;
  }
  /* افزودن یا ویرایش یک رکورد پرسنل.
     اگر id موجود باشد → ویرایش؛ در غیر این صورت → افزودن جدید. */
  function saveHr(rec) {
    if (!rec) return { ok: false, error: 'رکورد خالی است' };
    var arr = hrRecords();
    var now = Date.now();
    var id = rec.id || ('hr' + now.toString(36) + Math.random().toString(36).slice(2, 6));
    if (rec.id) {
      var found = false;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === rec.id) {
          arr[i] = Object.assign({}, arr[i], rec, { ts: arr[i].ts || now, updatedAt: now });
          found = true;
          break;
        }
      }
      if (!found) return { ok: false, error: 'رکورد یافت نشد' };
    } else {
      arr.unshift({
        id: id,
        base: String(rec.base || ''),
        hh: String(rec.hh || ''),
        center: String(rec.center || ''),
        caregiver: String(rec.caregiver || ''),
        behvarz: String(rec.behvarz || ''),
        observer: String(rec.observer || ''),
        envExpert: String(rec.envExpert || ''),
        occExpert: String(rec.occExpert || ''),
        doctor: String(rec.doctor || ''),
        dentist: String(rec.dentist || ''),
        services: String(rec.services || ''),
        reception: String(rec.reception || ''),
        popTotal: Number(rec.popTotal) || 0,
        popUnder1: Number(rec.popUnder1) || 0,
        popUnder5: Number(rec.popUnder5) || 0,
        caregiverCount: Number(rec.caregiverCount) || 0,
        lat: rec.lat !== undefined ? rec.lat : null,
        lng: rec.lng !== undefined ? rec.lng : null,
        deleted: false,
        ts: now
      });
      if (arr.length > MAX_HR) arr = arr.slice(0, MAX_HR);
    }
    writeJSON(LS_HR, arr);
    return { ok: true, id: id };
  }
  /* حذف نرم (soft delete) — فقط پرچم deleted=true می‌گذارد */
  function deleteHr(id) {
    var arr = hrRecords();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) {
        arr[i].deleted = true;
        arr[i].updatedAt = Date.now();
        writeJSON(LS_HR, arr);
        return { ok: true };
      }
    }
    return { ok: false, error: 'رکورد یافت نشد' };
  }
  /* حذف گروهی (soft delete) */
  function deleteHrBulk(ids) {
    if (!Array.isArray(ids) || !ids.length) return { ok: false, error: 'هیچ آیدی داده نشده' };
    var set = {};
    ids.forEach(function (x) { set[String(x)] = 1; });
    var arr = hrRecords();
    var n = 0;
    var now = Date.now();
    arr.forEach(function (r) {
      if (set[r.id] && !r.deleted) { r.deleted = true; r.updatedAt = now; n++; }
    });
    writeJSON(LS_HR, arr);
    return { ok: true, count: n };
  }
  /* بازگرداندن رکورد حذف‌شده (undo) */
  function restoreHr(id) {
    var arr = hrRecords();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) {
        arr[i].deleted = false;
        arr[i].updatedAt = Date.now();
        writeJSON(LS_HR, arr);
        return { ok: true };
      }
    }
    return { ok: false, error: 'رکورد یافت نشد' };
  }
  /* حذف قطعی از حافظه (پاک‌سازی کامل) */
  function purgeHr(ids) {
    if (!Array.isArray(ids) || !ids.length) return { ok: false, error: 'هیچ آیدی داده نشده' };
    var set = {};
    ids.forEach(function (x) { set[String(x)] = 1; });
    var arr = hrRecords().filter(function (r) { return !set[r.id]; });
    writeJSON(LS_HR, arr);
    return { ok: true };
  }
  /* حذف قطعی همهٔ رکوردهای حذف‌شده (پاک‌سازی سطل بازیافت) */
  function emptyTrashHr() {
    var arr = hrRecords().filter(function (r) { return !r.deleted; });
    writeJSON(LS_HR, arr);
    return { ok: true };
  }
  /* آمار کوتاه برای چیپ‌های پنل */
  function hrStats() {
    var arr = hrRecords();
    var active = 0, deleted = 0, bases = {}, houses = {}, centers = {},
        popTotal = 0, popUnder5 = 0, caregiverCount = 0;
    arr.forEach(function (r) {
      if (r.deleted) { deleted++; return; }
      active++;
      if (r.base) bases[r.base] = 1;
      if (r.hh) houses[r.hh] = 1;
      if (r.center) centers[r.center] = 1;
      popTotal += Number(r.popTotal) || 0;
      popUnder5 += Number(r.popUnder5) || 0;
      caregiverCount += Number(r.caregiverCount) || 0;
    });
    return {
      total: active,
      deleted: deleted,
      centers: Object.keys(centers).length,
      bases: Object.keys(bases).length,
      houses: Object.keys(houses).length,
      popTotal: popTotal,
      popUnder5: popUnder5,
      caregiverCount: caregiverCount
    };
  }

  /* ---------- API عمومی ---------- */
  global.Registry = {
    ROLE_LABEL: ROLE_LABEL,
    users: users,
    findByUsername: findByUsername,
    addUser: addUser,
    updateUser: updateUser,
    removeUser: removeUser,
    licenseOf: licenseOf,
    setLicense: setLicense,
    setManualLock: setManualLock,
    licenseStatus: licenseStatus,
    verifyLogin: verifyLogin,
    sessionRestoreCheck: sessionRestoreCheck,
    linksOf: linksOf,
    setLinks: setLinks,
    countsByMid: countsByMid,
    datasets: datasets,
    addDataset: addDataset,
    removeDatasets: removeDatasets,
    /* API منابع انسانی */
    hrRecords: hrRecords,
    hrActive: hrActive,
    hrById: hrById,
    saveHr: saveHr,
    deleteHr: deleteHr,
    deleteHrBulk: deleteHrBulk,
    restoreHr: restoreHr,
    purgeHr: purgeHr,
    emptyTrashHr: emptyTrashHr,
    hrStats: hrStats
  };
})(window);

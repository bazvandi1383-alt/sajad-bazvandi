/* =========================================================
   cloud.js — پشتیبان‌گیری/بازیابی + همگام‌سازی ابری (Cloudflare Worker + D1)
   ─────────────────────────────────────────────────────────
   ۱) پشتیبان‌گیری کامل محلی: همهٔ داده‌های برنامه (کاربران، مجوزها،
      زیرمجموعه‌ها، داده‌ها، درخواست‌ها، نقاط اکسل و تنظیمات) در یک فایل
      JSON — و بازیابی همان فایل در هر مرورگر/دستگاه دیگر.
   ۲) همگام‌سازی ابری: یک Worker سبک روی Cloudflare (رایگان) با دیتابیس D1
      نقش «مرکز توزیع داده» دارد. دستگاه admin با کلید مدیر می‌نویسد و
      همهٔ دستگاه‌ها با کلید خواندن، وضعیت تازه را هنگام ورود می‌گیرند.
   راهنمای راه‌اندازی: «راهنمای_همگام‌سازی_ابری_Cloudflare.md»
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------- کلیدهای حافظه ---------- */
  var LS_CFG   = 'nema.cloud.cfg';      /* {base, readKey, adminKey} */
  var LS_VER   = 'nema.cloud.ver';      /* آخرین شمارهٔ نسخهٔ دیده‌شده از سرور */
  var LS_AT    = 'nema.cloud.at';       /* زمان آخرین همگام‌سازی */
  var LS_DIRTY = 'nema.cloud.dirty';    /* تغییرات محلیِ ارسال‌نشده */

  /* کلیدهایی که در پشتیبان کامل می‌آیند (به‌جز نشست/قفل که مخصوص دستگاه است) */
  var BACKUP_KEYS = [
    'nema.users.v1',
    'nema.licenses.v1',
    'nema.midlinks.v1',
    'nema.datasets.v1',
    'nema.support.tickets.v1',
    'nema.points.v1',
    'neshanExcelMap.settings',
    'neshanExcelMap.auth'
  ];

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function readJSON(k, dft) { try { var v = JSON.parse(lsGet(k) || 'null'); return (v === null || v === undefined) ? dft : v; } catch (e) { return dft; } }

  /* ---------- تنظیمات ابر ---------- */
  function cfg() { return readJSON(LS_CFG, null) || { base: '', readKey: '', adminKey: '' }; }
  function saveCfg(c) {
    lsSet(LS_CFG, JSON.stringify({
      base: String(c.base || '').trim().replace(/\/+$/, ''),
      readKey: String(c.readKey || '').trim(),
      adminKey: String(c.adminKey || '').trim()
    }));
  }
  function clearCfg() { lsDel(LS_CFG); lsDel(LS_VER); lsDel(LS_AT); lsDel(LS_DIRTY); }
  function enabled() { var c = cfg(); return !!(c.base && c.readKey); }

  /* ---------- نشانگر تغییرات ارسال‌نشده ---------- */
  function dirty() { return lsGet(LS_DIRTY) === '1'; }
  function markDirty() { lsSet(LS_DIRTY, '1'); }
  function markClean() { lsSet(LS_DIRTY, '0'); }

  function lastSync() {
    return {
      at: lsGet(LS_AT) || '',
      version: Number(lsGet(LS_VER) || 0) || 0,
      dirty: dirty()
    };
  }

  function _saveSeen(version) {
    lsSet(LS_VER, String(version || 0));
    lsSet(LS_AT, new Date().toISOString());
  }

  /* ---------- درخواست با مهلت زمانی ---------- */
  function _fetch(url, opts, timeoutMs) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 7000);
    var o = opts || {};
    if (ctrl) o.signal = ctrl.signal;
    return fetch(url, o).then(function (res) {
      clearTimeout(timer);
      return res;
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  /* =========================================================
     دریافت وضعیت از ابر
     ========================================================= */
  function pullState(opts) {
    opts = opts || {};
    var c = cfg();
    if (!c.base || !c.readKey) return Promise.resolve({ ok: false, error: 'not-configured' });
    return _fetch(c.base + '/state', {
      method: 'GET',
      headers: { 'X-Read-Key': c.readKey }
    }, opts.timeoutMs).then(function (res) {
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'کلید خواندن نامعتبر است.' };
      if (!res.ok) return { ok: false, error: 'خطای سرور (' + res.status + ')' };
      return res.json().then(function (j) {
        return { ok: true, version: j.version || 0, updatedAt: j.updatedAt || '', data: j.data || null };
      });
    }).catch(function () {
      return { ok: false, error: 'دسترسی به سرور برقرار نشد.' };
    });
  }

  /* نصب وضعیت دریافتی در حافظهٔ محلی — به‌صورت «ادغام» نه «جایگزینی» (ضد حذف ناخواسته):
     - کاربران: اجتماع بر اساس id — نسخهٔ سرور در تداخل برنده است، ولی کاربرانی که
       فقط روی همین دستگاه ساخته شده‌اند و هنوز به ابر نرفته‌اند حذف نمی‌شوند.
     - مجوزها: اجتماع بر اساس id کاربر — نسخه‌ای که updatedAt تازه‌تری دارد برنده است.
     - اتصال‌ها: اجتماع شناسه‌های هر مدیر میانی.
     - درخواست‌ها: ادغام بر اساس شناسه — نسخهٔ محلی (ویرایش admin) برنده است.
     version (اختیاری): شمارهٔ نسخهٔ سرور برای به‌روز شدن شمارندهٔ «نسخهٔ دیده‌شده»
     تا «ارسال به ابر» بعدی دچار تداخل 409 نشود. */
  function installState(data, version) {
    if (!data || typeof data !== 'object') return { ok: false };
    var out = { ok: true, users: 0, keptLocalUsers: 0, ticketsMerged: 0 };
    if (Array.isArray(data.users)) {
      var local = readJSON('nema.users.v1', []);
      if (!Array.isArray(local)) local = [];
      var byId = {}, byName = {};
      local.forEach(function (u) {
        if (u && u.id && !byId[u.id]) { byId[u.id] = u; if (u.username) byName[u.username] = u.id; }
      });
      var cloudIds = {};
      data.users.forEach(function (u) {
        if (!u || !u.id) return;
        cloudIds[u.id] = 1;
        var localU = byId[u.id];
        if (!localU && u.username && byName[u.username]) localU = byId[byName[u.username]];
        /* در تداخل، نسخهٔ سرور (منتشرشدهٔ مدیر) جایگزین می‌شود */
        byId[u.id] = u;
        if (u.username) byName[u.username] = u.id;
        if (!localU) out.users++;
      });
      Object.keys(byId).forEach(function (id) { if (!cloudIds[id]) out.keptLocalUsers++; });
      var mergedUsers = Object.keys(byId).map(function (k) { return byId[k]; });
      mergedUsers.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      lsSet('nema.users.v1', JSON.stringify(mergedUsers));
      out.users = mergedUsers.length;
    }
    if (data.licenses && typeof data.licenses === 'object') {
      var lic = readJSON('nema.licenses.v1', {});
      if (!lic || typeof lic !== 'object' || Array.isArray(lic)) lic = {};
      Object.keys(data.licenses).forEach(function (id) {
        var c = data.licenses[id];
        var l = lic[id];
        if (!l || !c) { lic[id] = c; return; }   /* رفتار قبلی: ایجاد/حذف */
        if ((c.updatedAt || 0) >= (l.updatedAt || 0)) {
          /* شمارندهٔ باز شدن: بزرگ‌ترین مقدار محلی/ابری بماند
             تا «دریافت از ابر» شمارندهٔ کاربر را صفر نکند (رفع باگ سقف تعدادی) */
          var oc = Math.max(Number(c.openCount) || 0, Number(l.openCount) || 0);
          lic[id] = Object.assign({}, c, { openCount: oc });
        }
      });
      lsSet('nema.licenses.v1', JSON.stringify(lic));
    }
    if (data.midlinks && typeof data.midlinks === 'object') {
      var links = readJSON('nema.midlinks.v1', {});
      if (!links || typeof links !== 'object' || Array.isArray(links)) links = {};
      Object.keys(data.midlinks).forEach(function (mid) {
        var c = Array.isArray(data.midlinks[mid]) ? data.midlinks[mid] : [];
        var l = Array.isArray(links[mid]) ? links[mid] : [];
        var all = c.concat(l.filter(function (x) { return c.indexOf(x) === -1; }));
        if (all.length) links[mid] = all; else delete links[mid];
      });
      lsSet('nema.midlinks.v1', JSON.stringify(links));
    }
    /* درخواست‌ها: ادغام بر اساس شناسه — نسخهٔ محلی (ویرایش admin) برنده است */
    if (Array.isArray(data.tickets)) {
      var loc = readJSON('nema.support.tickets.v1', []);
      if (!Array.isArray(loc)) loc = [];
      var tById = {};
      loc.forEach(function (t) { if (t && t.id) tById[t.id] = t; });
      data.tickets.forEach(function (t) { if (t && t.id && !tById[t.id]) { tById[t.id] = t; out.ticketsMerged++; } });
      var mergedT = Object.keys(tById).map(function (k) { return tById[k]; });
      mergedT.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
      lsSet('nema.support.tickets.v1', JSON.stringify(mergedT));
    }
    if (version != null) _saveSeen(version);
    markClean();
    return out;
  }

  /* =========================================================
     ارسال خودکار پس از تغییرات مدیریتی (فاصلهٔ ۱٫۲ ثانیه‌ای)
     تا هیچ تغییری «فقط محلی» نماند و با رفرش/دریافت از ابر از بین نرود.
     بی‌صدا است؛ فقط اگر تداخل نسخه باشد پیام در پنل ظاهر می‌شود.
     ========================================================= */
  var _pushTimer = null;
  function autoPush() {
    if (!enabled()) return;
    var c = cfg();
    if (!c.adminKey) return;               /* فقط دستگاه مدیر می‌نویسد */
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(function () {
      _pushTimer = null;
      pushState(false).then(function (r) {
        var h = (global.NemaCloud && global.NemaCloud._autoPushHandler);
        if (typeof h === 'function') { try { h(r); } catch (e) {} }
      });
    }, 1200);
  }

  /* =========================================================
     ارسال وضعیت محلی به ابر (نیازمند کلید مدیر)
     ========================================================= */
  function collectState() {
    return {
      users: readJSON('nema.users.v1', []),
      licenses: readJSON('nema.licenses.v1', {}),
      midlinks: readJSON('nema.midlinks.v1', {}),
      datasets: readJSON('nema.datasets.v1', []),
      tickets: readJSON('nema.support.tickets.v1', [])
    };
  }

  function pushState(force) {
    var c = cfg();
    if (!c.base || !c.adminKey) return Promise.resolve({ ok: false, error: 'تنظیمات ابر یا کلید مدیر کامل نیست.' });
    return _fetch(c.base + '/state', {
      method: 'PUT',
      headers: { 'X-Admin-Key': c.adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: collectState(),
        version: Number(lsGet(LS_VER) || 0) || null,
        force: !!force
      })
    }, 15000).then(function (res) {
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'کلید مدیر نامعتبر است.' };
      if (res.status === 409) {
        return res.json().then(function (j) {
          return { ok: false, conflict: true, currentVersion: (j && j.currentVersion) || 0, error: 'نسخهٔ سرور تازه‌تر است.' };
        });
      }
      if (!res.ok) return { ok: false, error: 'خطای سرور (' + res.status + ')' };
      return res.json().then(function (j) {
        _saveSeen(j.version || 0);
        markClean();
        return { ok: true, version: j.version || 0 };
      });
    }).catch(function () {
      return { ok: false, error: 'دسترسی به سرور برقرار نشد.' };
    });
  }

  /* ارسال یک درخواست پشتیبانی به ابر (با کلید خواندن — برای همهٔ کاربران) */
  function postTicket(ticket) {
    var c = cfg();
    if (!c.base || !c.readKey) return Promise.resolve({ ok: false, error: 'not-configured' });
    return _fetch(c.base + '/ticket', {
      method: 'POST',
      headers: { 'X-Read-Key': c.readKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: ticket })
    }, 8000).then(function (res) {
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'کلید خواندن نامعتبر است.' };
      if (!res.ok) return { ok: false, error: 'خطای سرور (' + res.status + ')' };
      return res.json().then(function (j) { return { ok: true, version: j.version || 0 }; });
    }).catch(function () {
      return { ok: false, error: 'ارسال به سرور ممکن نشد.' };
    });
  }

  /* =========================================================
     پشتیبان‌گیری کامل محلی (بدون نیاز به اینترنت/سرور)
     ========================================================= */
  function exportBackup() {
    var data = {};
    var counts = {};
    BACKUP_KEYS.forEach(function (k) {
      var raw = lsGet(k);
      if (raw === null) { data[k] = null; return; }
      try { data[k] = JSON.parse(raw); counts[k] = Array.isArray(data[k]) ? data[k].length : 'ok'; }
      catch (e) { data[k] = raw; }
    });
    var payload = {
      app: 'neshan-epi-map',
      kind: 'full-backup',
      backupVersion: 1,
      exportedAt: new Date().toISOString(),
      data: data
    };
    var blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    var d = new Date();
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    a.download = 'neshan-backup-' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
                 '_' + p2(d.getHours()) + '-' + p2(d.getMinutes()) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    lsSet('nema.cloud.lastbackup', new Date().toISOString());
    return { ok: true, keys: counts };
  }

  function lastBackupAt() { return lsGet('nema.cloud.lastbackup') || ''; }

  /* بازیابی از فایل پشتیبان — کلیدهای ناشناس نادیده گرفته می‌شوند */
  function importBackup(file) {
    return new Promise(function (resolve) {
      if (!file) { resolve({ ok: false, error: 'فایلی انتخاب نشده است.' }); return; }
      var fr = new FileReader();
      fr.onerror = function () { resolve({ ok: false, error: 'خواندن فایل ناموفق بود.' }); };
      fr.onload = function () {
        var j = null;
        try { j = JSON.parse(String(fr.result)); } catch (e) { resolve({ ok: false, error: 'فایل پشتیبان معتبر نیست (JSON نامعتبر).' }); return; }
        if (!j || j.kind !== 'full-backup' || !j.data || typeof j.data !== 'object') {
          resolve({ ok: false, error: 'این فایل پشتیبانِ این برنامه نیست.' });
          return;
        }
        var applied = 0, skipped = 0;
        BACKUP_KEYS.forEach(function (k) {
          if (!(k in j.data)) { skipped++; return; }
          var v = j.data[k];
          if (v === null || v === undefined) { lsDel(k); applied++; return; }
          try { lsSet(k, JSON.stringify(v)); applied++; } catch (e) { skipped++; }
        });
        resolve({
          ok: true,
          applied: applied,
          skipped: skipped,
          exportedAt: j.exportedAt || '',
          summary: {
            users: Array.isArray(j.data['nema.users.v1']) ? j.data['nema.users.v1'].length : 0,
            tickets: Array.isArray(j.data['nema.support.tickets.v1']) ? j.data['nema.support.tickets.v1'].length : 0,
            datasets: Array.isArray(j.data['nema.datasets.v1']) ? j.data['nema.datasets.v1'].length : 0,
            points: Array.isArray(j.data['nema.points.v1']) ? j.data['nema.points.v1'].length : 0
          }
        });
      };
      fr.readAsText(file);
    });
  }

  /* ---------- API عمومی ---------- */
  global.NemaCloud = {
    cfg: cfg,
    saveCfg: saveCfg,
    clearCfg: clearCfg,
    enabled: enabled,
    dirty: dirty,
    markDirty: markDirty,
    markClean: markClean,
    lastSync: lastSync,
    lastBackupAt: lastBackupAt,
    pullState: pullState,
    installState: installState,
    pushState: pushState,
    autoPush: autoPush,
    postTicket: postTicket,
    exportBackup: exportBackup,
    importBackup: importBackup,
    BACKUP_KEYS: BACKUP_KEYS
  };

})(window);

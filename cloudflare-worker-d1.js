/* =========================================================
   nema-cloud-worker — Worker سبک همگام‌سازی ابری سامانه منابع انسانی
   (Cloudflare Workers + D1 — پلن رایگان)
   ─────────────────────────────────────────────────────────
   راه‌اندازی کامل با جزئیات گام‌به‌گام:
   فایل «راهنمای_همگام‌سازی_ابری_Cloudflare.md» را ببینید.

   خلاصهٔ راه‌اندازی:
   ۱) داشبورد Cloudflare → Storage & Databases → D1 → Create → نام: nema-db
      (اجرای دستور SQL لازم نیست — این Worker جدول را خودش و در اولین استفاده می‌سازد)
   ۲) Workers & Pages → Create Worker → نام: nema-api → Deploy → Edit code
      → تمام کد این فایل را جای کد پیش‌فرض بگذارید → Deploy
   ۳) Settings → Bindings → دو متغیر و یک اتصال اضافه کنید:
        • Variable  ADMIN_KEY  = یک عبارت طولانی تصادفی (کلید نوشتن — فقط نزد خودتان)
        • Variable  READ_KEY   = عبارت تصادفی دیگر (کد اشتراک — به کاربران می‌دهید)
        • D1 Binding  نام: DB   دیتابیس: nema-db
   ۴) نشانی Worker را در «پنل مدیریت ← ابر و پشتیبان» برنامه وارد و کلیدها را ذخیره کنید.

   نکته برای ایران: چون دامنهٔ workers.dev ممکن است فیلتر باشد، در همان
   Settings → Domains & Routes یک زیردامنهٔ دامنهٔ اختصاصی خودتان
   (مثلاً api.your-domain.ir) به این Worker وصل کنید.
   ========================================================= */

/* ---------- پاسخ‌های CORS ---------- */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Read-Key, X-Admin-Key',
  'Access-Control-Max-Age': '86400',
};
function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS),
  });
}

/* ---------- ساخت خودکار جدول در اولین استفاده (بدون نیاز به SQL دستی) ---------- */
let _schemaP = null;
function ensureSchema(env) {
  if (!_schemaP) {
    _schemaP = env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS state (' +
      'id INTEGER PRIMARY KEY CHECK (id = 1), ' +
      'version INTEGER NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL)'
    ).run().catch(function (e) { _schemaP = null; throw e; });
  }
  return _schemaP;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    /* سلامت سرور */
    if (path === '/health') return json({ ok: true, service: 'nema-cloud' });

    /* ---------- GET /state — دریافت وضعیت (کلید خواندن) ---------- */
    if (path === '/state' && request.method === 'GET') {
      await ensureSchema(env);
      const readKey = request.headers.get('X-Read-Key') || url.searchParams.get('code') || '';
      if (!env.READ_KEY || readKey !== env.READ_KEY) return json({ error: 'unauthorized' }, 401);
      const row = await env.DB.prepare('SELECT version, updated_at, data FROM state WHERE id = 1').first();
      if (!row) return json({ ok: true, version: 0, updatedAt: '', data: null });
      let data = null;
      try { data = JSON.parse(row.data); } catch (e) { data = null; }
      return json({ ok: true, version: row.version, updatedAt: row.updated_at, data });
    }

    /* ---------- POST /ticket — افزودن یک درخواست پشتیبانی (کلید خواندن) ---------- */
    if (path === '/ticket' && request.method === 'POST') {
      await ensureSchema(env);
      const readKey = request.headers.get('X-Read-Key') || '';
      if (!env.READ_KEY || readKey !== env.READ_KEY) return json({ error: 'unauthorized' }, 401);
      let body = null;
      try { body = await request.json(); } catch (e) { return json({ error: 'bad-json' }, 400); }
      const t = body && body.ticket;
      if (!t || typeof t !== 'object' || !t.id) return json({ error: 'bad-ticket' }, 400);
      /* سقف امن: حداکثر ۵۰۰ درخواست — قدیمی‌ها حذف می‌شوند */
      const row = await env.DB.prepare('SELECT version, updated_at, data FROM state WHERE id = 1').first();
      let data = {};
      let version = 0;
      if (row) { try { data = JSON.parse(row.data) || {}; } catch (e) { data = {}; } version = row.version; }
      if (!Array.isArray(data.tickets)) data.tickets = [];
      data.tickets.push(t);
      if (data.tickets.length > 500) data.tickets = data.tickets.slice(-500);
      const updatedAt = new Date().toISOString();
      const newVersion = version + 1;
      await env.DB.prepare(
        'INSERT INTO state (id, version, updated_at, data) VALUES (1, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at, data = excluded.data'
      ).bind(newVersion, updatedAt, JSON.stringify(data)).run();
      return json({ ok: true, version: newVersion });
    }

    /* ---------- PUT /state — نوشتن کامل وضعیت (کلید مدیر) ---------- */
    if (path === '/state' && request.method === 'PUT') {
      await ensureSchema(env);
      const adminKey = request.headers.get('X-Admin-Key') || '';
      if (!env.ADMIN_KEY || adminKey !== env.ADMIN_KEY) return json({ error: 'unauthorized' }, 401);
      let body = null;
      try { body = await request.json(); } catch (e) { return json({ error: 'bad-json' }, 400); }
      if (!body || !body.data || typeof body.data !== 'object') return json({ error: 'bad-data' }, 400);
      const row = await env.DB.prepare('SELECT version FROM state WHERE id = 1').first();
      const serverVersion = row ? row.version : 0;
      /* کنترل نسخه: اگر سرور تازه‌تر باشد و «ارسال اجباری» زده نشده باشد → 409 */
      if (row && !body.force && body.version != null && Number(body.version) !== serverVersion) {
        return json({ error: 'conflict', currentVersion: serverVersion }, 409);
      }
      const updatedAt = new Date().toISOString();
      const newVersion = serverVersion + 1;
      await env.DB.prepare(
        'INSERT INTO state (id, version, updated_at, data) VALUES (1, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at, data = excluded.data'
      ).bind(newVersion, updatedAt, JSON.stringify(body.data)).run();
      return json({ ok: true, version: newVersion });
    }

    return json({ error: 'not-found' }, 404);
  },
};

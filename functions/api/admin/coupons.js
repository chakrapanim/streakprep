import { checkAdminAuth, adminUnauth } from '../../_lib/admin-auth.js';
import { json } from '../../_lib/db.js';

// GET   /api/admin/coupons          list all coupons, newest first
// POST  /api/admin/coupons          body: { code, discountType: 'percent'|'flat', discountValue, maxRedemptions?, expiresInDays? }
// PATCH /api/admin/coupons          body: { id, isActive } — toggle active/inactive (redemption history kept)
export async function onRequestGet({ request, env }) {
  const auth = await checkAdminAuth(request, env);
  if (!auth.ok) return adminUnauth(auth.error);

  const db   = env.streakprep_db;
  const rows = await db.prepare(
    'SELECT * FROM coupons ORDER BY created_at DESC LIMIT 200'
  ).all();

  return json({ coupons: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  const auth = await checkAdminAuth(request, env);
  if (!auth.ok) return adminUnauth(auth.error);

  const db = env.streakprep_db;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const code           = (body.code || '').trim().toUpperCase();
  const discountType   = body.discountType;
  const maxRedemptions = body.maxRedemptions ? parseInt(body.maxRedemptions) : null;
  const expiresInDays  = body.expiresInDays ? parseInt(body.expiresInDays) : null;

  if (!/^[A-Z0-9]{3,20}$/.test(code)) return json({ error: 'invalid_code' }, 400);
  if (!['percent', 'flat'].includes(discountType)) return json({ error: 'invalid_discount_type' }, 400);

  // Admin enters rupees for a flat discount; stored as paise (matches amount_paise elsewhere).
  const rawValue      = parseInt(body.discountValue);
  const discountValue = discountType === 'flat' ? rawValue * 100 : rawValue;
  if (!Number.isFinite(discountValue) || discountValue <= 0) return json({ error: 'invalid_discount_value' }, 400);
  if (discountType === 'percent' && discountValue > 100) return json({ error: 'invalid_discount_value' }, 400);

  const now       = Math.floor(Date.now() / 1000);
  const expiresAt = expiresInDays ? now + expiresInDays * 24 * 60 * 60 : null;

  try {
    await db.prepare(`
      INSERT INTO coupons (code, discount_type, discount_value, max_redemptions, expires_at, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).bind(code, discountType, discountValue, maxRedemptions, expiresAt, now).run();
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) return json({ error: 'code_already_exists' }, 409);
    throw e;
  }

  return json({ ok: true });
}

export async function onRequestPatch({ request, env }) {
  const auth = await checkAdminAuth(request, env);
  if (!auth.ok) return adminUnauth(auth.error);

  const db = env.streakprep_db;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const id       = parseInt(body.id);
  const isActive = !!body.isActive;
  if (!id) return json({ error: 'id_required' }, 400);

  await db.prepare('UPDATE coupons SET is_active = ? WHERE id = ?').bind(isActive ? 1 : 0, id).run();
  return json({ ok: true });
}

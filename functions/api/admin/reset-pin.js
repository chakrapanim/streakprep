import { checkAdminAuth, adminUnauth } from '../../_lib/admin-auth.js';
import { json, normalisePhone } from '../../_lib/db.js';
import { hashPin, randomHex, randomOtp } from '../../_lib/crypto.js';

// Admin manual PIN reset. Identify the account by parentId or phone.
// If newPin is supplied it's used; otherwise a random 4-digit temp PIN is generated
// and returned in the response for the admin to relay to the user.
export async function onRequestPost({ request, env }) {
  const auth = checkAdminAuth(request, env);
  if (!auth.ok) return adminUnauth(auth.error);

  const db = env.streakprep_db;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const parentId = body.parentId ? parseInt(body.parentId) : null;
  const phone    = body.phone ? normalisePhone(String(body.phone).trim()) : null;
  let   newPin   = (body.newPin || '').trim();

  if (!parentId && !phone) return json({ error: 'parentId_or_phone_required' }, 400);
  if (newPin && !/^\d{4}$/.test(newPin)) return json({ error: 'invalid_pin_format' }, 400);

  const parent = parentId
    ? await db.prepare('SELECT id, phone FROM parents WHERE id = ? AND is_active = 1').bind(parentId).first()
    : await db.prepare('SELECT id, phone FROM parents WHERE phone = ? AND is_active = 1').bind(phone).first();
  if (!parent) return json({ error: 'not_found' }, 404);

  // Generate a temp PIN if none supplied.
  const generated = !newPin;
  if (generated) newPin = randomOtp(); // random 4-digit

  const salt = randomHex(16);
  const hash = await hashPin(newPin, salt);
  await db.prepare(
    'UPDATE parents SET password_hash = ?, password_salt = ? WHERE id = ?'
  ).bind(hash, salt, parent.id).run();

  return json({
    ok: true,
    parentId: parent.id,
    phone: parent.phone,
    // Only returned so the admin can relay it; the user should change it after logging in.
    tempPin: generated ? newPin : undefined,
  });
}

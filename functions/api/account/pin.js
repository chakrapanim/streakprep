import { getSession } from '../../_lib/auth.js';
import { json } from '../../_lib/db.js';
import { hashPin, verifyPin, randomHex } from '../../_lib/crypto.js';

export async function onRequestPatch({ request, env }) {
  const db      = env.streakprep_db;
  const session = await getSession(request, db);
  if (!session) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const { currentPin, newPin } = body;
  if (!/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin)) {
    return json({ error: 'invalid_pin_format' }, 400);
  }
  if (currentPin === newPin) {
    return json({ error: 'same_pin' }, 400);
  }

  const parent = await db.prepare(
    'SELECT id, password_hash, password_salt FROM parents WHERE id = ? AND is_active = 1'
  ).bind(session.parent_id).first();
  if (!parent) return json({ error: 'not_found' }, 404);

  if (!parent.password_hash || !parent.password_salt) {
    return json({ error: 'no_pin_set' }, 400);
  }

  const valid = await verifyPin(currentPin, parent.password_salt, parent.password_hash);
  if (!valid) return json({ error: 'pin_incorrect' }, 401);

  const newSalt = randomHex(16);
  const newHash = await hashPin(newPin, newSalt);

  await db.prepare(
    'UPDATE parents SET password_hash = ?, password_salt = ? WHERE id = ?'
  ).bind(newHash, newSalt, parent.id).run();

  return json({ ok: true });
}

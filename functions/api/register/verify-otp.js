import { normalisePhone, json } from '../../_lib/db.js';
import { verifyOtp } from '../../_lib/otp.js';

export async function onRequestPost({ request, env }) {
  const db = env.streakprep_db;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const phone = normalisePhone((body.phone || '').trim());
  const otp   = (body.otp || '').trim();

  if (!phone) return json({ error: 'phone_required' }, 400);
  if (!otp || otp.length !== 6) return json({ error: 'otp_invalid' }, 400);

  const valid = await verifyOtp(db, phone, otp);
  if (!valid) return json({ error: 'otp_incorrect' }, 400);

  return json({ ok: true });
}

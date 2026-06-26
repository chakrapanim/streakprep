import { normalisePhone, json } from '../../../_lib/db.js';
import { checkRateLimit, createAndSendOtp } from '../../../_lib/otp.js';

// Forgot-PIN step 1: send an OTP (WhatsApp primary, SMS fallback) to a registered number.
export async function onRequestPost({ request, env }) {
  const db = env.streakprep_db;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const phone = normalisePhone((body.phone || '').trim());
  if (!phone) return json({ error: 'phone_required' }, 400);

  // Only send to a real, active account (mirrors login/init's behaviour).
  const parent = await db.prepare(
    'SELECT id FROM parents WHERE phone = ? AND is_active = 1'
  ).bind(phone).first();
  if (!parent) return json({ error: 'not_registered' }, 404);

  const limit = await checkRateLimit(db, phone);
  if (!limit.allowed) return json({ error: limit.reason, retryAfter: limit.retryAfter }, 429);

  const { otp, channel } = await createAndSendOtp(db, phone, env);

  const res = { ok: true, channel };
  if (channel === 'dev') res._devOtp = otp;
  return json(res);
}

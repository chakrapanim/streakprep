import { normalisePhone, json } from '../../_lib/db.js';
import { checkRateLimit, createAndSendOtp } from '../../_lib/otp.js';
import { clientIp } from '../../_lib/rate-limit.js';

export async function onRequestPost({ request, env }) {
  const db = env.streakprep_db;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const rawPhone = (body.phone || '').trim();
  if (!rawPhone) return json({ error: 'phone_required' }, 400);

  const phone = normalisePhone(rawPhone);

  // Check not already registered
  const existing = await db.prepare('SELECT id FROM parents WHERE phone = ?').bind(phone).first();
  if (existing) return json({ error: 'already_registered' }, 409);

  // Rate limit
  const limit = await checkRateLimit(db, phone, clientIp(request));
  if (!limit.allowed) return json({ error: limit.reason, retryAfter: limit.retryAfter }, 429);

  // Send OTP
  const { otp, channel } = await createAndSendOtp(db, phone, env);

  const res = { ok: true, channel };
  // In dev (no channel configured), return OTP so it can be tested
  if (channel === 'dev') res._devOtp = otp;
  return json(res);
}

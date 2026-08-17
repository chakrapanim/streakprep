import { normalisePhone, json } from '../../_lib/db.js';
import { checkRateLimit, createAndSendOtp } from '../../_lib/otp.js';

export async function onRequestPost({ request, env }) {
  const db = env.streakprep_db;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const phone       = normalisePhone((body.phone || '').trim());
  const deviceToken = (body.deviceToken || '').trim();

  if (!phone) return json({ error: 'phone_required' }, 400);

  // Check parent exists
  const parent = await db.prepare('SELECT id FROM parents WHERE phone = ?').bind(phone).first();
  if (!parent) return json({ error: 'not_registered' }, 404);

  // Reviewer bypass (e.g. a payment-gateway reviewer who can't receive a
  // WhatsApp OTP on their own device) — scoped to explicit whitelisted
  // phone numbers only, see verify.js's isReviewerBypass for the matching check.
  const bypassPhones = (env.REVIEWER_BYPASS_PHONES || '').split(',').map(p => p.trim());
  if (bypassPhones.includes(phone)) return json({ method: 'pin' });

  // Check trusted device
  if (deviceToken) {
    const now    = Math.floor(Date.now() / 1000);
    const device = await db.prepare(
      'SELECT id FROM trusted_devices WHERE token = ? AND parent_id = ? AND expires_at > ?'
    ).bind(deviceToken, parent.id, now).first();

    if (device) {
      // Refresh last seen
      await db.prepare('UPDATE trusted_devices SET expires_at = expires_at WHERE id = ?').bind(device.id).run();
      return json({ method: 'pin' }); // skip OTP — just ask for PIN
    }
  }

  // Not trusted — send OTP
  const limit = await checkRateLimit(db, phone);
  if (!limit.allowed) return json({ error: limit.reason, retryAfter: limit.retryAfter }, 429);

  const { otp, channel } = await createAndSendOtp(db, phone, env);

  const res = { method: 'otp', channel };
  if (channel === 'dev') res._devOtp = otp;
  return json(res);
}

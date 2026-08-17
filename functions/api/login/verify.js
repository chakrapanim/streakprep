import { normalisePhone, json } from '../../_lib/db.js';
import { verifyOtp } from '../../_lib/otp.js';
import { verifyPin, randomHex } from '../../_lib/crypto.js';

export async function onRequestPost({ request, env }) {
  const db = env.streakprep_db;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const phone       = normalisePhone((body.phone || '').trim());
  const pin         = (body.pin || '').trim();
  const otp         = (body.otp || '').trim();
  const deviceToken = (body.deviceToken || '').trim();
  const trustDevice = !!body.trustDevice;
  const method      = body.method; // 'otp' | 'pin'

  if (!phone) return json({ error: 'phone_required' }, 400);
  if (!pin || !/^\d{4}$/.test(pin)) return json({ error: 'pin_required' }, 400);

  const parent = await db.prepare(
    'SELECT id, password_hash, password_salt FROM parents WHERE phone = ? AND is_active = 1'
  ).bind(phone).first();
  if (!parent) return json({ error: 'not_registered' }, 404);

  const now = Math.floor(Date.now() / 1000);

  // ── Verify identity ──
  if (method === 'pin' && deviceToken) {
    // Trusted device — verify token still valid
    const device = await db.prepare(
      'SELECT id FROM trusted_devices WHERE token = ? AND parent_id = ? AND expires_at > ?'
    ).bind(deviceToken, parent.id, now).first();
    if (!device) return json({ error: 'device_expired' }, 401);
  } else if (method === 'otp' && otp) {
    // New/untrusted device — WhatsApp OTP + PIN required together.
    if (otp.length !== 4) return json({ error: 'otp_invalid' }, 400);
    const otpOk = await verifyOtp(db, phone, otp);
    if (!otpOk) return json({ error: 'otp_incorrect' }, 401);
  } else if (method === 'pin' && !deviceToken && isReviewerBypass(env, phone)) {
    // PIN-only bypass, scoped to explicitly whitelisted phone numbers only
    // (REVIEWER_BYPASS_PHONES) — e.g. for a payment-gateway reviewer who
    // can't receive a WhatsApp OTP on their own device. NOT a general
    // fallback: any other phone hitting this combination is rejected below,
    // since without that restriction this branch would let anyone bypass
    // OTP entirely on an untrusted device via a direct API call (no
    // rate-limit on PIN guesses here — only 10,000 possible 4-digit PINs).
  } else {
    return json({ error: 'method_required' }, 400);
  }

  // ── Verify PIN ──
  const pinOk = await verifyPin(pin, parent.password_salt, parent.password_hash);
  if (!pinOk) return json({ error: 'pin_incorrect' }, 401);

  // ── Create session ──
  const firstStudent = await db.prepare(
    'SELECT id FROM students WHERE parent_id = ? AND is_active = 1 ORDER BY id LIMIT 1'
  ).bind(parent.id).first();

  const sessionToken  = randomHex(32);
  const sessionExpiry = now + 30 * 24 * 60 * 60;

  await db.prepare(
    'INSERT INTO sessions (id, parent_id, active_student_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(sessionToken, parent.id, firstStudent?.id ?? null, sessionExpiry, now).run();

  // ── Trusted device ──
  let newDeviceToken = deviceToken || null;
  if (trustDevice && !deviceToken) {
    const settingRow   = await db.prepare('SELECT value FROM settings WHERE key = ?').bind('trusted_device_days').first();
    const trustedDays  = parseInt(settingRow?.value ?? 90);
    newDeviceToken     = randomHex(32);
    const deviceExpiry = now + trustedDays * 24 * 60 * 60;
    const userAgent    = request.headers.get('User-Agent') || '';
    await db.prepare(
      'INSERT INTO trusted_devices (parent_id, token, user_agent, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(parent.id, newDeviceToken, userAgent, deviceExpiry, now).run();
  }

  return json({ ok: true, sessionToken, deviceToken: newDeviceToken });
}

function isReviewerBypass(env, phone) {
  return (env.REVIEWER_BYPASS_PHONES || '').split(',').map(p => p.trim()).includes(phone);
}

import { normalisePhone, json } from '../../../_lib/db.js';
import { verifyOtp } from '../../../_lib/otp.js';
import { hashPin, randomHex } from '../../../_lib/crypto.js';

// Forgot-PIN step 2: verify the OTP, set a new PIN, and log the user in.
export async function onRequestPost({ request, env }) {
  const db = env.streakprep_db;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const phone  = normalisePhone((body.phone || '').trim());
  const otp    = (body.otp || '').trim();
  const newPin = (body.newPin || '').trim();
  const trustDevice = !!body.trustDevice;

  if (!phone)                    return json({ error: 'phone_required' }, 400);
  if (!/^\d{4}$/.test(newPin))   return json({ error: 'invalid_pin_format' }, 400);
  if (!/^\d{6}$/.test(otp))      return json({ error: 'otp_invalid' }, 400);

  const parent = await db.prepare(
    'SELECT id FROM parents WHERE phone = ? AND is_active = 1'
  ).bind(phone).first();
  if (!parent) return json({ error: 'not_registered' }, 404);

  const otpOk = await verifyOtp(db, phone, otp);
  if (!otpOk) return json({ error: 'otp_incorrect' }, 401);

  // Set the new PIN.
  const salt = randomHex(16);
  const hash = await hashPin(newPin, salt);
  await db.prepare(
    'UPDATE parents SET password_hash = ?, password_salt = ? WHERE id = ?'
  ).bind(hash, salt, parent.id).run();

  // Log them in (so a reset lands them straight in the app).
  const now           = Math.floor(Date.now() / 1000);
  const firstStudent  = await db.prepare(
    'SELECT id FROM students WHERE parent_id = ? AND is_active = 1 ORDER BY id LIMIT 1'
  ).bind(parent.id).first();

  const sessionToken  = randomHex(32);
  const sessionExpiry = now + 30 * 24 * 60 * 60;
  await db.prepare(
    'INSERT INTO sessions (id, parent_id, active_student_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(sessionToken, parent.id, firstStudent?.id ?? null, sessionExpiry, now).run();

  let deviceToken = null;
  if (trustDevice) {
    const settingRow  = await db.prepare('SELECT value FROM settings WHERE key = ?').bind('trusted_device_days').first();
    const trustedDays = parseInt(settingRow?.value ?? 90);
    deviceToken       = randomHex(32);
    const deviceExpiry = now + trustedDays * 24 * 60 * 60;
    const userAgent    = request.headers.get('User-Agent') || '';
    await db.prepare(
      'INSERT INTO trusted_devices (parent_id, token, user_agent, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(parent.id, deviceToken, userAgent, deviceExpiry, now).run();
  }

  return json({ ok: true, sessionToken, deviceToken });
}

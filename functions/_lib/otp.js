import { getSetting } from './db.js';
import { randomOtp, hashOtp } from './crypto.js';

export async function checkRateLimit(db, phone) {
  // Lenient by design: students legitimately log in several times a day. PIN / trusted-device
  // logins don't send an OTP and never reach here — this only throttles OTP sends.
  const maxPerHour      = parseInt(await getSetting(db, 'otp_max_per_hour', '20'));
  const cooldownSeconds = parseInt(await getSetting(db, 'otp_cooldown_seconds', '30'));
  const now             = Math.floor(Date.now() / 1000);
  const hourAgo         = now - 3600;

  const [recent, lastRequest] = await Promise.all([
    db.prepare('SELECT COUNT(*) as n, MIN(created_at) as oldest FROM otp_requests WHERE phone = ? AND created_at > ?')
      .bind(phone, hourAgo).first(),
    db.prepare('SELECT created_at FROM otp_requests WHERE phone = ? ORDER BY created_at DESC LIMIT 1')
      .bind(phone).first(),
  ]);

  if (recent.n >= maxPerHour) {
    // Wait only until the oldest request in the window ages out and frees a slot,
    // not a flat hour. Floor at the cooldown so retryAfter is always sensible.
    const retryAfter = Math.max(cooldownSeconds, (recent.oldest + 3600) - now);
    return { allowed: false, reason: 'rate_limit', retryAfter };
  }
  if (lastRequest && now - lastRequest.created_at < cooldownSeconds) {
    return { allowed: false, reason: 'cooldown', retryAfter: cooldownSeconds - (now - lastRequest.created_at) };
  }
  return { allowed: true };
}

// True once at least one delivery channel (WhatsApp or SMS) is configured.
// Until then we're in dev mode: OTPs are logged, not sent, and OTP enforcement
// is skipped so local/pre-launch flows aren't blocked.
export function otpConfigured(env) {
  return !!(whatsappConfigured(env) || env.MSG91_API_KEY);
}

function whatsappConfigured(env) {
  return !!(env.MSG91_WA_AUTHKEY && env.MSG91_WA_INTEGRATED_NUMBER && env.MSG91_WA_TEMPLATE_NAME);
}

// Creates an OTP, stores its hash, and sends it. Returns { otp, channel }.
// channel is 'whatsapp' | 'sms' | 'dev'. The raw otp is only meant to reach the
// client in dev mode (channel === 'dev').
export async function createAndSendOtp(db, phone, env) {
  const expirySeconds = parseInt(await getSetting(db, 'otp_expiry_seconds', '600'));
  const now           = Math.floor(Date.now() / 1000);
  const otp           = randomOtp();
  const otpHash       = await hashOtp(otp);

  await db.prepare(
    'INSERT INTO otp_requests (phone, otp_hash, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(phone, otpHash, now + expirySeconds, now).run();

  const channel = await sendOtp(env, phone, otp);
  return { otp, channel };
}

// WhatsApp first (primary), SMS on any WhatsApp failure (fallback), dev-log if neither configured.
async function sendOtp(env, phone, otp) {
  if (whatsappConfigured(env)) {
    try {
      await sendViaWhatsApp(env, phone, otp);
      return 'whatsapp';
    } catch (e) {
      console.log('[OTP] WhatsApp send failed, falling back to SMS:', e?.message || e);
    }
  }
  if (env.MSG91_API_KEY) {
    await sendViaMSG91(phone, otp, env.MSG91_API_KEY, env.MSG91_TEMPLATE_ID);
    return 'sms';
  }
  // Dev mode — log, don't send.
  console.log(`[OTP DEV] ${phone} → ${otp}`);
  return 'dev';
}

export async function verifyOtp(db, phone, otp) {
  const { hashOtp: hash } = await import('./crypto.js');
  const otpHash = await hash(otp);
  const now     = Math.floor(Date.now() / 1000);

  const row = await db.prepare(`
    SELECT id FROM otp_requests
    WHERE phone = ? AND otp_hash = ? AND verified = 0 AND attempts < 5 AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1
  `).bind(phone, otpHash, now).first();

  if (!row) {
    // Increment attempts on the latest unverified OTP
    await db.prepare(`
      UPDATE otp_requests SET attempts = attempts + 1
      WHERE phone = ? AND verified = 0
      ORDER BY created_at DESC LIMIT 1
    `).bind(phone).run();
    return false;
  }

  await db.prepare('UPDATE otp_requests SET verified = 1 WHERE id = ?').bind(row.id).run();
  return true;
}

export async function hasVerifiedOtp(db, phone) {
  const now     = Math.floor(Date.now() / 1000);
  const window  = now - 600; // verified within last 10 minutes
  const row = await db.prepare(`
    SELECT id FROM otp_requests
    WHERE phone = ? AND verified = 1 AND created_at > ?
    ORDER BY created_at DESC LIMIT 1
  `).bind(phone, window).first();
  return !!row;
}

// ── SMS (fallback) — MSG91 v5 OTP, DLT-registered template ──
async function sendViaMSG91(phone, otp, apiKey, templateId) {
  if (!apiKey) {
    console.log(`[OTP DEV] ${phone} → ${otp}`);
    return;
  }
  const mobile = phone.replace('+', '');
  const resp = await fetch('https://api.msg91.com/api/v5/otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authkey: apiKey, template_id: templateId, mobile, otp }),
  });
  if (!resp.ok) throw new Error('sms_http_' + resp.status);
}

// ── WhatsApp (primary) — MSG91 v5 WhatsApp outbound template message ──
// IMPORTANT: confirm the exact endpoint + payload against your MSG91 console
// (WhatsApp → your integrated number → "API" / cURL sample). The structure below
// matches MSG91's documented v5 "send template" shape, but template variable names
// (body_1, button_1) and the language code depend on how YOUR Authentication template
// is built. This is the ONLY function that needs editing once those values are known.
async function sendViaWhatsApp(env, phone, otp) {
  const mobile = phone.replace('+', '');
  const resp = await fetch('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authkey: env.MSG91_WA_AUTHKEY },
    body: JSON.stringify({
      integrated_number: env.MSG91_WA_INTEGRATED_NUMBER,
      content_type: 'template',
      payload: {
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: env.MSG91_WA_TEMPLATE_NAME,
          language: { code: env.MSG91_WA_TEMPLATE_LANG || 'en', policy: 'deterministic' },
          to_and_components: [{
            to: [mobile],
            components: {
              // Body variable {{1}} = the OTP code.
              body_1: { type: 'text', value: otp },
              // Authentication templates carry a "Copy code" URL button whose value is the OTP.
              button_1: { subtype: 'url', type: 'text', value: otp },
            },
          }],
        },
      },
    }),
  });
  if (!resp.ok) throw new Error('whatsapp_http_' + resp.status);
  const data = await resp.json().catch(() => ({}));
  // MSG91 returns { type: 'success' | 'error', ... }. Treat anything non-success as a
  // failure so the SMS fallback fires.
  if (data && data.type && data.type !== 'success') {
    throw new Error('whatsapp_api_' + (data.message || data.type));
  }
}

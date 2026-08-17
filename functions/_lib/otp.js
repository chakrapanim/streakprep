import { getSetting } from './db.js';
import { randomOtp, hashOtp } from './crypto.js';
import { checkIpRateLimit } from './rate-limit.js';

export async function checkRateLimit(db, phone, ip) {
  // Lenient by design: students legitimately log in several times a day. PIN / trusted-device
  // logins don't send an OTP and never reach here — this only throttles OTP sends.
  const maxPerHour      = parseInt(await getSetting(db, 'otp_max_per_hour', '20'));
  const cooldownSeconds = parseInt(await getSetting(db, 'otp_cooldown_seconds', '30'));
  const now             = Math.floor(Date.now() / 1000);
  const hourAgo         = now - 3600;

  // Per-IP cap (independent of phone) — stops one source from rotating through many
  // numbers to spam-send OTPs (harassment + WhatsApp/SMS spend), which the per-phone
  // limit below can't catch on its own.
  if (ip) {
    const ipOk = await checkIpRateLimit(db, 'otp_send', ip, 10, 3600);
    if (!ipOk) return { allowed: false, reason: 'rate_limit', retryAfter: 3600 };
  }

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

  const inserted = await db.prepare(
    'INSERT INTO otp_requests (phone, otp_hash, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(phone, otpHash, now + expirySeconds, now).run();

  const channel = await sendOtp(env, phone, otp, db, inserted.meta.last_row_id);
  return { otp, channel };
}

// WhatsApp first (primary), SMS on WhatsApp failure (fallback) if configured, dev-log if
// neither channel is configured. Key rule: a *configured* channel that fails must throw —
// we only fall through to dev-log when nothing is configured, so a WhatsApp-only setup
// surfaces send failures to the caller instead of silently pretending success.
async function sendOtp(env, phone, otp, db, otpRowId) {
  const hasWhatsApp = whatsappConfigured(env);
  const hasSms      = !!env.MSG91_API_KEY;

  // Dev mode — nothing configured, log instead of sending.
  if (!hasWhatsApp && !hasSms) {
    console.log(`[OTP DEV] ${phone} → ${otp}`);
    return 'dev';
  }

  if (hasWhatsApp) {
    try {
      const requestId = await sendViaWhatsApp(env, phone, otp);
      // MSG91's send call only confirms the request was accepted, not that it actually
      // delivered — real outcome (sent/delivered/failed/read) arrives later via the
      // webhook at api/webhooks/msg91-whatsapp.js, correlated by this request_id.
      if (requestId && db && otpRowId) {
        await db.prepare('UPDATE otp_requests SET msg91_request_id = ? WHERE id = ?')
          .bind(requestId, otpRowId).run();
      }
      return 'whatsapp';
    } catch (e) {
      // Surface the failure unless we have an SMS fallback to try.
      if (!hasSms) throw e;
      console.log('[OTP] WhatsApp send failed, falling back to SMS:', e?.message || e);
    }
  }

  await sendViaMSG91(phone, otp, env.MSG91_API_KEY, env.MSG91_TEMPLATE_ID);
  return 'sms';
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
// Endpoint + payload confirmed against MSG91's "Send WhatsApp Template" cURL (2026-07):
// POST .../whatsapp-outbound-message/bulk/ with content_type=template and the
// payload/template/to_and_components shape below. One thing still unverified: the
// copy-code button component (button_1). WhatsApp Authentication templates require the
// OTP echoed into the copy-code button in addition to the body; the key below follows
// MSG91's documented auth format but should be confirmed on the first live send once the
// template is approved.
async function sendViaWhatsApp(env, phone, otp) {
  const mobile = phone.replace('+', '');
  const resp = await fetch('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', authkey: env.MSG91_WA_AUTHKEY },
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
  // MSG91 returns { status: 'success' | 'error', hasError, data|errors, request_id, ... }.
  // Treat anything non-success as a failure so the SMS fallback fires. NOTE: a 'success'
  // here only means MSG91 accepted the request for delivery — it does NOT mean the
  // message actually reached the recipient (bad template/number fail asynchronously).
  if (data && data.status && data.status !== 'success') {
    throw new Error('whatsapp_api_' + (data.errors ? JSON.stringify(data.errors) : data.status));
  }
  return data && data.request_id;
}

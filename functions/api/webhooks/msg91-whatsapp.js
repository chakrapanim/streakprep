import { json } from '../../_lib/db.js';

// MSG91 "On Outbound Report Received" webhook — the only source of the real WhatsApp
// send outcome (sent/delivered/failed/read). The synchronous send API call in otp.js
// only confirms MSG91 accepted the request, not that it was delivered.
// Configure in MSG91: WhatsApp → Webhook (New) → Create Webhook → event
// "On Outbound Report Received" → this endpoint's URL, with a custom header
// `x-webhook-secret: <MSG91_WEBHOOK_SECRET>` matching the Cloudflare Pages secret below.
// Must respond fast — MSG91 times out and retries after a few seconds.
export async function onRequestPost({ request, env }) {
  if (env.MSG91_WEBHOOK_SECRET) {
    const provided = request.headers.get('x-webhook-secret');
    if (provided !== env.MSG91_WEBHOOK_SECRET) return json({ error: 'unauthorized' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  // Sample payload: { requestId, eventName: 'sent'|'delivered'|'failed'|'read', reason, customerNumber, ts, ... }
  const requestId = body.requestId;
  const status    = body.eventName;
  const reason    = body.reason || null;

  // Ack even when there's nothing to correlate (unrecognised event, retry storm, etc.)
  // — MSG91 retries on non-2xx, and we have no useful recovery action either way.
  if (!requestId || !status) return json({ ok: true });

  const db  = env.streakprep_db;
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    'UPDATE otp_requests SET delivery_status = ?, delivery_reason = ?, delivery_updated_at = ? WHERE msg91_request_id = ?'
  ).bind(status, reason, now, requestId).run();

  return json({ ok: true });
}

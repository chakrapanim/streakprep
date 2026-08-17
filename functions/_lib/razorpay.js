// Thin Razorpay REST client. Auth is HTTP Basic with key_id:key_secret.
// Docs (as of this writing): https://razorpay.com/docs/api/subscriptions/

export function razorpayConfigured(env) {
  return !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

async function rzpRequest(env, method, path, body) {
  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const resp = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error('razorpay_' + resp.status + '_' + (data?.error?.description || 'unknown'));
  }
  return data;
}

// A Razorpay Plan is a fixed-price recurring template. We create one per
// subscription-creation call (matching that student's exact, possibly
// coupon-discounted, amount) rather than pre-provisioning fixed plans —
// simpler, and it naturally handles both per-subject-count pricing and
// per-coupon discounts without extra Razorpay-side setup.
export async function createPlan(env, { amountPaise, planName, studentName }) {
  return rzpRequest(env, 'POST', '/plans', {
    period: 'monthly',
    interval: 1,
    item: {
      name: `StreakPrep ${planName} — ${studentName}`,
      amount: amountPaise,
      currency: 'INR',
    },
  });
}

// total_count: Razorpay requires a fixed number of billing cycles; there's
// no "forever" flag. 120 (10 years of monthly billing) is the common
// workaround for an "until cancelled" subscription.
export async function createSubscription(env, { planId, customerNotify = 1, notes = {} }) {
  return rzpRequest(env, 'POST', '/subscriptions', {
    plan_id: planId,
    customer_notify: customerNotify,
    total_count: 120,
    notes,
  });
}

export async function cancelSubscription(env, subscriptionId) {
  return rzpRequest(env, 'POST', `/subscriptions/${subscriptionId}/cancel`, { cancel_at_cycle_end: 0 });
}

// HMAC-SHA256 signature verification for incoming webhooks — required so a
// spoofed POST can't fake a payment event. Compares against the raw request
// body (must be verified before JSON.parse'ing it).
export async function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computed = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(computed, signatureHeader);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

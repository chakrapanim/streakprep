import { json } from '../../_lib/db.js';
import { verifyWebhookSignature } from '../../_lib/razorpay.js';

// Razorpay webhook — the source of truth for subscription lifecycle. The
// dashboard/account/quiz live-checks (current_period_end > now) already
// degrade gracefully even if an event is ever missed, but this is what
// actually keeps status/current_period_end/grace_until correct going forward.
//
// Configure in Razorpay Dashboard -> Settings -> Webhooks:
//   URL: https://streakprep.ai/api/webhooks/razorpay
//   Secret: (set as RAZORPAY_WEBHOOK_SECRET)
//   Events: subscription.charged, subscription.pending, subscription.halted,
//           subscription.cancelled
export async function onRequestPost({ request, env }) {
  const db = env.streakprep_db;

  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');
  if (!env.RAZORPAY_WEBHOOK_SECRET) return json({ error: 'not_configured' }, 503);

  const validSig = await verifyWebhookSignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET);
  if (!validSig) return json({ error: 'invalid_signature' }, 401);

  let evt;
  try { evt = JSON.parse(rawBody); } catch { return json({ error: 'invalid_json' }, 400); }

  const eventId   = request.headers.get('x-razorpay-event-id') || evt.event + '_' + (evt.created_at || Date.now());
  const eventType = evt.event;
  const now       = Math.floor(Date.now() / 1000);

  // Idempotency: INSERT OR IGNORE against the UNIQUE razorpay_event_id — if
  // this event was already processed (0 rows changed), stop here rather than
  // double-crediting a referral reward or double-extending a period.
  const insertResult = await db.prepare(
    'INSERT OR IGNORE INTO payment_events (event_type, razorpay_event_id, payload, processed, created_at) VALUES (?, ?, ?, 0, ?)'
  ).bind(eventType, eventId, rawBody, now).run();
  if (insertResult.meta.changes === 0) return json({ ok: true, duplicate: true });

  const rzpSub = evt.payload?.subscription?.entity;
  const rzpSubId = rzpSub?.id;
  if (!rzpSubId) return json({ ok: true, ignored: 'no_subscription_in_payload' });

  const sub = await db.prepare(
    'SELECT id, student_id, status FROM subscriptions WHERE razorpay_subscription_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(rzpSubId).first();
  if (!sub) return json({ ok: true, ignored: 'subscription_not_found' });

  const wasFirstCharge = sub.status === 'pending';

  if (eventType === 'subscription.charged') {
    const periodEnd = rzpSub.current_end || (now + 30 * 24 * 60 * 60);
    const paymentId = evt.payload?.payment?.entity?.id || null;
    await db.prepare(`
      UPDATE subscriptions
      SET status = 'active', current_period_start = ?, current_period_end = ?,
          razorpay_payment_id = ?, updated_at = ?
      WHERE id = ?
    `).bind(rzpSub.current_start || now, periodEnd, paymentId, now, sub.id).run();

    if (wasFirstCharge) {
      await creditReferralRewardIfAny(db, sub.student_id, now);
    }
  } else if (eventType === 'subscription.pending') {
    const graceDays = parseInt((await db.prepare('SELECT value FROM settings WHERE key = ?').bind('renewal_grace_days').first())?.value ?? 3);
    await db.prepare(`
      UPDATE subscriptions SET status = 'grace', grace_until = ?, updated_at = ? WHERE id = ?
    `).bind(now + graceDays * 86400, now, sub.id).run();
  } else if (eventType === 'subscription.halted') {
    await db.prepare(`UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE id = ?`).bind(now, sub.id).run();
  } else if (eventType === 'subscription.cancelled') {
    await db.prepare(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, sub.id).run();
  }

  await db.prepare('UPDATE payment_events SET processed = 1, subscription_id = ? WHERE razorpay_event_id = ?')
    .bind(sub.id, eventId).run();

  return json({ ok: true });
}

// Reward is credited on the REFERRED student's first successful payment, not
// at signup — an account that registers with a referral code but never pays
// can't be farmed for free rewards. Reward = 30 days added to the referrer's
// first-registered child's current subscription (whatever state it's in).
async function creditReferralRewardIfAny(db, referredStudentId, now) {
  const student = await db.prepare('SELECT parent_id FROM students WHERE id = ?').bind(referredStudentId).first();
  if (!student) return;

  const referral = await db.prepare(
    'SELECT id, referrer_parent_id FROM referrals WHERE referred_parent_id = ? AND reward_given = 0'
  ).bind(student.parent_id).first();
  if (!referral) return;

  const targetSub = await db.prepare(`
    SELECT id, status, trial_ends_at, current_period_end, grace_until FROM subscriptions
    WHERE student_id = (SELECT id FROM students WHERE parent_id = ? AND is_active = 1 ORDER BY id ASC LIMIT 1)
    ORDER BY created_at DESC LIMIT 1
  `).bind(referral.referrer_parent_id).first();

  if (targetSub) {
    const THIRTY_DAYS = 30 * 24 * 60 * 60;
    if (targetSub.status === 'trial') {
      await db.prepare('UPDATE subscriptions SET trial_ends_at = trial_ends_at + ?, grace_until = grace_until + ?, updated_at = ? WHERE id = ?')
        .bind(THIRTY_DAYS, THIRTY_DAYS, now, targetSub.id).run();
    } else if (targetSub.status === 'active') {
      await db.prepare('UPDATE subscriptions SET current_period_end = current_period_end + ?, updated_at = ? WHERE id = ?')
        .bind(THIRTY_DAYS, now, targetSub.id).run();
    } else {
      await db.prepare("UPDATE subscriptions SET status = 'active', current_period_end = ?, updated_at = ? WHERE id = ?")
        .bind(now + THIRTY_DAYS, now, targetSub.id).run();
    }
  }

  await db.prepare('UPDATE referrals SET reward_given = 1 WHERE id = ?').bind(referral.id).run();
}

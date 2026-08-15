import { getSession } from '../../_lib/auth.js';
import { json } from '../../_lib/db.js';
import { razorpayConfigured, createPlan, createSubscription } from '../../_lib/razorpay.js';

export async function onRequestPost({ request, env }) {
  const db      = env.streakprep_db;
  const session = await getSession(request, db);
  if (!session) return json({ error: 'unauthorized' }, 401);

  // No live Razorpay keys yet (KYC pending) — the frontend treats this as
  // "show the coming-soon placeholder" rather than a hard error.
  if (!razorpayConfigured(env)) return json({ error: 'not_configured' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const studentId  = parseInt(body.studentId);
  const couponCode = (body.couponCode || '').trim().toUpperCase() || null;
  if (!studentId) return json({ error: 'student_id_required' }, 400);

  // Subscriptions are per-student — verify this student actually belongs to
  // the logged-in parent before creating anything.
  const student = await db.prepare(
    'SELECT id, name, subjects FROM students WHERE id = ? AND parent_id = ? AND is_active = 1'
  ).bind(studentId, session.parent_id).first();
  if (!student) return json({ error: 'student_not_found' }, 404);

  const subjects = JSON.parse(student.subjects || '[]');
  const plan     = planFor(subjects.length);
  let amountPaise = plan.paise;
  let appliedCoupon = null;

  if (couponCode) {
    const now    = Math.floor(Date.now() / 1000);
    const coupon = await db.prepare('SELECT * FROM coupons WHERE code = ? AND is_active = 1').bind(couponCode).first();
    const valid  = coupon
      && (!coupon.expires_at || coupon.expires_at > now)
      && (!coupon.max_redemptions || coupon.times_redeemed < coupon.max_redemptions);
    if (!valid) return json({ error: 'invalid_coupon' }, 400);

    amountPaise = coupon.discount_type === 'percent'
      ? Math.round(amountPaise * (100 - coupon.discount_value) / 100)
      : Math.max(0, amountPaise - coupon.discount_value);
    appliedCoupon = coupon;
  }

  let rzpPlan, rzpSub;
  try {
    rzpPlan = await createPlan(env, { amountPaise, planName: plan.name, studentName: student.name });
    rzpSub  = await createSubscription(env, {
      planId: rzpPlan.id,
      notes: { studentId: String(studentId), parentId: String(session.parent_id) },
    });
  } catch (e) {
    return json({ error: 'razorpay_error', detail: e.message }, 502);
  }

  const now = Math.floor(Date.now() / 1000);

  // New row rather than mutating the trial row — preserves history, and
  // matches the "latest row wins" pattern already used by dashboard/account/quiz.
  await db.prepare(`
    INSERT INTO subscriptions
      (student_id, plan, subjects, status, amount_paise, trial_ends_at,
       razorpay_subscription_id, coupon_code, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
  `).bind(
    studentId, plan.name, JSON.stringify(subjects), amountPaise, now,
    rzpSub.id, appliedCoupon ? appliedCoupon.code : null, now, now
  ).run();

  if (appliedCoupon) {
    await db.prepare('UPDATE coupons SET times_redeemed = times_redeemed + 1 WHERE id = ?').bind(appliedCoupon.id).run();
  }

  return json({
    ok: true,
    subscriptionId: rzpSub.id,
    keyId: env.RAZORPAY_KEY_ID,
    amountPaise,
    planName: plan.name,
  });
}

// Mirrors register/complete.js's planFor() — same tiering everywhere a plan is derived from subject count.
function planFor(n) {
  if (n <= 1) return { name: 'starter', paise: 9900  };
  if (n <= 3) return { name: 'core',    paise: 19900 };
  return           { name: 'full',    paise: 24900 };
}

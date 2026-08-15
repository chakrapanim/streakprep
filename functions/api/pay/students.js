import { getSession } from '../../_lib/auth.js';
import { json } from '../../_lib/db.js';

// Subscriptions are per-student (not per-parent) — a parent with multiple
// children has one Razorpay subscription per child. This lists every active
// child under the logged-in parent with their current plan/price/status, so
// /pay can ask "which student is this for?" before starting checkout.
export async function onRequestGet({ request, env }) {
  const db      = env.streakprep_db;
  const session = await getSession(request, db);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const now = Math.floor(Date.now() / 1000);

  const studentsRes = await db.prepare(
    'SELECT id, name, class, subjects FROM students WHERE parent_id = ? AND is_active = 1 ORDER BY id'
  ).bind(session.parent_id).all();
  const students = studentsRes.results || [];

  const withPlans = await Promise.all(students.map(async (s) => {
    const sub = await db.prepare(
      'SELECT status, trial_ends_at, current_period_end, grace_until, plan, amount_paise FROM subscriptions WHERE student_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(s.id).first();

    const subjects = JSON.parse(s.subjects || '[]');
    const plan     = planFor(subjects.length);

    return {
      id: s.id,
      name: s.name,
      class: s.class,
      subjectCount: subjects.length,
      plan: plan.name,
      amountPaise: plan.paise,
      subscription: calcSubStatus(sub, now),
    };
  }));

  return json({ students: withPlans });
}

// Mirrors register/complete.js's planFor() — same tiering everywhere a plan is derived from subject count.
function planFor(n) {
  if (n <= 1) return { name: 'starter', paise: 9900  };
  if (n <= 3) return { name: 'core',    paise: 19900 };
  return           { name: 'full',    paise: 24900 };
}

function calcSubStatus(sub, now) {
  if (!sub) return { type: 'none', label: 'No subscription', daysLeft: 0 };
  if (sub.status === 'trial') {
    const daysLeft = Math.max(0, Math.ceil((sub.trial_ends_at - now) / 86400));
    if (daysLeft > 0) return { type: 'trial', label: `Free trial — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`, daysLeft };
    if (sub.grace_until > now) return { type: 'grace', label: 'Trial ended — subscribe to continue', daysLeft: 0 };
    return { type: 'expired', label: 'Trial expired', daysLeft: 0 };
  }
  if (sub.status === 'active') {
    if (sub.current_period_end > now) {
      const daysLeft = Math.ceil((sub.current_period_end - now) / 86400);
      return { type: 'active', label: `Active — renews in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`, daysLeft };
    }
    if (sub.grace_until > now) return { type: 'grace', label: 'Payment due — renew to continue', daysLeft: 0 };
    return { type: 'expired', label: 'Subscription expired — renew to continue', daysLeft: 0 };
  }
  if (sub.status === 'grace') return { type: 'grace', label: 'Subscription ended — renew to continue', daysLeft: 0 };
  return { type: 'expired', label: 'Subscription expired', daysLeft: 0 };
}

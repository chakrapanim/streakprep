import { getSession } from '../_lib/auth.js';
import { json } from '../_lib/db.js';

export async function onRequestGet({ request, env }) {
  const db      = env.streakprep_db;
  const session = await getSession(request, db);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const studentId = session.active_student_id;
  const parentId  = session.parent_id;
  const now       = Math.floor(Date.now() / 1000);

  const [student, parent, sub, siblings] = await Promise.all([
    db.prepare('SELECT id, name, class, subjects FROM students WHERE id = ? AND is_active = 1').bind(studentId).first(),
    db.prepare('SELECT phone, email FROM parents WHERE id = ? AND is_active = 1').bind(parentId).first(),
    db.prepare('SELECT status, trial_ends_at, current_period_end, grace_until, plan, amount_paise FROM subscriptions WHERE student_id = ? ORDER BY created_at DESC LIMIT 1').bind(studentId).first(),
    db.prepare('SELECT id, name, class FROM students WHERE parent_id = ? AND is_active = 1 ORDER BY id').bind(parentId).all(),
  ]);

  if (!student || !parent) return json({ error: 'not_found' }, 404);

  const subjects  = JSON.parse(student.subjects || '[]');
  const subStatus = calcSubStatus(sub, now);

  return json({
    student: { id: student.id, name: student.name, class: student.class, subjects },
    parent:  { phone: parent.phone, email: parent.email },
    subscription: subStatus,
    siblings: siblings.results || [],
    activeStudentId: studentId,
  });
}

function calcSubStatus(sub, now) {
  if (!sub) return { type: 'none', label: 'No subscription', daysLeft: 0 };
  if (sub.status === 'trial') {
    const daysLeft = Math.max(0, Math.ceil((sub.trial_ends_at - now) / 86400));
    if (daysLeft > 0) return { type: 'trial', label: `Free trial — ${daysLeft} day${daysLeft===1?'':'s'} left`, daysLeft };
    if (sub.grace_until > now) return { type: 'grace', label: 'Trial ended — subscribe to continue', daysLeft: 0 };
    return { type: 'expired', label: 'Trial expired', daysLeft: 0 };
  }
  if (sub.status === 'active') {
    if (sub.current_period_end > now) {
      const daysLeft = Math.ceil((sub.current_period_end - now) / 86400);
      return { type: 'active', label: `Active — renews in ${daysLeft} day${daysLeft===1?'':'s'}`, daysLeft, planName: sub.plan, amountPaise: sub.amount_paise };
    }
    // Period end has passed but nothing has flipped status yet (missed/late webhook) —
    // degrade gracefully instead of showing a stale "Active — renews in -N days" label.
    if (sub.grace_until > now) return { type: 'grace', label: 'Payment due — renew to continue', daysLeft: 0 };
    return { type: 'expired', label: 'Subscription expired — renew to continue', daysLeft: 0 };
  }
  if (sub.status === 'grace') return { type: 'grace', label: 'Subscription ended — renew to continue', daysLeft: 0 };
  return { type: 'expired', label: 'Subscription expired', daysLeft: 0 };
}

import { getSession } from '../_lib/auth.js';
import { json } from '../_lib/db.js';

export async function onRequestGet({ request, env }) {
  const db      = env.streakprep_db;
  const session = await getSession(request, db);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const studentId = session.active_student_id;
  const parentId  = session.parent_id;
  const now       = Math.floor(Date.now() / 1000);

  // IST today date string YYYY-MM-DD
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const [student, subscription, streak, siblingsRes, quizzesRes] = await Promise.all([
    db.prepare('SELECT id, name, class, subjects FROM students WHERE id = ? AND is_active = 1')
      .bind(studentId).first(),
    db.prepare('SELECT * FROM subscriptions WHERE student_id = ? ORDER BY created_at DESC LIMIT 1')
      .bind(studentId).first(),
    db.prepare('SELECT current_streak, longest_streak, last_quiz_date FROM streaks WHERE student_id = ?')
      .bind(studentId).first(),
    db.prepare('SELECT id, name, class FROM students WHERE parent_id = ? AND is_active = 1 ORDER BY id')
      .bind(parentId).all(),
    db.prepare('SELECT subject, status, score FROM quiz_sessions WHERE student_id = ? AND quiz_date = ?')
      .bind(studentId, today).all(),
  ]);

  if (!student) return json({ error: 'student_not_found' }, 404);

  const subjects     = JSON.parse(student.subjects || '[]');
  const todayQuizzes = quizzesRes.results || [];
  const siblings     = siblingsRes.results || [];

  // Subscription status
  const subStatus = calcSubStatus(subscription, now);

  // Today's progress
  const doneSubjects    = todayQuizzes.filter(q => q.status === 'completed').map(q => q.subject);
  const pendingSubjects = subjects.filter(s => !doneSubjects.includes(s));

  return json({
    student: { id: student.id, name: student.name, class: student.class, subjects },
    subscription: subStatus,
    streak: streak || { current_streak: 0, longest_streak: 0, last_quiz_date: null },
    siblings,
    activeStudentId: studentId,
    today,
    todayQuizzes,
    doneSubjects,
    pendingSubjects,
  });
}

function calcSubStatus(sub, now) {
  if (!sub) return { type: 'none', label: 'No subscription', daysLeft: 0 };

  if (sub.status === 'trial') {
    const daysLeft = Math.max(0, Math.ceil((sub.trial_ends_at - now) / 86400));
    if (daysLeft > 0) return { type: 'trial', label: `Free trial — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`, daysLeft };
    if (now < sub.grace_until) return { type: 'grace', label: 'Trial ended — subscribe to continue', daysLeft: 0 };
    return { type: 'expired', label: 'Trial expired — subscribe to access quizzes', daysLeft: 0 };
  }
  if (sub.status === 'active') {
    if (sub.current_period_end > now) {
      const daysLeft = Math.ceil((sub.current_period_end - now) / 86400);
      return { type: 'active', label: `Active — renews in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`, daysLeft };
    }
    // Period end has passed but nothing has flipped status yet (missed/late webhook) —
    // degrade gracefully instead of showing a stale "Active — renews in -N days" label.
    if (sub.grace_until > now) return { type: 'grace', label: 'Payment due — renew to continue', daysLeft: 0 };
    return { type: 'expired', label: 'Subscription expired — renew to continue', daysLeft: 0 };
  }
  if (sub.status === 'grace') {
    return { type: 'grace', label: 'Subscription ended — renew to continue', daysLeft: 0 };
  }
  return { type: 'expired', label: 'Subscription expired', daysLeft: 0 };
}

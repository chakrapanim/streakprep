import { checkAdminAuth, adminUnauth } from '../../_lib/admin-auth.js';
import { json } from '../../_lib/db.js';

export async function onRequestGet({ request, env }) {
  const auth = checkAdminAuth(request, env);
  if (!auth.ok) return adminUnauth(auth.error);

  const db  = env.streakprep_db;
  const now = Math.floor(Date.now() / 1000);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const [students, subs, reviewers, quizzesToday] = await Promise.all([
    db.prepare('SELECT COUNT(*) as n FROM students WHERE is_active=1').first(),
    db.prepare(`SELECT
      SUM(CASE WHEN status='trial' AND trial_ends_at > ? THEN 1 ELSE 0 END) as trials,
      SUM(CASE WHEN status='active' AND current_period_end > ? THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN (status='trial' AND trial_ends_at <= ?) OR status='expired' THEN 1 ELSE 0 END) as expired
      FROM subscriptions WHERE id IN (SELECT MAX(id) FROM subscriptions GROUP BY student_id)
    `).bind(now, now, now).first(),
    db.prepare("SELECT COUNT(*) as n FROM students WHERE is_reviewer=1 AND is_active=1").first(),
    db.prepare("SELECT COUNT(*) as n FROM quiz_sessions WHERE quiz_date=? AND status='completed'").bind(today).first(),
  ]);

  return json({
    totalStudents:  students?.n || 0,
    trialsActive:   subs?.trials || 0,
    subsActive:     subs?.active || 0,
    expired:        subs?.expired || 0,
    reviewers:      reviewers?.n || 0,
    quizzesToday:   quizzesToday?.n || 0,
  });
}

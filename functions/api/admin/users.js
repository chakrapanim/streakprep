import { checkAdminAuth, adminUnauth } from '../../_lib/admin-auth.js';
import { json } from '../../_lib/db.js';

export async function onRequestGet({ request, env }) {
  const auth = checkAdminAuth(request, env);
  if (!auth.ok) return adminUnauth(auth.error);

  const db  = env.streakprep_db;
  const now = Math.floor(Date.now() / 1000);
  const url = new URL(request.url);
  const q   = (url.searchParams.get('q') || '').trim();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = 20;
  const offset = (page - 1) * limit;

  const searchClause = q
    ? `AND (p.phone LIKE ? OR s.name LIKE ?)`
    : '';
  const searchParams = q ? [`%${q}%`, `%${q}%`] : [];

  const rows = await db.prepare(`
    SELECT
      s.id as student_id, s.name, s.class, s.subjects,
      s.is_reviewer, s.reviewer_classes,
      p.id as parent_id, p.phone, p.email,
      sub.status as sub_status,
      sub.trial_ends_at, sub.current_period_end,
      s.created_at
    FROM students s
    JOIN parents p ON p.id = s.parent_id
    LEFT JOIN subscriptions sub ON sub.id = (
      SELECT MAX(id) FROM subscriptions WHERE student_id = s.id
    )
    WHERE s.is_active = 1 ${searchClause}
    ORDER BY s.id DESC
    LIMIT ? OFFSET ?
  `).bind(...searchParams, limit, offset).all();

  const countRow = await db.prepare(`
    SELECT COUNT(*) as n
    FROM students s JOIN parents p ON p.id = s.parent_id
    WHERE s.is_active = 1 ${searchClause}
  `).bind(...searchParams).first();

  const users = (rows.results || []).map(r => {
    let subLabel = 'None';
    if (r.sub_status === 'trial') {
      const left = Math.max(0, Math.ceil((r.trial_ends_at - now) / 86400));
      subLabel = left > 0 ? `Trial (${left}d left)` : 'Trial expired';
    } else if (r.sub_status === 'active') {
      const left = Math.ceil((r.current_period_end - now) / 86400);
      subLabel = `Active (${left}d)`;
    } else if (r.sub_status) {
      subLabel = r.sub_status.charAt(0).toUpperCase() + r.sub_status.slice(1);
    }
    return {
      studentId:       r.student_id,
      name:            r.name,
      class:           r.class,
      subjects:        JSON.parse(r.subjects || '[]'),
      isReviewer:      r.is_reviewer === 1,
      reviewerClasses: r.reviewer_classes ? JSON.parse(r.reviewer_classes) : null,
      parentId:        r.parent_id,
      phone:           r.phone,
      email:           r.email,
      subLabel,
      createdAt:       r.created_at,
    };
  });

  return json({ users, total: countRow?.n || 0, page, limit });
}

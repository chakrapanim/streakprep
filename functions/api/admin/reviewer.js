import { checkAdminAuth, adminUnauth } from '../../_lib/admin-auth.js';
import { json } from '../../_lib/db.js';

// PATCH /api/admin/reviewer
// body: { studentId, isReviewer, reviewerClasses }
export async function onRequestPatch({ request, env }) {
  const auth = checkAdminAuth(request, env);
  if (!auth.ok) return adminUnauth(auth.error);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const { studentId, isReviewer, reviewerClasses } = body;
  if (!studentId) return json({ error: 'student_id_required' }, 400);

  const db = env.streakprep_db;
  const student = await db.prepare('SELECT id FROM students WHERE id = ? AND is_active = 1').bind(studentId).first();
  if (!student) return json({ error: 'student_not_found' }, 404);

  const reviewerFlag    = isReviewer ? 1 : 0;
  const reviewerClassesJson = isReviewer && Array.isArray(reviewerClasses) && reviewerClasses.length
    ? JSON.stringify(reviewerClasses)
    : null;

  await db.prepare(
    'UPDATE students SET is_reviewer = ?, reviewer_classes = ? WHERE id = ?'
  ).bind(reviewerFlag, reviewerClassesJson, studentId).run();

  return json({ ok: true, studentId, isReviewer: reviewerFlag === 1, reviewerClasses: reviewerClassesJson ? JSON.parse(reviewerClassesJson) : null });
}

import { checkAdminAuth, adminUnauth } from '../../_lib/admin-auth.js';
import { json } from '../../_lib/db.js';

// DELETE /api/admin/delete-user   body: { studentId }
export async function onRequestDelete({ request, env }) {
  const auth = checkAdminAuth(request, env);
  if (!auth.ok) return adminUnauth(auth.error);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const { studentId } = body;
  if (!studentId) return json({ error: 'student_id_required' }, 400);

  const db = env.streakprep_db;

  const student = await db.prepare(
    'SELECT id, parent_id FROM students WHERE id = ? AND is_active = 1'
  ).bind(studentId).first();
  if (!student) return json({ error: 'not_found' }, 404);

  // Soft-delete student
  await db.prepare('UPDATE students SET is_active = 0 WHERE id = ?').bind(studentId).run();

  // If parent has no other active students, soft-delete parent and invalidate sessions
  const others = await db.prepare(
    'SELECT COUNT(*) as n FROM students WHERE parent_id = ? AND is_active = 1'
  ).bind(student.parent_id).first();

  if ((others?.n || 0) === 0) {
    await db.batch([
      db.prepare('UPDATE parents SET is_active = 0 WHERE id = ?').bind(student.parent_id),
      db.prepare('DELETE FROM sessions WHERE parent_id = ?').bind(student.parent_id),
      db.prepare('DELETE FROM trusted_devices WHERE parent_id = ?').bind(student.parent_id),
    ]);
  }

  return json({ ok: true });
}

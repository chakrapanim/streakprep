import { getSession } from '../../_lib/auth.js';
import { json } from '../../_lib/db.js';

export async function onRequestPost({ request, env }) {
  const db      = env.streakprep_db;
  const session = await getSession(request, db);
  if (!session) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const studentId = parseInt(body.studentId);
  if (!studentId) return json({ error: 'student_id_required' }, 400);

  // Confirm the student belongs to this parent
  const student = await db.prepare(
    'SELECT id FROM students WHERE id = ? AND parent_id = ? AND is_active = 1'
  ).bind(studentId, session.parent_id).first();
  if (!student) return json({ error: 'not_found' }, 404);

  await db.prepare('UPDATE sessions SET active_student_id = ? WHERE id = ?')
    .bind(studentId, session.id).run();

  return json({ ok: true });
}

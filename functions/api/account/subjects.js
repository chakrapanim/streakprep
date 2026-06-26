import { getSession } from '../../_lib/auth.js';
import { json } from '../../_lib/db.js';

const ALL_SUBJECTS = ['mathematics', 'science', 'english', 'hindi', 'social_science'];

export async function onRequestPatch({ request, env }) {
  const db      = env.streakprep_db;
  const session = await getSession(request, db);
  if (!session) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const subjects = body.subjects;
  if (!Array.isArray(subjects) || subjects.length === 0) {
    return json({ error: 'at_least_one_subject_required' }, 400);
  }
  if (!subjects.every(s => ALL_SUBJECTS.includes(s))) {
    return json({ error: 'invalid_subject' }, 400);
  }
  if (subjects.length > 5) {
    return json({ error: 'too_many_subjects' }, 400);
  }

  const studentId = session.active_student_id;

  const student = await db.prepare(
    'SELECT id FROM students WHERE id = ? AND parent_id = ? AND is_active = 1'
  ).bind(studentId, session.parent_id).first();
  if (!student) return json({ error: 'not_found' }, 404);

  await db.prepare(
    'UPDATE students SET subjects = ? WHERE id = ?'
  ).bind(JSON.stringify(subjects), studentId).run();

  return json({ ok: true, subjects });
}

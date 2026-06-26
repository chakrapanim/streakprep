import { getSession } from '../../_lib/auth.js';
import { json } from '../../_lib/db.js';

export async function onRequestGet({ request, env }) {
  const db = env.streakprep_db;
  const session = await getSession(request, db);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const student = await db.prepare(
    'SELECT is_reviewer FROM students WHERE id = ? AND is_active = 1'
  ).bind(session.active_student_id).first();
  if (!student?.is_reviewer) return json({ error: 'forbidden' }, 403);

  const url     = new URL(request.url);
  const grade   = parseInt(url.searchParams.get('grade') || '6');
  const subject = (url.searchParams.get('subject') || 'mathematics').replace(/[^a-z_]/g, '');

  const rows = await db.prepare(
    `SELECT chapter_key,
            COUNT(*) as total,
            SUM(CASE WHEN image_path IS NOT NULL AND image_path != '' THEN 1 ELSE 0 END) as pictorial
     FROM questions
     WHERE grade = ? AND subject_can = ? AND is_active = 1
     GROUP BY chapter_key
     ORDER BY chapter_key`
  ).bind(grade, subject).all();

  return json({ chapters: rows.results || [] });
}

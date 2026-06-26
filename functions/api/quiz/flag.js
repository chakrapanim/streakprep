import { getSession } from '../../_lib/auth.js';
import { json } from '../../_lib/db.js';

const VALID_REASONS = ['wrong_answer', 'bad_explanation', 'factual_error', 'unclear_question', 'other'];

// POST /api/quiz/flag  body: { questionId, reason, note? }
export async function onRequestPost({ request, env }) {
  const db      = env.streakprep_db;
  const session = await getSession(request, db);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const student = await db.prepare(
    'SELECT id, is_reviewer FROM students WHERE id = ? AND is_active = 1'
  ).bind(session.active_student_id).first();
  if (!student || student.is_reviewer !== 1) return json({ error: 'reviewer_only' }, 403);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const { questionId, reason, note } = body;
  if (!questionId)                    return json({ error: 'question_id_required' }, 400);
  if (!VALID_REASONS.includes(reason)) return json({ error: 'invalid_reason' }, 400);

  const question = await db.prepare('SELECT id FROM questions WHERE id = ?').bind(questionId).first();
  if (!question) return json({ error: 'question_not_found' }, 404);

  // Upsert: if already flagged by this reviewer, update reason
  const existing = await db.prepare(
    'SELECT id FROM flagged_questions WHERE question_id = ? AND student_id = ?'
  ).bind(questionId, student.id).first();

  if (existing) {
    await db.prepare(
      'UPDATE flagged_questions SET reason = ?, note = ?, status = \'pending\', created_at = unixepoch() WHERE id = ?'
    ).bind(reason, note || null, existing.id).run();
  } else {
    await db.prepare(
      'INSERT INTO flagged_questions (question_id, student_id, reason, note) VALUES (?, ?, ?, ?)'
    ).bind(questionId, student.id, reason, note || null).run();
  }

  return json({ ok: true });
}

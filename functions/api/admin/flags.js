import { checkAdminAuth, adminUnauth } from '../../_lib/admin-auth.js';
import { json } from '../../_lib/db.js';

// GET  /api/admin/flags?status=pending   list flagged questions
// PATCH /api/admin/flags                 body: { flagId, action: 'deactivate'|'dismiss' }
export async function onRequestGet({ request, env }) {
  const auth = await checkAdminAuth(request, env);
  if (!auth.ok) return adminUnauth(auth.error);

  const db     = env.streakprep_db;
  const url    = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';

  const rows = await db.prepare(`
    SELECT
      f.id as flag_id, f.question_id, f.reason, f.note, f.status, f.created_at,
      s.name as reviewer_name,
      q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
      q.correct, q.explanation, q.chapter_key, q.subject_can, q.grade, q.is_active
    FROM flagged_questions f
    JOIN students s  ON s.id = f.student_id
    JOIN questions q ON q.id = f.question_id
    WHERE f.status = ?
    ORDER BY f.created_at DESC
    LIMIT 100
  `).bind(status).all();

  return json({ flags: rows.results || [] });
}

export async function onRequestPatch({ request, env }) {
  const auth = await checkAdminAuth(request, env);
  if (!auth.ok) return adminUnauth(auth.error);

  const db = env.streakprep_db;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const { flagId, flagIds, action } = body;
  if (!['deactivate','dismiss'].includes(action)) return json({ error: 'invalid_action' }, 400);

  // Normalise to array
  const ids = flagIds ? flagIds : (flagId ? [flagId] : []);
  if (!ids.length) return json({ error: 'flag_id_required' }, 400);

  const placeholders = ids.map(() => '?').join(',');
  const flags = await db.prepare(
    `SELECT id, question_id FROM flagged_questions WHERE id IN (${placeholders})`
  ).bind(...ids).all();

  if (!flags.results?.length) return json({ error: 'flags_not_found' }, 404);

  if (action === 'deactivate') {
    const questionIds = [...new Set(flags.results.map(f => f.question_id))];
    const qPlaceholders = questionIds.map(() => '?').join(',');
    await db.batch([
      db.prepare(`UPDATE questions SET is_active = 0 WHERE id IN (${qPlaceholders})`).bind(...questionIds),
      db.prepare(`UPDATE flagged_questions SET status = 'deactivated' WHERE question_id IN (${qPlaceholders})`).bind(...questionIds),
    ]);
  } else {
    await db.prepare(
      `UPDATE flagged_questions SET status = 'dismissed' WHERE id IN (${placeholders})`
    ).bind(...ids).run();
  }

  return json({ ok: true, count: flags.results.length });
}

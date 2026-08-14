import { json } from '../_lib/db.js';
import { getSession } from '../_lib/auth.js';

// Fire-and-forget click-stream telemetry ingestion. Always returns 200 so a
// bad/late beacon never surfaces as an error to the client — track() calls
// are best-effort and must never affect the actual user-facing flow.
export async function onRequestPost({ request, env }) {
  const db = env.streakprep_db;

  let body;
  try { body = await request.json(); } catch { return json({ ok: true }); }

  const eventName = (body.event_name || '').slice(0, 100);
  if (!eventName) return json({ ok: true });

  const session = await getSession(request, db).catch(() => null);

  await db.prepare(`
    INSERT INTO events (event_name, anon_id, session_id, parent_id, student_id, props, path, referrer, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    eventName,
    body.anon_id || null,
    session ? session.id : null,
    session ? session.parent_id : null,
    session ? (session.active_student_id || null) : null,
    JSON.stringify(body.props || {}).slice(0, 2000),
    body.path || null,
    body.referrer || null,
    request.headers.get('user-agent') || null
  ).run();

  return json({ ok: true });
}

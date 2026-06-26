export async function getSession(request, db) {
  const auth  = (request.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;

  const now = Math.floor(Date.now() / 1000);
  const session = await db.prepare(`
    SELECT s.id, s.parent_id, s.active_student_id, s.expires_at,
           p.phone, p.email
    FROM sessions s
    JOIN parents p ON p.id = s.parent_id
    WHERE s.id = ? AND s.expires_at > ? AND p.is_active = 1
  `).bind(token, now).first();

  return session || null;
}

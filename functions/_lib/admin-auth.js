import { json } from './db.js';

export function getAdminSecret(env) {
  return env.ADMIN_SECRET || '';
}

export function checkAdminAuth(request, env) {
  const secret = getAdminSecret(env);
  if (!secret) return { ok: false, error: 'admin_not_configured' };
  const auth = (request.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Admin ') ? auth.slice(6).trim() : '';
  if (!token || token !== secret) return { ok: false, error: 'unauthorized' };
  return { ok: true };
}

export function adminUnauth(reason = 'unauthorized') {
  return json({ error: reason }, 401);
}

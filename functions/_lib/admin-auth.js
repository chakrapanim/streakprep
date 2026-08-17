import { json } from './db.js';
import { timingSafeEqual } from './crypto.js';
import { checkIpRateLimit, clientIp } from './rate-limit.js';

export function getAdminSecret(env) {
  return env.ADMIN_SECRET || '';
}

export async function checkAdminAuth(request, env) {
  const secret = getAdminSecret(env);
  if (!secret) return { ok: false, error: 'admin_not_configured' };

  // Throttle before comparing the secret so the admin bearer token can't be brute-forced.
  const db  = env.streakprep_db;
  const ip  = clientIp(request);
  const ok  = await checkIpRateLimit(db, 'admin_auth', ip, 30, 3600);
  if (!ok) return { ok: false, error: 'rate_limited' };

  const auth  = (request.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Admin ') ? auth.slice(6).trim() : '';
  if (!token || !timingSafeEqual(token, secret)) return { ok: false, error: 'unauthorized' };
  return { ok: true };
}

export function adminUnauth(reason = 'unauthorized') {
  return json({ error: reason }, reason === 'rate_limited' ? 429 : 401);
}

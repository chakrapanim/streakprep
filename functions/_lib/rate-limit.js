// Lightweight D1-backed fixed-window rate limiter, keyed by an arbitrary bucket +
// identifier (usually the caller's IP). Not a precise distributed limiter under heavy
// concurrency, but it's enough to blunt scripted abuse — the D1 write is the
// enforcement, not a lock.
export async function checkIpRateLimit(db, bucket, identifier, max, windowSeconds) {
  const now         = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;
  const key         = `${bucket}:${identifier || 'unknown'}`;

  const row = await db.prepare(
    'SELECT COUNT(*) as n FROM rate_limit_events WHERE key = ? AND created_at > ?'
  ).bind(key, windowStart).first();

  if ((row?.n || 0) >= max) return false;

  await db.prepare('INSERT INTO rate_limit_events (key, created_at) VALUES (?, ?)').bind(key, now).run();
  // Opportunistic cleanup so a hot key's row count doesn't grow unbounded.
  await db.prepare('DELETE FROM rate_limit_events WHERE key = ? AND created_at <= ?').bind(key, windowStart).run();

  return true;
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

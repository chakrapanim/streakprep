export function normalisePhone(phone) {
  const trimmed = phone.trim();
  const digits  = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return trimmed.replace(/\s/g, '');
  return '+91' + (digits.length === 10 ? digits : digits.slice(-10));
}

export async function getSetting(db, key, fallback) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : fallback;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

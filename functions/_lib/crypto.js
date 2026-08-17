const enc = new TextEncoder();

export async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(pin), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 10000, hash: 'SHA-256' },
    key, 256
  );
  return hex(new Uint8Array(bits));
}

export async function verifyPin(pin, salt, storedHash) {
  return (await hashPin(pin, salt)) === storedHash;
}

export async function hashOtp(otp) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(otp));
  return hex(new Uint8Array(buf));
}

export function randomHex(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return hex(arr);
}

export function randomOtp() {
  return String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
}

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function hex(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

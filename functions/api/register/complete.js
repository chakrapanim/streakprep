import { normalisePhone, json } from '../../_lib/db.js';
import { hasVerifiedOtp, otpConfigured } from '../../_lib/otp.js';
import { hashPin, randomHex } from '../../_lib/crypto.js';

export async function onRequestPost({ request, env }) {
  const db = env.streakprep_db;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const phone    = normalisePhone((body.phone || '').trim());
  const email    = (body.email || '').trim() || null;
  const pin      = (body.pin   || '').trim();
  const children = Array.isArray(body.children) ? body.children : [];
  const referral = (body.referral || '').trim().toUpperCase() || null;

  // Validate
  if (!phone)           return json({ error: 'phone_required' }, 400);
  if (!pin || !/^\d{4}$/.test(pin)) return json({ error: 'pin_invalid' }, 400);
  if (!children.length) return json({ error: 'children_required' }, 400);
  for (const c of children) {
    if (!c.name) return json({ error: 'name_required' }, 400);
    const cls = parseInt(c.class);
    if (!cls || cls < 6 || cls > 10) return json({ error: 'invalid_class' }, 400);
    if (!Array.isArray(c.subjects) || !c.subjects.length) return json({ error: 'subjects_required' }, 400);
  }

  // OTP verification — enforced once a delivery channel (WhatsApp/SMS) is configured.
  // Before that (dev/pre-launch) it's skipped so the flow isn't blocked.
  if (otpConfigured(env)) {
    const otpOk = await hasVerifiedOtp(db, phone);
    if (!otpOk) return json({ error: 'otp_not_verified' }, 403);
  }

  // Double-check not already registered (race condition guard)
  const existing = await db.prepare('SELECT id FROM parents WHERE phone = ?').bind(phone).first();
  if (existing) return json({ error: 'already_registered' }, 409);

  const now         = Math.floor(Date.now() / 1000);
  const trialEndsAt = now + 7 * 24 * 60 * 60;
  const graceUntil  = trialEndsAt + 24 * 60 * 60;

  // Hash PIN
  const salt         = randomHex(16);
  const passwordHash = await hashPin(pin, salt);

  // Insert parent
  await db.prepare(
    'INSERT INTO parents (phone, email, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(phone, email, passwordHash, salt, now, now).run();

  const parent   = await db.prepare('SELECT id FROM parents WHERE phone = ?').bind(phone).first();
  const parentId = parent.id;
  const studentIds = [];

  for (const child of children) {
    const subjectsJson = JSON.stringify(child.subjects);
    const plan         = planFor(child.subjects.length);

    const sr = await db.prepare(
      'INSERT INTO students (parent_id, name, class, subjects, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(parentId, child.name.trim(), parseInt(child.class), subjectsJson, now, now).run();

    const studentId = sr.meta.last_row_id;
    studentIds.push(studentId);

    await db.prepare(`
      INSERT INTO subscriptions
        (student_id, plan, subjects, status, amount_paise, trial_ends_at, grace_until, created_at, updated_at)
      VALUES (?, ?, ?, 'trial', ?, ?, ?, ?, ?)
    `).bind(studentId, plan.name, subjectsJson, plan.paise, trialEndsAt, graceUntil, now, now).run();

    await db.prepare(
      'INSERT OR IGNORE INTO streaks (student_id, current_streak, longest_streak, updated_at) VALUES (?, 0, 0, ?)'
    ).bind(studentId, now).run();
  }

  // Referral code — this parent's own code, to share with others.
  const firstName = children[0].name.trim();
  let myReferralCode = null;
  for (let i = 0; i < 5; i++) {
    const candidate = referralCode(firstName, i);
    try {
      await db.prepare('INSERT INTO referral_codes (parent_id, code, created_at) VALUES (?, ?, ?)')
        .bind(parentId, candidate, now).run();
      myReferralCode = candidate;
      break;
    } catch { /* collision, try next */ }
  }

  // If they entered someone else's referral code, record it. Reward is NOT
  // credited here — that happens on the referred student's first successful
  // payment (in the Razorpay webhook handler), so a signup that never
  // converts to paid can't be farmed for free rewards.
  if (referral) {
    const referrer = await db.prepare(
      'SELECT parent_id FROM referral_codes WHERE code = ?'
    ).bind(referral).first();
    if (referrer && referrer.parent_id !== parentId) {
      try {
        await db.prepare(
          'INSERT INTO referrals (referrer_parent_id, referred_parent_id, reward_given, created_at) VALUES (?, ?, 0, ?)'
        ).bind(referrer.parent_id, parentId, now).run();
      } catch { /* referred_parent_id already used (shouldn't happen for a brand-new parent) */ }
    }
  }

  // Create session
  const sessionToken = randomHex(32);
  const sessionExpiry = now + 30 * 24 * 60 * 60; // 30 days
  const firstStudentId = studentIds[0];

  await db.prepare(
    'INSERT INTO sessions (id, parent_id, active_student_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(sessionToken, parentId, firstStudentId, sessionExpiry, now).run();

  // Create trusted device token
  const trustedDays  = parseInt(await (await db.prepare('SELECT value FROM settings WHERE key = ?').bind('trusted_device_days').first())?.value ?? 90);
  const deviceToken  = randomHex(32);
  const deviceExpiry = now + trustedDays * 24 * 60 * 60;
  const userAgent    = request.headers.get('User-Agent') || '';

  await db.prepare(
    'INSERT INTO trusted_devices (parent_id, token, user_agent, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(parentId, deviceToken, userAgent, deviceExpiry, now).run();

  return json({ ok: true, sessionToken, deviceToken, parentId, studentIds, referralCode: myReferralCode });
}

function planFor(n) {
  if (n <= 1) return { name: 'starter', paise: 9900  };
  if (n <= 3) return { name: 'core',    paise: 19900 };
  return           { name: 'full',    paise: 24900 };
}

function referralCode(name, attempt) {
  const prefix = (name || 'SP').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4).padEnd(4, 'X');
  const rand   = randomHex(2).toUpperCase().slice(0, 4);
  return attempt === 0 ? prefix + rand : prefix + rand + attempt;
}

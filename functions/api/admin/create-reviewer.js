import { checkAdminAuth, adminUnauth } from '../../_lib/admin-auth.js';
import { json, normalisePhone } from '../../_lib/db.js';
import { hashPin, randomHex } from '../../_lib/crypto.js';

export async function onRequestPost({ request, env }) {
  const auth = checkAdminAuth(request, env);
  if (!auth.ok) return adminUnauth(auth.error);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const { name, phone, pin, reviewerClasses } = body;

  if (!name?.trim())                       return json({ error: 'name_required' }, 400);
  if (!phone?.trim())                      return json({ error: 'phone_required' }, 400);
  if (!/^\d{4}$/.test(pin))               return json({ error: 'pin_must_be_4_digits' }, 400);
  if (!Array.isArray(reviewerClasses) || reviewerClasses.length === 0)
                                           return json({ error: 'reviewer_classes_required' }, 400);

  const db          = env.streakprep_db;
  const normPhone   = normalisePhone(phone);
  const now         = Math.floor(Date.now() / 1000);
  const trialEnd    = now + 365 * 24 * 3600; // 1-year trial for reviewers
  const graceUntil  = trialEnd + 3 * 24 * 3600;

  // Check duplicate phone
  const existing = await db.prepare('SELECT id FROM parents WHERE phone = ?').bind(normPhone).first();
  if (existing) return json({ error: 'phone_already_registered' }, 409);

  const salt = randomHex(16);
  const hash = await hashPin(pin, salt);

  // All 5 subjects by default
  const subjects = JSON.stringify(['mathematics','science','english','hindi','social_science']);

  // Create parent
  await db.prepare(
    `INSERT INTO parents (phone, password_hash, password_salt, is_active, created_at)
     VALUES (?, ?, ?, 1, ?)`
  ).bind(normPhone, hash, salt, now).run();

  const parent = await db.prepare('SELECT id FROM parents WHERE phone = ?').bind(normPhone).first();

  // Create student
  await db.prepare(
    `INSERT INTO students (parent_id, name, class, subjects, is_reviewer, reviewer_classes, is_active, created_at)
     VALUES (?, ?, ?, ?, 1, ?, 1, ?)`
  ).bind(parent.id, name.trim(), 6, subjects, JSON.stringify(reviewerClasses), now).run();

  const student = await db.prepare(
    'SELECT id FROM students WHERE parent_id = ? ORDER BY id DESC LIMIT 1'
  ).bind(parent.id).first();

  // Subscription (long trial so reviewers are never blocked)
  await db.prepare(
    `INSERT INTO subscriptions (student_id, plan, subjects, amount_paise, status, trial_ends_at, grace_until, created_at)
     VALUES (?, 'full', ?, 0, 'trial', ?, ?, ?)`
  ).bind(student.id, subjects, trialEnd, graceUntil, now).run();

  // Streak row
  await db.prepare(
    'INSERT INTO streaks (student_id, current_streak, longest_streak) VALUES (?, 0, 0)'
  ).bind(student.id).run();

  return json({ ok: true, parentId: parent.id, studentId: student.id, phone: normPhone });
}

import { json } from '../../_lib/db.js';
import { sendWhatsAppTemplate } from '../../_lib/whatsapp.js';

// Daily reminder pass. Cloudflare Pages has no native Cron Trigger (that's a
// Workers-only feature), so this is a protected HTTP endpoint triggered by
// an external scheduler (.github/workflows/cron-reminders.yml) instead of a
// Cloudflare-side cron binding.
//
// Requires 4 new MSG91 Utility-category WhatsApp templates (Authentication
// templates, like the OTP one, legally cannot be reused for these) — each
// send is individually gated on its own template-name env var being set, so
// partially-configured reminders degrade gracefully rather than erroring:
//   MSG91_WA_TRIAL_TEMPLATE   — body_1: child name, body_2: status phrase
//   MSG91_WA_RENEWAL_TEMPLATE — body_1: child name, body_2: amount (rupees)
// (receipt/payment-failed sends live in the webhook handler, not here, since
// those are event-triggered, not day-based.)
export async function onRequestPost({ request, env }) {
  const db = env.streakprep_db;

  if (!env.CRON_SECRET) return json({ error: 'not_configured' }, 503);
  if (request.headers.get('x-cron-secret') !== env.CRON_SECRET) return json({ error: 'unauthorized' }, 401);

  const now = Math.floor(Date.now() / 1000);
  const DAY = 86400;
  const results = { trial_2days: 0, trial_lastday: 0, trial_grace: 0, trial_day14: 0, renewal_3days: 0, skipped_no_template: 0, errors: 0 };

  // ── Trial reminders (all read the RAW status='trial' column + time math —
  // trial subscriptions never get their DB status flipped to grace/expired;
  // that's only computed live for display in dashboard.js/account.js) ──
  const trialRows = await db.prepare(`
    SELECT s.id as sub_id, s.trial_ends_at, s.grace_until, st.name as student_name, p.phone
    FROM subscriptions s
    JOIN students st ON st.id = s.student_id AND st.is_active = 1
    JOIN parents  p  ON p.id  = st.parent_id AND p.is_active = 1
    WHERE s.status = 'trial'
  `).all();

  for (const row of trialRows.results || []) {
    const sinceEnd = now - row.trial_ends_at;
    let type = null, phrase = null;

    if (sinceEnd >= -2.5 * DAY && sinceEnd <= -1.5 * DAY) { type = 'trial_2days';  phrase = '2 days left in your free trial'; }
    else if (sinceEnd >= 0 && sinceEnd <= DAY)             { type = 'trial_lastday'; phrase = 'Last day of your free trial'; }
    else if (now > row.trial_ends_at && now < row.grace_until) { type = 'trial_grace'; phrase = 'Your trial ended — subscribe to resume'; }
    else if (sinceEnd >= 6 * DAY && sinceEnd <= 7 * DAY)   { type = 'trial_day14'; phrase = 'Come back anytime — your streak is waiting'; }

    if (!type) continue;
    await sendReminderOnce(db, env, row.sub_id, type, row.phone, env.MSG91_WA_TRIAL_TEMPLATE, [row.student_name, phrase], results, mapKey(type));
  }

  // ── Renewal-in-3-days notice (RBI requires pre-debit notification ≥24h
  // before an auto-charge; 3 days gives comfortable margin) ──
  const renewalRows = await db.prepare(`
    SELECT s.id as sub_id, s.current_period_end, s.amount_paise, st.name as student_name, p.phone
    FROM subscriptions s
    JOIN students st ON st.id = s.student_id AND st.is_active = 1
    JOIN parents  p  ON p.id  = st.parent_id AND p.is_active = 1
    WHERE s.status = 'active' AND s.current_period_end IS NOT NULL
  `).all();

  for (const row of renewalRows.results || []) {
    const until = row.current_period_end - now;
    if (until < 2.5 * DAY || until > 3.5 * DAY) continue;
    const rupees = (row.amount_paise / 100).toFixed(0);
    await sendReminderOnce(db, env, row.sub_id, 'renewal_3days', row.phone, env.MSG91_WA_RENEWAL_TEMPLATE, [row.student_name, rupees], results, 'renewal_3days');
  }

  return json({ ok: true, ...results });
}

async function sendReminderOnce(db, env, subId, type, phone, templateName, bodyParams, results, resultKey) {
  if (!templateName) { results.skipped_no_template++; return; }

  const already = await db.prepare(
    'SELECT id FROM reminder_log WHERE subscription_id = ? AND reminder_type = ?'
  ).bind(subId, type).first();
  if (already) return;

  try {
    await sendWhatsAppTemplate(env, phone, templateName, bodyParams);
    await db.prepare(
      'INSERT INTO reminder_log (subscription_id, reminder_type) VALUES (?, ?)'
    ).bind(subId, type).run();
    results[resultKey]++;
  } catch (e) {
    results.errors++;
  }
}

function mapKey(type) {
  return type === 'trial_2days' ? 'trial_2days'
       : type === 'trial_lastday' ? 'trial_lastday'
       : type === 'trial_grace' ? 'trial_grace'
       : 'trial_day14';
}

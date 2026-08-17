import { checkAdminAuth, adminUnauth } from '../../_lib/admin-auth.js';
import { json, getSetting } from '../../_lib/db.js';

// GET   /api/admin/settings   currently just the referral-rewards kill switch
// PATCH /api/admin/settings   body: { referralRewardsEnabled: boolean }
export async function onRequestGet({ request, env }) {
  const auth = await checkAdminAuth(request, env);
  if (!auth.ok) return adminUnauth(auth.error);

  const db = env.streakprep_db;
  const referralRewardsEnabled = (await getSetting(db, 'referral_rewards_enabled', '1')) === '1';

  return json({ referralRewardsEnabled });
}

export async function onRequestPatch({ request, env }) {
  const auth = await checkAdminAuth(request, env);
  if (!auth.ok) return adminUnauth(auth.error);

  const db = env.streakprep_db;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  if (typeof body.referralRewardsEnabled === 'boolean') {
    await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind('referral_rewards_enabled', body.referralRewardsEnabled ? '1' : '0').run();
  }

  return json({ ok: true });
}

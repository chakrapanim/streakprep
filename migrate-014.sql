-- Referral reward for an already-active subscriber: instead of touching Razorpay's
-- billing schedule (fragile — pause/resume has no future-scheduling, plan-swap has
-- no clean single-cycle revert), let their next real charge go through in full, then
-- refund it. This row tracks that pending refund until the next subscription.charged
-- webhook fires for this subscription.
CREATE TABLE IF NOT EXISTS referral_credits (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  referral_id          INTEGER NOT NULL REFERENCES referrals(id),
  subscription_id      INTEGER NOT NULL REFERENCES subscriptions(id),
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied')),
  applied_payment_id    TEXT,
  applied_amount_paise  INTEGER,
  created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
  applied_at           INTEGER
);

CREATE INDEX IF NOT EXISTS idx_referral_credits_sub_status ON referral_credits(subscription_id, status);

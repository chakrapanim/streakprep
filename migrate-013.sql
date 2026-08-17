-- Denormalized phone numbers on referrals so the "once per real person" guard
-- survives account deletion/recreation (parent_id churn) — a hard-deleted and
-- re-registered phone number must not be able to farm a second referral chain.
ALTER TABLE referrals ADD COLUMN referrer_phone TEXT;
ALTER TABLE referrals ADD COLUMN referred_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_phone ON referrals(referrer_phone);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_phone ON referrals(referred_phone);

-- Settings table exists in production but was never captured in schema.sql
-- (schema drift, found during the billing audit). Adding here for fresh installs;
-- IF NOT EXISTS makes this a no-op against production where it already exists.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Coupons: applied at subscribe-time, first-billing-cycle discount only (see
-- create-subscription.js). Referral rewards use the existing referral_codes/
-- referrals tables directly, no coupon row needed for those.
CREATE TABLE IF NOT EXISTS coupons (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT    NOT NULL UNIQUE,
  discount_type   TEXT    NOT NULL CHECK (discount_type IN ('percent','flat')),
  discount_value  INTEGER NOT NULL,   -- percent: 0-100; flat: paise
  max_redemptions INTEGER,            -- NULL = unlimited
  times_redeemed  INTEGER NOT NULL DEFAULT 0,
  expires_at      INTEGER,            -- NULL = never expires
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);

-- Records which coupon (if any) was applied when a subscription was created —
-- audit trail only, redemption counting lives on the coupons row itself.
ALTER TABLE subscriptions ADD COLUMN coupon_code TEXT;

-- Renewal grace period (days) after a failed recurring charge before a paid
-- subscription is treated as expired. Configurable via the same getSetting()
-- pattern already used for OTP/device settings.
INSERT OR IGNORE INTO settings (key, value) VALUES ('renewal_grace_days', '3');

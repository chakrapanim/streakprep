-- Adds 'pending' to subscriptions.status (SQLite can't ALTER a CHECK
-- constraint directly, so the table is recreated). 'pending' = a Razorpay
-- subscription was created but the first charge hasn't been confirmed by
-- webhook yet; distinct from 'trial' (which has its own live-expiry logic).
-- Column list is explicit on both sides (not SELECT *) — coupon_code was
-- appended at the end by a prior ALTER TABLE ADD COLUMN, not in the position
-- schema.sql shows it for documentation purposes.

CREATE TABLE subscriptions_new (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id              INTEGER NOT NULL REFERENCES students(id),
  plan                    TEXT    NOT NULL CHECK (plan IN ('starter','core','full')),
  subjects                TEXT    NOT NULL,
  status                  TEXT    NOT NULL DEFAULT 'trial'
                                  CHECK (status IN ('trial','pending','active','grace','expired','cancelled')),
  amount_paise            INTEGER NOT NULL,
  trial_ends_at           INTEGER NOT NULL,
  current_period_start    INTEGER,
  current_period_end      INTEGER,
  grace_until             INTEGER,
  razorpay_subscription_id TEXT,
  razorpay_payment_id     TEXT,
  cancelled_at            INTEGER,
  created_at              INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at              INTEGER NOT NULL DEFAULT (unixepoch()),
  coupon_code             TEXT
);

INSERT INTO subscriptions_new (
  id, student_id, plan, subjects, status, amount_paise, trial_ends_at,
  current_period_start, current_period_end, grace_until,
  razorpay_subscription_id, razorpay_payment_id, cancelled_at,
  created_at, updated_at, coupon_code
)
SELECT
  id, student_id, plan, subjects, status, amount_paise, trial_ends_at,
  current_period_start, current_period_end, grace_until,
  razorpay_subscription_id, razorpay_payment_id, cancelled_at,
  created_at, updated_at, coupon_code
FROM subscriptions;

DROP TABLE subscriptions;
ALTER TABLE subscriptions_new RENAME TO subscriptions;

CREATE INDEX IF NOT EXISTS idx_subs_student   ON subscriptions(student_id);
CREATE INDEX IF NOT EXISTS idx_subs_status    ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subs_trial_end ON subscriptions(trial_ends_at);

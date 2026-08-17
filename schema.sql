-- StreakPrep D1 Schema
-- All timestamps: Unix epoch seconds (INTEGER)
-- Money: paise (INTEGER, never float)
-- Soft deletes: is_active = 0, never hard delete

-- ─────────────────────────────────────────
-- PARENTS (one per guardian phone number)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  phone      TEXT    NOT NULL UNIQUE,   -- E.164 format: +919876543210
  name       TEXT,
  email      TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─────────────────────────────────────────
-- STUDENTS (children; many per parent)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS students (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER NOT NULL REFERENCES parents(id),
  name       TEXT    NOT NULL,
  class      INTEGER NOT NULL CHECK (class BETWEEN 6 AND 10),
  subjects   TEXT    NOT NULL,  -- JSON array: ["mathematics","science",...]
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_students_parent ON students(parent_id);

-- ─────────────────────────────────────────
-- SUBSCRIPTIONS
-- status: trial | active | grace | expired | cancelled
-- plan:   starter (1 subj) | core (3 subj) | full (5 subj)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id              INTEGER NOT NULL REFERENCES students(id),
  plan                    TEXT    NOT NULL CHECK (plan IN ('starter','core','full')),
  subjects                TEXT    NOT NULL,  -- JSON array at time of subscription
  status                  TEXT    NOT NULL DEFAULT 'trial'
                                  CHECK (status IN ('trial','active','grace','expired','cancelled')),
  amount_paise            INTEGER NOT NULL,  -- 9900 | 19900 | 24900
  trial_ends_at           INTEGER NOT NULL,
  current_period_start    INTEGER,
  current_period_end      INTEGER,
  grace_until             INTEGER,           -- 24h after period_end before blocking
  razorpay_subscription_id TEXT,
  razorpay_payment_id     TEXT,
  coupon_code             TEXT,              -- audit trail only; redemption count lives on coupons row
  cancelled_at            INTEGER,
  created_at              INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at              INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_subs_student   ON subscriptions(student_id);
CREATE INDEX IF NOT EXISTS idx_subs_status    ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subs_trial_end ON subscriptions(trial_ends_at);

-- ─────────────────────────────────────────
-- SETTINGS (key/value config, e.g. otp_max_per_hour, renewal_grace_days)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ─────────────────────────────────────────
-- COUPONS (first-billing-cycle discount, applied at subscribe-time)
-- ─────────────────────────────────────────
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

-- ─────────────────────────────────────────
-- OTP REQUESTS (WhatsApp login)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_requests (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  phone                TEXT    NOT NULL,
  otp_hash             TEXT    NOT NULL,   -- SHA-256 of OTP, never store plaintext
  expires_at           INTEGER NOT NULL,
  attempts             INTEGER NOT NULL DEFAULT 0,
  verified             INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
  msg91_request_id     TEXT,    -- correlates to MSG91's async delivery-report webhook
  delivery_status      TEXT,    -- sent | delivered | failed | read (from webhook, not the send call)
  delivery_reason      TEXT,    -- MSG91 failure reason, when delivery_status = 'failed'
  delivery_updated_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_requests(phone, verified);
CREATE INDEX IF NOT EXISTS idx_otp_msg91_request_id ON otp_requests(msg91_request_id);

-- ─────────────────────────────────────────
-- SESSIONS (auth)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT    PRIMARY KEY,  -- random 32-byte hex token
  parent_id         INTEGER NOT NULL REFERENCES parents(id),
  active_student_id INTEGER REFERENCES students(id),  -- which child's dashboard is shown
  expires_at        INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);

-- ─────────────────────────────────────────
-- QUIZ SESSIONS (one per student per day per subject)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id   INTEGER NOT NULL REFERENCES students(id),
  quiz_date    TEXT    NOT NULL,   -- 'YYYY-MM-DD' in IST
  subject      TEXT    NOT NULL,
  question_ids TEXT    NOT NULL,   -- JSON array of 5 question IDs from dqi.db
  status       TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','completed')),
  score        INTEGER,            -- 0–5, NULL until completed
  started_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER,
  UNIQUE (student_id, quiz_date, subject)
);

CREATE INDEX IF NOT EXISTS idx_quiz_student_date ON quiz_sessions(student_id, quiz_date);

-- ─────────────────────────────────────────
-- STUDENT ANSWERS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_answers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_session_id INTEGER NOT NULL REFERENCES quiz_sessions(id),
  question_id     INTEGER NOT NULL,  -- ID from dqi.db (read-only reference)
  answer          INTEGER NOT NULL,  -- 0–3 (option index chosen by student)
  is_correct      INTEGER NOT NULL,  -- 0 | 1
  answered_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_answers_session ON student_answers(quiz_session_id);

-- ─────────────────────────────────────────
-- STREAKS (one row per student, updated daily)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS streaks (
  student_id      INTEGER PRIMARY KEY REFERENCES students(id),
  current_streak  INTEGER NOT NULL DEFAULT 0,
  longest_streak  INTEGER NOT NULL DEFAULT 0,
  last_quiz_date  TEXT,   -- 'YYYY-MM-DD' in IST
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─────────────────────────────────────────
-- REFERRAL CODES (one permanent code per parent)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER NOT NULL UNIQUE REFERENCES parents(id),
  code       TEXT    NOT NULL UNIQUE,   -- e.g. 'RIYA2026', uppercase 8 chars
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─────────────────────────────────────────
-- REFERRALS (who brought whom)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_parent_id  INTEGER NOT NULL REFERENCES parents(id),
  referred_parent_id  INTEGER NOT NULL UNIQUE REFERENCES parents(id),  -- each parent referred at most once
  reward_given        INTEGER NOT NULL DEFAULT 0,  -- 1 once referrer is credited
  -- Denormalized phones (not just a live join to parents) so the "once per real
  -- person, lifetime" guard survives a hard-deleted-and-recreated account.
  referrer_phone      TEXT,
  referred_phone      TEXT,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_parent_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_phone ON referrals(referrer_phone);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_phone ON referrals(referred_phone);

-- ─────────────────────────────────────────
-- EVENTS (click-stream / funnel telemetry, self-hosted)
-- anon_id persists in localStorage from first landing-page visit, before any
-- login exists to key off of; parent_id/student_id fill in once authenticated.
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT    NOT NULL,
  anon_id    TEXT,
  session_id TEXT,
  parent_id  INTEGER,
  student_id INTEGER,
  props      TEXT,     -- JSON, event-specific details
  path       TEXT,
  referrer   TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_events_name    ON events(event_name, created_at);
CREATE INDEX IF NOT EXISTS idx_events_anon    ON events(anon_id);
CREATE INDEX IF NOT EXISTS idx_events_parent  ON events(parent_id);

-- ─────────────────────────────────────────
-- FLAGGED QUESTIONS (student-reported issues, reviewed by admin)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flagged_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT    NOT NULL REFERENCES questions(id),
  student_id  INTEGER NOT NULL REFERENCES students(id),
  reason      TEXT    NOT NULL CHECK (reason IN ('wrong_answer','bad_explanation','factual_error','unclear_question','other')),
  note        TEXT,
  status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','deactivated','dismissed')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─────────────────────────────────────────
-- REMINDER LOG (dedup for the daily reminder cron)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reminder_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  reminder_type   TEXT    NOT NULL,
  sent_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (subscription_id, reminder_type)
);

-- ─────────────────────────────────────────
-- RATE LIMIT EVENTS (backing store for functions/_lib/rate-limit.js)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_key_created ON rate_limit_events (key, created_at);

-- ─────────────────────────────────────────
-- PAYMENT EVENTS (immutable ledger)
-- Every Razorpay webhook lands here before touching subscriptions
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER REFERENCES subscriptions(id),
  event_type      TEXT    NOT NULL,   -- 'payment.captured' | 'payment.failed' | etc.
  razorpay_event_id TEXT  UNIQUE,     -- dedup key from webhook
  payload         TEXT    NOT NULL,   -- raw JSON from Razorpay
  processed       INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE parents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  phone      TEXT    NOT NULL UNIQUE,   -- E.164 format: +919876543210
  name       TEXT,
  email      TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
, password_hash TEXT, password_salt TEXT);
CREATE TABLE students (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  class      INTEGER NOT NULL CHECK (class BETWEEN 6 AND 10),
  subjects   TEXT    NOT NULL,  -- JSON array: ["mathematics","science",...]
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
, is_reviewer INTEGER NOT NULL DEFAULT 0, reviewer_classes TEXT DEFAULT NULL);
CREATE TABLE otp_requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  phone      TEXT    NOT NULL,
  otp_hash   TEXT    NOT NULL,   -- SHA-256 of OTP, never store plaintext
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  verified   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
, msg91_request_id   TEXT, delivery_status     TEXT, delivery_reason     TEXT, delivery_updated_at INTEGER);
CREATE TABLE sessions (
  id                TEXT    PRIMARY KEY,  -- random 32-byte hex token
  parent_id         INTEGER NOT NULL,
  active_student_id INTEGER,  -- which child's dashboard is shown
  expires_at        INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE quiz_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id   INTEGER NOT NULL,
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
CREATE TABLE streaks (
  student_id      INTEGER PRIMARY KEY,
  current_streak  INTEGER NOT NULL DEFAULT 0,
  longest_streak  INTEGER NOT NULL DEFAULT 0,
  last_quiz_date  TEXT,   -- 'YYYY-MM-DD' in IST
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE referral_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER NOT NULL UNIQUE,
  code       TEXT    NOT NULL UNIQUE,   -- e.g. 'RIYA2026', uppercase 8 chars
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE referrals (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_parent_id  INTEGER NOT NULL,
  referred_parent_id  INTEGER NOT NULL UNIQUE,  -- each parent referred at most once
  reward_given        INTEGER NOT NULL DEFAULT 0,  -- 1 once referrer is credited
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
, referrer_phone TEXT, referred_phone TEXT);
CREATE TABLE payment_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER,
  event_type      TEXT    NOT NULL,   -- 'payment.captured' | 'payment.failed' | etc.
  razorpay_event_id TEXT  UNIQUE,     -- dedup key from webhook
  payload         TEXT    NOT NULL,   -- raw JSON from Razorpay
  processed       INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE trusted_devices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER NOT NULL,
  token      TEXT    NOT NULL UNIQUE,
  user_agent TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE settings (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE questions (
  id           TEXT PRIMARY KEY,
  grade        INTEGER NOT NULL,
  class_label  TEXT NOT NULL,
  subject_key  TEXT NOT NULL,
  subject_can  TEXT NOT NULL,
  chapter_key  TEXT NOT NULL,
  concept      TEXT,
  question_text TEXT NOT NULL,
  option_a     TEXT NOT NULL,
  option_b     TEXT NOT NULL,
  option_c     TEXT NOT NULL,
  option_d     TEXT NOT NULL,
  correct      TEXT NOT NULL,
  explanation  TEXT NOT NULL,
  difficulty   TEXT DEFAULT 'medium'
, is_active INTEGER NOT NULL DEFAULT 1, image_path TEXT);
CREATE TABLE student_answers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_session_id INTEGER NOT NULL,
  question_id     TEXT    NOT NULL,
  answer          TEXT    NOT NULL CHECK (answer IN ('A','B','C','D')),
  is_correct      INTEGER NOT NULL CHECK (is_correct IN (0,1)),
  answered_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE flagged_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT    NOT NULL,
  student_id  INTEGER NOT NULL,
  reason      TEXT    NOT NULL CHECK (reason IN ('wrong_answer','bad_explanation','factual_error','unclear_question','other')),
  note        TEXT,
  status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','deactivated','dismissed')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT    NOT NULL,
  anon_id    TEXT,
  session_id TEXT,
  parent_id  INTEGER,
  student_id INTEGER,
  props      TEXT,
  path       TEXT,
  referrer   TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE coupons (
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
CREATE TABLE IF NOT EXISTS "subscriptions" (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id              INTEGER NOT NULL,
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
CREATE TABLE reminder_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL,
  reminder_type   TEXT    NOT NULL,
  sent_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (subscription_id, reminder_type)
);
CREATE TABLE rate_limit_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE referral_credits (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  referral_id          INTEGER NOT NULL,
  subscription_id      INTEGER NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied')),
  applied_payment_id    TEXT,
  applied_amount_paise  INTEGER,
  created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
  applied_at           INTEGER
);
DELETE FROM sqlite_sequence;
CREATE INDEX idx_students_parent ON students(parent_id);
CREATE INDEX idx_otp_phone ON otp_requests(phone, verified);
CREATE INDEX idx_sessions_parent ON sessions(parent_id);
CREATE INDEX idx_quiz_student_date ON quiz_sessions(student_id, quiz_date);
CREATE INDEX idx_referrals_referrer ON referrals(referrer_parent_id);
CREATE INDEX idx_trusted_token  ON trusted_devices(token);
CREATE INDEX idx_trusted_parent ON trusted_devices(parent_id);
CREATE INDEX idx_q_serving ON questions(grade, subject_can);
CREATE INDEX idx_q_concept  ON questions(grade, subject_can, concept);
CREATE INDEX idx_fq_question ON flagged_questions(question_id);
CREATE INDEX idx_fq_status   ON flagged_questions(status);
CREATE INDEX idx_otp_msg91_request_id ON otp_requests(msg91_request_id);
CREATE INDEX idx_events_name   ON events(event_name, created_at);
CREATE INDEX idx_events_anon   ON events(anon_id);
CREATE INDEX idx_events_parent ON events(parent_id);
CREATE INDEX idx_coupons_code ON coupons(code);
CREATE INDEX idx_subs_student   ON subscriptions(student_id);
CREATE INDEX idx_subs_status    ON subscriptions(status);
CREATE INDEX idx_subs_trial_end ON subscriptions(trial_ends_at);
CREATE INDEX idx_rate_limit_events_key_created ON rate_limit_events (key, created_at);
CREATE INDEX idx_referrals_referrer_phone ON referrals(referrer_phone);
CREATE INDEX idx_referrals_referred_phone ON referrals(referred_phone);
CREATE INDEX idx_referral_credits_sub_status ON referral_credits(subscription_id, status);

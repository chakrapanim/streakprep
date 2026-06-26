ALTER TABLE questions ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS flagged_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT    NOT NULL REFERENCES questions(id),
  student_id  INTEGER NOT NULL REFERENCES students(id),
  reason      TEXT    NOT NULL CHECK (reason IN ('wrong_answer','bad_explanation','factual_error','unclear_question','other')),
  note        TEXT,
  status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','deactivated','dismissed')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_fq_question ON flagged_questions(question_id);
CREATE INDEX IF NOT EXISTS idx_fq_status   ON flagged_questions(status);

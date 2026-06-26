-- Fix student_answers to use TEXT question_id and TEXT answer (A/B/C/D)
-- These tables are empty so we can safely recreate them.
DROP TABLE IF EXISTS student_answers;
CREATE TABLE student_answers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_session_id INTEGER NOT NULL REFERENCES quiz_sessions(id),
  question_id     TEXT    NOT NULL,
  answer          TEXT    NOT NULL CHECK (answer IN ('A','B','C','D')),
  is_correct      INTEGER NOT NULL CHECK (is_correct IN (0,1)),
  answered_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

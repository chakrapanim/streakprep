CREATE TABLE IF NOT EXISTS questions (
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
);

CREATE INDEX IF NOT EXISTS idx_q_serving ON questions(grade, subject_can);
CREATE INDEX IF NOT EXISTS idx_q_concept  ON questions(grade, subject_can, concept);

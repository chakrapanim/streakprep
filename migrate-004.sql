-- Reviewer mode: special quiz privileges for paid testers
ALTER TABLE students ADD COLUMN is_reviewer INTEGER NOT NULL DEFAULT 0;
-- JSON array of allowed grades, e.g. '[6,7,8,9,10]'. NULL = own class only.
ALTER TABLE students ADD COLUMN reviewer_classes TEXT DEFAULT NULL;

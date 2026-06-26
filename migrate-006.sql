-- migrate-006: add image_path to questions for Manim-generated diagram questions
ALTER TABLE questions ADD COLUMN image_path TEXT;

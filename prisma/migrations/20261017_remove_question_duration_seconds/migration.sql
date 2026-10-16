-- Remove question-level duration_seconds as quiz timer is standardized on assessment.duration_minutes
ALTER TABLE "questions" DROP COLUMN IF EXISTS "duration_seconds";

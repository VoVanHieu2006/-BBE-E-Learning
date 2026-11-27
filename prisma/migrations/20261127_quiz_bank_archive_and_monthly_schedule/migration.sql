-- ADR-0001: soft-archive questions that already have attempts, and keep the next-month
-- question_count / duration_minutes schedule on the assessment itself.
-- Additive and nullable: existing rows are unchanged (NULL = active question / no schedule).
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP;

CREATE INDEX IF NOT EXISTS "questions_assessment_id_archived_at_sort_order_idx" ON "questions"("assessment_id", "archived_at", "sort_order");

ALTER TABLE "assessments" ADD COLUMN IF NOT EXISTS "scheduled_question_count" INTEGER;
ALTER TABLE "assessments" ADD COLUMN IF NOT EXISTS "scheduled_duration_minutes" INTEGER;
ALTER TABLE "assessments" ADD COLUMN IF NOT EXISTS "scheduled_effective_at" TIMESTAMP;
ALTER TABLE "assessments" ADD COLUMN IF NOT EXISTS "scheduled_effective_month_key" VARCHAR(7);
ALTER TABLE "assessments" ADD COLUMN IF NOT EXISTS "scheduled_by_user_id" UUID;
ALTER TABLE "assessments" ADD COLUMN IF NOT EXISTS "scheduled_at" TIMESTAMP;

CREATE INDEX IF NOT EXISTS "assessments_scheduled_effective_at_idx" ON "assessments"("scheduled_effective_at");

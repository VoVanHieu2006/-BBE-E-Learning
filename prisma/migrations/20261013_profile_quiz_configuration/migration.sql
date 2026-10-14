ALTER TABLE "users" ADD COLUMN "display_name" VARCHAR(120);
ALTER TABLE "invitations" ADD COLUMN "display_name" VARCHAR(120);
ALTER TABLE "chapter_reorganization_items" ADD COLUMN "display_name" VARCHAR(120);
ALTER TABLE "assessments" ADD COLUMN "question_count" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "assessments" ADD COLUMN "duration_minutes" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "assessments"
  ADD CONSTRAINT "assessments_question_count_check" CHECK ("question_count" BETWEEN 1 AND 100),
  ADD CONSTRAINT "assessments_duration_minutes_check" CHECK ("duration_minutes" BETWEEN 1 AND 240);

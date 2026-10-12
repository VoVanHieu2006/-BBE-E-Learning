CREATE TYPE "assessment_type" AS ENUM ('LESSON', 'COURSE_FINAL');

ALTER TABLE "assessments"
  ADD COLUMN "type" "assessment_type" NOT NULL DEFAULT 'LESSON',
  ADD COLUMN "course_id" UUID,
  ALTER COLUMN "lesson_id" DROP NOT NULL;

ALTER TABLE "assessments"
  ADD CONSTRAINT "assessments_course_id_fkey"
  FOREIGN KEY ("course_id") REFERENCES "courses"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "assessments_course_id_key" ON "assessments"("course_id");

ALTER TABLE "assessments"
  ADD CONSTRAINT "assessments_exactly_one_owner_check"
  CHECK (
    ("type" = 'LESSON' AND "lesson_id" IS NOT NULL AND "course_id" IS NULL)
    OR
    ("type" = 'COURSE_FINAL' AND "lesson_id" IS NULL AND "course_id" IS NOT NULL)
  );

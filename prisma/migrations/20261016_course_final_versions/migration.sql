BEGIN;

CREATE TABLE "final_exam_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assessment_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "question_count" INTEGER NOT NULL,
  "duration_minutes" INTEGER NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "final_exam_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "final_exam_versions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "final_exam_versions_assessment_id_version_number_key" ON "final_exam_versions"("assessment_id", "version_number");
CREATE UNIQUE INDEX "final_exam_versions_one_active_per_assessment" ON "final_exam_versions"("assessment_id") WHERE "is_active";
CREATE INDEX "final_exam_versions_assessment_id_is_active_idx" ON "final_exam_versions"("assessment_id", "is_active");

ALTER TABLE "questions" ADD COLUMN "final_exam_version_id" UUID;
ALTER TABLE "questions" ADD COLUMN "source_assessment_id" UUID;
ALTER TABLE "questions" ADD CONSTRAINT "questions_final_exam_version_id_fkey" FOREIGN KEY ("final_exam_version_id") REFERENCES "final_exam_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "questions_final_exam_version_id_idx" ON "questions"("final_exam_version_id");

ALTER TABLE "attempts" ADD COLUMN "final_exam_version_id" UUID;
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_final_exam_version_id_fkey" FOREIGN KEY ("final_exam_version_id") REFERENCES "final_exam_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "attempts_final_exam_version_id_idx" ON "attempts"("final_exam_version_id");

-- Existing scores remain unchanged. Clone every currently available source
-- question, including questions referenced by an old final-exam attempt.
INSERT INTO "final_exam_versions" ("assessment_id", "version_number", "is_active", "question_count", "duration_minutes", "title", "description")
SELECT "id", 1, true, "question_count", "duration_minutes", "title", "description"
FROM "assessments" WHERE "type" = 'COURSE_FINAL';

CREATE TEMP TABLE "_final_question_map" ON COMMIT DROP AS
SELECT source."assessment_id", source."source_id", gen_random_uuid() AS "copy_id", source."version_id"
FROM (SELECT DISTINCT a."id" AS "assessment_id", q."id" AS "source_id", v."id" AS "version_id"
FROM "assessments" a
JOIN "final_exam_versions" v ON v."assessment_id" = a."id"
JOIN "questions" q ON q."assessment_id" IN (
  SELECT la."id" FROM "assessments" la
  JOIN "lessons" l ON l."id" = la."lesson_id"
  JOIN "sessions" s ON s."id" = l."session_id"
  WHERE la."type" = 'LESSON' AND s."course_id" = a."course_id"
)
WHERE a."type" = 'COURSE_FINAL') source;

INSERT INTO "_final_question_map" ("assessment_id", "source_id", "copy_id", "version_id")
SELECT source."assessment_id", source."source_id", gen_random_uuid(), source."version_id"
FROM (SELECT DISTINCT a."id" AS "assessment_id", q."id" AS "source_id", v."id" AS "version_id"
FROM "assessments" a
JOIN "final_exam_versions" v ON v."assessment_id" = a."id"
JOIN "attempts" at ON at."assessment_id" = a."id"
JOIN "attempt_questions" aq ON aq."attempt_id" = at."id"
JOIN "questions" q ON q."id" = aq."question_id") source
WHERE NOT EXISTS (SELECT 1 FROM "_final_question_map" m WHERE m."assessment_id" = source."assessment_id" AND m."source_id" = source."source_id");

CREATE UNIQUE INDEX ON "_final_question_map"("assessment_id", "source_id");

INSERT INTO "questions" ("id", "assessment_id", "question_text", "question_type", "points", "duration_seconds", "sort_order", "explanation", "pool_id", "final_exam_version_id", "source_assessment_id", "created_at", "updated_at")
SELECT m."copy_id", m."assessment_id", q."question_text", q."question_type", q."points", q."duration_seconds", q."sort_order", q."explanation", NULL, m."version_id", q."assessment_id", q."created_at", q."updated_at"
FROM "_final_question_map" m JOIN "questions" q ON q."id" = m."source_id";

CREATE TEMP TABLE "_final_option_map" ON COMMIT DROP AS
SELECT m."assessment_id", o."id" AS "source_id", gen_random_uuid() AS "copy_id", m."copy_id" AS "question_id"
FROM "_final_question_map" m JOIN "question_options" o ON o."question_id" = m."source_id";
CREATE UNIQUE INDEX ON "_final_option_map"("assessment_id", "source_id");

INSERT INTO "question_options" ("id", "question_id", "option_text", "is_correct", "sort_order")
SELECT m."copy_id", m."question_id", o."option_text", o."is_correct", o."sort_order"
FROM "_final_option_map" m JOIN "question_options" o ON o."id" = m."source_id";

UPDATE "attempt_answers" aa SET "selected_option_id" = om."copy_id"
FROM "attempts" at JOIN "_final_option_map" om ON om."assessment_id" = at."assessment_id"
WHERE aa."attempt_id" = at."id" AND aa."selected_option_id" = om."source_id";

UPDATE "attempt_answers" aa SET "question_id" = m."copy_id"
FROM "attempts" at JOIN "_final_question_map" m ON m."assessment_id" = at."assessment_id"
WHERE aa."attempt_id" = at."id" AND aa."question_id" = m."source_id";

UPDATE "attempt_questions" aq SET "question_id" = m."copy_id"
FROM "attempts" at JOIN "_final_question_map" m ON m."assessment_id" = at."assessment_id"
WHERE aq."attempt_id" = at."id" AND aq."question_id" = m."source_id";

UPDATE "attempts" at SET "final_exam_version_id" = v."id"
FROM "final_exam_versions" v WHERE at."assessment_id" = v."assessment_id";

COMMIT;

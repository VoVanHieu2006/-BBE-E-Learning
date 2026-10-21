BEGIN;

-- DropForeignKey
ALTER TABLE "lesson_progress" DROP CONSTRAINT "lesson_progress_user_id_fkey";

-- DropForeignKey
ALTER TABLE "attempts" DROP CONSTRAINT "attempts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_learning_assignments" DROP CONSTRAINT "user_learning_assignments_user_id_fkey";

-- DropForeignKey
ALTER TABLE "star_ledger" DROP CONSTRAINT "star_ledger_user_id_fkey";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "anonymized_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "content_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "program_id" UUID;

-- AlterTable
ALTER TABLE "attempts" ADD COLUMN     "cancellation_reason" VARCHAR(120),
ADD COLUMN     "grading_snapshot" JSONB,
ADD COLUMN     "learning_cycle_id" UUID;

-- AlterTable
ALTER TABLE "attempt_questions" ADD COLUMN     "question_snapshot" JSONB;

-- AlterTable
ALTER TABLE "organization_units" ADD COLUMN     "code" VARCHAR(100);

-- AlterTable
ALTER TABLE "learning_rules" ADD COLUMN     "target_code" VARCHAR(100);

-- AlterTable
ALTER TABLE "user_learning_assignments" ADD COLUMN     "learning_cycle_id" UUID,
ADD COLUMN     "requirement_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "source_rule_ids" UUID[] DEFAULT ARRAY[]::UUID[];

-- AlterTable
ALTER TABLE "star_ledger" ADD COLUMN     "chapter_at_award_id" UUID,
ADD COLUMN     "competition_month_id" UUID,
ADD COLUMN     "learning_cycle_id" UUID,
ADD COLUMN     "provenance" VARCHAR(30) NOT NULL DEFAULT 'LEGACY';

-- AlterTable
ALTER TABLE "chapter_reorganizations" ADD COLUMN     "apply_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_error" TEXT,
ADD COLUMN     "transfer_season_id" UUID;

-- AlterTable
ALTER TABLE "chapter_reorganization_items" ALTER COLUMN "department_unit_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "learning_policy" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "cutover_at" TIMESTAMPTZ(3),
    "mapping_approved_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "learning_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_months" (
    "id" UUID NOT NULL,
    "key" VARCHAR(7) NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "state" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "competition_months_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_seasons" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transfer_seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapter_competition_terms" (
    "id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "season_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),

    CONSTRAINT "chapter_competition_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_cycles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "chapter_id" UUID,
    "trigger_key" VARCHAR(255) NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "provenance" VARCHAR(30) NOT NULL DEFAULT 'NATIVE',

    CONSTRAINT "learning_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_lesson_progress" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "learning_cycle_id" UUID NOT NULL,
    "furthest_seconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ(3),
    "unlocked_at" TIMESTAMPTZ(3),
    "provenance" VARCHAR(30) NOT NULL DEFAULT 'NATIVE',

    CONSTRAINT "cycle_lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_video_replays" (
    "view_session_id" VARCHAR(80),
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "video_id" UUID NOT NULL,
    "competition_month_id" UUID NOT NULL,
    "learning_cycle_id" UUID NOT NULL,
    "furthest_seconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "last_heartbeat_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "monthly_video_replays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_reward_high_water_marks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "competition_month_id" UUID NOT NULL,
    "learning_cycle_id" UUID NOT NULL,
    "reward_question_count" INTEGER NOT NULL,
    "reward_config" JSONB NOT NULL,
    "maximum_stars" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quiz_reward_high_water_marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_paths" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "learning_cycle_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "due_at" TIMESTAMPTZ(3),
    "imported_due_at" TIMESTAMPTZ(3),
    "budget_fingerprint" TEXT NOT NULL DEFAULT '',
    "budget" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "learning_paths_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_path_changes" (
    "id" UUID NOT NULL,
    "path_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL,
    "previous_budget" JSONB NOT NULL,
    "next_budget" JSONB NOT NULL,
    "due_at" TIMESTAMPTZ(3),
    "reason" VARCHAR(120) NOT NULL,

    CONSTRAINT "learning_path_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_outbox" (
    "id" UUID NOT NULL,
    "event_key" VARCHAR(255) NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "user_id" UUID,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "last_error" TEXT,

    CONSTRAINT "learning_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_snapshots" (
    "id" UUID NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "learning_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_programs" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "is_core" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "learning_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_targets" (
    "code" VARCHAR(100) NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "department_code" VARCHAR(100),
    "position_code" VARCHAR(100),
    "dna_unit_code" VARCHAR(100),
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "learning_targets_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "course_requirement_versions" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "lesson_ids" UUID[],
    "assessment_ids" UUID[],
    "final_version_id" UUID,
    "published_at" TIMESTAMPTZ(3) NOT NULL,
    "fingerprint" TEXT NOT NULL,

    CONSTRAINT "course_requirement_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplemental_learning_requirements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "learning_cycle_id" UUID NOT NULL,
    "requirement_version_id" UUID NOT NULL,
    "lesson_ids" UUID[],
    "added_days" INTEGER NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "violated_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "supplemental_learning_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_notices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_key" VARCHAR(255) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "learning_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_state_intervals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(40) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),

    CONSTRAINT "account_state_intervals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapter_affiliation_intervals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),

    CONSTRAINT "chapter_affiliation_intervals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_publication_events" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "course_publication_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "competition_months_key_key" ON "competition_months"("key");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_seasons_code_key" ON "transfer_seasons"("code");

-- CreateIndex
CREATE INDEX "chapter_competition_terms_chapter_id_starts_at_ends_at_idx" ON "chapter_competition_terms"("chapter_id", "starts_at", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "chapter_competition_terms_chapter_id_season_id_key" ON "chapter_competition_terms"("chapter_id", "season_id");

-- CreateIndex
CREATE UNIQUE INDEX "learning_cycles_trigger_key_key" ON "learning_cycles"("trigger_key");

-- CreateIndex
CREATE INDEX "learning_cycles_user_id_ends_at_idx" ON "learning_cycles"("user_id", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_lesson_progress_user_id_lesson_id_learning_cycle_id_key" ON "cycle_lesson_progress"("user_id", "lesson_id", "learning_cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_video_replays_user_id_video_id_competition_month_id_key" ON "monthly_video_replays"("user_id", "video_id", "competition_month_id", "learning_cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_reward_high_water_marks_user_id_assessment_id_competit_key" ON "quiz_reward_high_water_marks"("user_id", "assessment_id", "competition_month_id", "learning_cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "learning_paths_learning_cycle_id_key" ON "learning_paths"("learning_cycle_id");

-- CreateIndex
CREATE INDEX "learning_path_changes_path_id_changed_at_idx" ON "learning_path_changes"("path_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "learning_outbox_event_key_key" ON "learning_outbox"("event_key");

-- CreateIndex
CREATE INDEX "learning_outbox_processed_at_available_at_idx" ON "learning_outbox"("processed_at", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "learning_snapshots_key_key" ON "learning_snapshots"("key");

-- CreateIndex
CREATE UNIQUE INDEX "learning_programs_code_key" ON "learning_programs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "course_requirement_versions_course_id_version_key" ON "course_requirement_versions"("course_id", "version");

-- CreateIndex
CREATE INDEX "supplemental_learning_requirements_completed_at_due_at_idx" ON "supplemental_learning_requirements"("completed_at", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "supplemental_learning_requirements_user_id_learning_cycle_i_key" ON "supplemental_learning_requirements"("user_id", "learning_cycle_id", "requirement_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "learning_notices_event_key_key" ON "learning_notices"("event_key");

-- CreateIndex
CREATE INDEX "learning_notices_user_id_read_at_idx" ON "learning_notices"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "account_state_intervals_user_id_starts_at_ends_at_idx" ON "account_state_intervals"("user_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "chapter_affiliation_intervals_chapter_id_starts_at_ends_at_idx" ON "chapter_affiliation_intervals"("chapter_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "course_publication_events_course_id_effective_at_idx" ON "course_publication_events"("course_id", "effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_learning_assignments_user_id_course_id_learning_cycle__key" ON "user_learning_assignments"("user_id", "course_id", "learning_cycle_id");

-- CreateIndex
CREATE INDEX "star_ledger_competition_month_id_chapter_at_award_id_idx" ON "star_ledger"("competition_month_id", "chapter_at_award_id");

-- CreateIndex
CREATE INDEX "star_ledger_learning_cycle_id_user_id_idx" ON "star_ledger"("learning_cycle_id", "user_id");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "learning_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempt_cycle_fk" FOREIGN KEY ("learning_cycle_id") REFERENCES "learning_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_learning_assignments" ADD CONSTRAINT "assignment_cycle_fk" FOREIGN KEY ("learning_cycle_id") REFERENCES "learning_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_learning_assignments" ADD CONSTRAINT "user_learning_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "star_ledger" ADD CONSTRAINT "star_month_fk" FOREIGN KEY ("competition_month_id") REFERENCES "competition_months"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "star_ledger" ADD CONSTRAINT "star_cycle_fk" FOREIGN KEY ("learning_cycle_id") REFERENCES "learning_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "star_ledger" ADD CONSTRAINT "star_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_lesson_progress" ADD CONSTRAINT "progress_cycle_fk" FOREIGN KEY ("learning_cycle_id") REFERENCES "learning_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_video_replays" ADD CONSTRAINT "replay_cycle_fk" FOREIGN KEY ("learning_cycle_id") REFERENCES "learning_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_video_replays" ADD CONSTRAINT "replay_month_fk" FOREIGN KEY ("competition_month_id") REFERENCES "competition_months"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_reward_high_water_marks" ADD CONSTRAINT "mark_cycle_fk" FOREIGN KEY ("learning_cycle_id") REFERENCES "learning_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_reward_high_water_marks" ADD CONSTRAINT "mark_month_fk" FOREIGN KEY ("competition_month_id") REFERENCES "competition_months"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_paths" ADD CONSTRAINT "path_cycle_fk" FOREIGN KEY ("learning_cycle_id") REFERENCES "learning_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;

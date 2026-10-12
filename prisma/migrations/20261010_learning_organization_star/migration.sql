-- Organization-aware learning, account restrictions, Star rewards and KPI.
-- This is additive: existing users, ChapterMember, progress and attempts remain intact.

CREATE TYPE "organization_unit_type" AS ENUM ('ROOT', 'DNA', 'CHAPTER', 'DEPARTMENT');
CREATE TYPE "organization_membership_status" AS ENUM ('ACTIVE', 'ENDED');
CREATE TYPE "position_scope" AS ENUM ('PLATFORM', 'DNA', 'CHAPTER', 'DEPARTMENT');
CREATE TYPE "learning_assignment_status" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'WAIVED', 'ENDED');
CREATE TYPE "restriction_type" AS ENUM ('DIRECT_ADMIN', 'DEADLINE', 'CHAPTER_CASCADE');
CREATE TYPE "kpi_status" AS ENUM ('RED', 'YELLOW', 'GREEN');
CREATE TYPE "star_reason" AS ENUM ('VIDEO_COMPLETION', 'MODULE_QUIZ_PASS', 'MODULE_QUIZ_BONUS', 'COURSE_FINAL_PASS', 'COURSE_FINAL_BONUS', 'ADMIN_ADJUSTMENT');

ALTER TABLE "users" ADD COLUMN "auth_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "chapters" ADD COLUMN "organization_unit_id" UUID;
ALTER TABLE "courses" ADD COLUMN "cover_url" VARCHAR(1000), ADD COLUMN "cover_public_id" VARCHAR(500);
ALTER TABLE "questions" ADD COLUMN "pool_id" UUID;

CREATE TABLE "organization_units" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(255) NOT NULL,
  "type" "organization_unit_type" NOT NULL,
  "parent_id" UUID,
  "status" "chapter_status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_units_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_units_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "organization_units_parent_id_name_key" ON "organization_units"("parent_id", "name");
CREATE INDEX "organization_units_type_status_idx" ON "organization_units"("type", "status");
CREATE INDEX "organization_units_parent_id_idx" ON "organization_units"("parent_id");

CREATE TABLE "organization_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "user_id" UUID NOT NULL, "unit_id" UUID NOT NULL,
  "status" "organization_membership_status" NOT NULL DEFAULT 'ACTIVE', "starts_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ends_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "organization_memberships_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "organization_units"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "organization_memberships_user_id_status_idx" ON "organization_memberships"("user_id", "status");
CREATE INDEX "organization_memberships_unit_id_status_idx" ON "organization_memberships"("unit_id", "status");

CREATE TABLE "positions" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "code" VARCHAR(100) NOT NULL, "name" VARCHAR(255) NOT NULL, "scope" "position_scope" NOT NULL, "is_manager" BOOLEAN NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "positions_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "positions_code_key" ON "positions"("code");
CREATE TABLE "permissions" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "code" VARCHAR(120) NOT NULL, "description" TEXT, "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "permissions_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");
CREATE TABLE "position_permissions" ("position_id" UUID NOT NULL, "permission_id" UUID NOT NULL, CONSTRAINT "position_permissions_pkey" PRIMARY KEY ("position_id", "permission_id"), CONSTRAINT "position_permissions_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "position_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE TABLE "position_assignments" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "user_id" UUID NOT NULL, "position_id" UUID NOT NULL, "unit_id" UUID NOT NULL, "is_primary" BOOLEAN NOT NULL DEFAULT false, "starts_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "ends_at" TIMESTAMP, "appointed_by" UUID, "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "position_assignments_pkey" PRIMARY KEY ("id"), CONSTRAINT "position_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "position_assignments_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE, CONSTRAINT "position_assignments_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE INDEX "position_assignments_user_id_starts_at_ends_at_idx" ON "position_assignments"("user_id", "starts_at", "ends_at");
CREATE INDEX "position_assignments_unit_id_position_id_starts_at_ends_at_idx" ON "position_assignments"("unit_id", "position_id", "starts_at", "ends_at");

CREATE TABLE "learning_rules" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "course_id" UUID NOT NULL, "organization_unit_id" UUID, "position_id" UUID, "mandatory" BOOLEAN NOT NULL DEFAULT true, "can_view" BOOLEAN NOT NULL DEFAULT true, "can_assess" BOOLEAN NOT NULL DEFAULT true, "can_earn_stars" BOOLEAN NOT NULL DEFAULT true, "due_days" INTEGER, "effective_from" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "effective_until" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "learning_rules_pkey" PRIMARY KEY ("id"), CONSTRAINT "learning_rules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "learning_rules_organization_unit_id_fkey" FOREIGN KEY ("organization_unit_id") REFERENCES "organization_units"("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "learning_rules_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX "learning_rules_course_id_effective_from_effective_until_idx" ON "learning_rules"("course_id", "effective_from", "effective_until");
CREATE INDEX "learning_rules_organization_unit_id_position_id_idx" ON "learning_rules"("organization_unit_id", "position_id");
CREATE TABLE "user_learning_assignments" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "user_id" UUID NOT NULL, "course_id" UUID NOT NULL, "rule_id" UUID, "mandatory" BOOLEAN NOT NULL DEFAULT true, "can_view" BOOLEAN NOT NULL DEFAULT true, "can_assess" BOOLEAN NOT NULL DEFAULT true, "can_earn_stars" BOOLEAN NOT NULL DEFAULT true, "due_at" TIMESTAMP, "status" "learning_assignment_status" NOT NULL DEFAULT 'ASSIGNED', "assigned_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "ended_at" TIMESTAMP, "completed_at" TIMESTAMP, CONSTRAINT "user_learning_assignments_pkey" PRIMARY KEY ("id"), CONSTRAINT "user_learning_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "user_learning_assignments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "user_learning_assignments_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "learning_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE);
CREATE INDEX "user_learning_assignments_user_id_status_due_at_idx" ON "user_learning_assignments"("user_id", "status", "due_at");

CREATE TABLE "access_restrictions" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "user_id" UUID, "organization_unit_id" UUID, "type" "restriction_type" NOT NULL, "reason" TEXT NOT NULL, "source_reference" VARCHAR(255), "created_by_user_id" UUID, "lifted_by_user_id" UUID, "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "lifted_at" TIMESTAMP, CONSTRAINT "access_restrictions_pkey" PRIMARY KEY ("id"), CONSTRAINT "access_restrictions_subject_check" CHECK (("user_id" IS NOT NULL) <> ("organization_unit_id" IS NOT NULL)), CONSTRAINT "access_restrictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "access_restrictions_unit_id_fkey" FOREIGN KEY ("organization_unit_id") REFERENCES "organization_units"("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "access_restrictions_created_by_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE, CONSTRAINT "access_restrictions_lifted_by_fkey" FOREIGN KEY ("lifted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE);
CREATE INDEX "access_restrictions_user_id_lifted_at_idx" ON "access_restrictions"("user_id", "lifted_at");
CREATE INDEX "access_restrictions_organization_unit_id_lifted_at_idx" ON "access_restrictions"("organization_unit_id", "lifted_at");

CREATE TABLE "star_ledger" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "user_id" UUID NOT NULL, "amount" INTEGER NOT NULL, "reason" "star_reason" NOT NULL, "reward_key" VARCHAR(255) NOT NULL, "source_type" VARCHAR(100) NOT NULL, "source_id" UUID NOT NULL, "metadata" JSONB, "awarded_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "star_ledger_pkey" PRIMARY KEY ("id"), CONSTRAINT "star_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "star_ledger_reward_key_key" ON "star_ledger"("reward_key");
CREATE INDEX "star_ledger_user_id_awarded_at_idx" ON "star_ledger"("user_id", "awarded_at");

CREATE TABLE "question_pools" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "assessment_id" UUID NOT NULL, "name" VARCHAR(255) NOT NULL, "sort_order" INTEGER NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "question_pools_pkey" PRIMARY KEY ("id"), CONSTRAINT "question_pools_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "question_pools_assessment_id_sort_order_key" ON "question_pools"("assessment_id", "sort_order");

CREATE TABLE "chapter_monthly_kpis" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "chapter_id" UUID NOT NULL, "month_start" DATE NOT NULL, "status" "kpi_status" NOT NULL, "configured_by_user_id" UUID NOT NULL, "note" TEXT, "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "chapter_monthly_kpis_pkey" PRIMARY KEY ("id"), CONSTRAINT "chapter_monthly_kpis_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "chapter_monthly_kpis_configured_by_fkey" FOREIGN KEY ("configured_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE UNIQUE INDEX "chapter_monthly_kpis_chapter_id_month_start_key" ON "chapter_monthly_kpis"("chapter_id", "month_start");

ALTER TABLE "chapters" ADD CONSTRAINT "chapters_organization_unit_id_fkey" FOREIGN KEY ("organization_unit_id") REFERENCES "organization_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "questions" ADD CONSTRAINT "questions_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "question_pools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

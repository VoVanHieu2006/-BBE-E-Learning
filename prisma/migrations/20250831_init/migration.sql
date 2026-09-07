-- Migration: init (20250831)
-- Generated from DBML: docs/schema.dbml

CREATE TYPE "user_role" AS ENUM ('ADMIN', 'CHAPTER_LEADER', 'MEMBER');
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'INACTIVE', 'LOCKED');
CREATE TYPE "chapter_status" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "membership_status" AS ENUM ('ACTIVE', 'LEFT');
CREATE TYPE "invitation_role" AS ENUM ('CHAPTER_LEADER', 'MEMBER');
CREATE TYPE "invitation_status" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "course_status" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "course_visibility" AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TYPE "question_type" AS ENUM ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE');
CREATE TYPE "attempt_status" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED', 'CANCELLED');
CREATE TYPE "video_provider" AS ENUM ('YOUTUBE');

-- Users
CREATE TABLE IF NOT EXISTS "users" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" VARCHAR(255) UNIQUE NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "role" user_role NOT NULL,
  "status" user_status NOT NULL DEFAULT 'ACTIVE',
  "failed_login_count" INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users"("email");
CREATE INDEX IF NOT EXISTS "users_status_idx" ON "users"("status");
CREATE INDEX IF NOT EXISTS "users_role_idx" ON "users"("role");

-- Chapters
CREATE TABLE IF NOT EXISTS "chapters" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(255) UNIQUE NOT NULL,
  "description" TEXT,
  "status" chapter_status NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "chapters_name_idx" ON "chapters"("name");
CREATE INDEX IF NOT EXISTS "chapters_status_idx" ON "chapters"("status");

-- Chapter Members
CREATE TABLE IF NOT EXISTS "chapter_members" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "chapter_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "joined_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("chapter_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "chapter_members_chapter_user_idx" ON "chapter_members"("chapter_id", "user_id");

-- Invitations
CREATE TABLE IF NOT EXISTS "invitations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" VARCHAR(255) NOT NULL,
  "role" invitation_role NOT NULL,
  "chapter_id" UUID NOT NULL,
  "invited_by" UUID NOT NULL,
  "token_hash" VARCHAR(255) UNIQUE NOT NULL,
  "status" invitation_status NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMP NOT NULL,
  "accepted_at" TIMESTAMP,
  "cancelled_at" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "invitations_email_idx" ON "invitations"("email");
CREATE INDEX IF NOT EXISTS "invitations_status_idx" ON "invitations"("status");
CREATE INDEX IF NOT EXISTS "invitations_expires_at_idx" ON "invitations"("expires_at");
CREATE INDEX IF NOT EXISTS "invitations_token_hash_idx" ON "invitations"("token_hash");

-- Courses
CREATE TABLE IF NOT EXISTS "courses" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "status" course_status NOT NULL DEFAULT 'DRAFT',
  "visibility" course_visibility NOT NULL DEFAULT 'PRIVATE',
  "created_by" UUID NOT NULL,
  "published_at" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "courses_status_visibility_idx" ON "courses"("status", "visibility");
CREATE INDEX IF NOT EXISTS "courses_created_by_idx" ON "courses"("created_by");

-- Sessions
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "course_id" UUID NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "sort_order" INTEGER NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "sessions_course_sort_idx" ON "sessions"("course_id", "sort_order");

-- Lessons
CREATE TABLE IF NOT EXISTS "lessons" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "sort_order" INTEGER NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "lessons_session_sort_idx" ON "lessons"("session_id", "sort_order");

-- Videos
CREATE TABLE IF NOT EXISTS "videos" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "lesson_id" UUID UNIQUE NOT NULL,
  "provider" video_provider NOT NULL DEFAULT 'YOUTUBE',
  "youtube_video_id" VARCHAR(255) NOT NULL,
  "duration_seconds" INTEGER NOT NULL,
  "title" VARCHAR(255),
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "videos_lesson_id_idx" ON "videos"("lesson_id");
CREATE INDEX IF NOT EXISTS "videos_provider_youtube_idx" ON "videos"("provider", "youtube_video_id");

-- Documents
CREATE TABLE IF NOT EXISTS "documents" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "lesson_id" UUID NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "storage_key" VARCHAR(500) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "file_size" BIGINT NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "documents_lesson_idx" ON "documents"("lesson_id");

-- Lesson Progress
CREATE TABLE IF NOT EXISTS "lesson_progress" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "lesson_id" UUID NOT NULL,
  "completed" BOOLEAN NOT NULL DEFAULT FALSE,
  "completed_at" TIMESTAMP,
  "last_position_seconds" INTEGER,
  "furthest_watched_position_seconds" INTEGER,
  "last_watched_at" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("user_id", "lesson_id")
);
CREATE INDEX IF NOT EXISTS "lesson_progress_user_lesson_idx" ON "lesson_progress"("user_id", "lesson_id");
CREATE INDEX IF NOT EXISTS "lesson_progress_user_idx" ON "lesson_progress"("user_id");
CREATE INDEX IF NOT EXISTS "lesson_progress_lesson_idx" ON "lesson_progress"("lesson_id");

-- Assessments
CREATE TABLE IF NOT EXISTS "assessments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "course_id" UUID UNIQUE NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "assessments_course_id_idx" ON "assessments"("course_id");

-- Questions
CREATE TABLE IF NOT EXISTS "questions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "assessment_id" UUID NOT NULL,
  "question_text" TEXT NOT NULL,
  "question_type" question_type NOT NULL DEFAULT 'SINGLE_CHOICE',
  "points" INTEGER NOT NULL DEFAULT 1,
  "duration_seconds" INTEGER NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "explanation" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "questions_assessment_sort_idx" ON "questions"("assessment_id", "sort_order");

-- Question Options
CREATE TABLE IF NOT EXISTS "question_options" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "question_id" UUID NOT NULL,
  "option_text" TEXT NOT NULL,
  "is_correct" BOOLEAN NOT NULL DEFAULT FALSE,
  "sort_order" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "question_options_question_sort_idx" ON "question_options"("question_id", "sort_order");
CREATE INDEX IF NOT EXISTS "question_options_question_idx" ON "question_options"("question_id");

-- Attempts
CREATE TABLE IF NOT EXISTS "attempts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "assessment_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "status" attempt_status NOT NULL DEFAULT 'IN_PROGRESS',
  "started_at" TIMESTAMP NOT NULL,
  "expires_at" TIMESTAMP NOT NULL,
  "submitted_at" TIMESTAMP,
  "score" DECIMAL(5,2),
  "passed" BOOLEAN,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "attempts_user_assessment_idx" ON "attempts"("user_id", "assessment_id");
CREATE INDEX IF NOT EXISTS "attempts_assessment_user_created_idx" ON "attempts"("assessment_id", "user_id", "created_at");
CREATE INDEX IF NOT EXISTS "attempts_status_idx" ON "attempts"("status");

-- Attempt Questions
CREATE TABLE IF NOT EXISTS "attempt_questions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "attempt_id" UUID NOT NULL,
  "question_id" UUID NOT NULL,
  "display_order" INTEGER NOT NULL,
  UNIQUE ("attempt_id", "question_id")
);
CREATE INDEX IF NOT EXISTS "attempt_questions_attempt_display_idx" ON "attempt_questions"("attempt_id", "display_order");
CREATE INDEX IF NOT EXISTS "attempt_questions_attempt_question_idx" ON "attempt_questions"("attempt_id", "question_id");

-- Attempt Answers
CREATE TABLE IF NOT EXISTS "attempt_answers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "attempt_id" UUID NOT NULL,
  "question_id" UUID NOT NULL,
  "selected_option_id" UUID,
  "answered_at" TIMESTAMP,
  "is_correct" BOOLEAN,
  UNIQUE ("attempt_id", "question_id")
);
CREATE INDEX IF NOT EXISTS "attempt_answers_attempt_question_idx" ON "attempt_answers"("attempt_id", "question_id");
CREATE INDEX IF NOT EXISTS "attempt_answers_attempt_idx" ON "attempt_answers"("attempt_id");
CREATE INDEX IF NOT EXISTS "attempt_answers_question_idx" ON "attempt_answers"("question_id");

-- Password Reset Tokens
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" VARCHAR(255) UNIQUE NOT NULL,
  "expires_at" TIMESTAMP NOT NULL,
  "used_at" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "password_reset_tokens_token_hash_idx" ON "password_reset_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_idx" ON "password_reset_tokens"("user_id");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_expires_idx" ON "password_reset_tokens"("expires_at");

-- Audit Logs
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_user_id" UUID,
  "action" VARCHAR(100) NOT NULL,
  "entity_type" VARCHAR(100) NOT NULL,
  "entity_id" UUID NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "audit_logs_actor_idx" ON "audit_logs"("actor_user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_entity_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "audit_logs_created_idx" ON "audit_logs"("created_at");

-- Refresh Token (added for Prompt 2 — Auth)
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
  "token_hash" VARCHAR(255) UNIQUE NOT NULL,
  "expires_at" TIMESTAMP NOT NULL,
  "revoked_at" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "refresh_tokens_token_hash_idx" ON "refresh_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_idx" ON "refresh_tokens"("user_id");
CREATE INDEX IF NOT EXISTS "refresh_tokens_expires_idx" ON "refresh_tokens"("expires_at");
CREATE INDEX IF NOT EXISTS "refresh_tokens_revoked_idx" ON "refresh_tokens"("revoked_at");

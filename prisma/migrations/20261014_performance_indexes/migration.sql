CREATE INDEX IF NOT EXISTS "lesson_progress_user_id_completed_lesson_id_idx"
ON "lesson_progress"("user_id", "completed", "lesson_id");

CREATE INDEX IF NOT EXISTS "attempts_user_id_status_assessment_id_submitted_at_idx"
ON "attempts"("user_id", "status", "assessment_id", "submitted_at");

CREATE INDEX IF NOT EXISTS "organization_memberships_user_id_status_starts_at_ends_at_idx"
ON "organization_memberships"("user_id", "status", "starts_at", "ends_at");

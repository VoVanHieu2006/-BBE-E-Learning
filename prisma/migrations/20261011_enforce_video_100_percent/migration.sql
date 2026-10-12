-- Re-evaluate legacy completion flags against the new 100% watch requirement.
-- Keep watch positions, timestamps, attempts, and Star ledger intact.
UPDATE "lesson_progress" AS progress
SET "completed" = FALSE,
    "completed_at" = NULL,
    "updated_at" = CURRENT_TIMESTAMP
FROM "videos" AS video
WHERE progress."lesson_id" = video."lesson_id"
  AND progress."completed" = TRUE
  AND COALESCE(progress."furthest_watched_position_seconds", progress."last_position_seconds", 0)
      < GREATEST(video."duration_seconds" - 2, 0);

-- Reopen course assignments that were completed only because a legacy lesson
-- completion flag is now invalid under the stricter watch threshold.
UPDATE "user_learning_assignments" AS assignment
SET "status" = 'IN_PROGRESS',
    "completed_at" = NULL
WHERE assignment."status" = 'COMPLETED'
  AND EXISTS (
    SELECT 1
    FROM "sessions" AS session
    JOIN "lessons" AS lesson ON lesson."session_id" = session."id"
    JOIN "videos" AS video ON video."lesson_id" = lesson."id"
    LEFT JOIN "lesson_progress" AS progress
      ON progress."lesson_id" = lesson."id"
     AND progress."user_id" = assignment."user_id"
    WHERE session."course_id" = assignment."course_id"
      AND (
        progress."completed" IS DISTINCT FROM TRUE
        OR COALESCE(progress."furthest_watched_position_seconds", progress."last_position_seconds", 0)
           < GREATEST(video."duration_seconds" - 2, 0)
      )
  );

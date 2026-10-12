-- Tighten the existing provider-tolerance rule to literal 100% completion.
-- Preserve the original Star ledger events and compensate rewards for videos
-- whose stored watch position did not reach the full configured duration.

UPDATE "lesson_progress" AS progress
SET "completed" = FALSE,
    "completed_at" = NULL,
    "updated_at" = CURRENT_TIMESTAMP
FROM "videos" AS video
WHERE progress."lesson_id" = video."lesson_id"
  AND progress."completed" = TRUE
  AND (
    video."duration_seconds" <= 0
    OR GREATEST(
      COALESCE(progress."furthest_watched_position_seconds", 0),
      COALESCE(progress."last_position_seconds", 0)
    ) < video."duration_seconds"
  );

UPDATE "user_learning_assignments" AS assignment
SET "status" = CASE
      WHEN assignment."mandatory" = TRUE
       AND assignment."due_at" IS NOT NULL
       AND assignment."due_at" <= CURRENT_TIMESTAMP THEN 'OVERDUE'
      WHEN EXISTS (
        SELECT 1
        FROM "sessions" AS session
        JOIN "lessons" AS lesson ON lesson."session_id" = session."id"
        JOIN "videos" AS video ON video."lesson_id" = lesson."id"
        JOIN "lesson_progress" AS progress
          ON progress."lesson_id" = lesson."id"
         AND progress."user_id" = assignment."user_id"
        WHERE session."course_id" = assignment."course_id"
          AND (
            COALESCE(progress."furthest_watched_position_seconds", 0) > 0
            OR COALESCE(progress."last_position_seconds", 0) > 0
            OR progress."completed" = TRUE
          )
      ) THEN 'IN_PROGRESS'
      ELSE 'ASSIGNED'
    END::"learning_assignment_status",
    "completed_at" = NULL
WHERE assignment."status" IN ('COMPLETED', 'IN_PROGRESS')
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
        video."duration_seconds" <= 0
        OR progress."completed" IS DISTINCT FROM TRUE
        OR GREATEST(
          COALESCE(progress."furthest_watched_position_seconds", 0),
          COALESCE(progress."last_position_seconds", 0)
        ) < video."duration_seconds"
      )
  );

INSERT INTO "star_ledger" (
  "id", "user_id", "amount", "reason", "reward_key", "source_type", "source_id", "metadata", "awarded_at"
)
SELECT
  gen_random_uuid(),
  reward."user_id",
  -reward."amount",
  'ADMIN_ADJUSTMENT',
  'migration:strict-video-100:' || reward."id"::text,
  'VIDEO',
  reward."source_id",
  jsonb_build_object(
    'reversesRewardId', reward."id",
    'reason', 'Video reward reversed because stored watch position was below 100% at migration time.'
  ),
  CURRENT_TIMESTAMP
FROM "star_ledger" AS reward
JOIN "videos" AS video ON video."id" = reward."source_id"
LEFT JOIN "lesson_progress" AS progress
  ON progress."lesson_id" = video."lesson_id"
 AND progress."user_id" = reward."user_id"
WHERE reward."reason" = 'VIDEO_COMPLETION'
  AND reward."source_type" = 'VIDEO'
  AND reward."amount" > 0
  AND (
    video."duration_seconds" <= 0
    OR GREATEST(
      COALESCE(progress."furthest_watched_position_seconds", 0),
      COALESCE(progress."last_position_seconds", 0)
    ) < video."duration_seconds"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "star_ledger" AS reversal
    WHERE reversal."reward_key" = 'migration:strict-video-100:' || reward."id"::text
  );

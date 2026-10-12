import { config } from 'dotenv'
import { Client } from 'pg'

config()

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DIRECT_URL or DATABASE_URL before running this read-only audit.')
  process.exit(1)
}

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })

async function main() {
  await client.connect()
  try {
    const progress = await client.query(`
        SELECT COUNT(*)::bigint AS count
        FROM lesson_progress AS progress
        JOIN videos AS video ON video.lesson_id = progress.lesson_id
        WHERE progress.completed = TRUE
          AND (
            video.duration_seconds <= 0
            OR GREATEST(
              COALESCE(progress.furthest_watched_position_seconds, 0),
              COALESCE(progress.last_position_seconds, 0)
            ) < video.duration_seconds
          )
      `)
    const assignments = await client.query(`
        WITH impacted AS (
          SELECT assignment.status,
            CASE
              WHEN assignment.mandatory = TRUE
                AND assignment.due_at IS NOT NULL
                AND assignment.due_at <= CURRENT_TIMESTAMP THEN 'OVERDUE'
              WHEN EXISTS (
                SELECT 1
                FROM sessions AS session
                JOIN lessons AS lesson ON lesson.session_id = session.id
                JOIN videos AS video ON video.lesson_id = lesson.id
                JOIN lesson_progress AS progress
                  ON progress.lesson_id = lesson.id
                 AND progress.user_id = assignment.user_id
                WHERE session.course_id = assignment.course_id
                  AND (
                    COALESCE(progress.furthest_watched_position_seconds, 0) > 0
                    OR COALESCE(progress.last_position_seconds, 0) > 0
                    OR progress.completed = TRUE
                  )
              ) THEN 'IN_PROGRESS'
              ELSE 'ASSIGNED'
            END AS next_status
          FROM user_learning_assignments AS assignment
          WHERE assignment.status IN ('COMPLETED', 'IN_PROGRESS')
            AND EXISTS (
              SELECT 1
              FROM sessions AS session
              JOIN lessons AS lesson ON lesson.session_id = session.id
              JOIN videos AS video ON video.lesson_id = lesson.id
              LEFT JOIN lesson_progress AS progress
                ON progress.lesson_id = lesson.id
               AND progress.user_id = assignment.user_id
              WHERE session.course_id = assignment.course_id
                AND (
                  video.duration_seconds <= 0
                  OR progress.completed IS DISTINCT FROM TRUE
                  OR GREATEST(
                    COALESCE(progress.furthest_watched_position_seconds, 0),
                    COALESCE(progress.last_position_seconds, 0)
                  ) < video.duration_seconds
                )
            )
        )
        SELECT status AS current_status, next_status, COUNT(*)::bigint AS count
        FROM impacted
        GROUP BY status, next_status
        ORDER BY status, next_status
      `)
    const rewards = await client.query(`
        SELECT COUNT(*)::bigint AS count,
          COALESCE(SUM(reward.amount), 0)::bigint AS stars_to_reverse
        FROM star_ledger AS reward
        JOIN videos AS video ON video.id = reward.source_id
        LEFT JOIN lesson_progress AS progress
          ON progress.lesson_id = video.lesson_id
         AND progress.user_id = reward.user_id
        WHERE reward.reason = 'VIDEO_COMPLETION'
          AND reward.source_type = 'VIDEO'
          AND reward.amount > 0
          AND (
            video.duration_seconds <= 0
            OR GREATEST(
              COALESCE(progress.furthest_watched_position_seconds, 0),
              COALESCE(progress.last_position_seconds, 0)
            ) < video.duration_seconds
          )
          AND NOT EXISTS (
            SELECT 1
            FROM star_ledger AS reversal
            WHERE reversal.reward_key = 'migration:strict-video-100:' || reward.id::text
          )
      `)

    console.log('Read-only impact estimate for 20261011_strict_video_100_percent')
    console.log(`Completed lesson records to reopen: ${progress.rows[0].count}`)
    console.log('Assignments to recalculate:')
    if (assignments.rows.length === 0) console.log('  none')
    for (const row of assignments.rows) {
      console.log(`  ${row.current_status} -> ${row.next_status}: ${row.count}`)
    }
    console.log(`Video Star entries to reverse: ${rewards.rows[0].count}`)
    console.log(`Total Stars to reverse: ${rewards.rows[0].stars_to_reverse}`)
    console.log('No rows were changed.')
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error('Read-only migration audit failed:', error instanceof Error ? error.message : 'unknown error')
  process.exitCode = 1
})

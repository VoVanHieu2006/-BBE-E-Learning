/**
 * Rà soát & sửa dữ liệu thời lượng video sai trong DB.
 *
 * Nguyên nhân dữ liệu sai: API youtube/info cũ tự bịa 180 giây khi không scrape được
 * thời lượng thật, và admin lưu thẳng giá trị đó.
 *
 * Cách dùng:
 *   npm run db:fix-durations                     # chạy thử (dry-run), chỉ in báo cáo
 *   npm run db:fix-durations -- --apply          # ghi DB thật
 *   npm run db:fix-durations -- --only-180       # chỉ xét video đang đúng 180s
 *   npm run db:fix-durations -- --limit=20       # giới hạn số video
 *   npm run db:fix-durations -- --delay=1200     # nghỉ giữa các request YouTube (ms)
 *   npm run db:fix-durations -- --no-progress    # bỏ qua bước tính lại tiến trình
 *   npm run db:fix-durations -- --revert-incomplete  # cho phép hạ "completed" khi % mới < 85
 *
 * Mặc định KHÔNG hạ trạng thái hoàn thành của học viên — chỉ bổ sung khi đủ ngưỡng.
 */

import * as fs from 'fs'
import * as path from 'path'
import { lookupYouTube } from '../src/lib/youtube/duration'

const { Client } = require('pg')

const COMPLETION_THRESHOLD = 85 // % — khớp với src/app/api/v1/lessons/[lessonId]/progress/route.ts

interface VideoRow {
  id: string
  youtube_video_id: string
  duration_seconds: number
  lesson_id: string
  title: string
  newDuration?: number
}

const args = process.argv.slice(2)
const hasFlag = (flag: string) => args.includes(flag)
const getNumberArg = (flag: string, fallback: number) => {
  const found = args.find((a) => a.startsWith(`${flag}=`))
  if (!found) return fallback
  const n = Number(found.split('=')[1])
  return Number.isFinite(n) ? n : fallback
}

const APPLY = hasFlag('--apply')
const ONLY_180 = hasFlag('--only-180')
const SKIP_PROGRESS = hasFlag('--no-progress')
const ALLOW_REVERT = hasFlag('--revert-incomplete')
const LIMIT = getNumberArg('--limit', 0)
const DELAY_MS = getNumberArg('--delay', 700)

function loadEnvValue(name: string): string {
  if (process.env[name]) return process.env[name] as string
  const envPath = path.join(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return ''
  const content = fs.readFileSync(envPath, 'utf8')
  const match = content.match(new RegExp(`^${name}=["']?([^"'\\r\\n]+)["']?`, 'm'))
  return match ? match[1] : ''
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const connectionString = loadEnvValue('DIRECT_URL') || loadEnvValue('DATABASE_URL')
  if (!connectionString) {
    console.error('Không tìm thấy DIRECT_URL hoặc DATABASE_URL (trong .env hoặc biến môi trường).')
    process.exit(1)
  }

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()

  try {
    console.log(APPLY ? '=== CHẾ ĐỘ GHI (--apply) ===' : '=== CHẠY THỬ (dry-run) — thêm --apply để ghi DB ===')
    if (ONLY_180) console.log('Chỉ xét các video có duration_seconds = 180')
    console.log('')

    const whereClause = ONLY_180 ? 'WHERE v.duration_seconds = 180' : ''
    const limitClause = LIMIT > 0 ? `LIMIT ${Math.trunc(LIMIT)}` : ''

    const videos: VideoRow[] = (
      await client.query(`
        SELECT v.id, v.youtube_video_id, v.duration_seconds, l.id AS lesson_id, l.title
        FROM videos v
        JOIN lessons l ON l.id = v.lesson_id
        ${whereClause}
        ORDER BY l.title
        ${limitClause}
      `)
    ).rows

    console.log(`Số video cần kiểm tra: ${videos.length}\n`)

    const changed: VideoRow[] = []
    const unknown: VideoRow[] = []
    const failed: VideoRow[] = []
    let correct = 0

    for (let i = 0; i < videos.length; i++) {
      const video = videos[i]
      process.stdout.write(`[${i + 1}/${videos.length}] ${video.youtube_video_id} ... `)

      const result = await lookupYouTube(video.youtube_video_id)

      if (result.status === 'lookup_failed') {
        console.log('KHÔNG KIỂM TRA ĐƯỢC (lỗi kết nối YouTube — hãy chạy lại sau)')
        failed.push(video)
      } else if (result.status === 'not_found') {
        console.log('KHÔNG TÌM THẤY video (bỏ qua)')
        unknown.push(video)
      } else if (!result.info.durationKnown) {
        console.log(`KHÔNG XÁC ĐỊNH ĐƯỢC THỜI LƯỢNG (đang lưu ${video.duration_seconds}s) — cần nhập tay`)
        unknown.push(video)
      } else if (result.info.durationSeconds === video.duration_seconds) {
        console.log(`ĐÚNG (${video.duration_seconds}s)`)
        correct++
      } else {
        console.log(`SAI: ${video.duration_seconds}s -> ${result.info.durationSeconds}s`)
        changed.push({ ...video, newDuration: result.info.durationSeconds })
      }

      if (DELAY_MS > 0 && i < videos.length - 1) await sleep(DELAY_MS)
    }

    if (APPLY) {
      for (const video of changed) {
        await client.query('UPDATE videos SET duration_seconds = $1, updated_at = now() WHERE id = $2', [
          video.newDuration,
          video.id,
        ])
      }
    }

    const progressSummary = SKIP_PROGRESS
      ? null
      : await recomputeProgress(client, changed)

    console.log('\n=== TỔNG KẾT ===')
    console.log(`Video đã kiểm tra : ${videos.length}`)
    console.log(`Đúng              : ${correct}`)
    console.log(`Sai (cần sửa)     : ${changed.length}`)
    console.log(`Không xác định    : ${unknown.length}`)
    console.log(`Không kiểm tra được: ${failed.length}`)

    if (progressSummary) {
      console.log(`Tiến trình xét    : ${progressSummary.lessons} bài học`)
      console.log(`  + Đánh dấu hoàn thành: ${progressSummary.newlyCompleted}`)
      console.log(`  ~ Vị trí xem bị vượt quá thời lượng (đã clamp): ${progressSummary.clampedPositions}`)
      if (progressSummary.keptIncomplete > 0) {
        console.log(
          `  ! Đã hoàn thành nhưng % mới < ${COMPLETION_THRESHOLD}%: ${progressSummary.keptIncomplete}` +
            (ALLOW_REVERT ? ' (đã hạ về chưa hoàn thành)' : ' (giữ nguyên — dùng --revert-incomplete nếu muốn hạ)')
        )
      }
    }

    if (unknown.length > 0) {
      console.log('\nCác video cần admin nhập thời lượng thủ công:')
      unknown.forEach((v) => console.log(`  - ${v.youtube_video_id} (${v.title})`))
    }

    if (failed.length > 0) {
      console.log('\nCác video CHƯA kiểm tra được do lỗi kết nối (kết quả còn thiếu — hãy chạy lại):')
      failed.forEach((v) => console.log(`  - ${v.youtube_video_id} (${v.title})`))
    }

    if (!APPLY) {
      console.log('\n[dry-run] Chưa ghi gì vào DB. Chạy lại với --apply để cập nhật.')
    } else {
      console.log('\nĐã ghi thay đổi vào DB.')
    }
  } finally {
    await client.end()
  }
}

async function recomputeProgress(client: any, changed: VideoRow[]) {
  const newDurationByLesson = new Map<string, number>()
  for (const video of changed) newDurationByLesson.set(video.lesson_id, video.newDuration as number)

  let newlyCompleted = 0
  let keptIncomplete = 0
  let clampedPositions = 0

  for (const [lessonId, duration] of Array.from(newDurationByLesson.entries())) {
    if (!duration || duration <= 0) continue

    const rows = (
      await client.query(
        `SELECT id, completed, completed_at, last_position_seconds, furthest_watched_position_seconds
         FROM lesson_progress WHERE lesson_id = $1`,
        [lessonId]
      )
    ).rows

    for (const row of rows) {
      const furthest = Number(row.furthest_watched_position_seconds || 0)
      const lastPosition = Number(row.last_position_seconds || 0)
      const clampedFurthest = Math.min(furthest, duration)
      const clampedLast = Math.min(lastPosition, duration)
      const percentage = Math.min(100, Math.floor((clampedFurthest / duration) * 100))

      let completed = Boolean(row.completed)
      let completedAt = row.completed_at

      if (percentage >= COMPLETION_THRESHOLD && !completed) {
        completed = true
        completedAt = new Date()
        newlyCompleted++
      } else if (percentage < COMPLETION_THRESHOLD && completed) {
        if (ALLOW_REVERT) {
          completed = false
          completedAt = null
        } else {
          keptIncomplete++
        }
      }

      const positionChanged = clampedFurthest !== furthest || clampedLast !== lastPosition
      if (positionChanged) clampedPositions++

      if (!APPLY) continue
      if (!positionChanged && completed === Boolean(row.completed)) continue

      await client.query(
        `UPDATE lesson_progress
         SET furthest_watched_position_seconds = $1,
             last_position_seconds = $2,
             completed = $3,
             completed_at = $4,
             updated_at = now()
         WHERE id = $5`,
        [clampedFurthest, clampedLast, completed, completedAt, row.id]
      )
    }
  }

  return {
    lessons: newDurationByLesson.size,
    newlyCompleted,
    keptIncomplete,
    clampedPositions,
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

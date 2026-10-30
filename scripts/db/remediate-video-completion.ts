/**
 * Chốt hoàn thành video cho MỘT tài khoản sau khi áp dụng ngưỡng 99% cho video dài.
 *
 * Chỉ xử lý tài khoản truyền vào qua --email và chỉ những bài đã xem tới
 * ngưỡng hoàn thành mới (furthest >= duration - endedCompletionToleranceSeconds).
 * Không ghi sao trực tiếp: gọi recordVideoHeartbeat(event ENDED) để hệ thống tự
 * kiểm tra replay tháng, điều kiện thưởng, unlock và chống cộng trùng.
 *
 * Cách dùng:
 *   npm run db:remediate-video -- --email=<email>              # dry-run
 *   npm run db:remediate-video -- --email=<email> --apply      # ghi DB thật
 */

import { prisma } from '../../src/lib/prisma'
import { recordVideoHeartbeat } from '../../src/lib/video-heartbeat'
import { competitionMonthBounds } from '../../src/lib/learning-cycle-rules'
import { readCourseLearningStates } from '../../src/lib/lesson-learning-state'
import { displayVideoProgressPercent, endedCompletionToleranceSeconds } from '../../src/lib/video-progress-rules'
import { starsForVideoDuration } from '../../src/lib/reward-rules'

const emailArg = process.argv.find((arg) => arg.startsWith('--email='))
const TARGET_EMAIL = (emailArg?.slice('--email='.length) || '').trim()
const APPLY = process.argv.includes('--apply')

const fmt = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2))
const dateText = (value: Date | null | undefined) => (value ? value.toISOString() : '—')
const line = () => console.log('─'.repeat(78))

type Entry = {
  lessonId: string
  lessonTitle: string
  courseId: string
  courseTitle: string
  courseStatus: string
  sessionTitle: string
  videoId: string
  duration: number
  furthest: number
  tolerance: number
  missing: number
  qualifying: boolean
  cycleCompletedAt: Date | null
  unlockedAt: Date | null
  hasAssessment: boolean
  canAssess: boolean
  replay?: { furthest: number; completedAt: Date | null; suppressedAt: Date | null }
  replayComplete: boolean
  starAmount: number | null
  needsWrite: boolean
}

async function main() {
  if (!TARGET_EMAIL) {
    console.error('Thiếu tham số --email=<email>. Ví dụ: npm run db:remediate-video -- --email=user@example.com')
    process.exitCode = 1
    return
  }
  console.log(APPLY ? '=== CHẾ ĐỘ GHI (--apply) ===' : '=== CHẠY THỬ (dry-run) — thêm --apply để ghi DB ===')
  console.log(`Tài khoản đích: ${TARGET_EMAIL}`)

  const user = await prisma.user.findUnique({
    where: { email: TARGET_EMAIL },
    select: { id: true, email: true, display_name: true, role: true, status: true, anonymized_at: true },
  })
  if (!user) {
    console.error('Không tìm thấy tài khoản. Không làm gì thêm.')
    process.exitCode = 1
    return
  }
  console.log(`Người dùng: ${user.display_name || '(không tên)'} | vai trò ${user.role} | trạng thái ${user.status}${user.anonymized_at ? ' | ĐÃ ẨN DANH' : ''}`)
  console.log(`User ID: ${user.id}`)

  const now = new Date()
  const [cycle, policy] = await Promise.all([
    prisma.learningCycle.findFirst({ where: { user_id: user.id, ends_at: null }, orderBy: { starts_at: 'desc' } }),
    prisma.learningPolicy.findUnique({ where: { id: 'default' }, select: { cutover_at: true } }),
  ])
  const bounds = competitionMonthBounds(now, policy?.cutover_at ?? new Date(0))
  const month = await prisma.competitionMonth.findUnique({ where: { key: bounds.key } })

  console.log(`Chu kỳ đang mở: ${cycle ? cycle.id : 'KHÔNG CÓ'}`)
  console.log(`Tháng hiện tại: ${bounds.key} (${month ? month.id : 'chưa có trong DB'})`)
  if (!cycle || !month) {
    console.log('\nKhông thể đối soát: cần có chu kỳ học đang mở và tháng thi đấu hiện tại.')
    if (APPLY) console.log('Dừng — không ghi gì vào DB.')
    return
  }

  const cycleRows = await prisma.cycleLessonProgress.findMany({
    where: { user_id: user.id, learning_cycle_id: cycle.id, furthest_seconds: { gt: 0 } },
    select: { lesson_id: true, furthest_seconds: true, completed_at: true, unlocked_at: true },
  })
  if (!cycleRows.length) {
    console.log('\nTài khoản chưa có tiến độ video nào trong chu kỳ hiện tại.')
    return
  }

  const lessonIds = cycleRows.map((row) => row.lesson_id)
  const [lessons, lifetimeRows, replayRows, starRows, starBefore] = await Promise.all([
    prisma.lesson.findMany({
      where: { id: { in: lessonIds } },
      select: {
        id: true,
        title: true,
        sort_order: true,
        assessment: { select: { id: true } },
        video: { select: { id: true, duration_seconds: true } },
        session: {
          select: {
            title: true,
            sort_order: true,
            course: { select: { id: true, title: true, status: true } },
          },
        },
      },
    }),
    prisma.lessonProgress.findMany({ where: { user_id: user.id, lesson_id: { in: lessonIds } } }),
    prisma.monthlyVideoReplay.findMany({
      where: { user_id: user.id, learning_cycle_id: cycle.id, competition_month_id: month.id },
    }),
    prisma.starLedger.findMany({
      where: { user_id: user.id, reward_key: { startsWith: `video:${user.id}:` } },
      select: { reward_key: true, amount: true, awarded_at: true },
    }),
    prisma.starLedger.aggregate({ where: { user_id: user.id }, _sum: { amount: true } }),
  ])

  const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]))
  const replayByVideo = new Map(replayRows.map((row) => [row.video_id, row]))
  const starByKey = new Map(starRows.map((row) => [row.reward_key, row]))
  const lifetimeByLesson = new Map(lifetimeRows.map((row) => [row.lesson_id, row]))

  // Read-only course states: canAssess reflects the current (99%) read path.
  const courseIds = Array.from(new Set(lessons.map((lesson) => lesson.session.course.id)))
  const statesByCourse = new Map<string, Awaited<ReturnType<typeof readCourseLearningStates>>>()
  for (const courseId of courseIds) {
    statesByCourse.set(courseId, await readCourseLearningStates(prisma as any, user.id, courseId))
  }

  const entries: Entry[] = []
  for (const row of cycleRows) {
    const lesson = lessonById.get(row.lesson_id)
    if (!lesson?.video) continue
    const duration = Number(lesson.video.duration_seconds) || 0
    if (duration <= 0) continue
    const furthest = Number(row.furthest_seconds) || 0
    const tolerance = endedCompletionToleranceSeconds(duration)
    const qualifying = furthest >= duration - tolerance
    const replay = replayByVideo.get(lesson.video.id)
    const replayFurthest = replay ? Number(replay.furthest_seconds) || 0 : 0
    const replayComplete = Boolean(replay && (replay.completed_at || (qualifying && replayFurthest >= duration - tolerance)))
    const star = starByKey.get(`video:${user.id}:${lesson.video.id}:${month.id}:${cycle.id}`)
    const courseState = statesByCourse.get(lesson.session.course.id)
    const state = courseState?.[lesson.id]
    const replayNeedsFinish = Boolean(replay && !replay.completed_at && replayFurthest >= duration - tolerance)
    entries.push({
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      courseId: lesson.session.course.id,
      courseTitle: lesson.session.course.title,
      courseStatus: lesson.session.course.status,
      sessionTitle: lesson.session.title,
      videoId: lesson.video.id,
      duration,
      furthest,
      tolerance,
      missing: Math.max(0, duration - furthest),
      qualifying,
      cycleCompletedAt: row.completed_at,
      unlockedAt: row.unlocked_at,
      hasAssessment: Boolean(lesson.assessment),
      canAssess: Boolean(state?.canAssess),
      replay: replay
        ? { furthest: replayFurthest, completedAt: replay.completed_at, suppressedAt: replay.reward_suppressed_at }
        : undefined,
      replayComplete,
      starAmount: star ? star.amount : null,
      // completed_at is lesson completion (needs a passed quiz), so use the
      // finalized video position to decide whether the heartbeat is still needed.
      needsWrite: qualifying && (furthest < duration || replayNeedsFinish),
    })
  }
  entries.sort((a, b) => {
    const lessonA = lessonById.get(a.lessonId)!
    const lessonB = lessonById.get(b.lessonId)!
    return lessonA.session.sort_order - lessonB.session.sort_order || lessonA.sort_order - lessonB.sort_order || a.lessonTitle.localeCompare(b.lessonTitle)
  })

  const qualifying = entries.filter((entry) => entry.qualifying)
  const actionable = entries.filter((entry) => entry.needsWrite)
  const lifetime = (entry: Entry) => lifetimeByLesson.get(entry.lessonId)

  console.log('\n=== CÁC BÀI ĐỦ ĐIỀU KIỆN HOÀN THÀNH (ngưỡng 99% cho video > 10 phút) ===')
  if (!qualifying.length) {
    console.log('Không có bài nào đạt ngưỡng. Không ghi gì.')
  }
  for (const entry of qualifying) {
    const life = lifetime(entry)
    console.log(`\n• ${entry.courseTitle} → ${entry.sessionTitle} → ${entry.lessonTitle}`)
    console.log(`  video ${entry.duration}s | đã xem ${fmt(entry.furthest)}s | hiển thị ${displayVideoProgressPercent(entry.furthest, entry.duration, false)}% | thiếu ${fmt(entry.missing)}s (dung sai ${fmt(entry.tolerance)}s)`)
    console.log(`  chu kỳ: ${entry.cycleCompletedAt ? `đã chốt ${dateText(entry.cycleCompletedAt)}` : 'CHƯA chốt hoàn thành'} | mở khóa: ${entry.unlockedAt ? 'có' : 'chưa ghi'} | quiz: ${entry.hasAssessment ? (entry.canAssess ? 'có thể làm' : 'đang khóa') : 'không có'}`)
    console.log(`  lifetime: ${life?.completed ? 'đã hoàn thành' : 'chưa hoàn thành'} (${life?.furthest_watched_position_seconds ?? 0}s)`)
    if (entry.replay) {
      console.log(`  replay ${bounds.key}: ${fmt(entry.replay.furthest)}s | ${entry.replayComplete ? 'đã đạt' : 'chưa đạt'} | ${entry.replay.completedAt ? `chốt ${dateText(entry.replay.completedAt)}` : 'chưa chốt'}${entry.replay.suppressedAt ? ' | đã bị chặn thưởng' : ''}`)
    } else {
      console.log(`  replay ${bounds.key}: KHÔNG CÓ — không đủ cơ sở cộng sao tháng này`)
    }
    console.log(`  sao video (reward key tháng này): ${entry.starAmount != null ? `đã có ${entry.starAmount} sao` : 'chưa có'}`)
    if (entry.needsWrite) {
      const starNote = entry.replay
        ? entry.replayComplete && !entry.starAmount
          ? ` | dự kiến +${starsForVideoDuration(entry.duration)} sao nếu đủ điều kiện thưởng`
          : ''
        : ' | không cộng sao (thiếu replay tháng)'
      console.log(`  → SẼ GHI: chốt hoàn thành video/chu kỳ + mở khóa bài kế nếu quiz bài này đã đạt${starNote}`)
    } else {
      console.log('  → không cần ghi thêm')
    }
  }

  const nonQualifying = entries.filter((entry) => !entry.qualifying)
  if (nonQualifying.length) {
    console.log('\n=== BÀI CHƯA ĐỦ NGƯỠNG (không thay đổi) ===')
    for (const entry of nonQualifying) {
      console.log(`• ${entry.courseTitle} → ${entry.sessionTitle} → ${entry.lessonTitle}: ${fmt(entry.furthest)}/${entry.duration}s (còn thiếu ${fmt(entry.missing)}s, cần thêm ${fmt(Math.max(0, entry.missing - entry.tolerance))}s so với dung sai)`)
    }
  }

  const starSum = starBefore._sum.amount || 0
  console.log(`\nTổng sao hiện tại của tài khoản: ${starSum}`)
  console.log(`Số bài sẽ tác động: ${actionable.length}${APPLY ? '' : ' (dry-run: chưa ghi)'}`)

  if (!APPLY) {
    console.log('\n[dry-run] Không có thay đổi nào được ghi. Chạy lại với --apply để thực hiện.')
    return
  }
  if (!actionable.length) {
    console.log('\nKhông có gì cần ghi.')
    return
  }

  console.log('\n=== GHI DB ===')
  for (const entry of actionable) {
    const result: any = await recordVideoHeartbeat(
      user.id,
      entry.lessonId,
      entry.furthest,
      entry.furthest,
      false,
      'COMPAT',
      { event: 'ENDED', playbackRate: 2, playerDurationSeconds: entry.duration },
    )
    if (!result) {
      console.log(`✗ ${entry.lessonTitle}: không tìm thấy bài/video, bỏ qua`)
      continue
    }
    if (result.error) {
      console.log(`✗ ${entry.lessonTitle}: bị chặn bởi thứ tự bài học (${result.error.code}) — chưa thể chốt`)
      continue
    }
    const replay = result.replay
    const star = result.starReward
    console.log(`✓ ${entry.lessonTitle}: cycle ${result.cycleProgress.furthestWatchedPositionSeconds}s | videoCompleted=${result.videoCompleted} | lessonCompleted=${result.completed}`)
    console.log(`  replay: ${replay.watchedSeconds}s | completed=${replay.completed}${replay.suppressed ? ' | bị chặn thưởng' : ''}`)
    console.log(`  sao: ${star.awarded ? `+${star.amount} (${star.rewardKey})` : `không cộng (${star.reasonCode})`}${star.balance != null ? ` | tổng ${star.balance}` : ''}`)
  }

  // Re-read persisted state instead of trusting the write result.
  const [afterRows, afterReplays, afterStars, starAfter] = await Promise.all([
    prisma.cycleLessonProgress.findMany({ where: { user_id: user.id, learning_cycle_id: cycle.id, lesson_id: { in: actionable.map((entry) => entry.lessonId) } } }),
    prisma.monthlyVideoReplay.findMany({ where: { user_id: user.id, learning_cycle_id: cycle.id, competition_month_id: month.id } }),
    prisma.starLedger.findMany({ where: { user_id: user.id, reward_key: { startsWith: `video:${user.id}:` } }, select: { reward_key: true, amount: true } }),
    prisma.starLedger.aggregate({ where: { user_id: user.id }, _sum: { amount: true } }),
  ])
  const afterRowByLesson = new Map(afterRows.map((row) => [row.lesson_id, row]))
  const afterReplayByVideo = new Map(afterReplays.map((row) => [row.video_id, row]))
  const afterStarByKey = new Map(afterStars.map((row) => [row.reward_key, row]))

  console.log('\n=== XÁC MINH SAU KHI GHI (đọc lại từ DB) ===')
  for (const entry of actionable) {
    const row = afterRowByLesson.get(entry.lessonId)
    const replay = afterReplayByVideo.get(entry.videoId)
    const star = afterStarByKey.get(`video:${user.id}:${entry.videoId}:${month.id}:${cycle.id}`)
    const state = statesByCourse.get(entry.courseId)?.[entry.lessonId]
    console.log(`• ${entry.lessonTitle}`)
    console.log(`  cycle: ${row ? `${fmt(Number(row.furthest_seconds))}s | completed_at=${dateText(row.completed_at)} | unlocked_at=${dateText(row.unlocked_at)}` : 'không có dòng'}`)
    console.log(`  replay: ${replay ? `${fmt(Number(replay.furthest_seconds))}s | completed_at=${dateText(replay.completed_at)}` : 'không có dòng'}`)
    console.log(`  sao: ${star ? `+${star.amount}` : 'chưa có'}`)
    if (state) console.log(`  quiz: videoCompleted=${state.videoCompleted} | canAssess=${state.canAssess} | lockReason=${state.lockReason || '—'}`)
  }
  console.log(`\nTổng sao sau khi ghi: ${starAfter._sum.amount || 0} (trước: ${starSum})`)
  console.log('\nNếu một bài chưa được cộng sao, nguyên nhân thường là chưa có replay tháng này, replay chưa đạt, chương đang tạm dừng thưởng, hoặc tài khoản không đủ điều kiện nhận thưởng.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

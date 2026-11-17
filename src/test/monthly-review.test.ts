import { describe, it, TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { cycleVideoAlreadyComplete, isFreeReviewLesson, planMonthlyReview, startMonthlyReview } from '../lib/monthly-review'
import { readinessForReason } from '../lib/learning-readiness-rules'
import { getMonthlyReviewState, monthlyReplayPercent, previousReplayHistory, monthlyPlayerStart, needsMonthlyQuiz, MonthlyReviewRefreshGate } from '../lib/monthly-review-state'
import { VideoPlaybackGuard } from '../lib/video-playback-guard'
import { isServerVideoCompleted } from '../lib/video-progress-rules'
import { getVideoReplayState } from '../lib/video-heartbeat'

describe('monthly review v2 presentation state', () => {
  it('reads only the current month and term when deciding the review button state', async (t) => {
    const prismaModule = require('../lib/prisma')
    const original = prismaModule.prisma
    t.after(() => { prismaModule.prisma = original })
    let replay: any = { furthest_seconds: 9 }
    let awarded = false
    let monthId = 'nov'
    const keys: string[] = []
    prismaModule.prisma = {
      learningCycle: { findFirst: async () => ({ id: 'cycle' }) },
      competitionMonth: { findUnique: async () => ({ id: monthId, key: `2026-${monthId === 'nov' ? '11' : '12'}` }) },
      video: { findUnique: async () => ({ id: 'vA', duration_seconds: 600 }) },
      cycleLessonProgress: { findUnique: async () => ({ furthest_seconds: 600 }) },
      monthlyVideoReplay: { findUnique: async ({ where }: any) => {
        assert.equal(where.user_id_video_id_competition_month_id_learning_cycle_id.competition_month_id, monthId)
        return replay
      } },
      starLedger: { findUnique: async ({ where }: any) => { keys.push(where.reward_key); return awarded ? { id: 'reward' } : null } },
    }
    const started = await getVideoReplayState('user', 'A')
    assert.equal(started?.reviewState, 'STARTED')
    assert.equal(started?.reviewAvailable, false)
    assert.equal(started?.watchedSeconds, 9)
    awarded = true
    assert.equal((await getVideoReplayState('user', 'A'))?.reviewState, 'AWARDED')
    monthId = 'dec'; replay = null; awarded = false
    const nextMonth = await getVideoReplayState('user', 'A')
    assert.equal(nextMonth?.reviewState, 'AVAILABLE')
    assert.equal(nextMonth?.watchedSeconds, 0)
    assert.deepEqual(keys, ['video:user:vA:nov:cycle', 'video:user:vA:nov:cycle', 'video:user:vA:dec:cycle'])
  })
  it('drops a same-lesson response started before reset even when it arrives last', async () => {
    const gate = new MonthlyReviewRefreshGate()
    let progress = { monthlyReplayRequired: false, watchedSeconds: 600 }
    let resolveOld!: (value: typeof progress) => void
    const oldRequest = new Promise<typeof progress>(resolve => { resolveOld = resolve })
    const oldEpoch = gate.begin(false)
    const pending = oldRequest.then(data => { if (gate.accepts(oldEpoch)) progress = data })
    const resetEpoch = gate.begin(true)
    if (gate.accepts(resetEpoch)) progress = { monthlyReplayRequired: true, watchedSeconds: 0 }
    resolveOld({ monthlyReplayRequired: false, watchedSeconds: 600 })
    await pending
    assert.deepEqual(progress, { monthlyReplayRequired: true, watchedSeconds: 0 })
  })
  it('does not unlock seeking when a monthly heartbeat still reports a completed term', () => {
    const guard = new VideoPlaybackGuard({ lessonId: 'A', videoId: 'vA', duration: 600, initialFurthest: 0 })
    const response = {
      lessonId: 'A', videoId: 'vA', furthestWatchedPositionSeconds: 600, videoCompleted: true, completed: true,
      progressContext: { learningCycleId: 'cycle', competitionMonthId: 'nov', monthlyReplayRequired: true, monthlyReview: true },
      replay: { learningCycleId: 'cycle', competitionMonthId: 'nov', watchedSeconds: 9, completed: false },
    }
    guard.onServerProgressResponse(1, response)
    assert.equal(guard.serverConfirmedFurthest, 9)
    assert.equal(guard.canSeekFreely(), false)
    assert.equal(isServerVideoCompleted(response), false)
    guard.onServerProgressResponse(2, { ...response, replay: { ...response.replay, watchedSeconds: 600, completed: true } })
    assert.equal(guard.canSeekFreely(), true)
  })
  it('keeps term progress for a first watch that crosses into a new month', () => {
    const guard = new VideoPlaybackGuard({ lessonId: 'A', videoId: 'vA', duration: 600, initialFurthest: 0 })
    const response = {
      lessonId: 'A', videoId: 'vA', furthestWatchedPositionSeconds: 300, videoCompleted: false, completed: false,
      progressContext: { learningCycleId: 'cycle', competitionMonthId: 'dec', monthlyReplayRequired: true, monthlyReview: false },
      replay: { learningCycleId: 'cycle', competitionMonthId: 'dec', watchedSeconds: 0, completed: false },
    }
    guard.onServerProgressResponse(1, response)
    assert.equal(guard.serverConfirmedFurthest, 300)
    assert.equal(isServerVideoCompleted({ ...response, furthestWatchedPositionSeconds: 600, videoCompleted: true }), true)
  })
  it('resets monthly playback and limits resume/seek to the current month', () => {
    assert.deepEqual(monthlyPlayerStart(true, 0, 399, 600, true, 600), { initialFurthest: 0, initialPosition: 0 })
    assert.deepEqual(monthlyPlayerStart(true, 9, 399, 600, true, 600), { initialFurthest: 9, initialPosition: 9 })
    assert.deepEqual(monthlyPlayerStart(true, 90, 12, 600, true, 600), { initialFurthest: 90, initialPosition: 12 })
    assert.deepEqual(monthlyPlayerStart(false, 0, 399, 600, true, 600), { initialFurthest: 600, initialPosition: 399 })
    assert.deepEqual(monthlyPlayerStart(false, 0, 600, 600, true, 600), { initialFurthest: 600, initialPosition: 0 })
    assert.deepEqual(monthlyPlayerStart(true, undefined, undefined, 600, true, 600), { initialFurthest: 0, initialPosition: 0 })
  })

  it('labels an opened, unfinished monthly replay quiz even if the term quiz passed', () => {
    assert.equal(needsMonthlyQuiz({ started: true, completed: false }, true), true)
    assert.equal(needsMonthlyQuiz({ started: true, completed: true }, true, true, true), false)
    assert.equal(needsMonthlyQuiz({ started: false, completed: false }, true), false)
    assert.equal(needsMonthlyQuiz(undefined, true), false)
    assert.equal(needsMonthlyQuiz({ started: true, completed: false }, false), false)
    // stays pending after the monthly video is done, until the quiz is passed this month
    assert.equal(needsMonthlyQuiz({ started: true, completed: true }, true, true, false), true)
    assert.equal(needsMonthlyQuiz({ started: true, completed: true }, true, true, true), false)
    // a first watch in the term (quiz never passed) is a normal quiz, not a monthly retake
    assert.equal(needsMonthlyQuiz({ started: true, completed: true }, true, false, false), false)
  })
  it('keeps completed lessons visible after starting and after receiving a reward', () => {
    assert.equal(getMonthlyReviewState(false, false, false), null)
    assert.equal(getMonthlyReviewState(true, true, false), 'AVAILABLE')
    assert.equal(getMonthlyReviewState(true, false, false), 'STARTED')
    assert.equal(getMonthlyReviewState(true, false, true), 'AWARDED')
    assert.equal(getMonthlyReviewState(true, true, true), 'AWARDED')
    // A new month has neither the previous replay nor its ledger entry.
    assert.equal(getMonthlyReviewState(true, true, false), 'AVAILABLE')
  })

  it('excludes the current month without changing its star totals or earlier rows', () => {
    const rows = [{ competitionMonthId: 'nov', awardedStars: 11 }, { competitionMonthId: 'oct', awardedStars: 7 }]
    assert.deepEqual(previousReplayHistory(rows, 'nov'), [rows[1]])
    assert.equal(rows[0].awardedStars, 11)
    assert.deepEqual(previousReplayHistory(rows, null), rows)
  })

  it('reports independent monthly progress, including an old nine-second replay', () => {
    assert.equal(monthlyReplayPercent(9, 600), 1.5)
    assert.equal(monthlyReplayPercent(0, 600), 0)
    assert.equal(monthlyReplayPercent(600, 600), 100)
    assert.equal(monthlyReplayPercent(650, 600), 100)
    assert.equal(monthlyReplayPercent(9, 0), 0)
  })
})

const root = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

const USER = '00000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-11-12T05:00:00Z')
const MONTH = { id: 'month-11', key: '2026-11', starts_at: new Date('2026-10-31T17:00:00Z'), ends_at: new Date('2026-11-30T17:00:00Z') }
const CYCLE = { id: 'cycle-1', provenance: 'NATIVE' }

// Bài A, B, C đã xem xong video (A và B hoàn thành trọn bài, C chỉ đủ video); D đang học dở.
const lessons = [
  { id: 'A', video: { id: 'vA', duration_seconds: 600 } },
  { id: 'B', video: { id: 'vB', duration_seconds: 600 } },
  { id: 'C', video: { id: 'vC', duration_seconds: 600 } },
  { id: 'D', video: { id: 'vD', duration_seconds: 600 } },
  { id: 'E', video: null },
]
const progress = [
  { lesson_id: 'A', completed_at: new Date('2026-10-05T00:00:00Z'), furthest_seconds: 600 },
  { lesson_id: 'B', completed_at: new Date('2026-10-06T00:00:00Z'), furthest_seconds: 600 },
  { lesson_id: 'C', completed_at: null, furthest_seconds: 600 },
  { lesson_id: 'D', completed_at: null, furthest_seconds: 100 },
]

function stubPrisma(t: TestContext, replays: any[] = []) {
  const calls = { replayCreates: 0, forbidden: [] as string[], lessonWheres: [] as any[] }
  const forbidden = (name: string) => () => { calls.forbidden.push(name); throw new Error(`${name} must not be touched`) }
  const tx: any = {
    $queryRaw: async (strings: TemplateStringsArray) => String(strings[0]).includes('clock_timestamp') ? [{ now: NOW }] : [{ id: USER }],
    competitionMonth: { findUnique: async () => MONTH },
    learningCycle: { findFirst: async () => CYCLE },
    lesson: { findMany: async ({ where }: any) => { calls.lessonWheres.push(where); return lessons.filter((l) => l.id === where.id) } },
    cycleLessonProgress: { findMany: async () => progress, upsert: forbidden('cycleLessonProgress.upsert'), update: forbidden('cycleLessonProgress.update') },
    monthlyVideoReplay: {
      findMany: async ({ where }: any) => replays.filter((row) => where.video_id.in.includes(row.video_id)),
      createMany: async ({ data }: any) => {
        calls.replayCreates += 1
        for (const row of data) if (!replays.some((r) => r.video_id === row.video_id)) replays.push(row)
      },
      update: forbidden('monthlyVideoReplay.update'),
    },
    starLedger: new Proxy({}, { get: (_, name) => forbidden(`starLedger.${String(name)}`) }),
  }
  const module = require('../lib/prisma')
  const original = module.prisma
  module.prisma = { $transaction: async (fn: any) => fn(tx) }
  t.after(() => { module.prisma = original })
  return { replays, calls }
}

describe('sang tháng mới không tự reset bài đã xem xong', () => {
  it('nhận diện video đã xem xong trong chu kỳ (hoàn thành hoặc tới cuối video)', () => {
    assert.equal(cycleVideoAlreadyComplete({ completed_at: new Date(), furthest_seconds: 0 }, 600), true)
    assert.equal(cycleVideoAlreadyComplete({ completed_at: null, furthest_seconds: 600 }, 600), true)
    assert.equal(cycleVideoAlreadyComplete({ completed_at: null, furthest_seconds: 100 }, 600), false)
    assert.equal(cycleVideoAlreadyComplete(null, 600), false)
    assert.equal(cycleVideoAlreadyComplete({ completed_at: null, furthest_seconds: 50 }, 0), false)
  })

  it('bài đã xem xong mà tháng này chưa bấm Xem lại thì xem tự do, không có lượt thưởng', () => {
    assert.equal(isFreeReviewLesson(true, false), true)
    // đã bấm Xem lại (có dòng replay của tháng) thì chạy lượt xem thưởng như trước
    assert.equal(isFreeReviewLesson(true, true), false)
    // bài chưa xong (đang học dở hoặc học lần đầu) vẫn tự tạo lượt xem tháng như trước
    assert.equal(isFreeReviewLesson(false, false), false)
    assert.equal(isFreeReviewLesson(false, true), false)
  })

  it('heartbeat không tạo lượt xem tháng và không tính Star cho bài xem tự do', () => {
    const source = read('src/lib/video-heartbeat.ts')
    assert.match(source, /const freeReview = isFreeReviewLesson\(alreadyCycleVideoComplete, Boolean\(replay\)\)/)
    assert.match(source, /rewardComplete = !freeReview && /)
    assert.match(source, /if \(!freeReview\) await tx\.monthlyVideoReplay\.upsert/)
    assert.match(source, /monthlyReplayRequired: !freeReview/)
    // Dòng replay do nút Xem lại mở (chưa có heartbeat) bắt đầu từ 0, không nhập thời gian xem cũ.
    assert.match(source, /replayFurthest = replay\?\.last_heartbeat_at\s*\?/)
  })

  it('tiến độ chu kỳ vẫn được ghi ở mọi nhánh và Star video vẫn khóa theo tháng + chu kỳ', () => {
    const source = read('src/lib/video-heartbeat.ts')
    assert.match(source, /await tx\.cycleLessonProgress\.upsert/)
    assert.match(source, /`video:\$\{userId\}:\$\{lesson\.video\.id\}:\$\{context\.month\.id\}:\$\{context\.cycle\.id\}`/)
    assert.match(source, /skipDuplicates: true/)
  })

  it('chỉ heartbeat và nút Xem lại được tạo dòng lượt xem tháng (không có tác vụ tự reset)', () => {
    const { readdirSync } = require('node:fs')
    const found: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) { if (rel !== 'src/test') walk(rel) }
        else if (/\.tsx?$/.test(entry.name) && /monthlyVideoReplay\.(create|createMany|upsert)\(/.test(read(rel))) found.push(rel)
      }
    }
    walk('src')
    assert.deepEqual(found.sort(), ['src/lib/monthly-review.ts', 'src/lib/video-heartbeat.ts'])
  })
})

describe('kế hoạch Xem lại tháng này', () => {
  const candidates = [
    { lessonId: 'A', videoId: 'vA', durationSeconds: 600, videoComplete: true },
    { lessonId: 'D', videoId: 'vD', durationSeconds: 600, videoComplete: false },
    { lessonId: 'E', videoId: null, durationSeconds: 0, videoComplete: false },
  ]
  it('chỉ mở các bài đã xem xong video và chưa có lượt tháng này', () => {
    const plan = planMonthlyReview(candidates, new Set())
    assert.equal(plan.status, 'STARTED')
    assert.deepEqual(plan.toStart.map((c) => c.lessonId), ['A'])
  })
  it('bấm lại khi đã mở thì không mở thêm', () => {
    const plan = planMonthlyReview(candidates, new Set(['vA']))
    assert.equal(plan.status, 'ALREADY_STARTED')
    assert.equal(plan.toStart.length, 0)
    assert.equal(plan.alreadyStarted, 1)
  })
  it('báo rõ khi chưa có gì để xem lại', () => {
    assert.equal(planMonthlyReview(candidates.slice(1), new Set()).status, 'NOTHING_TO_REVIEW')
    assert.equal(planMonthlyReview([], new Set()).status, 'NOTHING_TO_REVIEW')
  })
  it('có câu thông báo tiếng Việt cho lý do chưa mở xem lại', () => {
    assert.match(readinessForReason('REVIEW_NOT_STARTED').message, /Xem lại tháng này/)
  })
})

describe('startMonthlyReview', () => {
  it('chỉ mở đúng bài được chọn (A, B, C xong còn D dở): không lan sang bài khác', async (t) => {
    const { replays } = stubPrisma(t)
    const result: any = await startMonthlyReview(USER, 'A')
    assert.equal(result.status, 'STARTED')
    assert.equal(result.competitionMonth, '2026-11')
    assert.deepEqual(result.lessonIds, ['A'])
    assert.deepEqual(replays.map((r) => r.video_id), ['vA'])
    for (const row of replays) {
      assert.equal(row.furthest_seconds, 0)
      assert.equal(row.competition_month_id, MONTH.id)
      assert.equal(row.learning_cycle_id, CYCLE.id)
      assert.equal(row.completed_at, undefined)
      assert.equal(row.last_heartbeat_at, undefined)
    }
    await startMonthlyReview(USER, 'C')
    assert.deepEqual(replays.map((r) => r.video_id), ['vA', 'vC'])
  })

  it('chỉ tìm bài trong khóa đã xuất bản', async (t) => {
    const { calls } = stubPrisma(t)
    await startMonthlyReview(USER, 'B')
    assert.deepEqual(calls.lessonWheres, [{ id: 'B', session: { course: { status: 'PUBLISHED' } } }])
  })

  it('bấm hai lần: lần hai không tạo thêm dòng, không đụng Star hay tiến độ', async (t) => {
    const { replays, calls } = stubPrisma(t)
    await startMonthlyReview(USER, 'A')
    const second: any = await startMonthlyReview(USER, 'A')
    assert.equal(second.status, 'ALREADY_STARTED')
    assert.equal(second.started, 0)
    assert.equal(second.alreadyStarted, 1)
    assert.equal(replays.length, 1)
    assert.equal(calls.replayCreates, 1)
    assert.deepEqual(calls.forbidden, [])
  })

  it('bài đang học dở thì báo chưa có gì để xem lại và không tạo dòng nào', async (t) => {
    const { replays } = stubPrisma(t)
    const result: any = await startMonthlyReview(USER, 'D')
    assert.equal(result.status, 'NOTHING_TO_REVIEW')
    assert.equal(replays.length, 0)
  })

  it('giữ nguyên lượt xem đã có tiến độ, không ghi đè về 0', async (t) => {
    const existing = { video_id: 'vA', furthest_seconds: 420, last_heartbeat_at: NOW }
    const { replays } = stubPrisma(t, [existing])
    const result: any = await startMonthlyReview(USER, 'A')
    assert.equal(result.status, 'ALREADY_STARTED')
    assert.equal(replays.length, 1)
    assert.equal(replays[0], existing)
    assert.equal(existing.furthest_seconds, 420)
  })

  it('bài không tồn tại hoặc chưa xuất bản thì trả NotFound', async (t) => {
    stubPrisma(t)
    assert.deepEqual(await startMonthlyReview(USER, 'ZZZ'), { error: 'NotFound' })
  })
})

describe('API monthly-review', () => {
  const source = read('src/app/api/v1/learning/monthly-review/route.ts')
  it('chỉ nhận lessonId hợp lệ, từ chối courseId và chặn tài khoản quản lý', () => {
    assert.match(source, /!UUID\.test\(lessonId\) \|\| body\?\.courseId !== undefined/)
    assert.match(source, /InvalidReviewScope/)
    assert.match(source, /status: 400/)
    assert.match(source, /isLearningManager/)
    assert.match(source, /status: 409/)
  })

  it('không còn phạm vi khóa ở API, hàm lõi và nút', () => {
    assert.doesNotMatch(source, /courseId\s*=/)
    const lib = read('src/lib/monthly-review.ts')
    assert.doesNotMatch(lib, /courseId|MonthlyReviewScope/)
    assert.doesNotMatch(read('src/components/learning/MonthlyReviewButton.tsx'), /courseId/)
    assert.doesNotMatch(read('src/app/student/courses/[courseId]/page.tsx'), /MonthlyReviewButton/)
  })
})

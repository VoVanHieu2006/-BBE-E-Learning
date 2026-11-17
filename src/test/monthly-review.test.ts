import { describe, it, TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { cycleVideoAlreadyComplete, isFreeReviewLesson, planMonthlyReview, startMonthlyReview, lessonsWithMonthlyQuizPassed } from '../lib/monthly-review'
import { readinessForReason } from '../lib/learning-readiness-rules'
import {
  getMonthlyReviewState, monthlyReplayPercent, previousReplayHistory, monthlyPlayerStart, needsMonthlyQuiz, MonthlyReviewRefreshGate,
  lessonAwardedThisMonth, monthlyQuizBlock, monthlyQuizLocked, quizRewardReason, quizRewardMessages, monthHistoryLabel, monthHistoryParts, thisMonthQuizLabel,
} from '../lib/monthly-review-state'
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
      starLedger: { findMany: async ({ where }: any) => {
        keys.push(`${where.competition_month_id}:${where.learning_cycle_id}:${where.OR.map((s: any) => `${s.source_type}=${s.source_id}`).join(',')}`)
        return awarded ? [{ source_type: 'VIDEO', amount: 5 }] : []
      } },
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
    assert.deepEqual(keys, ['nov:cycle:VIDEO=vA', 'nov:cycle:VIDEO=vA', 'dec:cycle:VIDEO=vA'])
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
  { id: 'A', video: { id: 'vA', duration_seconds: 600 }, assessment: { id: 'qA' } },
  { id: 'B', video: { id: 'vB', duration_seconds: 600 }, assessment: { id: 'qB' } },
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

function stubPrisma(t: TestContext, replays: any[] = [], stars: { source_type: string; source_id: string; amount: number }[] = []) {
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
    // Reading this month's stars is allowed; opening a review must never write Star.
    starLedger: new Proxy({}, { get: (_, name) => name === 'findMany'
      ? async ({ where }: any) => {
          assert.equal(where.competition_month_id, MONTH.id)
          assert.equal(where.learning_cycle_id, CYCLE.id)
          return stars.filter((s) => where.OR.some((o: any) => o.source_type === s.source_type && o.source_id === s.source_id))
        }
      : forbidden(`starLedger.${String(name)}`) }),
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

  it('phương án A: tháng này đã nhận sao quiz của bài (vd "Tầm nhìn") thì từ chối mở, không tạo dòng', async (t) => {
    const { replays } = stubPrisma(t, [], [{ source_type: 'ASSESSMENT', source_id: 'qA', amount: 10 }])
    const result: any = await startMonthlyReview(USER, 'A')
    assert.equal(result.status, 'AWARDED_THIS_MONTH')
    assert.match(result.message, /Tháng sau mới xem lại được/)
    assert.equal(replays.length, 0)
  })

  it('phương án A: tháng này đã nhận sao video thì cũng từ chối mở', async (t) => {
    const { replays } = stubPrisma(t, [], [{ source_type: 'VIDEO', source_id: 'vA', amount: 5 }])
    assert.equal(((await startMonthlyReview(USER, 'A')) as any).status, 'AWARDED_THIS_MONTH')
    assert.equal(replays.length, 0)
  })

  it('sao của bài khác không chặn bài này', async (t) => {
    const { replays } = stubPrisma(t, [], [{ source_type: 'ASSESSMENT', source_id: 'qB', amount: 10 }])
    assert.equal(((await startMonthlyReview(USER, 'A')) as any).status, 'STARTED')
    assert.equal(replays.length, 1)
  })
})

describe('phương án A: mỗi bài mỗi tháng nhận sao video và sao quiz tối đa 1 lần', () => {
  it('có bất kỳ sao nào của bài trong tháng (video hoặc quiz) thì nút xám', () => {
    assert.equal(lessonAwardedThisMonth({ video: 0, quiz: 0 }), false)
    assert.equal(lessonAwardedThisMonth({ video: 5, quiz: 0 }), true)
    assert.equal(lessonAwardedThisMonth({ video: 0, quiz: 10 }), true)
    assert.equal(lessonAwardedThisMonth(null), false)
    // "Tầm nhìn": sao video tháng 10, quiz làm trong tháng 11 → tháng 11 xám
    assert.equal(getMonthlyReviewState(true, true, lessonAwardedThisMonth({ video: 0, quiz: 10 })), 'AWARDED')
  })

  it('planMonthlyReview bỏ qua bài đã có sao tháng này', () => {
    const candidates = [{ lessonId: 'A', videoId: 'vA', durationSeconds: 600, videoComplete: true }]
    assert.equal(planMonthlyReview(candidates, new Set(), new Set(['A'])).status, 'AWARDED_THIS_MONTH')
    assert.equal(planMonthlyReview(candidates, new Set(), new Set(['A'])).toStart.length, 0)
    assert.equal(planMonthlyReview(candidates, new Set(), new Set()).status, 'STARTED')
  })

  it('getVideoReplayState xét cả sao quiz của bài trong tháng và nhiệm kỳ', async (t) => {
    const prismaModule = require('../lib/prisma')
    const original = prismaModule.prisma
    t.after(() => { prismaModule.prisma = original })
    let rows: any[] = []
    prismaModule.prisma = {
      learningCycle: { findFirst: async () => ({ id: 'cycle' }) },
      competitionMonth: { findUnique: async () => ({ id: 'nov', key: '2026-11' }) },
      video: { findUnique: async () => ({ id: 'vA', duration_seconds: 600, lesson: { assessment: { id: 'qA' } } }) },
      cycleLessonProgress: { findUnique: async () => ({ furthest_seconds: 600 }) },
      monthlyVideoReplay: { findUnique: async () => null },
      starLedger: { findMany: async ({ where }: any) => {
        assert.deepEqual(where.OR, [{ source_type: 'VIDEO', source_id: 'vA' }, { source_type: 'ASSESSMENT', source_id: 'qA' }])
        return rows
      } },
    }
    assert.equal((await getVideoReplayState('user', 'A'))?.reviewState, 'AVAILABLE')
    rows = [{ source_type: 'ASSESSMENT', amount: 10 }]
    const state = await getVideoReplayState('user', 'A')
    assert.equal(state?.reviewState, 'AWARDED')
    assert.deepEqual(state?.monthStars, { video: 0, quiz: 10 })
  })
})

describe('thứ tự video → quiz', () => {
  const base = { priorAttempt: false, priorAttemptBeforeMonth: false, replayExists: false, replayCompleted: false, videoDoneInEarlierMonth: false }
  it('học lần đầu trong nhiệm kỳ không bị chặn (kể cả xem video vắt qua 2 tháng)', () => {
    assert.equal(monthlyQuizBlock(base), null)
    assert.equal(monthlyQuizBlock({ ...base, replayExists: true }), null)
  })
  it('quiz làm ở tháng trước, tháng này chưa bấm Xem lại → hướng sang Xem lại tháng này', () => {
    assert.equal(monthlyQuizBlock({ ...base, priorAttempt: true, priorAttemptBeforeMonth: true }), 'REVIEW_NOT_STARTED')
  })
  it('đã bấm Xem lại mà video tháng chưa xong → chặn; xem xong → mở', () => {
    const reset = { ...base, priorAttempt: true, priorAttemptBeforeMonth: true, replayExists: true }
    assert.equal(monthlyQuizBlock(reset), 'MONTHLY_VIDEO_INCOMPLETE')
    assert.equal(monthlyQuizBlock({ ...reset, replayCompleted: true }), null)
  })
  it('xem video tháng trước mà chưa làm quiz, tháng này bấm Xem lại → vẫn phải xem hết video trước', () => {
    const reset = { ...base, replayExists: true, videoDoneInEarlierMonth: true }
    assert.equal(monthlyQuizBlock(reset), 'MONTHLY_VIDEO_INCOMPLETE')
    assert.equal(monthlyQuizBlock({ ...reset, replayCompleted: true }), null)
  })
  it('giao diện mở khóa ngay khi heartbeat báo video tháng xong', () => {
    assert.equal(monthlyQuizLocked({ reason: 'MONTHLY_VIDEO_INCOMPLETE' }, true), null)
    assert.equal(monthlyQuizLocked({ reason: 'MONTHLY_VIDEO_INCOMPLETE' }, false), 'MONTHLY_VIDEO_INCOMPLETE')
    assert.equal(monthlyQuizLocked({ reason: 'REVIEW_NOT_STARTED' }, true), 'REVIEW_NOT_STARTED')
    assert.equal(monthlyQuizLocked(null, false), null)
  })
  it('server cổng bắt đầu bài và trang bài học dùng chung luật', () => {
    const route = read('src/app/api/v1/assessments/[assessmentId]/attempts/route.ts')
    assert.match(route, /loadMonthlyQuizBlock\(prisma/)
    assert.match(read('src/lib/quiz-submission.ts'), /loadMonthlyQuizBlock\(tx[\s\S]*excludeAttemptId: attempt\.id/)
    const page = read('src/app/student/learning/[lessonId]/page.tsx')
    assert.match(page, /Xem hết video trước/)
    assert.match(read('src/app/student/learning/[lessonId]/quiz/page.tsx'), /Bấm "Xem lại tháng này" để làm lại/)
  })
})

describe('quiz đạt mà 0 sao phải nói lý do', () => {
  const ok = { passed: true, amount: 0, hasCourse: true, videoDone: true, monthlyReplayDone: true, eligible: true, paused: false }
  it('mỗi trường hợp có mã lý do và lời nhắn', () => {
    assert.equal(quizRewardReason({ ...ok, amount: 10 }), 'AWARDED')
    assert.equal(quizRewardReason({ ...ok, passed: false }), 'NOT_PASSED')
    assert.equal(quizRewardReason(ok), 'ALREADY_AWARDED')
    assert.equal(quizRewardReason({ ...ok, monthlyReplayDone: false }), 'MONTHLY_VIDEO_INCOMPLETE')
    assert.equal(quizRewardReason({ ...ok, eligible: false, paused: true }), 'CHAPTER_PAUSED')
    assert.equal(quizRewardReason({ ...ok, eligible: false }), 'REWARD_NOT_ELIGIBLE')
    for (const code of ['ALREADY_AWARDED', 'MONTHLY_VIDEO_INCOMPLETE', 'CHAPTER_PAUSED', 'REWARD_NOT_ELIGIBLE'] as const) {
      assert.ok(quizRewardMessages[code].length > 10)
    }
  })
  it('API nộp bài trả mã lý do để trang quiz hiển thị', () => {
    assert.match(read('src/app/api/v1/attempts/[attemptId]/submit/route.ts'), /reasonCode, message: reasonCode \? quizRewardMessages\[reasonCode\]/)
  })
})

describe('lịch sử theo tháng có cả video và quiz', () => {
  it('nhãn chip tháng trước', () => {
    assert.equal(monthHistoryLabel({ awardedStars: 5, completed: true, watchedSeconds: 19, quiz: { attempted: 1, passed: true, stars: 10 } }), 'video +5 ⭐ · quiz đạt +10 ⭐')
    assert.equal(monthHistoryLabel({ awardedStars: 5, completed: true, watchedSeconds: 19, quiz: { attempted: 0, passed: false, stars: 0 } }), 'video +5 ⭐ · quiz chưa làm')
    assert.equal(monthHistoryLabel({ awardedStars: 0, completed: false, watchedSeconds: 0, quiz: { attempted: 2, passed: false, stars: 0 } }), 'video chưa xem · quiz chưa đạt')
    assert.equal(monthHistoryLabel({ awardedStars: 0, completed: true, watchedSeconds: 19, quiz: { attempted: 1, passed: true, stars: 0 } }), 'video ✓ đã xem · quiz đạt, 0 ⭐')
    assert.equal(monthHistoryLabel({ awardedStars: 0, completed: false, watchedSeconds: 7, quiz: null }), 'video 7s')
  })
  it('tách phần VIDEO và QUIZ để hiển thị nhãn in đậm, khác màu', () => {
    assert.deepEqual(monthHistoryParts({ awardedStars: 1, completed: true, watchedSeconds: 19, quiz: { attempted: 1, passed: true, stars: 1 } }), { video: '+1 ⭐', quiz: 'đạt +1 ⭐' })
    assert.deepEqual(monthHistoryParts({ awardedStars: 0, completed: false, watchedSeconds: 7, quiz: null }), { video: '7s', quiz: null })
    const component = read('src/components/learning/MonthStarParts.tsx')
    assert.match(component, /font-extrabold uppercase/)
    assert.match(component, /text-\[#2563EB\]' : 'text-violet-700'/)
    assert.match(read('src/app/student/learning/[lessonId]/page.tsx'), /<MonthStarParts \{\.\.\.monthHistoryParts\(row\)\} \/>/)
    assert.match(read('src/app/student/learning/[lessonId]/quiz/page.tsx'), /<MonthStarParts \{\.\.\.monthHistoryParts\(row\)\} \/>/)
  })
  it('ô tháng này', () => {
    const quiz = { attempted: 0, passed: false, stars: 0 }
    assert.equal(thisMonthQuizLabel({ quiz, locked: 'MONTHLY_VIDEO_INCOMPLETE', monthlyPending: false, reviewStarted: true, monthlyPassed: false }), 'xem hết video trước')
    assert.equal(thisMonthQuizLabel({ quiz: { attempted: 1, passed: true, stars: 10 }, locked: null, monthlyPending: false, reviewStarted: true, monthlyPassed: true }), 'đạt +10 ⭐')
    assert.equal(thisMonthQuizLabel({ quiz, locked: null, monthlyPending: true, reviewStarted: true, monthlyPassed: false }), 'chưa làm lại')
    assert.equal(thisMonthQuizLabel({ quiz, locked: null, monthlyPending: false, reviewStarted: false, monthlyPassed: false }), 'chưa làm')
  })
  it('API tiến độ trả quiz theo tháng', () => {
    const route = read('src/app/api/v1/lessons/[lessonId]/progress/route.ts')
    assert.match(route, /source_type: 'ASSESSMENT', source_id: assessmentId/)
    assert.match(route, /quizThisMonth: historyData\.quizThisMonth/)
    assert.match(route, /monthlyQuizBlock:/)
  })
})

describe('danh sách bài học trên điện thoại', () => {
  const page = () => read('src/app/student/learning/[lessonId]/page.tsx')
  it('dưới lg hiện dạng lớp phủ toàn màn hình, từ lg giữ cột bên phải', () => {
    assert.match(page(), /fixed inset-0 z-50 flex justify-end bg-slate-950\/40 lg:static/)
    assert.match(page(), /matchMedia\('\(max-width: 1023px\)'\)/)
  })
  it('có nút quay lại, chọn bài thì tự đóng, Esc cũng đóng', () => {
    assert.match(page(), /← Quay lại bài học/)
    assert.match(page(), /if \(compactViewport\) setSidebarOpen\(false\);\s*switchLesson\(lId\)/)
    assert.match(page(), /event\.key === 'Escape'\) setSidebarOpen\(false\)/)
  })
})

describe('bài thi cuối khóa: 1 ⭐ mỗi câu đúng', () => {
  it('nhãn theo số câu hỏi, không còn cố định 5 ⭐', () => {
    const page = read('src/app/student/courses/[courseId]/quiz/page.tsx')
    assert.doesNotMatch(page, /tối đa 5 ⭐/)
    assert.match(page, /Tối đa \{assessment\.questionCount \|\| 0\} ⭐ \(1 ⭐ mỗi câu đúng\)/)
  })
  it('server cộng 1 ⭐ mỗi câu đúng, trần là số câu của lượt đầu trong tháng (dùng chung với quiz bài học)', () => {
    const source = read('src/lib/quiz-submission.ts')
    assert.match(source, /reward_question_count: grading\.results\.length/)
    assert.match(source, /Math\.floor\(correctCount \/ grading\.results\.length \* mark\.reward_question_count/)
    assert.match(source, /assessment\.type === 'COURSE_FINAL' \? 'COURSE_FINAL_PASS'/)
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

describe('Xem lại tháng này reset cả video và bài kiểm tra', () => {
  it('chỉ tính quiz đạt tháng này khi nộp sau lúc xem xong video của lượt tháng', async (t) => {
    const prismaModule = require('../lib/prisma')
    const original = prismaModule.prisma
    t.after(() => { prismaModule.prisma = original })
    const videoDone = new Date('2026-11-20T10:00:00Z')
    let replays: any[] = []
    let attempts: any[] = []
    prismaModule.prisma = {
      monthlyVideoReplay: { findMany: async () => replays },
      attempt: { findMany: async () => attempts },
    }
    const lessons = [{ lessonId: 'L1', videoId: 'V1' }, { lessonId: 'L2', videoId: 'V2' }]
    // Reset clicked, video not finished yet: the quiz passed earlier this month no longer counts.
    attempts = [{ submitted_at: new Date('2026-11-05T00:00:00Z'), assessment: { lesson_id: 'L1' } }]
    assert.deepEqual(Array.from(await lessonsWithMonthlyQuizPassed('u', 'c', 'm', lessons)), [])
    // Video finished, old pass is from before: still not passed this month.
    replays = [{ video_id: 'V1', completed_at: videoDone }]
    assert.deepEqual(Array.from(await lessonsWithMonthlyQuizPassed('u', 'c', 'm', lessons)), [])
    // Retaken after the video: passed this month.
    attempts.push({ submitted_at: new Date('2026-11-20T10:05:00Z'), assessment: { lesson_id: 'L1' } })
    assert.deepEqual(Array.from(await lessonsWithMonthlyQuizPassed('u', 'c', 'm', lessons)), ['L1'])
  })

  it('quiz chặn làm lại khi lượt tháng đã mở mà video chưa xem xong, kể cả trong cùng tháng', () => {
    const source = readFileSync(path.join(__dirname, '../app/api/v1/assessments/[assessmentId]/attempts/route.ts'), 'utf8')
    assert.match(source, /const block = await loadMonthlyQuizBlock\(prisma/)
    assert.match(source, /if \(block\)/)
    // Quiz đã làm trong cùng tháng, rồi bấm Xem lại: lượt tháng mở mà video chưa xong thì chặn.
    assert.equal(monthlyQuizBlock({ priorAttempt: true, priorAttemptBeforeMonth: false, replayExists: true, replayCompleted: false, videoDoneInEarlierMonth: false }), 'MONTHLY_VIDEO_INCOMPLETE')
  })
})

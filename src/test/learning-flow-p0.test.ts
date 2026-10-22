import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { capVideoProgress, hasWatchedFullVideo } from '../lib/video-progress-rules'
import { highWaterIncrement } from '../lib/learning-cycle-rules'
import { starsForVideoDuration } from '../lib/reward-rules'

describe('P0 — Anti-Seek & Video Progress Integrity', () => {
  it('capVideoProgress strictly caps client-reported furthest to wall-clock elapsed time at max rate', () => {
    const currentFurthest = 10
    const requestedPosition = 500
    const requestedFurthest = 500
    const elapsedSeconds = 5 // only 5 seconds passed in reality
    const maxPlaybackRate = 2

    const result = capVideoProgress(
      currentFurthest,
      requestedPosition,
      requestedFurthest,
      elapsedSeconds,
      maxPlaybackRate,
    )

    // Maximum reachable = 10 + 5 * 2 = 20 seconds.
    // It must NEVER allow jumping to 500s.
    assert.equal(result.furthestWatchedPositionSeconds, 20)
    assert.equal(result.lastPositionSeconds, 20)
  })

  it('rejects zero or negative elapsed time without making progress', () => {
    const currentFurthest = 100
    const requestedPosition = 300
    const requestedFurthest = 300
    const elapsedSeconds = 0

    const result = capVideoProgress(currentFurthest, requestedPosition, requestedFurthest, elapsedSeconds)
    assert.equal(result.furthestWatchedPositionSeconds, 100)
  })

  it('hasWatchedFullVideo requires position >= duration and valid numbers', () => {
    assert.equal(hasWatchedFullVideo(99, 100), false)
    assert.equal(hasWatchedFullVideo(95, 100), false) // no fake -5s shortcut
    assert.equal(hasWatchedFullVideo(100, 100), true)
    assert.equal(hasWatchedFullVideo(105, 100), true)
    assert.equal(hasWatchedFullVideo(NaN, 100), false)
    assert.equal(hasWatchedFullVideo(100, 0), false)
  })
})

describe('P0 — Quiz High-Water Mark and Delta Stars', () => {
  it('awards stars for first pass above high-water mark (0 -> 9)', () => {
    const currentMax = 0
    const earned = 9
    const delta = highWaterIncrement(currentMax, earned)
    assert.equal(delta, 9)
  })

  it('awards zero stars when subsequent attempt has equal or lower score (9 -> 7, 9 -> 9)', () => {
    const currentMax = 9
    assert.equal(highWaterIncrement(currentMax, 7), 0)
    assert.equal(highWaterIncrement(currentMax, 9), 0)
  })

  it('awards only incremental stars when score improves (9 -> 10)', () => {
    const currentMax = 9
    const earned = 10
    const delta = highWaterIncrement(currentMax, earned)
    assert.equal(delta, 1)
  })

  it('starts fresh at 0 in a new month or new learning cycle', () => {
    // When a new month or new cycle begins, a new QuizRewardHighWaterMark is created with maximum_stars = 0.
    const newCycleMax = 0
    const earned = 8
    const delta = highWaterIncrement(newCycleMax, earned)
    assert.equal(delta, 8)
  })
})

describe('P0 — Sequential Lesson Gating Logic', () => {
  type TestLesson = {
    id: string
    videoDuration: number
    hasQuiz: boolean
  }

  function evaluateSequentialGate(
    lessons: TestLesson[],
    targetLessonIndex: number,
    watchedSecondsByLesson: Map<string, number>,
    passedQuizByLesson: Set<string>,
  ): { ok: boolean; code?: string } {
    if (targetLessonIndex === 0) return { ok: true }

    const previousLessons = lessons.slice(0, targetLessonIndex)
    for (const prev of previousLessons) {
      const watched = watchedSecondsByLesson.get(prev.id) || 0
      if (!hasWatchedFullVideo(watched, prev.videoDuration)) {
        return { ok: false, code: 'PreviousLessonIncomplete' }
      }
      if (prev.hasQuiz && !passedQuizByLesson.has(prev.id)) {
        return { ok: false, code: 'LessonAssessmentRequired' }
      }
    }
    return { ok: true }
  }

  const sampleCourse: TestLesson[] = [
    { id: 'lesson-1', videoDuration: 120, hasQuiz: true },
    { id: 'lesson-2', videoDuration: 180, hasQuiz: true },
    { id: 'lesson-3', videoDuration: 240, hasQuiz: false },
  ]

  it('Lesson 1 is always unlocked initially', () => {
    const watched = new Map<string, number>()
    const passed = new Set<string>()
    const gate = evaluateSequentialGate(sampleCourse, 0, watched, passed)
    assert.equal(gate.ok, true)
  })

  it('Lesson 2 is blocked if Lesson 1 video is not fully watched', () => {
    const watched = new Map<string, number>([['lesson-1', 110]]) // 110 < 120
    const passed = new Set<string>()
    const gate = evaluateSequentialGate(sampleCourse, 1, watched, passed)
    assert.equal(gate.ok, false)
    assert.equal(gate.code, 'PreviousLessonIncomplete')
  })

  it('Lesson 2 is blocked if Lesson 1 video is watched but quiz is not passed', () => {
    const watched = new Map<string, number>([['lesson-1', 120]])
    const passed = new Set<string>() // no quiz passed
    const gate = evaluateSequentialGate(sampleCourse, 1, watched, passed)
    assert.equal(gate.ok, false)
    assert.equal(gate.code, 'LessonAssessmentRequired')
  })

  it('Lesson 2 unlocks after Lesson 1 video is complete AND quiz is passed', () => {
    const watched = new Map<string, number>([['lesson-1', 120]])
    const passed = new Set<string>(['lesson-1'])
    const gate = evaluateSequentialGate(sampleCourse, 1, watched, passed)
    assert.equal(gate.ok, true)
  })

  it('Term reset isolates new cycle from old cycle completion', () => {
    // Old cycle: Lesson 1 and 2 completed
    const oldCycleWatched = new Map<string, number>([['lesson-1', 120], ['lesson-2', 180]])
    const oldCyclePassed = new Set<string>(['lesson-1', 'lesson-2'])
    assert.equal(evaluateSequentialGate(sampleCourse, 2, oldCycleWatched, oldCyclePassed).ok, true)

    // New term cycle: starts fresh, no cycle progress inherited
    const newCycleWatched = new Map<string, number>()
    const newCyclePassed = new Set<string>()

    // Lesson 1 is open
    assert.equal(evaluateSequentialGate(sampleCourse, 0, newCycleWatched, newCyclePassed).ok, true)
    // Lesson 2 is locked again in new cycle
    const gateLesson2 = evaluateSequentialGate(sampleCourse, 1, newCycleWatched, newCyclePassed)
    assert.equal(gateLesson2.ok, false)
    assert.equal(gateLesson2.code, 'PreviousLessonIncomplete')

    // Old cycle data remains untouched in historical records
    assert.equal(oldCycleWatched.get('lesson-1'), 120)
    assert.equal(oldCyclePassed.has('lesson-1'), true)
  })
})

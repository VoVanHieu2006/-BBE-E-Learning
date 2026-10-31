import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { QUIZ_SUBMIT_GRACE_MS, submissionTiming } from '../lib/quiz-attempt-rules'
import {
  countAnswered,
  formatCountdown,
  questionNavState,
  quizDeadlineMs,
  secondsUntil,
  toggleFlag,
} from '../lib/quiz-navigator'

const root = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

describe('quiz submission timing', () => {
  const expiresAt = new Date('2026-10-31T10:00:00.000Z')
  const at = (offsetMs: number) => new Date(expiresAt.getTime() + offsetMs)

  it('is on time before expiry', () => {
    assert.equal(submissionTiming(expiresAt, at(-1)), 'ON_TIME')
  })

  it('accepts a submit sent as the countdown ends within the grace window', () => {
    assert.equal(submissionTiming(expiresAt, at(0)), 'LATE_WITHIN_GRACE')
    assert.equal(submissionTiming(expiresAt, at(QUIZ_SUBMIT_GRACE_MS)), 'LATE_WITHIN_GRACE')
  })

  it('treats later submits as too late (only saved answers count)', () => {
    assert.equal(submissionTiming(expiresAt, at(QUIZ_SUBMIT_GRACE_MS + 1)), 'TOO_LATE')
    assert.ok(QUIZ_SUBMIT_GRACE_MS > 0 && QUIZ_SUBMIT_GRACE_MS <= 2 * 60_000)
  })
})

describe('time-up submit no longer fails on the server', () => {
  const source = read('src/lib/quiz-submission.ts')

  it('does not reject a manual submit after expiry', () => {
    assert.doesNotMatch(source, /AttemptExpired/)
    assert.match(source, /const timing = submissionTiming\(attempt\.expires_at, now\)/)
  })

  it('ignores request answers once the grace window has passed', () => {
    assert.match(source, /input\.answers && timing !== 'TOO_LATE'/)
  })

  it('records a time-up submit as AUTO_SUBMITTED and keeps the cron guard', () => {
    assert.match(source, /status: input\.auto \|\| timeUp \? 'AUTO_SUBMITTED' : 'SUBMITTED'/)
    assert.match(source, /input\.auto && timing === 'ON_TIME'\) return \{ error: 'AttemptNotExpired'/)
  })

  it('still refuses to save answers after expiry', () => {
    const answers = read('src/app/api/v1/attempts/[attemptId]/answers/route.ts')
    assert.match(answers, /new Date\(\) >= attempt\.expires_at\) return NextResponse\.json\(\{ error: \{ code: 'AttemptExpired' \} \}/)
  })
})

describe('quiz countdown helpers', () => {
  it('computes whole seconds left from the deadline and never goes negative', () => {
    assert.equal(secondsUntil(10_000, 0), 10)
    assert.equal(secondsUntil(10_000, 9_001), 1)
    assert.equal(secondsUntil(10_000, 10_000), 0)
    assert.equal(secondsUntil(10_000, 99_999), 0)
    assert.equal(secondsUntil(Number.NaN, 0), 0)
  })

  it('prefers the server expiresAt over the configured duration', () => {
    assert.equal(quizDeadlineMs('2026-10-31T10:00:00.000Z', 30, 0), Date.parse('2026-10-31T10:00:00.000Z'))
    assert.equal(quizDeadlineMs(undefined, 2, 1_000), 121_000)
    assert.equal(quizDeadlineMs(undefined, 0, 1_000), null)
    assert.equal(quizDeadlineMs('not a date', 0, 1_000), null)
  })

  it('formats mm:ss and h:mm:ss', () => {
    assert.equal(formatCountdown(0), '00:00')
    assert.equal(formatCountdown(65), '01:05')
    assert.equal(formatCountdown(3_725), '1:02:05')
  })
})

describe('question navigator state', () => {
  const answers = { q1: 'o1', q3: 'o9' }

  it('distinguishes unanswered, answered and flagged (flag wins)', () => {
    const flagged = new Set(['q3', 'q4'])
    assert.equal(questionNavState('q1', answers, flagged), 'answered')
    assert.equal(questionNavState('q2', answers, flagged), 'unanswered')
    assert.equal(questionNavState('q3', answers, flagged), 'flagged')
    assert.equal(questionNavState('q4', answers, flagged), 'flagged')
  })

  it('toggles flags without mutating the previous set', () => {
    const before = new Set(['q1'])
    const added = toggleFlag(before, 'q2')
    const removed = toggleFlag(added, 'q1')
    assert.deepEqual(Array.from(before), ['q1'])
    assert.deepEqual(Array.from(added).sort(), ['q1', 'q2'])
    assert.deepEqual(Array.from(removed), ['q2'])
  })

  it('counts answered questions only for questions in the attempt', () => {
    assert.equal(countAnswered(['q1', 'q2', 'q3'], { ...answers, stale: 'x' }), 2)
  })
})

describe('LessonQuiz UI wiring', () => {
  const source = read('src/components/lesson/LessonQuiz.tsx')

  it('keeps the timer in a sticky panel below the page header', () => {
    assert.match(source, /data-testid="quiz-sidebar"/)
    assert.match(source, /style=\{\{ top: stickyTop \}\}/)
    assert.match(source, /className="sticky z-20/)
    assert.match(source, /document\.querySelector\('\[data-quiz-header\]'\)/)
    for (const page of ['src/app/student/learning/[lessonId]/quiz/page.tsx', 'src/app/student/courses/[courseId]/quiz/page.tsx']) {
      assert.match(read(page), /data-quiz-header/, page)
    }
  })

  it('locks answers and shows a non-dismissable time-up modal with submit and cancel', () => {
    assert.match(source, /const locked = Boolean\(result\) \|\| timeUp/)
    assert.match(source, /if \(locked\) return; \/\/ Frozen/)
    assert.match(source, /Bạn đã hết thời gian/)
    assert.match(source, /isOpen=\{timeUp && !result && Boolean\(attempt\)\}\s*onClose=\{\(\) => \{\}\}/)
    assert.match(source, /onClick=\{handleCancelQuiz\}\s*>\s*Hủy bài/)
    assert.match(source, /onClick=\{handleSubmit\}\s*>\s*Nộp bài\s*</)
    // The old flow silently auto-submitted when the timer hit zero.
    assert.doesNotMatch(source, /handleAutoSubmit/)
  })

  it('saves answers to the server while working', () => {
    assert.match(source, /\/api\/v1\/attempts\/\$\{attemptId\}\/answers/)
  })

  it('navigator scrolls on click and flags on right click or long press', () => {
    assert.match(source, /onContextMenu=\{\(e\) => \{\s*e\.preventDefault\(\);/)
    assert.match(source, /handleToggleFlag\(qId\)/)
    assert.match(source, /scrollToQuestion\(index\)/)
    assert.match(source, /onPointerDown=\{\(e\) => handleNavPointerDown\(e, qId\)\}/)
    assert.match(source, /data-testid=\{`quiz-flag-\$\{qIdx \+ 1\}`\}/)
    assert.match(source, /id=\{`quiz-question-\$\{qIdx \+ 1\}`\}/)
  })
})

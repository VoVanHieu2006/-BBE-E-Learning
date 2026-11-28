import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  attemptScorePercent,
  formatAttemptScorePercent,
  scorePercentLabel,
  lessonQuizSummary,
  lessonQuizStatus,
  isCourseCompleted,
} from '../lib/course-progress-display'

describe('attemptScorePercent', () => {
  it('1 -> 100', () => {
    assert.equal(attemptScorePercent(1), 100)
  })
  it('0.85 -> 85', () => {
    assert.equal(attemptScorePercent(0.85), 85)
  })
  it('0 -> 0', () => {
    assert.equal(attemptScorePercent(0), 0)
  })
  it('null/undefined -> null', () => {
    assert.equal(attemptScorePercent(null), null)
    assert.equal(attemptScorePercent(undefined), null)
  })
})

describe('formatAttemptScorePercent', () => {
  it('scorePercent 100 thắng score 1', () => {
    assert.equal(formatAttemptScorePercent({ scorePercent: 100, score: 1 }), 100)
  })
  it('score đã là percent (85) -> 85', () => {
    assert.equal(formatAttemptScorePercent({ score: 85 }), 85)
  })
  it('score fraction 0.85 -> 85', () => {
    assert.equal(formatAttemptScorePercent({ score: 0.85 }), 85)
  })
  it('null/undefined -> null', () => {
    assert.equal(formatAttemptScorePercent(null), null)
    assert.equal(formatAttemptScorePercent(undefined), null)
  })
})

describe('scorePercentLabel', () => {
  it('1 -> "100%"', () => {
    assert.equal(scorePercentLabel({ score: 1 }), '100%')
  })
  it('null -> null (không bao giờ "null%")', () => {
    assert.equal(scorePercentLabel(null), null)
  })
})

describe('lessonQuizSummary', () => {
  it('0/0 -> null', () => {
    assert.equal(lessonQuizSummary({ totalLessonAssessments: 0, passedLessonAssessments: 0 }), null)
  })
  it('41/41 -> đạt hết', () => {
    const s = lessonQuizSummary({ totalLessonAssessments: 41, passedLessonAssessments: 41 })
    assert.equal(s?.allPassed, true)
    assert.equal(s?.label, '✓ Đạt hết (41/41)')
  })
  it('32/41 -> còn 9 chưa đạt', () => {
    const s = lessonQuizSummary({ totalLessonAssessments: 41, passedLessonAssessments: 32 })
    assert.equal(s?.allPassed, false)
    assert.equal(s?.remaining, 9)
    assert.equal(s?.label, '32/41 bài đạt (còn 9 chưa đạt)')
  })
})

describe('lessonQuizStatus', () => {
  it('chưa có attempt -> Chưa thi', () => {
    assert.deepEqual(lessonQuizStatus(null), { tone: 'none', label: 'Chưa thi' })
    assert.deepEqual(lessonQuizStatus({}), { tone: 'none', label: 'Chưa thi' })
  })
  it('đạt -> "100% (Đạt)"', () => {
    assert.deepEqual(lessonQuizStatus({ latestAttempt: { passed: true, score: 1 } }), { tone: 'passed', label: '100% (Đạt)' })
  })
  it('everPassed + lần mới nhất trượt 80% -> ever-passed', () => {
    assert.deepEqual(
      lessonQuizStatus({ everPassed: true, latestAttempt: { passed: false, score: 0.8 } }),
      { tone: 'ever-passed', label: '✓ Đã đạt (lần mới nhất: 80%)' },
    )
  })
  it('trượt và chưa từng đạt -> "80% (Chưa đạt)"', () => {
    assert.deepEqual(
      lessonQuizStatus({ latestAttempt: { passed: false, score: 0.8 } }),
      { tone: 'failed', label: '80% (Chưa đạt)' },
    )
  })
})

describe('isCourseCompleted', () => {
  it('isCompleted true -> true', () => {
    assert.equal(isCourseCompleted({ isCompleted: true }), true)
  })
  it('isCompleted false -> false', () => {
    assert.equal(isCourseCompleted({ isCompleted: false }), false)
  })
  it('{} / undefined -> false', () => {
    assert.equal(isCourseCompleted({}), false)
    assert.equal(isCourseCompleted(undefined), false)
  })
})

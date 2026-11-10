import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getNextLearningTarget } from '../lib/lesson-navigation'

const outline = (extra: Record<string, unknown> = {}) => ({
  sessions: [
    { lessons: [{ lessonId: 'a' }, { lessonId: 'b' }] },
    { lessons: [{ lessonId: 'c' }] },
  ],
  ...extra,
})

describe('getNextLearningTarget', () => {
  it('goes to the next lesson in the same session', () => {
    assert.deepEqual(getNextLearningTarget(outline(), 'c1', 'a'), {
      kind: 'lesson',
      href: '/student/learning/b',
      label: 'Bài tiếp theo',
    })
  })

  it('crosses into the next session', () => {
    assert.equal(getNextLearningTarget(outline(), 'c1', 'b')?.href, '/student/learning/c')
  })

  it('goes to the final exam after the last lesson when the course has one', () => {
    const target = getNextLearningTarget(outline({ finalAssessment: { id: 'f' } }), 'c1', 'c')
    assert.equal(target?.kind, 'final-quiz')
    assert.equal(target?.href, '/student/courses/c1/quiz')
  })

  it('goes to the course page after the last lesson when there is no final exam', () => {
    const target = getNextLearningTarget(outline(), 'c1', 'c')
    assert.equal(target?.kind, 'course')
    assert.equal(target?.href, '/student/courses/c1')
  })

  it('returns null when the lesson is unknown or data is missing', () => {
    assert.equal(getNextLearningTarget(outline(), 'c1', 'zzz'), null)
    assert.equal(getNextLearningTarget(null, 'c1', 'a'), null)
    assert.equal(getNextLearningTarget(outline(), '', 'a'), null)
  })

  it('accepts lessons that only carry an id field', () => {
    const course = { sessions: [{ lessons: [{ id: 'x' }, { id: 'y' }] }] }
    assert.equal(getNextLearningTarget(course, 'c1', 'x')?.href, '/student/learning/y')
  })
})

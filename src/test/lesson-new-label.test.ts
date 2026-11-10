import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildLessonStates, firstInteractionAt, isNewForLearner, LearningLesson } from '../lib/lesson-learning-state'
import { unlockedPrefix } from '../lib/learning-unlocks'

const t = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 3_600_000)
const lesson = (id: string, createdHour: number, quizId: string | null = `q-${id}`, quizHour = createdHour): LearningLesson => ({
  id, courseId: 'c1', created_at: t(createdHour), video: { duration_seconds: 100 },
  assessment: quizId ? { id: quizId, created_at: t(quizHour) } : null,
})
const row = (completedHour: number | null, unlockedHour: number | null, furthest = 100) => ({
  completed_at: completedHour === null ? null : t(completedHour), unlocked_at: unlockedHour === null ? null : t(unlockedHour), furthest_seconds: furthest,
})

describe('nhãn Mới', () => {
  it('mốc tương tác đầu tiên là sớm nhất của unlocked_at/completed_at', () => {
    assert.deepEqual(firstInteractionAt([row(20, 10), row(null, 5)]), t(5))
    assert.equal(firstInteractionAt([]), null)
  })
  it('chưa tương tác thì không có nhãn; tạo trước mốc thì không có nhãn', () => {
    assert.equal(isNewForLearner(t(50), null, false), false)
    assert.equal(isNewForLearner(t(1), t(5), false), false)
  })
  it('tạo sau mốc và chưa xong thì Mới; xong thì mất nhãn', () => {
    assert.equal(isNewForLearner(t(50), t(5), false), true)
    assert.equal(isNewForLearner(t(50), t(5), true), false)
  })
})

describe('buildLessonStates: chèn bài giữa khóa', () => {
  // Người học tương tác lần đầu giờ 10. Bài X chèn giữa b và c lúc giờ 100.
  const lessons = [lesson('a', 0), lesson('b', 0), lesson('x', 100), lesson('c', 0), lesson('d', 0)]
  const anchorByCourse = new Map([['c1', t(10)]])
  const passed = new Set(['q-a', 'q-b', 'q-c', 'q-d'])

  it('bài sau mốc đã mở/đã xong vẫn mở, bài mới có nhãn Mới và không chặn bài sau', () => {
    const states = buildLessonStates({
      cycleId: 'cy', lessons, anchorByCourse, passedAssessmentIds: new Set(['q-a', 'q-b']), legacyProgress: new Map(),
      cycleProgress: new Map([
        ['a', row(20, 10)], ['b', row(30, 10)], ['c', row(40, 10)], ['d', row(null, 10, 0)],
      ]),
    })
    assert.equal(states.x.isNew, true)
    assert.equal(states.x.quizIsNew, true)
    assert.equal(states.x.canView, true) // bài trước (a, b) đã xong
    assert.equal(states.c.canView, true) // đã xong từ trước, không bị khóa lại
    assert.equal(states.d.canView, true) // đã mở trước khi chèn, không bị chặn
    assert.equal(states.d.lockReason, null)
    assert.equal(states.a.isNew, false)
  })

  it('bài mới chưa xong không chặn bài chưa từng mở phía sau khi các bài trước mốc đã xong', () => {
    const states = buildLessonStates({
      cycleId: 'cy', lessons: [lesson('a', 0), lesson('x', 100), lesson('c', 0)], anchorByCourse, passedAssessmentIds: new Set(['q-a']),
      legacyProgress: new Map(), cycleProgress: new Map([['a', row(20, 10)]]), // c chưa có hàng tiến độ
    })
    assert.equal(states.x.canView, true)
    assert.equal(states.c.canView, true)
    assert.equal(states.c.lockReason, null)
  })

  it('bài cũ chưa xong vẫn chặn bài sau (hành vi tuần tự cũ giữ nguyên)', () => {
    const states = buildLessonStates({
      cycleId: 'cy', lessons: [lesson('a', 0), lesson('b', 0), lesson('c', 0)], anchorByCourse, passedAssessmentIds: new Set(),
      legacyProgress: new Map(), cycleProgress: new Map([['a', row(null, 10, 10)]]),
    })
    assert.equal(states.b.lockReason, 'PreviousLessonIncomplete')
    assert.equal(states.c.lockReason, 'PreviousLessonIncomplete')
  })

  it('học xong bài mới thì nhãn mất', () => {
    const states = buildLessonStates({
      cycleId: 'cy', lessons, anchorByCourse, passedAssessmentIds: new Set([...Array.from(passed), 'q-x']),
      legacyProgress: new Map(), cycleProgress: new Map([['a', row(20, 10)], ['b', row(30, 10)], ['x', row(200, 150)], ['c', row(40, 10)], ['d', row(50, 10)]]),
    })
    assert.equal(states.x.isNew, false)
    assert.equal(states.x.quizIsNew, false)
    assert.equal(states.x.assessmentPassed, true)
  })

  it('quiz thêm vào bài đã xong: bài giữ trạng thái xong, quiz Mới, assessmentPassed = false, không chặn bài sau', () => {
    const lessonsWithNewQuiz = [lesson('a', 0, 'q-a', 100), lesson('b', 0)]
    const states = buildLessonStates({
      cycleId: 'cy', lessons: lessonsWithNewQuiz, anchorByCourse, passedAssessmentIds: new Set(['q-b']),
      legacyProgress: new Map(), cycleProgress: new Map([['a', row(20, 10)], ['b', row(null, 10, 0)]]),
    })
    assert.equal(states.a.lessonCompleted, true)
    assert.equal(states.a.isNew, false)
    assert.equal(states.a.quizIsNew, true)
    assert.equal(states.a.assessmentPassed, false)
    assert.equal(states.b.canView, true)
  })

  it('không có chu kỳ: bài đã xong không bị khóa lại, không có nhãn', () => {
    const states = buildLessonStates({
      cycleId: null, lessons: [lesson('a', 0), lesson('b', 0)], anchorByCourse: new Map(), passedAssessmentIds: new Set(),
      cycleProgress: new Map(), legacyProgress: new Map([['b', { completed: true, furthest_watched_position_seconds: 100 }]]),
    })
    assert.equal(states.a.isNew, false)
    assert.equal(states.b.canView, true)
    assert.equal(states.b.lessonCompleted, true)
  })
})

describe('unlockedPrefix', () => {
  const cand = (id: string, o: Partial<Parameters<typeof unlockedPrefix>[0][number]> = {}) => ({
    id, createdAt: t(0), quizCreatedAt: t(0), hasQuiz: true, videoWatched: true, quizPassed: true, lessonCompleted: true, ...o,
  })
  it('dừng ở bài đầu tiên chưa xong', () => {
    assert.deepEqual(unlockedPrefix([cand('a'), cand('b', { videoWatched: false, lessonCompleted: false }), cand('c')], t(10)), ['a', 'b'])
    assert.deepEqual(unlockedPrefix([cand('a'), cand('b', { quizPassed: false, lessonCompleted: false }), cand('c')], t(10)), ['a', 'b'])
  })
  it('bài chèn mới chưa xong không chặn các bài sau', () => {
    const list = [cand('a'), cand('x', { createdAt: t(100), videoWatched: false, quizPassed: false, lessonCompleted: false }), cand('c')]
    assert.deepEqual(unlockedPrefix(list, t(10)), ['a', 'x', 'c'])
  })
  it('quiz mới thêm vào bài đã xong không chặn bài sau', () => {
    const list = [cand('a', { quizCreatedAt: t(100), quizPassed: false }), cand('b')]
    assert.deepEqual(unlockedPrefix(list, t(10)), ['a', 'b'])
  })
  it('chưa tương tác (không có mốc) thì không có nhãn, quy tắc tuần tự cũ giữ nguyên', () => {
    const list = [cand('a', { videoWatched: false, lessonCompleted: false, createdAt: t(100) }), cand('b')]
    assert.deepEqual(unlockedPrefix(list, null), ['a'])
  })
})

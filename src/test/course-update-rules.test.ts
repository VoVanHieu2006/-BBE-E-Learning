import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  FINAL_EXAM_ADDED_DAYS, RequirementState, additionalDays, buildRequirementFingerprint, diffRequirementState, lessonDayShares,
  sameRequirementFingerprint, updatedDueAt,
} from '../lib/course-update-rules'

const DAY = 86_400_000
const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * DAY)
const state = (lessons: Record<string, [boolean, boolean]>, finalVersionId: string | null = null): RequirementState => ({
  lessons: new Map(Object.entries(lessons).map(([id, [hasVideo, hasQuiz]]) => [id, { hasVideo, hasQuiz }])), finalVersionId,
})

describe('lessonDayShares (KHBB 5.6)', () => {
  it('khóa 20 ngày, 7 bài: mỗi bài 3 ngày, video 2 + quiz 1', () => {
    assert.deepEqual(lessonDayShares(20, 7), { perLesson: 3, videoPart: 2, quizPart: 1 })
  })
  it('có sàn 3 ngày cho mỗi bài', () => {
    assert.equal(lessonDayShares(5, 10).perLesson, 3)
  })
  it('làm tròn lên và video + quiz luôn bằng đúng một bài', () => {
    for (const [days, lessons] of [[30, 4], [20, 5], [9, 2], [100, 7], [3, 1]]) {
      const { perLesson, videoPart, quizPart } = lessonDayShares(days, lessons)
      assert.equal(perLesson, Math.max(Math.ceil(days / lessons), 3))
      assert.equal(videoPart + quizPart, perLesson)
      assert.ok(videoPart >= 1 && quizPart >= 1)
    }
  })
  it('bài 4 ngày chia 2 + 2, bài 5 ngày chia 3 + 2', () => {
    assert.deepEqual(lessonDayShares(20, 5), { perLesson: 4, videoPart: 2, quizPart: 2 })
    assert.deepEqual(lessonDayShares(25, 5), { perLesson: 5, videoPart: 3, quizPart: 2 })
  })
})

describe('diffRequirementState + additionalDays', () => {
  const before = state({ a: [true, true], b: [true, true], c: [true, true], d: [true, true], e: [true, true] })

  it('lần xuất bản đầu tiên không cộng ngày', () => {
    const diff = diffRequirementState(null, before)
    assert.equal(additionalDays(diff, 20, 5), 0)
  })
  it('thêm 2 bài đủ video+quiz vào khóa 20 ngày (L_sau = 7): +6 ngày', () => {
    const after = state({ a: [true, true], b: [true, true], c: [true, true], d: [true, true], e: [true, true], f: [true, true], g: [true, true] })
    const diff = diffRequirementState(before, after)
    assert.deepEqual(diff.newLessonsFull, ['f', 'g'])
    assert.equal(additionalDays(diff, 20, 7), 6)
  })
  it('bài mới chỉ có video cộng phần video; thêm quiz sau cộng phần quiz', () => {
    const withVideoOnly = state({ a: [true, true], b: [true, true], c: [true, true], d: [true, true], e: [true, true], f: [true, false], g: [true, true], h: [true, true] })
    const first = diffRequirementState(before, withVideoOnly)
    assert.deepEqual(first.newLessonsVideoOnly, ['f'])
    // 20 ngày, 8 bài => 3 ngày/bài => video 2; hai bài đủ (g, h) = 6
    assert.equal(additionalDays(first, 20, 8), 6 + 2)
    const later = state({ a: [true, true], b: [true, true], c: [true, true], d: [true, true], e: [true, true], f: [true, true], g: [true, true], h: [true, true] })
    const second = diffRequirementState(withVideoOnly, later)
    assert.deepEqual(second.quizAdded, ['f'])
    assert.equal(additionalDays(second, 20, 8), 1)
  })
  it('thêm riêng video vào bài đã có quiz và thêm riêng quiz vào bài đã có video', () => {
    const prev = state({ a: [false, true], b: [true, false] })
    const next = state({ a: [true, true], b: [true, true] })
    const diff = diffRequirementState(prev, next)
    assert.deepEqual(diff.videoAdded, ['a'])
    assert.deepEqual(diff.quizAdded, ['b'])
    assert.equal(additionalDays(diff, 20, 7), 2 + 1)
  })
  it('thêm bài thi cuối mới cộng cố định 3 ngày; đổi đề cộng 0', () => {
    const added = diffRequirementState(state({ a: [true, true] }, null), state({ a: [true, true] }, 'v1'))
    assert.equal(added.finalAdded, true)
    assert.equal(additionalDays(added, 20, 1), FINAL_EXAM_ADDED_DAYS)
    const replaced = diffRequirementState(state({ a: [true, true] }, 'v1'), state({ a: [true, true] }, 'v2'))
    assert.equal(replaced.finalReplaced, true)
    assert.equal(replaced.finalAdded, false)
    assert.equal(additionalDays(replaced, 20, 1), 0)
  })
  it('cộng dồn mọi thứ trong một lần cập nhật', () => {
    const prev = state({ a: [true, true], b: [true, false] }, null)
    const next = state({ a: [true, true], b: [true, true], c: [true, true] }, 'v1')
    // 20 ngày, 3 bài => 7 ngày/bài, video 4, quiz 3. c = 7, b quiz = 3, final = 3
    assert.equal(additionalDays(diffRequirementState(prev, next), 20, 3), 7 + 3 + 3)
  })
  it('bài bị xóa hoặc sắp xếp lại không cộng ngày', () => {
    const next = state({ a: [true, true] })
    assert.equal(additionalDays(diffRequirementState(before, next), 20, 1), 0)
  })
})

describe('updatedDueAt (tính từ lúc cập nhật)', () => {
  it('ví dụ Lan: xong khóa, hạn ngày 20, ngày 30 thêm 2 bài (+6) => ngày 36', () => {
    assert.deepEqual(updatedDueAt({ now: day(30), currentDueAt: day(20), completed: true, addedDays: 6 }), day(36))
  })
  it('người đang học dở: hạn ngày 30, ngày 20 thêm +6 => ngày 36 (cộng dồn)', () => {
    assert.deepEqual(updatedDueAt({ now: day(20), currentDueAt: day(30), completed: false, addedDays: 6 }), day(36))
  })
  it('người đã xong không bị rút ngắn nếu hạn chung (khóa khác) còn muộn hơn', () => {
    assert.deepEqual(updatedDueAt({ now: day(10), currentDueAt: day(40), completed: true, addedDays: 6 }), day(40))
  })
  it('không có hạn hiện tại thì tính từ lúc cập nhật', () => {
    assert.deepEqual(updatedDueAt({ now: day(5), currentDueAt: null, completed: true, addedDays: 3 }), day(8))
    assert.deepEqual(updatedDueAt({ now: day(5), currentDueAt: null, completed: false, addedDays: 3 }), day(8))
  })
  it('không cộng gì thì giữ nguyên hạn', () => {
    assert.deepEqual(updatedDueAt({ now: day(5), currentDueAt: day(9), completed: false, addedDays: 0 }), day(9))
  })
})

describe('dấu vân tay yêu cầu', () => {
  const full = { lessonIds: ['a', 'b'], assessmentIds: ['q1'], finalVersion: null, videoLessonIds: ['a', 'b'], quizLessonIds: ['a'] }
  it('cùng nội dung => cùng dấu vân tay (idempotent), thứ tự không quan trọng', () => {
    const again = { ...full, lessonIds: ['b', 'a'], videoLessonIds: ['b', 'a'] }
    assert.equal(buildRequirementFingerprint(full), buildRequirementFingerprint(again))
    assert.ok(sameRequirementFingerprint(buildRequirementFingerprint(full), buildRequirementFingerprint(again)))
  })
  it('thêm quiz, thêm video hoặc thêm đề thi cuối đều đổi dấu vân tay', () => {
    const base = buildRequirementFingerprint(full)
    assert.ok(!sameRequirementFingerprint(base, buildRequirementFingerprint({ ...full, quizLessonIds: ['a', 'b'], assessmentIds: ['q1', 'q2'] })))
    assert.ok(!sameRequirementFingerprint(base, buildRequirementFingerprint({ ...full, videoLessonIds: ['a'] })))
    assert.ok(!sameRequirementFingerprint(base, buildRequirementFingerprint({ ...full, finalVersion: 'v1' })))
  })
  it('dấu vân tay định dạng cũ (3 khóa) không bị coi là thay đổi khi nội dung giống nhau', () => {
    const legacy = JSON.stringify({ lessonIds: ['a', 'b'], assessmentIds: ['q1'], finalVersion: null })
    assert.ok(sameRequirementFingerprint(legacy, buildRequirementFingerprint(full)))
    assert.ok(!sameRequirementFingerprint(legacy, buildRequirementFingerprint({ ...full, lessonIds: ['a', 'b', 'c'] })))
  })
})

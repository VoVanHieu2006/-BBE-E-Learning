import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { allCourseLessonsDone } from '../lib/learning-display'
import { draftToEditorCourse, draftQuestionBankSize } from '../lib/course-draft-editor'
import type { CourseDraftContent } from '../lib/course-draft'

describe('learning display completion', () => {
  const sessions = [{ lessons: [{ id: 'a', assessment: { id: 'q' } }, { id: 'b', assessment: null }] }]
  it('completed video does not pass a newly added quiz', () => {
    assert.equal(allCourseLessonsDone(sessions, [{ lessons: [{ id: 'a', completed: true, quizIsNew: true, assessmentPassed: false }, { id: 'b', completed: true }] }]), false)
  })
  it('requires every video and quiz, accepts lessons without quizzes', () => {
    assert.equal(allCourseLessonsDone(sessions, [{ lessons: [{ id: 'a', videoCompleted: true, assessmentPassed: true }, { id: 'b', completed: true }] }]), true)
    assert.equal(allCourseLessonsDone(sessions, [{ lessons: [{ id: 'a', videoCompleted: false, assessmentPassed: true }, { id: 'b', completed: true }] }]), false)
    assert.equal(allCourseLessonsDone(sessions, []), false)
    assert.equal(allCourseLessonsDone([], []), false)
  })
})

describe('draft editor snapshot projection', () => {
  it('retains question/option/pool identity and stages unpublished metadata', () => {
    const content: CourseDraftContent = { title: 'Bản nháp', visibility: 'PRIVATE', finalAssessment: null, sessions: [{ id: 's', title: 'Buổi', lessons: [{ id: 'l', title: 'Bài', video: null, documents: [{ id: 'd', fileName: 'doc', fileSize: 1, mimeType: 'text/plain', storageKey: 'key' }], assessment: { id: 'a', title: 'Quiz', questionCount: 1, durationMinutes: 30, pools: [{ id: 'p', name: 'Nhóm' }], questions: [{ id: 'q', questionText: 'Câu', questionType: 'SINGLE_CHOICE', points: 1, poolId: 'p', options: [{ id: 'o', optionText: 'Đúng', isCorrect: true }] }] } }] }] }
    const base = { id: 'c', title: 'Đang xuất bản', status: 'PUBLISHED' }
    const editor = draftToEditorCourse(content, base)
    assert.equal(base.title, 'Đang xuất bản')
    assert.equal(editor.title, 'Bản nháp')
    assert.equal(editor.sessions[0].sessionId, 's')
    assert.equal(editor.sessions[0].lessons[0].lessonId, 'l')
    assert.equal(editor.sessions[0].lessons[0].assessment?.pools[0].poolId, 'p')
    assert.equal(editor.sessions[0].lessons[0].assessment?.questions[0].options[0].id, 'o')
    assert.equal(editor.sessions[0].lessons[0].documents[0].documentId, 'd')
    assert.equal(draftQuestionBankSize(content), 1)
  })
})

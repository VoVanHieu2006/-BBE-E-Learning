import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateDraftContent, reconcileDraftIds, assertQuestionEditAllowed, needsFinalExamVersion, assertDraftVersion, assertDraftIdentity } from '../lib/course-draft'

const id = '00000000-0000-4000-8000-000000000001'
const question = { id, questionText: 'Câu hỏi', questionType: 'SINGLE_CHOICE' as const, points: 1, durationSeconds: 120, explanation: null, poolId: id, options: [{ id: 'temp-a', optionText: 'Đúng', isCorrect: true }, { id: 'temp-b', optionText: 'Sai', isCorrect: false }] }
const assessment = { title: 'Quiz', description: null, questionCount: 1, durationMinutes: 30, pools: [{ id: 'temp-pool', name: 'Nhóm 1' }], questions: [{ ...question, poolId: 'temp-pool' }] }
const content = () => ({ title: 'Khóa học', description: null, visibility: 'PRIVATE', sessions: [{ id: 'temp-session', title: 'Buổi học', lessons: [{ id: 'temp-lesson', title: 'Bài học', video: { youtubeVideoId: 'abc', durationSeconds: 60 }, documents: [], assessment }] }], finalAssessment: null })

describe('course draft safety', () => {
  it('validates full snapshots and normalizes video duration', () => {
    const draft = content()
    ;(draft.sessions[0].lessons[0].video as any).durationSeconds = '61'
    assert.equal(validateDraftContent(draft).sessions[0].lessons[0].video?.durationSeconds, 61)
    draft.sessions[0].lessons[0].video.durationSeconds = 0
    assert.throws(() => validateDraftContent(draft), /thời lượng/i)
    assert.throws(() => validateDraftContent({ title: 'partial' }), /bản nháp/i)
  })
  it('validates quiz pools and bank capacity', () => {
    const draft = content()
    draft.sessions[0].lessons[0].assessment.questionCount = 2
    assert.throws(() => validateDraftContent(draft), /ngân hàng/i)
    draft.sessions[0].lessons[0].assessment.questionCount = 1
    draft.sessions[0].lessons[0].assessment.questions[0].poolId = 'other'
    assert.throws(() => validateDraftContent(draft), /nhóm/i)
  })
  it('reuses IDs once, identifies omissions, rejects foreign and duplicate IDs', () => {
    assert.deepEqual(reconcileDraftIds([{ id }], [{ id }, { id: 'temp-new' }]), [])
    assert.deepEqual(reconcileDraftIds([{ id }], []), [id])
    assert.throws(() => reconcileDraftIds([], [{ id }]), /thuộc/i)
    assert.throws(() => reconcileDraftIds([{ id }], [{ id }, { id }]), /trùng/i)
  })
  it('keeps attempted questions and options in place, blocks grading edits/deletion', () => {
    assert.doesNotThrow(() => assertQuestionEditAllowed(question, { ...question, sortOrder: 2 }, 1))
    assert.throws(() => assertQuestionEditAllowed(question, { ...question, questionText: 'Thay đổi' }, 1), /lượt làm/i)
    assert.throws(() => assertQuestionEditAllowed(question, null, 1), /lượt làm/i)
    assert.doesNotThrow(() => assertQuestionEditAllowed(question, null, 0))
    assert.throws(() => assertQuestionEditAllowed(question, { ...question, options: question.options.map(o => ({ ...o, isCorrect: !o.isCorrect })) }, 1), /lượt làm/i)
  })
  it('versions final exams only when configuration or source bank changes', () => {
    const config = { title: 'Thi cuối', description: null, questionCount: 1, durationMinutes: 30 }
    assert.equal(needsFinalExamVersion(config, config, [question], [question], true), false)
    assert.equal(needsFinalExamVersion(config, config, [question], [{ ...question, points: 2 }], true), true)
    assert.equal(needsFinalExamVersion(config, { ...config, questionCount: 2 }, [question], [question], true), true)
    assert.equal(needsFinalExamVersion(null, config, [], [question], false), true)
  })
  it('requires exact draft and base versions for save/publish/discard', () => {
    assert.doesNotThrow(() => assertDraftVersion(2, 2, 5, 5))
    assert.throws(() => assertDraftVersion(undefined, 2, 5, 5), /phiên/i)
    assert.throws(() => assertDraftVersion(1, 2, 5, 5), /phiên/i)
    assert.throws(() => assertDraftVersion(0, 0, 4, 5), /phiên/i)
    assert.doesNotThrow(() => assertDraftIdentity(null, null))
    assert.doesNotThrow(() => assertDraftIdentity('draft-1', 'draft-1'))
    assert.throws(() => assertDraftIdentity('draft-1', 'draft-2'), /thay thế/i)
    assert.throws(() => assertDraftIdentity('draft-1', null), /thay thế/i)
  })
  it('rejects malformed nested records without throwing unexpected runtime errors', () => {
    for (const mutate of [
      (d: any) => { d.sessions[0].lessons[0].assessment.questions[0].options = [null, null] },
      (d: any) => { d.sessions[0].lessons[0].documents = [null] },
      (d: any) => { d.sessions[0].lessons[0].assessment.pools = [null] },
      (d: any) => { d.sessions[0].description = {} },
    ]) {
      const draft = content(); mutate(draft)
      assert.throws(() => validateDraftContent(draft), (error: any) => error.code === 'ValidationError')
    }
  })
})

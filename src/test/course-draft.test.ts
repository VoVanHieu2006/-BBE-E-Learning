import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CourseDraftContent, validateDraftContent, reconcileDraftIds, assertQuestionEditAllowed, needsFinalExamVersion, assertDraftVersion, assertDraftIdentity, questionGradingFingerprint } from '../lib/course-draft'

const id = '00000000-0000-4000-8000-000000000001'
const question = { id, questionText: 'Câu hỏi', questionType: 'SINGLE_CHOICE' as const, points: 1, durationSeconds: 120, explanation: null, poolId: id, options: [{ id: 'temp-a', optionText: 'Đúng', isCorrect: true }, { id: 'temp-b', optionText: 'Sai', isCorrect: false }] }
const assessment = { title: 'Quiz', description: null, questionCount: 1, durationMinutes: 30, pools: [{ id: 'temp-pool', name: 'Nhóm 1' }], questions: [{ ...question, poolId: 'temp-pool' }] }
const content = () => ({ title: 'Khóa học', description: null, visibility: 'PRIVATE', sessions: [{ id: 'temp-session', title: 'Buổi học', lessons: [{ id: 'temp-lesson', title: 'Bài học', video: { youtubeVideoId: 'abc', durationSeconds: 60 }, documents: [], assessment }] }], finalAssessment: null })

describe('course draft safety', () => {
  it('retains unchanged legacy documents but checks size for new or edited documents', () => {
    for (const fileSize of [0, 101 * 1024 * 1024]) {
      const before = validateDraftContent(content())
      before.sessions[0].lessons[0].documents = [{ id: '00000000-0000-4000-8000-000000000099', fileName: 'legacy.pdf', fileSize, mimeType: 'application/pdf', storageKey: 'docs/legacy' }]
      const draft = structuredClone(before)
      draft.title = 'Tiêu đề đã sửa'
      assert.doesNotThrow(() => validateDraftContent(draft, before))
      for (const change of [{ fileName: 'renamed.pdf' }, { storageKey: 'docs/new' }, { mimeType: 'text/plain' }, { fileSize: fileSize + 1 }, { id: 'temp-new' }]) {
        const edited = structuredClone(draft)
        Object.assign(edited.sessions[0].lessons[0].documents[0], change)
        // A zero-byte legacy document edited to one byte becomes valid.
        if (fileSize === 0 && 'fileSize' in change) continue
        assert.throws(() => validateDraftContent(edited, before), (e: any) => e.code === 'ValidationError')
      }
      const moved = structuredClone(draft)
      moved.sessions[0].lessons.push({ ...moved.sessions[0].lessons[0], id: 'temp-other', assessment: null, documents: draft.sessions[0].lessons[0].documents })
      moved.sessions[0].lessons[0].documents = []
      assert.throws(() => validateDraftContent(moved, before), (e: any) => e.code === 'ValidationError')
    }
    for (const fileSize of [1, 100 * 1024 * 1024]) {
      const draft: CourseDraftContent = validateDraftContent(content())
      draft.sessions[0].lessons[0].documents = [{ fileName: 'new.pdf', fileSize, mimeType: 'application/pdf', storageKey: 'docs/new' }]
      assert.doesNotThrow(() => validateDraftContent(draft))
    }
  })
  it('validates full snapshots and normalizes video duration', () => {
    const draft = content()
    ;(draft.sessions[0].lessons[0].video as any).durationSeconds = '61'
    assert.equal(validateDraftContent(draft).sessions[0].lessons[0].video?.durationSeconds, 61)
    draft.sessions[0].lessons[0].video.durationSeconds = 0
    assert.throws(() => validateDraftContent(draft), /thời lượng/i)
    assert.throws(() => validateDraftContent({ title: 'partial' }), /bản nháp/i)
  })
  it('accepts HTTPS and bundled /images/ covers, rejects unsafe cover URLs', () => {
    for (const coverUrl of ['https://res.cloudinary.com/x/cover.png', '/images/course-covers/organization-culture.png', null]) {
      assert.equal(validateDraftContent({ ...content(), coverUrl }).coverUrl, coverUrl)
    }
    for (const coverUrl of ['javascript:alert(1)', '//evil.com/x.png', '/images/../secret', 'http://example.com/x.png', '']) {
      assert.throws(() => validateDraftContent({ ...content(), coverUrl }), (e: any) => e.code === 'ValidationError' && /ảnh bìa/i.test(e.message))
    }
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

describe('ngân hàng 200 câu và lịch chuyển cấu hình tháng sau trong bản nháp', () => {
  const bankQuestion = (n: number, poolId?: string) => ({
    id: `temp-q${n}`, questionText: `Câu ${n}`, questionType: 'SINGLE_CHOICE', points: 1, explanation: null, ...(poolId ? { poolId } : {}),
    options: [{ id: `temp-q${n}-a`, optionText: 'Đúng', isCorrect: true }, { id: `temp-q${n}-b`, optionText: 'Sai', isCorrect: false }],
  })
  const draftWith = (assessment: any, finalAssessment: any = null): any => ({
    title: 'Khóa học', description: null, visibility: 'PRIVATE', finalAssessment,
    sessions: [{ id: 'temp-session', title: 'Buổi học', lessons: [{ id: 'temp-lesson', title: 'Bài học', video: null, documents: [], assessment }] }],
  })
  const pooledDraft = (poolSizes: number[], config: any = {}, finalAssessment: any = null) => {
    let n = 0
    const pools = poolSizes.map((_, i) => ({ id: `temp-pool${i}`, name: `Nhóm ${i + 1}` }))
    const questions = poolSizes.flatMap((size, i) => Array.from({ length: size }, () => bankQuestion(++n, pools[i].id)))
    return draftWith({ title: 'Quiz', description: null, questionCount: poolSizes.length, durationMinutes: 30, pools, questions, ...config }, finalAssessment)
  }
  const legacyDraft = (total: number, config: any = {}) =>
    draftWith({ title: 'Quiz', description: null, questionCount: 1, durationMinutes: 30, pools: [], questions: Array.from({ length: total }, (_, i) => bankQuestion(i + 1)), ...config })
  const final = (config: any = {}) => ({ title: 'Thi cuối khóa', description: null, questionCount: 5, durationMinutes: 30, ...config })
  const lessonQuiz = (draft: any) => validateDraftContent(draft).sessions[0].lessons[0].assessment
  const rejects = (draft: any, code: string, message: RegExp) => assert.throws(() => validateDraftContent(draft), (e: any) => e.code === code && message.test(e.message))

  it('ngân hàng nhận tới 200 câu (trước đây 100), 201 câu bị từ chối', () => {
    assert.equal(lessonQuiz(pooledDraft([101])).questions.length, 101)
    assert.equal(lessonQuiz(pooledDraft([200])).questions.length, 200)
    assert.equal(lessonQuiz(legacyDraft(200)).questions.length, 200)
    rejects(pooledDraft([201]), 'ValidationError', /ngân hàng/i)
    rejects(legacyDraft(201), 'ValidationError', /ngân hàng/i)
  })
  it('vẫn tối đa 20 nhóm câu hỏi', () => {
    assert.equal(lessonQuiz(pooledDraft(Array(20).fill(1))).pools.length, 20)
    rejects(pooledDraft(Array(21).fill(1)), 'ValidationError', /ngân hàng/i)
  })
  it('bản nháp cũ không có trường lịch tháng sau vẫn hợp lệ và không bị thêm trường', () => {
    const result = validateDraftContent(pooledDraft([2, 2], {}, final()))
    assert.deepEqual(Object.keys(result.finalAssessment).sort(), ['description', 'durationMinutes', 'questionCount', 'title'])
    assert.equal('scheduledQuestionCount' in result.sessions[0].lessons[0].assessment, false)
  })
  it('giữ nguyên lịch tháng sau hợp lệ của quiz bài học và bài thi cuối khóa', () => {
    const schedule = { scheduledQuestionCount: 4, scheduledDurationMinutes: 45, scheduledEffectiveAt: '2026-11-30T17:00:00.000Z', scheduledEffectiveMonthKey: '2026-12', cancelSchedule: false }
    const result = validateDraftContent(pooledDraft([2, 2], schedule, final({ ...schedule, scheduledQuestionCount: 10000, scheduledDurationMinutes: 240 })))
    const quiz = result.sessions[0].lessons[0].assessment
    assert.deepEqual([quiz.scheduledQuestionCount, quiz.scheduledDurationMinutes, quiz.scheduledEffectiveAt, quiz.scheduledEffectiveMonthKey, quiz.cancelSchedule], [4, 45, '2026-11-30T17:00:00.000Z', '2026-12', false])
    assert.deepEqual([result.finalAssessment.scheduledQuestionCount, result.finalAssessment.scheduledDurationMinutes], [10000, 240])
    const empty = { scheduledQuestionCount: null, scheduledDurationMinutes: null, scheduledEffectiveAt: null, scheduledEffectiveMonthKey: null }
    assert.doesNotThrow(() => validateDraftContent(pooledDraft([2, 2], empty, final(empty))))
  })
  it('lịch tháng sau sai định dạng bị từ chối: số câu 1–10000, thời gian 1–240 phút', () => {
    for (const bad of [
      { scheduledQuestionCount: 0 }, { scheduledQuestionCount: 1.5 }, { scheduledQuestionCount: 10001 }, { scheduledQuestionCount: '4' },
      { scheduledDurationMinutes: 0 }, { scheduledDurationMinutes: 241 }, { scheduledDurationMinutes: 30.5 },
      { scheduledEffectiveMonthKey: '2026-13' }, { scheduledEffectiveMonthKey: '12-2026' }, { scheduledEffectiveAt: 'không phải ngày' }, { cancelSchedule: 'yes' },
    ]) {
      rejects(pooledDraft([2, 2], bad), 'ValidationError', /tháng sau/i)
      rejects(pooledDraft([2, 2], {}, final(bad)), 'ValidationError', /tháng sau/i)
    }
  })
  it('ngân hàng phải đủ cho cả số câu đang áp dụng và số câu hẹn tháng sau', () => {
    assert.doesNotThrow(() => validateDraftContent(pooledDraft([3, 5, 6], { questionCount: 5, scheduledQuestionCount: 9 })))
    rejects(pooledDraft([3, 5, 6], { questionCount: 5, scheduledQuestionCount: 10 }), 'ScheduledQuestionCountExceedsBank', /không quá 9 câu/)
    rejects(pooledDraft([3, 5, 6], { questionCount: 5, scheduledQuestionCount: 2 }), 'ScheduledQuestionCountBelowPools', /ít nhất 3 câu/)
    assert.doesNotThrow(() => validateDraftContent(legacyDraft(5, { questionCount: 3, scheduledQuestionCount: 5 })))
    rejects(legacyDraft(5, { questionCount: 3, scheduledQuestionCount: 6 }), 'ScheduledQuestionCountExceedsBank', /không quá 5 câu/)
  })
  it('xóa bớt câu làm ngân hàng thiếu cho lịch tháng sau thì bị chặn; hủy lịch thì lưu được', () => {
    const schedule = { questionCount: 3, scheduledQuestionCount: 12 }
    assert.doesNotThrow(() => validateDraftContent(pooledDraft([4, 4, 4], schedule)))
    rejects(pooledDraft([4, 4, 3], schedule), 'ScheduledQuestionCountExceedsBank', /tháng sau/)
    assert.doesNotThrow(() => validateDraftContent(pooledDraft([4, 4, 3], { ...schedule, cancelSchedule: true })))
  })
  it('số câu hẹn của bài thi cuối khóa không bị so với ngân hàng của một bài học', () => {
    assert.doesNotThrow(() => validateDraftContent(pooledDraft([1], {}, final({ scheduledQuestionCount: 500 }))))
  })
  it('dấu vân tay chấm điểm chỉ đổi khi đổi nội dung, loại, điểm, giải thích hoặc đáp án', () => {
    const base = questionGradingFingerprint(question)
    assert.equal(questionGradingFingerprint({ ...question, sortOrder: 5, poolId: null, options: [...question.options].reverse() }), base)
    assert.equal(questionGradingFingerprint({ ...question, explanation: '' }), base)
    for (const changed of [
      { ...question, questionText: 'Câu hỏi đã sửa' }, { ...question, questionType: 'MULTIPLE_CHOICE' as const }, { ...question, points: 2 }, { ...question, explanation: 'Vì sao' },
      { ...question, options: question.options.map(o => ({ ...o, isCorrect: !o.isCorrect })) },
      { ...question, options: question.options.map((o, i) => i ? o : { ...o, optionText: 'Đáp án đã sửa' }) },
    ]) assert.notEqual(questionGradingFingerprint(changed), base)
  })
})

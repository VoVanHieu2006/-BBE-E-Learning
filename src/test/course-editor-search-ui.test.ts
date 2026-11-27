import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyQuizImport, buildConfigPayload, checkScheduledBudget, courseSearchTarget, defaultImportMode, describeScheduledUpdates, effectiveDateLabel,
  filterQuizBank, findLessonForTarget, formatMonthKey, hasPendingSchedule, needsReplaceConfirm, pendingScheduleOf, questionKeyOf, removeQuestionAt,
  scheduleFormFrom, toScheduleMeta, toSearchableSessions, updateQuestionAt,
} from '../lib/course-editor-search-ui'
import { MAX_LESSON_QUIZ_POOLS, MAX_LESSON_QUIZ_QUESTIONS } from '../lib/quiz-schedule-rules'
import { searchCourseQuestions } from '../lib/quiz-search'

const q = (id: string, questionText: string, poolIndex: number, extra: Record<string, unknown> = {}) =>
  ({ id, questionText, poolIndex, explanation: '', options: [{ optionText: 'Đáp án A' }, { optionText: 'Đáp án B' }], ...extra })

describe('lọc câu hỏi trong modal luôn giữ chỉ số gốc', () => {
  const bank = [q('q0', 'Giao tiếp là gì', 0), q('q1', 'Lắng nghe chủ động', 1), q('q2', 'Kỹ năng giao tiếp nâng cao', 1), q('q3', 'Đàm phán', 0)]

  it('mỗi kết quả lọc mang chỉ số trong danh sách đầy đủ', () => {
    const view = filterQuizBank(bank, 2, 'giao tiep', null)
    assert.deepEqual(view.entries.map(e => [e.index, e.question.id]), [[0, 'q0'], [2, 'q2']])
    assert.deepEqual([view.matchCount, view.total, view.active], [2, 4, true])
  })
  it('sửa theo chỉ số gốc của kết quả lọc đúng câu, không phải vị trí trong mảng lọc', () => {
    const target = filterQuizBank(bank, 2, 'nang cao', null).entries[0]
    assert.equal(target.index, 2)
    const edited = updateQuestionAt(bank, target.index, row => ({ ...row, questionText: 'Đã sửa' }))
    assert.deepEqual(edited.map(row => row.questionText), ['Giao tiếp là gì', 'Lắng nghe chủ động', 'Đã sửa', 'Đàm phán'])
    assert.equal(bank[2].questionText, 'Kỹ năng giao tiếp nâng cao')
  })
  it('xóa theo chỉ số gốc không xóa nhầm câu đứng ở vị trí lọc', () => {
    const target = filterQuizBank(bank, 2, 'dam phan', null).entries[0]
    assert.equal(target.index, 3)
    assert.deepEqual(removeQuestionAt(bank, target.index).map(row => row.id), ['q0', 'q1', 'q2'])
  })
  it('chỉ số ngoài phạm vi không làm thay đổi danh sách', () => {
    assert.equal(removeQuestionAt(bank, 9), bank)
    assert.equal(updateQuestionAt(bank, -1, row => row), bank)
  })
  it('lọc theo nhóm ẩn nhóm không có câu khớp và vẫn giữ chỉ số gốc', () => {
    const view = filterQuizBank(bank, 3, '', 1)
    assert.deepEqual(view.visiblePools, [1])
    assert.deepEqual(view.byPool.get(1)!.map(e => e.index), [1, 2])
  })
  it('không lọc thì hiện mọi nhóm, kể cả nhóm trống', () => {
    const view = filterQuizBank(bank, 3, '  ', null)
    assert.equal(view.active, false)
    assert.deepEqual(view.visiblePools, [0, 1, 2])
    assert.equal(view.matchCount, 4)
  })
  it('từ khóa không khớp cho kết quả rỗng', () => {
    const view = filterQuizBank(bank, 2, 'khong co', null)
    assert.deepEqual([view.matchCount, view.visiblePools], [0, []])
  })
  it('khóa câu hỏi dùng id, câu mới dùng chỉ số', () => {
    assert.equal(questionKeyOf({ id: 'abc' }, 3), 'abc')
    assert.equal(questionKeyOf({}, 3), 'idx-3')
  })
})

describe('nhập Google Sheet/Doc: thêm vào hoặc thay thế', () => {
  let n = 0
  const newId = () => `temp-${++n}`
  type Row = { id?: string; poolIndex?: number; text: string }
  const run = (input: Parameters<typeof applyQuizImport<Row>>[0]) => applyQuizImport<Row>(input)
  const existing: Row[] = [{ id: 'old1', poolIndex: 0, text: 'cũ 1' }, { id: 'old2', poolIndex: 1, text: 'cũ 2' }]
  const imported: Row[] = [{ poolIndex: 0, text: 'mới 1' }, { poolIndex: 1, text: 'mới 2' }, { poolIndex: 2, text: 'mới 3' }]
  const base = { poolNames: ['Nhóm 1', 'Nhóm 2'], poolIds: ['p1', 'p2'], questions: existing, newId }

  it('chế độ mặc định theo số câu hiện có', () => {
    assert.equal(defaultImportMode(0), 'replace')
    assert.equal(defaultImportMode(5), 'append')
  })
  it('chỉ hỏi xác nhận thay thế khi có nội dung thật', () => {
    assert.equal(needsReplaceConfirm(0, false), false)
    assert.equal(needsReplaceConfirm(1, false), false)
    assert.equal(needsReplaceConfirm(1, true), true)
    assert.equal(needsReplaceConfirm(3, false), true)
  })
  it('thêm vào: giữ nguyên id câu cũ, gộp nhóm theo tên không phân biệt hoa thường, thêm nhóm mới', () => {
    const result = run({ ...base, mode: 'append', importedPools: [' nhóm 2 ', 'Nhóm mới', 'Nhóm 3'], importedQuestions: imported })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.poolNames, ['Nhóm 1', 'Nhóm 2', 'Nhóm mới', 'Nhóm 3'])
    assert.deepEqual(result.poolIds.slice(0, 2), ['p1', 'p2'])
    assert.equal(new Set(result.poolIds).size, 4)
    assert.deepEqual(result.questions.slice(0, 2), existing)
    assert.deepEqual(result.questions.slice(2).map(row => row.poolIndex), [1, 2, 3])
  })
  it('thay thế: bỏ câu và nhóm cũ, nhóm mới có id tạm', () => {
    const result = run({ ...base, mode: 'replace', importedPools: ['A', 'B', 'C'], importedQuestions: imported })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.poolNames, ['A', 'B', 'C'])
    assert.ok(result.poolIds.every(id => id.startsWith('temp-')))
    assert.deepEqual(result.questions.map(row => row.text), ['mới 1', 'mới 2', 'mới 3'])
  })
  it('thêm vào vượt 200 câu bị chặn bằng thông báo tiếng Việt', () => {
    const many = Array.from({ length: MAX_LESSON_QUIZ_QUESTIONS - 1 }, (_, i) => ({ id: `e${i}`, poolIndex: 0, text: 'x' }))
    const result = run({ ...base, questions: many, mode: 'append', importedPools: ['Nhóm 1'], importedQuestions: [{ poolIndex: 0, text: 'a' }, { poolIndex: 0, text: 'b' }] })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.message, /200 câu/)
  })
  it('thay thế đúng 200 câu được chấp nhận', () => {
    const full = Array.from({ length: MAX_LESSON_QUIZ_QUESTIONS }, () => ({ poolIndex: 0, text: 'x' }))
    assert.equal(run({ ...base, mode: 'replace', importedPools: ['Nhóm 1'], importedQuestions: full }).ok, true)
  })
  it('thêm vào vượt 20 nhóm bị chặn', () => {
    const names = Array.from({ length: MAX_LESSON_QUIZ_POOLS }, (_, i) => `N${i}`)
    const result = run({ ...base, poolNames: names, poolIds: names.map(n => `id-${n}`), mode: 'append', importedPools: ['Nhóm lạ'], importedQuestions: [{ poolIndex: 0, text: 'a' }] })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.message, /20 nhóm/)
  })
  it('thêm vào ngân hàng chưa có nhóm tạo nhóm mặc định cho câu cũ', () => {
    const result = run({ mode: 'append', poolNames: [], poolIds: [], questions: [{ id: 'old', poolIndex: 0, text: 'cũ' }], importedPools: ['Chủ đề'], importedQuestions: [{ poolIndex: 0, text: 'mới' }], newId })
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.poolNames, ['Nhóm 1', 'Chủ đề'])
  })
})

describe('kiểm tra ngân sách kép và gợi ý sửa nhanh lịch tháng sau', () => {
  const lesson = (scheduledCount: number | null, poolCounts: number[]) => checkScheduledBudget({
    mode: 'LESSON', activeCount: 4, scheduledCount, poolCounts, totalQuestions: poolCounts.reduce((a, b) => a + b, 0), availableQuestions: 0,
  })

  it('không có lịch hoặc lịch nằm trong sức chứa thì không có cảnh báo', () => {
    assert.equal(lesson(null, [5, 5]), null)
    assert.equal(lesson(10, [5, 5]), null)
  })
  it('lịch vượt sức chứa cân bằng: gợi ý giảm về mức tối đa, nêu đúng mức tối đa', () => {
    const issue = lesson(30, [5, 5, 8])!
    assert.equal(issue.maxAllowed, 15)
    assert.equal(issue.reduceTo, 15)
    assert.equal(issue.raiseTo, null)
    assert.match(issue.message, /15 câu/)
  })
  it('lịch ít hơn số nhóm: gợi ý tăng lên bằng số nhóm, không gợi ý giảm', () => {
    const issue = checkScheduledBudget({ mode: 'LESSON', activeCount: 5, scheduledCount: 2, poolCounts: [5, 5, 5], totalQuestions: 15, availableQuestions: 0 })!
    assert.equal(issue.reduceTo, null)
    assert.equal(issue.raiseTo, 3)
  })
  it('ngân hàng thu nhỏ dưới số câu đang áp dụng: báo lỗi nhưng không có nút giảm lịch', () => {
    const issue = checkScheduledBudget({ mode: 'LESSON', activeCount: 10, scheduledCount: 3, poolCounts: [2, 2], totalQuestions: 4, availableQuestions: 0 })!
    assert.equal(issue.reduceTo, null)
    assert.equal(issue.raiseTo, null)
  })
  it('bài thi cuối khóa: lịch vượt số câu khả dụng thì gợi ý giảm về số câu khả dụng', () => {
    const issue = checkScheduledBudget({ mode: 'COURSE_FINAL', activeCount: 10, scheduledCount: 40, poolCounts: [], totalQuestions: 0, availableQuestions: 25 })!
    assert.deepEqual([issue.maxAllowed, issue.reduceTo], [25, 25])
    assert.equal(checkScheduledBudget({ mode: 'COURSE_FINAL', activeCount: 10, scheduledCount: 25, poolCounts: [], totalQuestions: 0, availableQuestions: 25 }), null)
  })
  it('bài thi cuối khóa không còn câu nào: báo lỗi nhưng không thể gợi ý giảm', () => {
    const issue = checkScheduledBudget({ mode: 'COURSE_FINAL', activeCount: 10, scheduledCount: 5, poolCounts: [], totalQuestions: 0, availableQuestions: 0 })!
    assert.deepEqual([issue.maxAllowed, issue.reduceTo], [0, null])
  })
})

describe('lịch áp dụng tháng sau: dữ liệu gửi đi', () => {
  const now = new Date('2026-11-15T03:00:00.000Z')
  const locked = toScheduleMeta({ hasCurrentMonthAttempts: true, currentQuestionCount: 10, currentDurationMinutes: 30, scheduledConfig: null })!
  const free = toScheduleMeta({ hasCurrentMonthAttempts: false, currentQuestionCount: 10, currentDurationMinutes: 30, scheduledConfig: null })!

  it('chưa có lượt làm trong tháng: áp dụng ngay, xóa lịch cũ', () => {
    const payload = buildConfigPayload({ meta: free, form: { questionCount: 20, durationMinutes: null }, questionCount: 12, durationMinutes: 45, now })
    assert.deepEqual([payload.questionCount, payload.durationMinutes, payload.scheduledQuestionCount, payload.cancelSchedule], [12, 45, null, false])
  })
  it('có lượt làm: giữ cấu hình tháng này và hẹn riêng số câu', () => {
    const payload = buildConfigPayload({ meta: locked, form: { questionCount: 20, durationMinutes: null }, questionCount: 99, durationMinutes: 99, now })
    assert.deepEqual([payload.questionCount, payload.durationMinutes, payload.scheduledQuestionCount, payload.scheduledDurationMinutes, payload.cancelSchedule], [10, 30, 20, 30, false])
    assert.equal(payload.scheduledEffectiveMonthKey, '2026-12')
    assert.equal(payload.scheduledEffectiveAt, '2026-11-30T17:00:00.000Z')
  })
  it('có lượt làm: chỉ hẹn thời gian', () => {
    const payload = buildConfigPayload({ meta: locked, form: { questionCount: null, durationMinutes: 45 }, questionCount: 10, durationMinutes: 30, now })
    assert.deepEqual([payload.scheduledQuestionCount, payload.scheduledDurationMinutes], [10, 45])
  })
  it('sửa lại lịch đã hẹn nhiều lần (20 sang 30) giữ nguyên thời điểm áp dụng đã lưu', () => {
    const meta = { ...locked, scheduledConfig: { questionCount: 20, durationMinutes: 30, effectiveAt: '2026-11-30T17:00:00.000Z', effectiveMonthKey: '2026-12' } }
    const payload = buildConfigPayload({ meta, form: { questionCount: 30, durationMinutes: null }, questionCount: 10, durationMinutes: 30, now })
    assert.equal(payload.scheduledQuestionCount, 30)
    assert.equal(payload.scheduledEffectiveAt, '2026-11-30T17:00:00.000Z')
  })
  it('hủy lịch hoặc đặt về đúng giá trị hiện tại gửi cancelSchedule', () => {
    for (const form of [{ questionCount: null, durationMinutes: null }, { questionCount: 10, durationMinutes: 30 }]) {
      const payload = buildConfigPayload({ meta: locked, form, questionCount: 10, durationMinutes: 30, now })
      assert.deepEqual([payload.cancelSchedule, payload.scheduledQuestionCount, payload.questionCount, payload.durationMinutes], [true, null, 10, 30])
    }
  })
  it('nhận biết lịch đang chờ', () => {
    assert.equal(hasPendingSchedule(locked, { questionCount: 20, durationMinutes: null }), true)
    assert.equal(hasPendingSchedule(locked, { questionCount: 10, durationMinutes: null }), false)
    assert.equal(hasPendingSchedule(free, { questionCount: 20, durationMinutes: null }), false)
    assert.equal(hasPendingSchedule(null, { questionCount: 20, durationMinutes: null }), false)
  })
  it('khôi phục form lịch từ bản nháp hoặc API; bản nháp đã hủy thì rỗng', () => {
    assert.deepEqual(scheduleFormFrom({ scheduledQuestionCount: 20, scheduledDurationMinutes: 30 }, locked), { questionCount: 20, durationMinutes: null })
    assert.deepEqual(scheduleFormFrom({ scheduledConfig: { questionCount: 15, durationMinutes: 40 } }, locked), { questionCount: 15, durationMinutes: 40 })
    assert.deepEqual(scheduleFormFrom({ scheduledQuestionCount: 20, cancelSchedule: true }, locked), { questionCount: null, durationMinutes: null })
    assert.deepEqual(scheduleFormFrom({ scheduledQuestionCount: 20 }, free), { questionCount: null, durationMinutes: null })
  })
  it('nhãn tháng và thời điểm áp dụng theo giờ Việt Nam', () => {
    assert.equal(formatMonthKey('2026-12'), '12/2026')
    assert.equal(formatMonthKey('bad'), '')
    assert.equal(effectiveDateLabel('2026-12'), '00:00 ngày 01/12/2026 (giờ VN)')
    assert.equal(effectiveDateLabel(null, now), '00:00 ngày 01/12/2026 (giờ VN)')
  })
  it('huy hiệu lịch tháng sau đọc được cả từ bản nháp và từ API', () => {
    assert.deepEqual(pendingScheduleOf({ questionCount: 10, durationMinutes: 30, scheduledQuestionCount: 20, scheduledEffectiveMonthKey: '2026-12' }), { questionCount: 20, durationMinutes: 30, monthKey: '2026-12' })
    assert.deepEqual(pendingScheduleOf({ scheduledConfig: { questionCount: 20, durationMinutes: 45, effectiveMonthKey: '2026-12' } }), { questionCount: 20, durationMinutes: 45, monthKey: '2026-12' })
    assert.equal(pendingScheduleOf({ questionCount: 10, durationMinutes: 30 }), null)
    assert.equal(pendingScheduleOf({ scheduledQuestionCount: 20, cancelSchedule: true }), null)
    assert.equal(pendingScheduleOf(null), null)
  })
  it('thông báo sau khi cập nhật khóa học nêu rõ quiz nào được hẹn sang tháng sau', () => {
    const message = describeScheduledUpdates([
      { type: 'LESSON', lessonId: 'l1', currentQuestionCount: 10, currentDurationMinutes: 30, questionCount: 20, durationMinutes: 30, effectiveMonthKey: '2026-12' },
      { type: 'COURSE_FINAL', lessonId: null, currentQuestionCount: 15, currentDurationMinutes: 60, questionCount: 15, durationMinutes: 90, effectiveMonthKey: '2026-12' },
    ], id => id === 'l1' ? 'Bài 1' : null)!
    assert.match(message, /Quiz "Bài 1"/)
    assert.match(message, /10 câu \/ 30 phút giữ nguyên tháng này/)
    assert.match(message, /01\/12\/2026/)
    assert.match(message, /Bài thi cuối khóa/)
    assert.equal(describeScheduledUpdates([], () => null), null)
    assert.equal(describeScheduledUpdates(undefined, () => null), null)
  })
})

describe('tìm câu hỏi toàn khóa học: kết quả mở đúng bài học và đúng câu', () => {
  const sessions = [
    { sessionId: 's1', title: 'Buổi 1', lessons: [{ lessonId: 'l1', title: 'Bài 1', assessment: null }] },
    { sessionId: 's2', title: 'Buổi 2', lessons: [{ lessonId: 'l2', title: 'Bài 2', assessment: {
      pools: [{ poolId: 'p1', name: 'Nhóm A' }, { poolId: 'p2', name: 'Nhóm B' }],
      questions: [
        { id: 'q1', questionText: 'Câu một', poolId: 'p1', options: [{ optionText: 'a' }, { optionText: 'b' }] },
        { id: 'q2', questionText: 'Lắng nghe', poolId: 'p2', explanation: 'Nghe chủ động', options: [{ optionText: 'a' }, { optionText: 'b' }] },
      ],
    } }] },
  ]

  it('chuẩn hóa được cả dữ liệu bản nháp lẫn API và tìm thấy câu', () => {
    const results = searchCourseQuestions(toSearchableSessions(sessions), 'lang nghe')
    assert.equal(results.length, 1)
    assert.deepEqual([results[0].sessionTitle, results[0].lessonTitle, results[0].poolName, results[0].questionIndex], ['Buổi 2', 'Bài 2', 'Nhóm B', 1])
  })
  it('ánh xạ kết quả sang bài học và khóa câu hỏi cần mở', () => {
    const result = searchCourseQuestions(toSearchableSessions(sessions), 'lang nghe')[0]
    const target = courseSearchTarget(result)!
    assert.deepEqual([target.sessionId, target.lessonId, target.questionId, target.questionKey], ['s2', 'l2', 'q2', 'q2'])
    const found = findLessonForTarget(sessions, target)!
    assert.equal(found.sessionId, 's2')
    assert.equal(found.lesson.title, 'Bài 2')
  })
  it('câu chưa có id dùng chỉ số làm khóa; bài học không còn thì không có đích', () => {
    const target = courseSearchTarget({ sessionId: 's9', sessionTitle: '', lessonId: 'gone', lessonTitle: '', poolName: null, poolIndex: null, questionId: null, questionIndex: 4, questionText: '', matchedIn: [], matchedSnippet: null })!
    assert.equal(target.questionKey, 'idx-4')
    assert.equal(findLessonForTarget(sessions, target), null)
    assert.equal(courseSearchTarget({ sessionId: null, sessionTitle: '', lessonId: null, lessonTitle: '', poolName: null, poolIndex: null, questionId: 'x', questionIndex: 0, questionText: '', matchedIn: [], matchedSnippet: null }), null)
  })
})

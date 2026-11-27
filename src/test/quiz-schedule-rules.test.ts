import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  LOCKING_ATTEMPT_STATUSES, MAX_LESSON_QUIZ_POOLS, MAX_LESSON_QUIZ_QUESTIONS,
  mergeImportedQuizBank, nextCompetitionMonthSchedule, resolveAssessmentConfigUpdate, validateLessonBankForCounts,
} from '../lib/quiz-schedule-rules'

const failure = (result: any) => { assert.equal(result.ok, false); return result }

describe('giới hạn ngân hàng câu hỏi và lượt làm tính khóa tháng', () => {
  it('ngân hàng tối đa 200 câu, 20 nhóm', () => {
    assert.equal(MAX_LESSON_QUIZ_QUESTIONS, 200)
    assert.equal(MAX_LESSON_QUIZ_POOLS, 20)
  })
  it('lượt CANCELLED không khóa cấu hình tháng', () => {
    assert.deepEqual([...LOCKING_ATTEMPT_STATUSES], ['IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED'])
  })
})

describe('lịch tháng sau có hiệu lực 00:00:00 mùng 1 tháng kế tiếp giờ Việt Nam', () => {
  const schedule = (iso: string) => {
    const { effectiveAt, effectiveMonthKey } = nextCompetitionMonthSchedule(new Date(iso))
    return [effectiveAt.toISOString(), effectiveMonthKey]
  }
  it('giữa tháng 11 hẹn sang 00:00 ngày 1/12 (UTC+7)', () => {
    assert.deepEqual(schedule('2026-11-27T10:00:00+07:00'), ['2026-11-30T17:00:00.000Z', '2026-12'])
  })
  it('mili giây cuối tháng vẫn thuộc tháng hiện tại', () => {
    assert.deepEqual(schedule('2026-11-30T16:59:59.999Z'), ['2026-11-30T17:00:00.000Z', '2026-12'])
  })
  it('đúng 00:00 mùng 1 đã là tháng mới, và tháng 12 hẹn sang tháng 1 năm sau', () => {
    assert.deepEqual(schedule('2026-11-30T17:00:00.000Z'), ['2026-12-31T17:00:00.000Z', '2027-01'])
  })
  it('tính theo ngày Việt Nam chứ không theo ngày UTC', () => {
    assert.deepEqual(schedule('2026-12-31T17:30:00.000Z'), ['2027-01-31T17:00:00.000Z', '2027-02'])
  })
})

describe('ngân hàng phải đủ cho cả số câu đang áp dụng lẫn số câu hẹn tháng sau', () => {
  const pooled = (questionCount: number, scheduledQuestionCount?: number | null) =>
    validateLessonBankForCounts({ questionCount, scheduledQuestionCount, poolCounts: [3, 5, 6], totalQuestions: 14 })

  it('quiz không chia nhóm: số câu mỗi lượt từ 1 đến tổng ngân hàng', () => {
    assert.deepEqual(validateLessonBankForCounts({ questionCount: 10, poolCounts: [], totalQuestions: 200 }), { ok: true, minAllowed: 1, maxAllowed: 200 })
    assert.deepEqual(validateLessonBankForCounts({ questionCount: 200, poolCounts: [], totalQuestions: 200 }), { ok: true, minAllowed: 1, maxAllowed: 200 })
    for (const questionCount of [0, 1.5, 21]) assert.equal(failure(validateLessonBankForCounts({ questionCount, poolCounts: [], totalQuestions: 20 })).code, 'QuestionCountInvalid')
  })
  it('ngân hàng rỗng hoặc quá 200 câu bị từ chối', () => {
    for (const totalQuestions of [0, 201]) assert.equal(failure(validateLessonBankForCounts({ questionCount: 1, poolCounts: [], totalQuestions })).code, 'QuestionBankSizeInvalid')
  })
  it('được 20 nhóm, 21 nhóm bị từ chối; nhóm rỗng bị từ chối', () => {
    assert.deepEqual(validateLessonBankForCounts({ questionCount: 20, poolCounts: Array(20).fill(1), totalQuestions: 20 }), { ok: true, minAllowed: 20, maxAllowed: 20 })
    assert.equal(failure(validateLessonBankForCounts({ questionCount: 21, poolCounts: Array(21).fill(1), totalQuestions: 21 })).code, 'QuestionPoolCountInvalid')
    assert.equal(failure(validateLessonBankForCounts({ questionCount: 2, poolCounts: [3, 0], totalQuestions: 3 })).code, 'QuestionPoolIncomplete')
  })
  it('có nhóm: số nhóm ≤ số câu mỗi lượt ≤ số nhóm × nhóm ít câu nhất', () => {
    assert.deepEqual(pooled(3), { ok: true, minAllowed: 3, maxAllowed: 9 })
    assert.deepEqual(pooled(9), { ok: true, minAllowed: 3, maxAllowed: 9 })
    assert.equal(failure(pooled(2)).code, 'QuestionCountBelowPools')
    assert.equal(failure(pooled(10)).code, 'QuestionPoolQuotaExceeded')
  })
  it('không có lịch tháng sau thì chỉ kiểm số câu đang áp dụng', () => {
    assert.equal(pooled(5, null).ok, true)
    assert.equal(pooled(5, undefined).ok, true)
  })
  it('số câu hẹn tháng sau nằm trong sức chứa ngân hàng thì hợp lệ', () => {
    assert.deepEqual(pooled(5, 9), { ok: true, minAllowed: 3, maxAllowed: 9 })
    assert.equal(validateLessonBankForCounts({ questionCount: 10, scheduledQuestionCount: 20, poolCounts: [], totalQuestions: 20 }).ok, true)
  })
  it('ngân hàng đủ cho hiện tại nhưng thiếu cho lịch tháng sau: chặn và gợi ý thêm câu hoặc giảm/hủy lịch', () => {
    const { message, ...rest } = failure(pooled(5, 10))
    assert.deepEqual(rest, { ok: false, code: 'ScheduledQuestionCountExceedsBank', minAllowed: 3, maxAllowed: 9, requestedScheduledCount: 10 })
    assert.match(message, /tháng sau/)
    assert.match(message, /10 câu/)
    assert.match(message, /thêm hoặc cân bằng câu hỏi/)
    assert.match(message, /giảm\/hủy số câu hẹn tháng sau xuống không quá 9 câu/)
    const unpooled = failure(validateLessonBankForCounts({ questionCount: 10, scheduledQuestionCount: 30, poolCounts: [], totalQuestions: 20 }))
    assert.equal(unpooled.code, 'ScheduledQuestionCountExceedsBank')
    assert.equal(unpooled.maxAllowed, 20)
    assert.equal(unpooled.requestedScheduledCount, 30)
  })
  it('số câu hẹn tháng sau ít hơn số nhóm bị chặn', () => {
    const { message, ...rest } = failure(pooled(5, 2))
    assert.deepEqual(rest, { ok: false, code: 'ScheduledQuestionCountBelowPools', minAllowed: 3, maxAllowed: 9, requestedScheduledCount: 2 })
    assert.match(message, /tháng sau/)
    assert.match(message, /ít nhất 3 câu/)
  })
  it('số câu hẹn tháng sau phải là số nguyên dương', () => {
    for (const scheduled of [0, -1, 2.5]) assert.equal(failure(pooled(5, scheduled)).code, 'ScheduledQuestionCountInvalid')
  })
  it('số câu đang áp dụng sai thì báo lỗi hiện tại trước lỗi lịch', () => {
    assert.equal(failure(pooled(10, 10)).code, 'QuestionPoolQuotaExceeded')
  })
})

describe('đổi số câu / thời gian: áp dụng ngay hoặc hẹn sang tháng sau', () => {
  const now = new Date('2026-11-27T03:00:00.000Z')
  const december = { effectiveAt: new Date('2026-11-30T17:00:00.000Z'), effectiveMonthKey: '2026-12' }
  const current = { questionCount: 10, durationMinutes: 30 }
  const locked = (requested: any, existingSchedule: any = null) =>
    resolveAssessmentConfigUpdate({ current, existingSchedule, requested, hasCurrentMonthLockingAttempts: true, now })
  const scheduled = (questionCount: number, durationMinutes: number) =>
    ({ questionCount: 10, durationMinutes: 30, scheduleAction: 'UPSERT', schedule: { questionCount, durationMinutes, ...december }, wasScheduled: true })
  const cleared = { questionCount: 10, durationMinutes: 30, scheduleAction: 'CLEAR', schedule: null, wasScheduled: false }

  it('tháng này chưa có lượt làm: áp dụng ngay và xóa lịch cũ', () => {
    assert.deepEqual(resolveAssessmentConfigUpdate({
      current, existingSchedule: { questionCount: 20, durationMinutes: 45, ...december },
      requested: { questionCount: 15, durationMinutes: 20, scheduledQuestionCount: 40 }, hasCurrentMonthLockingAttempts: false, now,
    }), { questionCount: 15, durationMinutes: 20, scheduleAction: 'CLEAR', schedule: null, wasScheduled: false })
  })
  it('đã có lượt làm tháng này, đổi số câu: giữ cấu hình đang áp dụng, hẹn sang tháng sau', () => {
    assert.deepEqual(locked({ questionCount: 20, durationMinutes: 30 }), scheduled(20, 30))
  })
  it('đã có lượt làm tháng này, CHỈ đổi thời gian: cũng hẹn sang tháng sau', () => {
    assert.deepEqual(locked({ questionCount: 10, durationMinutes: 45 }), scheduled(10, 45))
  })
  it('đổi cả số câu lẫn thời gian: hẹn cả hai', () => {
    assert.deepEqual(locked({ questionCount: 20, durationMinutes: 45 }), scheduled(20, 45))
  })
  it('sửa lịch nhiều lần trước ngày hiệu lực (10 → 20 → 30)', () => {
    const first = locked({ questionCount: 20, durationMinutes: 30 })
    assert.deepEqual(locked({ questionCount: 30, durationMinutes: 30 }, first.schedule), scheduled(30, 30))
    assert.deepEqual(locked({ questionCount: 10, durationMinutes: 30, scheduledQuestionCount: 30 }, first.schedule), scheduled(30, 30))
  })
  it('trường không đổi lấy theo lịch đang có, không quay về cấu hình hiện tại', () => {
    const existing = { questionCount: 20, durationMinutes: 30, ...december }
    assert.deepEqual(locked({ questionCount: 10, durationMinutes: 45 }, existing), scheduled(20, 45))
    assert.deepEqual(locked({ questionCount: 25, durationMinutes: 30 }, { ...existing, durationMinutes: 60 }), scheduled(25, 60))
  })
  it('giá trị hẹn nhập rõ được ưu tiên hơn giá trị suy ra từ thay đổi', () => {
    assert.deepEqual(locked({ questionCount: 15, durationMinutes: 40, scheduledQuestionCount: 25, scheduledDurationMinutes: 60 }), scheduled(25, 60))
    assert.deepEqual(locked({ questionCount: 10, durationMinutes: 30, scheduledQuestionCount: 25 }), scheduled(25, 30))
    assert.deepEqual(locked({ questionCount: 10, durationMinutes: 30, scheduledDurationMinutes: 60 }), scheduled(10, 60))
  })
  it('hủy lịch: xóa lịch, cấu hình đang áp dụng không đổi', () => {
    const existing = { questionCount: 20, durationMinutes: 45, ...december }
    assert.deepEqual(locked({ questionCount: 99, durationMinutes: 99, scheduledQuestionCount: 50, cancelSchedule: true }, existing), cleared)
  })
  it('đặt lịch về đúng cấu hình đang áp dụng cũng là hủy lịch', () => {
    const existing = { questionCount: 20, durationMinutes: 45, ...december }
    assert.deepEqual(locked({ questionCount: 10, durationMinutes: 30, scheduledQuestionCount: 10, scheduledDurationMinutes: 30 }, existing), cleared)
  })
  it('không đổi gì: giữ nguyên lịch đang có', () => {
    const existing = { questionCount: 20, durationMinutes: 45, ...december }
    assert.deepEqual(locked({ questionCount: 10, durationMinutes: 30 }, existing), { questionCount: 10, durationMinutes: 30, scheduleAction: 'KEEP', schedule: existing, wasScheduled: false })
    assert.deepEqual(locked({ questionCount: 10, durationMinutes: 30, scheduledQuestionCount: null, scheduledDurationMinutes: null }), { questionCount: 10, durationMinutes: 30, scheduleAction: 'KEEP', schedule: null, wasScheduled: false })
  })
  it('hẹn vào 23:59 ngày cuối tháng 12 thì hiệu lực 00:00 ngày 1/1 năm sau', () => {
    const result = resolveAssessmentConfigUpdate({ current, existingSchedule: null, requested: { questionCount: 20, durationMinutes: 30 }, hasCurrentMonthLockingAttempts: true, now: new Date('2026-12-31T16:59:00.000Z') })
    assert.deepEqual(result.schedule, { questionCount: 20, durationMinutes: 30, effectiveAt: new Date('2026-12-31T17:00:00.000Z'), effectiveMonthKey: '2027-01' })
  })
})

describe('nhập câu hỏi từ Google Sheet/Doc: thay toàn bộ hoặc thêm vào ngân hàng', () => {
  type Row = { id?: string; questionText: string; poolIndex?: number }
  const row = (questionText: string, poolIndex?: number, id?: string): Row => {
    const question: Row = { questionText }
    if (poolIndex !== undefined) question.poolIndex = poolIndex
    if (id) question.id = id
    return question
  }
  const rows = (count: number, poolIndex?: number) => Array.from({ length: count }, (_, i) => row(`Câu ${i + 1}`, poolIndex))
  const merge = (mode: 'append' | 'replace', existingPools: { id?: string; name: string }[], existingQuestions: Row[], importedPools: string[], importedQuestions: Row[]): any =>
    mergeImportedQuizBank({ mode, existingPools, existingQuestions, importedPools, importedQuestions })

  it('thay toàn bộ: chỉ còn nhóm và câu hỏi từ file nhập', () => {
    assert.deepEqual(merge('replace', [{ id: 'p1', name: 'Cũ' }], [row('cũ', 0, 'q1')], ['A', 'B'], [row('a', 0), row('b', 1)]), {
      ok: true, pools: [{ name: 'A' }, { name: 'B' }], questions: [{ questionText: 'a', poolIndex: 0 }, { questionText: 'b', poolIndex: 1 }],
    })
  })
  it('thay toàn bộ từ file không có nhóm: mọi câu vào "Nhóm 1"', () => {
    assert.deepEqual(merge('replace', [{ id: 'p1', name: 'Cũ' }], [row('cũ', 0, 'q1')], [], [row('a'), row('b')]), {
      ok: true, pools: [{ name: 'Nhóm 1' }], questions: [{ questionText: 'a', poolIndex: 0 }, { questionText: 'b', poolIndex: 0 }],
    })
  })
  it('thay toàn bộ: đúng 200 câu được, 201 câu bị chặn; 21 nhóm bị chặn', () => {
    assert.equal(merge('replace', [], [], [], rows(200)).questions.length, 200)
    const tooMany = failure(merge('replace', [], [], [], rows(201)))
    assert.equal(tooMany.code, 'QuestionBankLimitExceeded')
    assert.match(tooMany.message, /201 câu/)
    assert.match(tooMany.message, /200 câu/)
    const names = Array.from({ length: 21 }, (_, i) => `Tab ${i + 1}`)
    const tooManyPools = failure(merge('replace', [], [], names, names.map((_, i) => row('x', i))))
    assert.equal(tooManyPools.code, 'QuestionPoolLimitExceeded')
    assert.match(tooManyPools.message, /20 nhóm/)
  })
  it('thay toàn bộ: không gộp nhóm trùng tên, giữ nguyên thứ tự nhóm và nhóm của từng câu', () => {
    assert.deepEqual(merge('replace', [{ id: 'p1', name: 'a' }], [row('cũ', 0, 'q1')], ['A', ' a ', 'B'], [row('x', 0), row('y', 1), row('z', 2)]), {
      ok: true, pools: [{ name: 'A' }, { name: 'a' }, { name: 'B' }],
      questions: [{ questionText: 'x', poolIndex: 0 }, { questionText: 'y', poolIndex: 1 }, { questionText: 'z', poolIndex: 2 }],
    })
  })
  it('thay toàn bộ: 21 nhóm trùng tên vẫn bị chặn, 20 nhóm trùng tên được giữ đủ', () => {
    const names = (count: number) => Array.from({ length: count }, () => 'Tab')
    assert.equal(merge('replace', [], [], names(20), names(20).map((_, i) => row('x', i))).pools.length, 20)
    const tooManyPools = failure(merge('replace', [], [], names(21), names(21).map((_, i) => row('x', i))))
    assert.equal(tooManyPools.code, 'QuestionPoolLimitExceeded')
    assert.match(tooManyPools.message, /21 nhóm/)
    assert.match(tooManyPools.message, /20 nhóm/)
  })
  it('thay toàn bộ: câu thiếu poolIndex (hoặc sai) được chia vòng tròn giữa các nhóm nhập', () => {
    const result = merge('replace', [], [], ['A', 'B'], [row('a'), row('b'), row('c'), row('d', 1), row('e', 5), row('f', -1)])
    assert.deepEqual(result.pools, [{ name: 'A' }, { name: 'B' }])
    assert.deepEqual(result.questions.map((q: Row) => q.poolIndex), [0, 1, 0, 1, 0, 1])
  })
  it('thêm vào: câu thiếu poolIndex được chia vòng tròn theo nhóm nhập rồi mới đổi sang vị trí nhóm trong ngân hàng', () => {
    const existingPools = [{ id: 'p1', name: 'Giao tiếp' }, { id: 'p2', name: 'Đàm phán' }]
    const result = merge('append', existingPools, [row('e1', 0, 'q1'), row('e2', 1, 'q2')], ['đàm phán', 'Chốt đơn'], [row('a'), row('b'), row('c'), row('d', 0)])
    assert.deepEqual(result.pools, [...existingPools, { name: 'Chốt đơn' }])
    assert.deepEqual(result.questions.map((q: Row) => q.poolIndex), [0, 1, 1, 2, 1, 1])
  })
  it('thêm vào: nhóm trùng tên ngay trong file nhập vẫn gộp làm một', () => {
    assert.deepEqual(merge('append', [], [], ['A', ' a '], [row('x', 0), row('y', 1)]), {
      ok: true, pools: [{ name: 'A' }], questions: [{ questionText: 'x', poolIndex: 0 }, { questionText: 'y', poolIndex: 0 }],
    })
  })
  it('không sửa mảng đầu vào', () => {
    const existingPools = [{ id: 'p1', name: 'A' }]
    const existingQuestions = [row('e1', 0, 'q1')]
    const importedPools = ['B', 'C']
    const importedQuestions = [row('i1'), row('i2', 1)]
    for (const mode of ['append', 'replace'] as const) merge(mode, existingPools, existingQuestions, importedPools, importedQuestions)
    assert.deepEqual(existingPools, [{ id: 'p1', name: 'A' }])
    assert.deepEqual(existingQuestions, [{ id: 'q1', questionText: 'e1', poolIndex: 0 }])
    assert.deepEqual(importedPools, ['B', 'C'])
    assert.deepEqual(importedQuestions, [{ questionText: 'i1' }, { questionText: 'i2', poolIndex: 1 }])
  })
  it('thêm vào: giữ nguyên câu và nhóm hiện có (cả ID), gộp nhóm trùng tên không phân biệt hoa thường/khoảng trắng', () => {
    const existingPools = [{ id: 'p1', name: 'Giao tiếp' }, { id: 'p2', name: 'Đàm phán' }]
    const existingQuestions = [row('e1', 0, 'q1'), row('e2', 1, 'q2')]
    const result = merge('append', existingPools, existingQuestions, ['  ĐÀM PHÁN ', 'Chốt đơn'], [row('i1', 0), row('i2', 1)])
    assert.deepEqual(result, {
      ok: true,
      pools: [{ id: 'p1', name: 'Giao tiếp' }, { id: 'p2', name: 'Đàm phán' }, { name: 'Chốt đơn' }],
      questions: [{ id: 'q1', questionText: 'e1', poolIndex: 0 }, { id: 'q2', questionText: 'e2', poolIndex: 1 }, { questionText: 'i1', poolIndex: 1 }, { questionText: 'i2', poolIndex: 2 }],
    })
    assert.equal(result.questions[0], existingQuestions[0])
    assert.equal(result.pools[1], existingPools[1])
  })
  it('thêm vào từ file không có nhóm: vào "Nhóm 1" nếu đã có, chưa có thì tạo thêm', () => {
    assert.deepEqual(merge('append', [{ id: 'p1', name: 'nhóm 1' }], [row('e1', 0, 'q1')], [], [row('i1')]), {
      ok: true, pools: [{ id: 'p1', name: 'nhóm 1' }], questions: [{ id: 'q1', questionText: 'e1', poolIndex: 0 }, { questionText: 'i1', poolIndex: 0 }],
    })
    assert.deepEqual(merge('append', [{ id: 'p1', name: 'Chủ đề A' }], [row('e1', 0, 'q1')], [], [row('i1')]), {
      ok: true, pools: [{ id: 'p1', name: 'Chủ đề A' }, { name: 'Nhóm 1' }], questions: [{ id: 'q1', questionText: 'e1', poolIndex: 0 }, { questionText: 'i1', poolIndex: 1 }],
    })
  })
  it('thêm vào: tổng đúng 200 câu được, 201 câu bị chặn kèm số liệu', () => {
    const pools = [{ id: 'p1', name: 'Nhóm 1' }]
    assert.equal(merge('append', pools, rows(150, 0), ['Nhóm 1'], rows(50, 0)).questions.length, 200)
    const tooMany = failure(merge('append', pools, rows(150, 0), ['Nhóm 1'], rows(51, 0)))
    assert.equal(tooMany.code, 'QuestionBankLimitExceeded')
    assert.match(tooMany.message, /đang có 150 câu/)
    assert.match(tooMany.message, /nhập thêm 51 câu/)
    assert.match(tooMany.message, /201 câu/)
  })
  it('thêm vào: tổng đúng 20 nhóm được, 21 nhóm bị chặn', () => {
    const pools = Array.from({ length: 19 }, (_, i) => ({ id: `p${i}`, name: `Nhóm ${i + 1}` }))
    const existing = pools.map((_, i) => row('e', i))
    assert.equal(merge('append', pools, existing, ['nhóm 19', 'Mới 1'], [row('a', 0), row('b', 1)]).pools.length, 20)
    const tooManyPools = failure(merge('append', pools, existing, ['Mới 1', 'Mới 2'], [row('a', 0), row('b', 1)]))
    assert.equal(tooManyPools.code, 'QuestionPoolLimitExceeded')
    assert.match(tooManyPools.message, /21 nhóm/)
  })
})

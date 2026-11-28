import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  STAR_SOURCE_FILTER_OPTIONS, buildAdminStarHistoryUrl, formatStarAwardedAt, formatStarHistoryRow, isStaleStarHistoryResponse, starHistoryEmptyMessage,
  starHistoryKindForReason,
} from '../lib/admin-star-history-ui'

const root = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

describe('buildAdminStarHistoryUrl', () => {
  it('mặc định chỉ có page và limit=20', () => {
    assert.equal(buildAdminStarHistoryUrl('u1', { page: 1 }), '/api/v1/admin/users/u1/stars?page=1&limit=20')
  })
  it('thêm month và source khi có chọn', () => {
    assert.equal(buildAdminStarHistoryUrl('u1', { page: 2, limit: 10, month: '2026-11', source: 'VIDEO' }), '/api/v1/admin/users/u1/stars?page=2&limit=10&month=2026-11&source=VIDEO')
  })
  it('bỏ qua ALL và giá trị rỗng', () => {
    assert.equal(buildAdminStarHistoryUrl('u1', { page: 1, month: '  ', source: 'ALL' }), '/api/v1/admin/users/u1/stars?page=1&limit=20')
  })
  it('mã hóa userId', () => {
    assert.match(buildAdminStarHistoryUrl('a/b c', { page: 1 }), /users\/a%2Fb%20c\/stars/)
  })
})

describe('STAR_SOURCE_FILTER_OPTIONS', () => {
  it('đủ 4 nguồn theo thứ tự, không có bộ lọc Admin', () => {
    assert.deepEqual(STAR_SOURCE_FILTER_OPTIONS.map(o => o.value), ['ALL', 'VIDEO', 'LESSON_QUIZ', 'COURSE_FINAL'])
    assert.deepEqual(STAR_SOURCE_FILTER_OPTIONS.map(o => o.label), ['Tất cả', 'Video', 'Quiz bài học', 'Thi cuối khóa'])
  })
})

describe('formatStarHistoryRow', () => {
  const base = { amount: 3, awarded_at: '2026-11-30T18:00:00Z', courseTitle: 'Khóa học chung cho thành viên' }
  it('video: tiêu đề bài học, badge Video, không có X/Y câu', () => {
    const row = formatStarHistoryRow({ ...base, reason: 'VIDEO_COMPLETION', kind: 'VIDEO', displayTitle: 'Bài 1', correctCount: 3, totalQuestions: 5 })
    assert.deepEqual([row.title, row.badge, row.kind, row.courseTitle, row.scoreLabel, row.amountLabel, row.amountTone],
      ['Bài 1', 'Video', 'VIDEO', 'Khóa học chung cho thành viên', null, '+3 ⭐', 'positive'])
  })
  it('quiz bài học và thi cuối khóa hiện X/Y câu khi có dữ liệu', () => {
    assert.equal(formatStarHistoryRow({ ...base, reason: 'MODULE_QUIZ_BONUS', correctCount: 17, totalQuestions: 20 }).scoreLabel, '17/20 câu')
    const final = formatStarHistoryRow({ ...base, reason: 'COURSE_FINAL_PASS', correctCount: 20, totalQuestions: 20 })
    assert.deepEqual([final.title, final.badge, final.scoreLabel], ['Bài thi cuối khóa', 'Thi cuối khóa', '20/20 câu'])
    assert.equal(formatStarHistoryRow({ ...base, reason: 'MODULE_QUIZ_PASS', lessonTitle: 'Bài 2' }).badge, 'Quiz')
  })
  it('ẩn X/Y câu khi thiếu hoặc sai dữ liệu (không bao giờ null/null)', () => {
    for (const [c, t] of [[null, null], [null, 20], [5, null], [0, 0], [21, 20], [-1, 5], [1.5, 5]] as const) {
      assert.equal(formatStarHistoryRow({ ...base, reason: 'MODULE_QUIZ_PASS', correctCount: c as any, totalQuestions: t as any }).scoreLabel, null, `${c}/${t}`)
    }
    assert.equal(formatStarHistoryRow({ ...base, reason: 'MODULE_QUIZ_PASS', correctCount: 0, totalQuestions: 5 }).scoreLabel, '0/5 câu')
  })
  it('dữ liệu cũ thiếu kind/displayTitle vẫn suy ra từ reason', () => {
    const quiz = formatStarHistoryRow({ ...base, reason: 'MODULE_QUIZ_PASS', quizTitle: 'Quiz A' })
    assert.deepEqual([quiz.kind, quiz.title], ['LESSON_QUIZ', 'Quiz A'])
    assert.equal(formatStarHistoryRow({ ...base, reason: 'VIDEO_COMPLETION' }).title, 'Video bài học')
    assert.equal(formatStarHistoryRow({ ...base, reason: 'MODULE_QUIZ_PASS' }).title, 'Bài kiểm tra bài học')
  })
  it('bản ghi ADMIN_ADJUSTMENT cũ hiện nhãn trung tính Khác, số âm màu đỏ', () => {
    const row = formatStarHistoryRow({ ...base, amount: -1200, reason: 'ADMIN_ADJUSTMENT', courseTitle: null })
    assert.deepEqual([row.kind, row.badge, row.title, row.courseTitle, row.amountLabel, row.amountTone], ['OTHER', 'Khác', 'Điều chỉnh sao', null, '-1.200 ⭐', 'negative'])
    assert.equal(formatStarHistoryRow({ ...base, amount: 0, reason: 'X' }).amountTone, 'zero')
  })
  it('thời gian theo giờ Việt Nam', () => {
    assert.match(formatStarHistoryRow({ ...base, reason: 'VIDEO_COMPLETION' }).timeLabel, /01\/12\/2026|1 thg 12, 2026|1 thg 12 2026/)
    assert.equal(formatStarHistoryRow({ ...base, reason: 'VIDEO_COMPLETION', awarded_at: new Date('2026-11-30T18:00:00Z') }).timeLabel, formatStarAwardedAt('2026-11-30T18:00:00Z'))
  })
  it('kind theo reason', () => {
    assert.deepEqual(['VIDEO_COMPLETION', 'MODULE_QUIZ_PASS', 'MODULE_QUIZ_BONUS', 'COURSE_FINAL_PASS', 'COURSE_FINAL_BONUS', 'ADMIN_ADJUSTMENT', undefined].map(starHistoryKindForReason),
      ['VIDEO', 'LESSON_QUIZ', 'LESSON_QUIZ', 'COURSE_FINAL', 'COURSE_FINAL', 'OTHER', 'OTHER'])
  })
})

describe('Admin và học viên dùng chung StarHistoryRow', () => {
  it('cả hai trang render qua StarHistoryRow, không còn nút Điều chỉnh Admin', () => {
    for (const file of ['src/components/learner/AdminStarHistoryPanel.tsx', 'src/app/student/stars/page.tsx']) {
      assert.match(read(file), /<StarHistoryRow /, file)
      assert.doesNotMatch(read(file), /Điều chỉnh Admin/, file)
    }
  })
})

describe('isStaleStarHistoryResponse', () => {
  it('cùng seq và cùng người dùng thì không cũ', () => assert.equal(isStaleStarHistoryResponse(3, 3, 'u1', 'u1'), false))
  it('seq cũ hơn thì bị bỏ', () => assert.equal(isStaleStarHistoryResponse(2, 3, 'u1', 'u1'), true))
  it('đã đổi người dùng thì bị bỏ', () => assert.equal(isStaleStarHistoryResponse(3, 3, 'u1', 'u2'), true))
})

describe('starHistoryEmptyMessage', () => {
  it('phân biệt chưa có sao và không khớp bộ lọc', () => {
    assert.match(starHistoryEmptyMessage(false).title, /chưa có lượt nhận sao nào/)
    assert.match(starHistoryEmptyMessage(true).title, /khớp bộ lọc/)
  })
})

describe('formatStarAwardedAt', () => {
  it('định dạng ngày hợp lệ', () => assert.match(formatStarAwardedAt('2026-11-27T03:00:00.000Z'), /2026/))
  it('hiển thị theo giờ Việt Nam tại ranh giới tháng', () => {
    const text = formatStarAwardedAt('2026-11-30T18:00:00Z')
    assert.match(text, /01\/12\/2026|1 thg 12, 2026|1 thg 12 2026/)
    assert.match(text, /01:00|1:00/)
  })
  it('ngày sai thì có giá trị thay thế', () => assert.equal(formatStarAwardedAt('abc'), 'Thời gian không xác định'))
})

describe('đấu nối enableAdminStarHistory', () => {
  it('Admin users và Admin chapters luôn bật', () => {
    assert.match(read('src/app/admin/users/page.tsx'), /enableAdminStarHistory=\{true\}/)
    assert.match(read('src/app/admin/chapters/page.tsx'), /enableAdminStarHistory=\{true\}/)
  })
  it('UnifiedLeaderboard chỉ bật khi isAdmin', () => {
    assert.match(read('src/components/learning/UnifiedLeaderboard.tsx'), /enableAdminStarHistory=\{isAdmin\}/)
  })
  it('màn hình Lead không bật', () => {
    assert.doesNotMatch(read('src/app/chapter-manager/members/page.tsx'), /enableAdminStarHistory/)
    assert.doesNotMatch(read('src/app/chapter-manager/members/[userId]/page.tsx'), /enableAdminStarHistory/)
  })
})

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  STAR_SOURCE_FILTER_OPTIONS, buildAdminStarHistoryUrl, formatStarAwardedAt, isStaleStarHistoryResponse, starHistoryEmptyMessage,
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
  it('đủ 5 nguồn theo thứ tự', () => {
    assert.deepEqual(STAR_SOURCE_FILTER_OPTIONS.map(o => o.value), ['ALL', 'VIDEO', 'LESSON_QUIZ', 'COURSE_FINAL', 'ADMIN_ADJUSTMENT'])
    assert.deepEqual(STAR_SOURCE_FILTER_OPTIONS.map(o => o.label), ['Tất cả', 'Video', 'Quiz bài học', 'Thi cuối khóa', 'Điều chỉnh Admin'])
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

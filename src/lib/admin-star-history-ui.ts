export type AdminStarSourceFilter = 'ALL' | 'VIDEO' | 'LESSON_QUIZ' | 'COURSE_FINAL' | 'ADMIN_ADJUSTMENT'

export const STAR_SOURCE_FILTER_OPTIONS: ReadonlyArray<{ value: AdminStarSourceFilter; label: string }> = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'VIDEO', label: 'Video' },
  { value: 'LESSON_QUIZ', label: 'Quiz bài học' },
  { value: 'COURSE_FINAL', label: 'Thi cuối khóa' },
  { value: 'ADMIN_ADJUSTMENT', label: 'Điều chỉnh Admin' },
]

export const STAR_REASON_LABELS: Record<string, string> = {
  VIDEO_COMPLETION: 'Hoàn thành video bài học',
  MODULE_QUIZ_PASS: 'Vượt qua bài kiểm tra',
  MODULE_QUIZ_BONUS: 'Thưởng kết quả bài kiểm tra',
  COURSE_FINAL_PASS: 'Hoàn thành bài thi cuối khóa',
  COURSE_FINAL_BONUS: 'Thưởng kết quả bài thi cuối khóa',
  ADMIN_ADJUSTMENT: 'Điều chỉnh Star',
}

export function buildAdminStarHistoryUrl(
  userId: string,
  filters: { page: number; limit?: number; month?: string; source?: string },
): string {
  const query = new URLSearchParams({ page: String(filters.page), limit: String(filters.limit ?? 20) })
  const month = (filters.month ?? '').trim()
  const source = (filters.source ?? '').trim()
  if (month) query.set('month', month)
  if (source && source.toUpperCase() !== 'ALL') query.set('source', source)
  return `/api/v1/admin/users/${encodeURIComponent(userId)}/stars?${query.toString()}`
}

export function formatStarAwardedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Thời gian không xác định'
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function starHistoryEmptyMessage(hasActiveFilter: boolean): { title: string; subtitle: string } {
  return hasActiveFilter
    ? { title: 'Không có lượt nhận sao nào khớp bộ lọc hiện tại', subtitle: 'Thử chọn tháng hoặc nguồn khác, hoặc xóa bộ lọc.' }
    : { title: 'Học viên chưa có lượt nhận sao nào', subtitle: 'Sao sẽ xuất hiện khi học viên hoàn thành video, quiz hoặc bài thi.' }
}

/** A response is stale when a newer request was issued or the viewed user changed meanwhile. */
export function isStaleStarHistoryResponse(requestSeq: number, latestSeq: number, requestedUserId: string, currentUserId: string): boolean {
  return requestSeq !== latestSeq || requestedUserId !== currentUserId
}

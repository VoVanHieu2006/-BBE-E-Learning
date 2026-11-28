import type { StarHistorySourceFilter } from './star-history-rules'

export type AdminStarSourceFilter = StarHistorySourceFilter

/** Admins never adjust Stars by hand, so there is no Admin filter; old ADMIN_ADJUSTMENT rows still show under "Tất cả". */
export const STAR_SOURCE_FILTER_OPTIONS: ReadonlyArray<{ value: AdminStarSourceFilter; label: string }> = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'VIDEO', label: 'Video' },
  { value: 'LESSON_QUIZ', label: 'Quiz bài học' },
  { value: 'COURSE_FINAL', label: 'Thi cuối khóa' },
]

export type StarHistoryKind = 'VIDEO' | 'LESSON_QUIZ' | 'COURSE_FINAL' | 'OTHER'

export function starHistoryKindForReason(reason: string | null | undefined): StarHistoryKind {
  if (reason === 'VIDEO_COMPLETION') return 'VIDEO'
  if (reason === 'MODULE_QUIZ_PASS' || reason === 'MODULE_QUIZ_BONUS') return 'LESSON_QUIZ'
  if (reason === 'COURSE_FINAL_PASS' || reason === 'COURSE_FINAL_BONUS') return 'COURSE_FINAL'
  return 'OTHER'
}

export const STAR_KIND_BADGES: Record<StarHistoryKind, string> = {
  VIDEO: 'Video',
  LESSON_QUIZ: 'Quiz',
  COURSE_FINAL: 'Thi cuối khóa',
  OTHER: 'Khác',
}

/** The fields one history row needs; matches the API item, older cached responses may lack the new ones. */
export interface StarHistoryRowInput {
  amount: number
  reason: string
  awarded_at: string | Date
  kind?: StarHistoryKind | null
  displayTitle?: string | null
  detail?: string | null
  lessonTitle?: string | null
  courseTitle?: string | null
  quizTitle?: string | null
  correctCount?: number | null
  totalQuestions?: number | null
}

export interface StarHistoryRowView {
  title: string
  kind: StarHistoryKind
  badge: string
  courseTitle: string | null
  /** "17/20 câu" for quizzes and final exams with known attempt data; null hides the pill. */
  scoreLabel: string | null
  timeLabel: string
  amountLabel: string
  amountTone: 'positive' | 'negative' | 'zero'
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

export function formatStarQuestionScore(correctCount: number | null | undefined, totalQuestions: number | null | undefined): string | null {
  if (!isCount(correctCount) || !isCount(totalQuestions) || totalQuestions === 0 || correctCount > totalQuestions) return null
  return `${correctCount}/${totalQuestions} câu`
}

function fallbackTitle(entry: StarHistoryRowInput, kind: StarHistoryKind): string {
  if (kind === 'VIDEO') return entry.lessonTitle || 'Video bài học'
  if (kind === 'LESSON_QUIZ') return entry.lessonTitle || entry.quizTitle || 'Bài kiểm tra bài học'
  if (kind === 'COURSE_FINAL') return 'Bài thi cuối khóa'
  return entry.reason === 'ADMIN_ADJUSTMENT' ? 'Điều chỉnh sao' : 'Phần thưởng tích lũy sao'
}

/** One shared 2-line row for the Admin panel and the learner's /student/stars page. */
export function formatStarHistoryRow(entry: StarHistoryRowInput): StarHistoryRowView {
  const kind = entry.kind ?? starHistoryKindForReason(entry.reason)
  const amount = Number(entry.amount) || 0
  const isQuiz = kind === 'LESSON_QUIZ' || kind === 'COURSE_FINAL'
  return {
    title: entry.displayTitle?.trim() || fallbackTitle(entry, kind),
    kind,
    badge: STAR_KIND_BADGES[kind],
    courseTitle: entry.courseTitle?.trim() || null,
    scoreLabel: isQuiz ? formatStarQuestionScore(entry.correctCount, entry.totalQuestions) : null,
    timeLabel: formatStarAwardedAt(entry.awarded_at instanceof Date ? entry.awarded_at.toISOString() : String(entry.awarded_at)),
    amountLabel: `${amount > 0 ? '+' : ''}${amount.toLocaleString('vi-VN')} ⭐`,
    amountTone: amount > 0 ? 'positive' : amount < 0 ? 'negative' : 'zero',
  }
}

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
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(date)
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

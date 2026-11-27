import { Prisma, StarLedger } from '@prisma/client'
import { isLearningManager } from './manager-learning-access'
import {
  StarHistorySourceFilter,
  formatStarMonthLabel,
  isValidStarUserId,
  normalizeStarHistoryPagination,
  parseStarHistoryMonth,
  parseStarHistorySource,
  starReasonsForSource,
  vnMonthBounds,
} from './star-history-rules'

type Db = Prisma.TransactionClient
export type StarHistoryEntry = Pick<StarLedger, 'id' | 'amount' | 'reason' | 'awarded_at' | 'source_type' | 'source_id' | 'metadata'>
export interface StarHistoryFilters { monthKey?: string | null; source?: StarHistorySourceFilter }

/** Matches a VN month by its competition month, or by award time for legacy rows that have none. */
function filterConditions(userId: string, filters: StarHistoryFilters) {
  const conditions = [Prisma.sql`sl.user_id = ${userId}::uuid`]
  if (filters.monthKey) {
    const { startsAt, endsAt } = vnMonthBounds(filters.monthKey)
    // awarded_at is a UTC wall-clock `timestamp`; compare against UTC wall-clock bounds.
    conditions.push(Prisma.sql`(cm.key = ${filters.monthKey} OR (sl.competition_month_id IS NULL
      AND sl.awarded_at >= timezone('UTC', ${startsAt.toISOString()}::timestamptz)
      AND sl.awarded_at < timezone('UTC', ${endsAt.toISOString()}::timestamptz)))`)
  }
  const reasons = starReasonsForSource(filters.source ?? 'ALL')
  if (reasons) conditions.push(Prisma.sql`sl.reason::text = ANY(${reasons}::text[])`)
  return Prisma.join(conditions, ' AND ')
}

/** A Quiz attempt is one history event, even when legacy rewards paid each correct answer separately. */
export async function readStarHistoryPage(tx: Db, userId: string, pageValue: string | null, limitValue: string | null, filters: StarHistoryFilters = {}) {
  const scopedHistory = Prisma.sql`
    WITH scoped_history AS (
      SELECT sl.id, sl.amount, sl.reason, sl.awarded_at, sl.source_type, sl.source_id, sl.metadata,
        CASE WHEN sl.source_type = 'ASSESSMENT' AND sl.amount > 0
          AND sl.reason IN ('MODULE_QUIZ_PASS', 'MODULE_QUIZ_BONUS', 'COURSE_FINAL_PASS', 'COURSE_FINAL_BONUS')
          AND sl.metadata->>'attemptId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        THEN jsonb_build_array('QUIZ_ATTEMPT', sl.source_id, lower(sl.metadata->>'attemptId'),
          sl.learning_cycle_id, sl.competition_month_id,
          CASE WHEN sl.reason IN ('COURSE_FINAL_PASS', 'COURSE_FINAL_BONUS') THEN 'FINAL' ELSE 'LESSON' END)::text
        ELSE jsonb_build_array('ENTRY', sl.id)::text END AS history_key
      FROM star_ledger sl LEFT JOIN competition_months cm ON cm.id = sl.competition_month_id
      WHERE ${filterConditions(userId, filters)}
    )`
  const [summary] = await tx.$queryRaw<{ total: number; amount: number }[]>`${scopedHistory}
    SELECT count(DISTINCT history_key)::int AS total, COALESCE(sum(amount), 0)::int AS amount FROM scoped_history`
  const totalItems = summary.total
  const filteredTotal = summary.amount
  const { page, limit, totalPages } = normalizeStarHistoryPagination(pageValue, limitValue, totalItems)
  if (!totalItems) return { items: [] as StarHistoryEntry[], totalItems, page, limit, totalPages, filteredTotal }

  // Group before OFFSET/LIMIT so one award never splits over multiple pages.
  // Existing row IDs and metadata remain suitable for title enrichment and stable sorting.
  const items = await tx.$queryRaw<StarHistoryEntry[]>`${scopedHistory}
    SELECT (array_agg(id ORDER BY awarded_at DESC, id DESC))[1] AS id,
      sum(amount)::int AS amount,
      (array_agg(reason ORDER BY awarded_at DESC, id DESC))[1] AS reason,
      max(awarded_at) AS awarded_at,
      max(source_type) AS source_type,
      max(source_id::text)::uuid AS source_id,
      (array_agg(metadata ORDER BY awarded_at DESC, id DESC))[1] AS metadata
    FROM scoped_history GROUP BY history_key
    ORDER BY awarded_at DESC, id DESC OFFSET ${(page - 1) * limit} LIMIT ${limit}`
  return { items, totalItems, page, limit, totalPages, filteredTotal }
}

/** The raw ledger sum, also for learning managers whose displayed balance is 0. */
export async function readUserStarLedgerTotal(tx: Db, userId: string): Promise<number> {
  const result = await tx.starLedger.aggregate({ where: { user_id: userId }, _sum: { amount: true } })
  return result._sum.amount || 0
}

/** Months with any ledger row, newest first; legacy rows fall back to their VN award month. */
export async function listUserStarHistoryMonths(tx: Db, userId: string): Promise<Array<{ key: string; label: string }>> {
  const rows = await tx.$queryRaw<{ key: string }[]>`
    SELECT DISTINCT CASE WHEN sl.competition_month_id IS NOT NULL THEN cm.key
      ELSE to_char(timezone('Asia/Ho_Chi_Minh', timezone('UTC', sl.awarded_at)), 'YYYY-MM') END AS key
    FROM star_ledger sl LEFT JOIN competition_months cm ON cm.id = sl.competition_month_id
    WHERE sl.user_id = ${userId}::uuid
    ORDER BY key DESC`
  return rows.filter(row => row.key).map(({ key }) => ({ key, label: formatStarMonthLabel(key) }))
}

export interface StarHistoryItem {
  id: string
  amount: number
  reason: StarLedger['reason']
  awarded_at: Date
  source_type: string
  lessonTitle: string | null
  courseTitle: string | null
  quizTitle: string | null
  detail: string
}

const metadataLessonId = (entry: StarHistoryEntry) => {
  const metadata = entry.metadata
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) && typeof metadata.lessonId === 'string' ? metadata.lessonId : null
}

/** Adds lesson, course and quiz titles; deleted sources fall back to generic Vietnamese labels. */
export async function enrichStarHistoryEntries(tx: Db, items: StarHistoryEntry[]): Promise<StarHistoryItem[]> {
  const videoIds = items.filter((i) => i.source_type === 'VIDEO' && i.source_id).map((i) => i.source_id)
  const assessmentIds = items.filter((i) => i.source_type === 'ASSESSMENT' && i.source_id).map((i) => i.source_id)
  const metadataLessonIds = items.map(metadataLessonId).filter((id): id is string => Boolean(id))
  const withCourse = { session: { select: { course: { select: { id: true, title: true } } } } } as const

  const [videos, lessons, assessments] = await Promise.all([
    videoIds.length
      ? tx.video.findMany({
          where: { id: { in: videoIds } },
          select: { id: true, title: true, lesson: { select: { id: true, title: true, ...withCourse } } },
        })
      : Promise.resolve([]),
    metadataLessonIds.length
      ? tx.lesson.findMany({ where: { id: { in: metadataLessonIds } }, select: { id: true, title: true, ...withCourse } })
      : Promise.resolve([]),
    assessmentIds.length
      ? tx.assessment.findMany({
          where: { id: { in: assessmentIds } },
          select: { id: true, title: true, lesson: { select: { title: true, ...withCourse } }, course: { select: { id: true, title: true } } },
        })
      : Promise.resolve([]),
  ])

  const videoMap = new Map(videos.map((v) => [v.id, v]))
  const lessonMap = new Map(lessons.map((l) => [l.id, l]))
  const assessmentMap = new Map(assessments.map((a) => [a.id, a]))

  return items.map((entry) => {
    let lessonTitle: string | null = null
    let courseTitle: string | null = null
    let quizTitle: string | null = null
    let detail = ''

    if (entry.reason === 'VIDEO_COMPLETION') {
      const v = videoMap.get(entry.source_id)
      const lessonId = metadataLessonId(entry)
      const l = v?.lesson || (lessonId ? lessonMap.get(lessonId) : undefined)
      lessonTitle = l?.title || v?.title || null
      courseTitle = l?.session?.course?.title || null
      detail = lessonTitle
        ? `Hoàn thành video: ${lessonTitle}${courseTitle ? ` · ${courseTitle}` : ''}`
        : 'Hoàn thành video bài học'
    } else if (entry.reason === 'MODULE_QUIZ_PASS' || entry.reason === 'MODULE_QUIZ_BONUS') {
      const a = assessmentMap.get(entry.source_id)
      quizTitle = a?.title || 'Bài kiểm tra'
      lessonTitle = a?.lesson?.title || null
      courseTitle = a?.lesson?.session?.course?.title || null
      detail = `Vượt qua bài kiểm tra: ${quizTitle}${lessonTitle ? ` · ${lessonTitle}` : ''}`
    } else if (entry.reason === 'COURSE_FINAL_PASS' || entry.reason === 'COURSE_FINAL_BONUS') {
      const a = assessmentMap.get(entry.source_id)
      courseTitle = a?.course?.title || null
      detail = courseTitle
        ? `Vượt qua bài thi cuối khóa: ${courseTitle}`
        : 'Vượt qua bài thi cuối khóa'
    } else if (entry.reason === 'ADMIN_ADJUSTMENT') {
      detail = 'Điều chỉnh Star bởi Ban Quản Trị'
    } else {
      detail = 'Phần thưởng tích lũy Star BBE'
    }

    return {
      id: entry.id,
      amount: entry.amount,
      reason: entry.reason,
      awarded_at: entry.awarded_at,
      source_type: entry.source_type,
      lessonTitle,
      courseTitle,
      quizTitle,
      detail,
    }
  })
}

export interface AdminUserStarHistory {
  user: { id: string; displayName: string | null; email: string; role: string; status: string }
  balance: number
  ledgerTotal: number
  filteredTotal: number
  availableMonths: Array<{ key: string; label: string }>
  filters: { month: string | null; source: StarHistorySourceFilter }
  items: StarHistoryItem[]
  page: number
  limit: number
  totalItems: number
  totalPages: number
}

export type AdminUserStarHistoryResult =
  | { ok: true; body: AdminUserStarHistory }
  | { ok: false; status: 400 | 404; error: { code: 'ValidationError' | 'UserNotFound'; message: string } }

interface QueryParams { get(name: string): string | null }
const invalid = (message: string): AdminUserStarHistoryResult => ({ ok: false, status: 400, error: { code: 'ValidationError', message } })

/** Admin view of any account (every role and status). Caller enforces the ADMIN-only check. */
export async function getAdminUserStarHistory(
  db: Db,
  userId: string,
  query: QueryParams,
  deps: { isLearningManager: (userId: string, role?: string | null) => Promise<boolean> } = { isLearningManager },
): Promise<AdminUserStarHistoryResult> {
  if (!isValidStarUserId(userId)) return invalid('Mã người dùng không hợp lệ.')
  const month = parseStarHistoryMonth(query.get('month'))
  if (!month.ok) return invalid(month.message)
  const source = parseStarHistorySource(query.get('source'))
  if (!source.ok) return invalid(source.message)

  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, display_name: true, email: true, role: true, status: true } })
  if (!user) return { ok: false, status: 404, error: { code: 'UserNotFound', message: 'Không tìm thấy người dùng.' } }

  const [ledgerTotal, manager, availableMonths, history] = await Promise.all([
    readUserStarLedgerTotal(db, user.id),
    deps.isLearningManager(user.id, user.role),
    listUserStarHistoryMonths(db, user.id),
    readStarHistoryPage(db, user.id, query.get('page'), query.get('limit'), { monthKey: month.value, source: source.value }),
  ])
  return {
    ok: true,
    body: {
      user: { id: user.id, displayName: user.display_name, email: user.email, role: user.role, status: user.status },
      // Same rule as getUserStarBalance: learning managers display 0 Stars.
      balance: manager ? 0 : ledgerTotal,
      ledgerTotal,
      filteredTotal: history.filteredTotal,
      availableMonths,
      filters: { month: month.value, source: source.value },
      items: await enrichStarHistoryEntries(db, history.items),
      page: history.page,
      limit: history.limit,
      totalItems: history.totalItems,
      totalPages: history.totalPages,
    },
  }
}

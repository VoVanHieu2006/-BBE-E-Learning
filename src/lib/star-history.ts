import { Prisma, StarLedger } from '@prisma/client'
import { normalizeStarHistoryPagination } from './star-history-rules'

type HistoryEntry = Pick<StarLedger, 'id' | 'amount' | 'reason' | 'awarded_at' | 'source_type' | 'source_id' | 'metadata'>

/** A Quiz attempt is one history event, even when legacy rewards paid each correct answer separately. */
export async function readStarHistoryPage(tx: Prisma.TransactionClient, userId: string, pageValue: string | null, limitValue: string | null) {
  const scopedHistory = Prisma.sql`
    WITH scoped_history AS (
      SELECT id, amount, reason, awarded_at, source_type, source_id, metadata,
        CASE WHEN source_type = 'ASSESSMENT' AND amount > 0
          AND reason IN ('MODULE_QUIZ_PASS', 'MODULE_QUIZ_BONUS', 'COURSE_FINAL_PASS', 'COURSE_FINAL_BONUS')
          AND metadata->>'attemptId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        THEN jsonb_build_array('QUIZ_ATTEMPT', source_id, lower(metadata->>'attemptId'),
          learning_cycle_id, competition_month_id,
          CASE WHEN reason IN ('COURSE_FINAL_PASS', 'COURSE_FINAL_BONUS') THEN 'FINAL' ELSE 'LESSON' END)::text
        ELSE jsonb_build_array('ENTRY', id)::text END AS history_key
      FROM star_ledger WHERE user_id = ${userId}::uuid
    )`
  const [count] = await tx.$queryRaw<{ total: number }[]>`${scopedHistory}
    SELECT count(DISTINCT history_key)::int AS total FROM scoped_history`
  const totalItems = count.total
  const { page, limit, totalPages } = normalizeStarHistoryPagination(pageValue, limitValue, totalItems)
  if (!totalItems) return { items: [] as HistoryEntry[], totalItems, page, limit, totalPages }

  // Group before OFFSET/LIMIT so one award never splits over multiple pages.
  // Existing row IDs and metadata remain suitable for title enrichment and stable sorting.
  const items = await tx.$queryRaw<HistoryEntry[]>`${scopedHistory}
    SELECT (array_agg(id ORDER BY awarded_at DESC, id DESC))[1] AS id,
      sum(amount)::int AS amount,
      (array_agg(reason ORDER BY awarded_at DESC, id DESC))[1] AS reason,
      max(awarded_at) AS awarded_at,
      max(source_type) AS source_type,
      max(source_id::text)::uuid AS source_id,
      (array_agg(metadata ORDER BY awarded_at DESC, id DESC))[1] AS metadata
    FROM scoped_history GROUP BY history_key
    ORDER BY awarded_at DESC, id DESC OFFSET ${(page - 1) * limit} LIMIT ${limit}`
  return { items, totalItems, page, limit, totalPages }
}

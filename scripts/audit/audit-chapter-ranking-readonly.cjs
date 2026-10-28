// Explicit read-only production reconciliation. Never logs connection strings or people.
const { Client } = require('pg')
if (process.argv.includes('--configured')) require('@next/env').loadEnvConfig(process.cwd())
const target = process.env.AUDIT_DATABASE_URL || (process.argv.includes('--configured') ? process.env.DIRECT_URL || process.env.DATABASE_URL : null)
if (!target) throw new Error('AUDIT_DATABASE_URL required (or explicitly use --configured)')
const queries = {
  ledgerAllocation: `SELECT provenance, competition_month_id IS NULL AS month_missing, learning_cycle_id IS NULL AS cycle_missing, chapter_at_award_id IS NULL AS chapter_missing, count(*)::int AS entries, sum(amount)::text AS stars FROM star_ledger GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`,
  monthCycleChapter: `SELECT competition_month_id,learning_cycle_id,chapter_at_award_id,provenance,count(*)::int AS entries,sum(amount)::text AS stars FROM star_ledger GROUP BY 1,2,3,4 ORDER BY 1,2,3,4 LIMIT 1000`,
  affiliationEvidence: `SELECT count(*)::int AS native_entries,count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM chapter_affiliation_intervals h WHERE h.user_id=s.user_id AND h.chapter_id=s.chapter_at_award_id AND h.starts_at<=s.awarded_at AND (h.ends_at IS NULL OR s.awarded_at<h.ends_at)))::int AS missing_or_mismatched_historical_affiliation FROM star_ledger s WHERE s.provenance='NATIVE' AND s.chapter_at_award_id IS NOT NULL`,
  policy: `SELECT cutover_at,mapping_approved_at FROM learning_policy WHERE id='default'`,
  periods: `SELECT key,state,starts_at,ends_at FROM competition_months ORDER BY starts_at DESC LIMIT 60`,
  transfers: `SELECT status,count(*)::int AS batches,count(applied_at)::int AS application_timestamps FROM chapter_reorganizations GROUP BY status`,
  terms: `SELECT season_id IS NULL AS initial,ends_at IS NULL AS ongoing,count(*)::int AS terms FROM chapter_competition_terms GROUP BY 1,2`,
  snapshotCoverage: `SELECT m.key,s.payload->>'state' AS snapshot_state,s.payload ? 'items' AS contains_items FROM competition_months m LEFT JOIN learning_snapshots s ON s.key='ranking:CHAPTER:'||m.id::text WHERE m.ends_at<=now() ORDER BY m.starts_at DESC LIMIT 60`,
}
;(async () => {
  const db = new Client({ connectionString: target, connectionTimeoutMillis: 8000, statement_timeout: 10000, application_name: 'chapter-ranking-readonly-audit' })
  let connected = false
  const completedQueries = []
  try {
    await db.connect(); connected = true
    await db.query('BEGIN READ ONLY')
    const { rows: [mode] } = await db.query("SELECT current_setting('transaction_read_only') AS read_only")
    if (mode.read_only !== 'on') throw new Error('ReadOnlyTransactionRequired')
    console.log(JSON.stringify({ transactionReadOnly: true }))
    for (const [name, sql] of Object.entries(queries)) {
      const rows = (await db.query(sql)).rows
      completedQueries.push(name)
      console.log(JSON.stringify({ name, rows }))
    }
    await db.query('ROLLBACK')
  } catch (e) {
    if (connected) await db.query('ROLLBACK').catch(() => {})
    console.error(JSON.stringify({ status: 'BLOCKED', code: e.code || 'CONNECTION_OR_QUERY_FAILED', name: e.name, timedOut: /timeout/i.test(e.message || ''), selectsVerified: completedQueries.length > 0, completedQueries }))
    process.exitCode = 1
  } finally { await db.end().catch(() => {}) }
})()

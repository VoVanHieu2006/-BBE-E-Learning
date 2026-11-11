import nextEnv from '@next/env'
import { Client } from 'pg'

nextEnv.loadEnvConfig(process.cwd())
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for this read-only audit.')

const db = new Client({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
  connectionTimeoutMillis: 15_000,
})
await db.connect()
try {
  await db.query('BEGIN READ ONLY')
  await db.query("SET LOCAL statement_timeout = '30s'")
  const [targets, rules, outbox, assignments, paths, units, positions] = await Promise.all([
    db.query('SELECT code, label, sort_order FROM learning_targets ORDER BY sort_order, code'),
    db.query(`SELECT target_code, due_days, effective_from, effective_until, organization_unit_id, position_id FROM learning_rules WHERE effective_until IS NULL ORDER BY created_at`),
    db.query(`SELECT count(*)::int AS pending, count(*) FILTER (WHERE processed_at IS NULL AND last_error IS NOT NULL)::int AS failed FROM learning_outbox`),
    db.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE mandatory)::int AS mandatory, count(*) FILTER (WHERE status = 'OVERDUE')::int AS overdue, count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed FROM user_learning_assignments`),
    db.query('SELECT count(*)::int AS total, count(*) FILTER (WHERE due_at IS NOT NULL)::int AS with_due FROM learning_paths'),
    db.query(`SELECT type, count(*)::int AS count FROM organization_units WHERE status = 'ACTIVE' GROUP BY type ORDER BY type`),
    db.query('SELECT code, name FROM positions ORDER BY code'),
  ])
  await db.query('COMMIT')

  const canonical = new Set([
    'DEPARTMENT_MEMBER_BTV', 'DEPARTMENT_MEMBER_BTK', 'DEPARTMENT_MEMBER_BND', 'DEPARTMENT_MEMBER_BCL', 'DEPARTMENT_MEMBER_BDHU', 'DEPARTMENT_MEMBER_BKM', 'DEPARTMENT_MEMBER_BTTSK',
    'DEPARTMENT_LEAD_BTV', 'DEPARTMENT_LEAD_BTK', 'DEPARTMENT_LEAD_BND', 'DEPARTMENT_LEAD_BCL', 'DEPARTMENT_LEAD_BDHU', 'DEPARTMENT_LEAD_BKM', 'DEPARTMENT_LEAD_BTTSK',
    'PRESIDENT', 'DNA_MEMBER_TT', 'DNA_MEMBER_SGDC', 'DNA_MEMBER_LDC',
  ])
  const legacyRules = rules.rows.filter((rule) => rule.target_code && !canonical.has(rule.target_code))
  const missingTargets = [...canonical].filter((code) => !targets.rows.some((target) => target.code === code))

  console.log(JSON.stringify({
    targetCount: targets.rows.length,
    missingTargets,
    targets: targets.rows,
    activeRules: rules.rows.length,
    legacyRules: legacyRules.map((rule) => ({ targetCode: rule.target_code, dueDays: rule.due_days })),
    outbox: outbox.rows[0],
    assignments: assignments.rows[0],
    paths: paths.rows[0],
    organizationUnits: units.rows,
    positions: positions.rows,
  }, null, 2))
} finally {
  await db.end()
}

import nextEnv from '@next/env'
import { Client } from 'pg'
import { mkdir, writeFile } from 'node:fs/promises'

nextEnv.loadEnvConfig(process.cwd())
const db = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, connectionTimeoutMillis: 15000 })
try {
  await db.connect()
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  await db.query("SET LOCAL statement_timeout = '30s'")
  const { rows: clock } = await db.query('SELECT clock_timestamp() AS audited_at, current_database() IS NOT NULL AS connected')
  const { rows: leadConflicts } = await db.query(`
    WITH grants AS (
      SELECT a.user_id, c.id AS chapter_id FROM position_assignments a
      JOIN positions p ON p.id=a.position_id JOIN chapters c ON c.organization_unit_id=a.unit_id
      JOIN users u ON u.id=a.user_id
      WHERE p.code IN ('CHAPTER_LEAD','CHAPTER_MANAGER') AND u.role <> 'ADMIN'
        AND a.starts_at <= timezone('UTC',now()) AND (a.ends_at IS NULL OR a.ends_at > timezone('UTC',now()))
      UNION ALL
      SELECT m.user_id,m.chapter_id FROM chapter_members m JOIN users u ON u.id=m.user_id WHERE u.role='CHAPTER_LEADER'
    ) SELECT md5(user_id::text) AS user_ref, count(DISTINCT chapter_id)::int AS chapter_count,
      array_agg(DISTINCT chapter_id) AS chapter_ids,
      (SELECT json_agg(json_build_object('chapterId',c.id,'name',c.name)) FROM chapters c WHERE c.id IN (SELECT g.chapter_id FROM grants g WHERE g.user_id=grants.user_id)) AS chapters
      FROM grants GROUP BY user_id HAVING count(DISTINCT chapter_id)>1`)
  const { rows: affiliationConflicts } = await db.query(`
    WITH dna AS (SELECT DISTINCT m.user_id FROM organization_memberships m JOIN organization_units u ON u.id=m.unit_id
      WHERE m.status='ACTIVE' AND m.starts_at <= timezone('UTC',now()) AND (m.ends_at IS NULL OR m.ends_at > timezone('UTC',now())) AND u.type IN ('DNA','DNA_GROUP'))
    SELECT md5(d.user_id::text) AS user_ref,
      EXISTS(SELECT 1 FROM chapter_members c WHERE c.user_id=d.user_id) AS legacy_chapter,
      (SELECT count(*)::int FROM organization_memberships m JOIN organization_units u ON u.id=m.unit_id WHERE m.user_id=d.user_id AND m.status='ACTIVE'
        AND m.starts_at<=timezone('UTC',now()) AND (m.ends_at IS NULL OR m.ends_at>timezone('UTC',now())) AND u.type IN ('CHAPTER','DEPARTMENT')) AS chapter_memberships
    FROM dna d WHERE EXISTS(SELECT 1 FROM chapter_members c WHERE c.user_id=d.user_id) OR EXISTS(
      SELECT 1 FROM organization_memberships m JOIN organization_units u ON u.id=m.unit_id WHERE m.user_id=d.user_id AND m.status='ACTIVE'
        AND m.starts_at<=timezone('UTC',now()) AND (m.ends_at IS NULL OR m.ends_at>timezone('UTC',now())) AND u.type IN ('CHAPTER','DEPARTMENT'))`)
  const { rows: emailConflicts } = await db.query(`SELECT count(*)::int AS accounts FROM users GROUP BY lower(btrim(email)) HAVING count(*)>1`)
  const { rows: diagnostics } = await db.query(`SELECT
    (SELECT count(*)::int FROM users u WHERE u.role='CHAPTER_LEADER' AND EXISTS(SELECT 1 FROM chapter_members c WHERE c.user_id=u.id) AND NOT EXISTS(SELECT 1 FROM position_assignments a JOIN positions p ON p.id=a.position_id WHERE a.user_id=u.id AND p.code IN ('CHAPTER_LEAD','CHAPTER_MANAGER'))) AS legacy_leads_without_tenure,
    (SELECT count(*)::int FROM position_assignments a JOIN position_assignments b ON a.user_id=b.user_id AND a.id<b.id JOIN positions p ON p.id=a.position_id JOIN positions q ON q.id=b.position_id JOIN users u ON u.id=a.user_id WHERE u.role<>'ADMIN' AND p.code IN ('CHAPTER_LEAD','CHAPTER_MANAGER') AND q.code IN ('CHAPTER_LEAD','CHAPTER_MANAGER') AND (a.ends_at IS NULL OR a.ends_at>timezone('UTC',now())) AND (b.ends_at IS NULL OR b.ends_at>timezone('UTC',now())) AND tsrange(a.starts_at,a.ends_at,'[)') && tsrange(b.starts_at,b.ends_at,'[)')) AS overlapping_lead_tenure_pairs,
    (SELECT count(*)::int FROM users WHERE email<>lower(btrim(email))) AS noncanonical_emails,
    (SELECT count(*)::int FROM organization_memberships WHERE status='ACTIVE' AND (starts_at>timezone('UTC',now()) OR ends_at<=timezone('UTC',now()))) AS active_status_not_current,
    (SELECT count(*)::int FROM chapter_affiliation_intervals h WHERE h.ends_at IS NULL AND NOT EXISTS(SELECT 1 FROM chapter_members c WHERE c.user_id=h.user_id AND c.chapter_id=h.chapter_id)) AS orphan_open_chapter_intervals,
    (SELECT count(*)::int FROM position_assignments a JOIN positions p ON p.id=a.position_id WHERE p.code IN ('CHAPTER_LEAD','CHAPTER_MANAGER') AND a.starts_at<=timezone('UTC',now()) AND (a.ends_at IS NULL OR a.ends_at>timezone('UTC',now()))) AS active_lead_assignments`)
  const { rows: leadCodes } = await db.query("SELECT code,scope,is_manager FROM positions WHERE code ILIKE '%CHAPTER%' ORDER BY code")
  const { rows: triggers } = await db.query("SELECT c.relname AS table_name,t.tgname,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname IN ('users','chapter_members','organization_memberships','position_assignments') ORDER BY c.relname,t.tgname")
  const { rows: indexes } = await db.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename IN ('users','chapter_members','organization_memberships','position_assignments')")
  const { rows: policy } = await db.query("SELECT cutover_at,mapping_approved_at FROM learning_policy WHERE id='default'")
  await db.query('COMMIT')
  const report = {
    ...clock[0], mode: 'READ_ONLY_DRY_RUN',
    summary: { multiChapterLeadAccounts: leadConflicts.length, dualDnaChapterAccounts: affiliationConflicts.length, normalizedEmailCollisionGroups: emailConflicts.length, ...diagnostics[0] },
    leadCodes, leadConflicts, affiliationConflicts, triggers, indexes, policy,
    remediation: { applied: false, approvalRequired: [...leadConflicts, ...affiliationConflicts].map(row => ({ ...row, decision: 'REVIEW_REQUIRED', action: 'Choose intended scope and effective timestamp from evidence; do not guess or rewrite historical stars.' })) },
  }
  await mkdir('docs/security-audit', { recursive: true })
  await writeFile('docs/security-audit/organization-integrity.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ mode: report.mode, ...report.summary, leadCodes, triggers, policy, leadConflicts }))
} catch (error) {
  // Never log connection strings, credentials, real email addresses, or driver stacks.
  console.error(JSON.stringify({ outcome: 'NOT_VERIFIED', code: error.code || error.name }))
  process.exitCode = 1
} finally { await db.end().catch(() => {}) }

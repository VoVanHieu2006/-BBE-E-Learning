import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sql = readFileSync(join(process.cwd(), 'prisma/migrations/20261110_standardize_roles_positions/migration.sql'), 'utf8')

describe('20261110_standardize_roles_positions migration (static checks)', () => {
  it('has balanced dollar quoting and one transaction', () => {
    const tags = sql.match(/\$[A-Za-z_]*\$/g) || []
    assert.equal(tags.length % 2, 0, 'every dollar-quote tag must be closed')
    for (const tag of Array.from(new Set(tags))) assert.equal(tags.filter(t => t === tag).length % 2, 0, `unbalanced ${tag}`)
    assert.equal(sql.match(/^BEGIN;/gm)?.length, 1)
    assert.equal(sql.match(/^COMMIT;/gm)?.length, 1)
  })

  it('renames both role enums and never deletes learning data', () => {
    assert.match(sql, /ALTER TYPE user_role RENAME VALUE 'CHAPTER_LEADER' TO 'LEAD'/)
    assert.match(sql, /ALTER TYPE invitation_role RENAME VALUE 'CHAPTER_LEADER' TO 'LEAD'/)
    assert.doesNotMatch(sql, /\b(TRUNCATE|DROP TABLE)\b/i)
    assert.doesNotMatch(sql, /DELETE FROM (user_learning_assignments|learning_paths|users|position_assignments|organization_memberships)\b/i)
  })

  it('merges every old position code and maps every old target code', () => {
    for (const pair of ["'CHAPTER_MANAGER','CHAPTER_LEAD'", "'DEPARTMENT_LEADER','DEPARTMENT_LEAD'", "'CHAPTER_PRESIDENT','PRESIDENT'", "'MEMBER','DEPARTMENT_MEMBER'"]) assert.ok(sql.includes(pair), pair)
    for (const target of ["'MEMBER_'||code", "'LEADER_'||code", "('CHAPTER_PRESIDENT','PRESIDENT')", "('DNA_TT','DNA_MEMBER_TT')"]) assert.ok(sql.includes(target), target)
    assert.match(sql, /UPDATE organization_units SET code='BDHU'/)
  })

  it('redefines the integrity function with the new names and the one-position rules', () => {
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION assert_organization_integrity'), sql.indexOf('-- Rename or merge position definitions'))
    assert.doesNotMatch(fn, /CHAPTER_LEADER|CHAPTER_MANAGER|DEPARTMENT_LEADER|CHAPTER_PRESIDENT/)
    for (const rule of ['SinglePositionRequired', 'SingleDepartmentRequired', 'PositionRoleMismatch', 'PositionMembershipMismatch']) assert.ok(fn.includes(rule), rule)
  })

  it('blocks MEMBER to LEAD promotion at the database level', () => {
    assert.match(sql, /prevent_member_lead_promotion/)
    assert.match(sql, /OLD\.role='MEMBER' AND NEW\.role='LEAD'/)
  })
})

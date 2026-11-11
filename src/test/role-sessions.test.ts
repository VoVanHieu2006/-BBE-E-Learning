import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { accountHome, canOpenManagerArea, hasCurrentSessionClaims, sessionMatchesAccount } from '../lib/session-role'
import { canHoldPosition } from '../lib/roles'

describe('Canonical role sessions', () => {
  it('rejects missing version, position codes, unknown roles and stale account versions', () => {
    const user = { role: 'LEAD', auth_version: 4 }
    assert.equal(sessionMatchesAccount({ role: 'LEAD', authVersion: 4 }, user), true)
    for (const payload of [{ role: 'LEAD' }, { role: 'DNA_LEAD', authVersion: 4 }, { role: 'obsolete', authVersion: 4 }, { role: 'LEAD', authVersion: 3 }, { role: 'MEMBER', authVersion: 4 }]) {
      assert.equal(sessionMatchesAccount(payload, user), false)
    }
    assert.equal(hasCurrentSessionClaims({ role: 'MEMBER', authVersion: -1 }), false)
  })
  it('routes Chapter and DNA leads to their own management areas', () => {
    assert.equal(accountHome('LEAD', 'LEAD_CHAPTER'), '/chapter-manager/dashboard')
    assert.equal(accountHome('LEAD', 'LEAD_DNA'), '/organization-manager')
    assert.equal(accountHome('ADMIN'), '/admin/dashboard')
    assert.equal(accountHome('MEMBER', 'LEAD_DNA'), '/student/dashboard')
    assert.equal(canOpenManagerArea('CHAPTER', 'LEAD', 'LEAD_DNA'), false)
    assert.equal(canOpenManagerArea('DNA', 'LEAD', 'LEAD_CHAPTER'), false)
    assert.equal(canOpenManagerArea('DNA', 'LEAD', 'LEAD_DNA'), true)
    assert.equal(canOpenManagerArea('CHAPTER', 'MEMBER', 'LEAD_CHAPTER'), false)
  })
  it('cannot promote a learner or appoint a learning position to a manager', () => {
    for (const code of ['CHAPTER_LEAD', 'DNA_LEAD']) {
      assert.equal(canHoldPosition('MEMBER', code), false)
      assert.equal(canHoldPosition('LEAD', code), true)
    }
    for (const code of ['PRESIDENT', 'DEPARTMENT_LEAD', 'DEPARTMENT_MEMBER', 'DNA_MEMBER']) {
      assert.equal(canHoldPosition('MEMBER', code), true)
      assert.equal(canHoldPosition('LEAD', code), false)
      assert.equal(canHoldPosition('ADMIN', code), false)
    }
  })
})

function stub(name: string, exports: unknown) {
  const filename = require.resolve(name)
  require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module
}

describe('Lead kind and invitation regression', () => {
  let existingUser: any = null
  const db = {
    user: { findUnique: async () => existingUser },
    chapterLeadBinding: { findFirst: async () => null },
    organizationUnit: { findFirst: async () => ({ id: 'dna' }) },
    positionAssignment: { findFirst: async () => null },
  }
  it('refuses an existing MEMBER when sending a DNA lead invitation, without mutation or mail', async () => {
    stub('../lib/prisma', { prisma: db })
    stub('../lib/email', { sendInvitationEmail: () => { throw new Error('Must not send') } })
    stub('../lib/learning-assignments', { reconcileLearningAssignmentsForUser: async () => {} })
    existingUser = { id: 'member', role: 'MEMBER', status: 'ACTIVE' }
    const { sendDnaLeaderInvitation } = require('../lib/invitations')
    const result = await sendDnaLeaderInvitation('member@example.test', 'admin')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'LeadInvitationRequiresNewAccount')
  })
  it('does not mistake DNA LEAD for a Chapter lead or deny DNA management', async () => {
    existingUser = { role: 'LEAD', chapter_lead_binding: null, chapter_members: [], position_assignments: [] }
    const { chapterLeadScope } = require('../lib/chapter-lead')
    assert.deepEqual(await chapterLeadScope('dna-lead'), { isLead: false, chapterId: null, conflict: false })
    db.positionAssignment.findFirst = async () => ({ id: 'position', position: { code: 'DNA_LEAD' } }) as any
    const { getLearningManagerKind } = require('../lib/manager-learning-access')
    assert.equal(await getLearningManagerKind('dna-lead', 'LEAD'), 'LEAD_DNA')
    assert.equal(await getLearningManagerKind('member', 'MEMBER'), null)
  })
})

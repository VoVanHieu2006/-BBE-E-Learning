import { it } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
const stub = (name: string, exports: unknown) => { const filename = require.resolve(name); require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module }
const unitId = '00000000-0000-4000-8000-000000000001'
const invitationId = '00000000-0000-4000-8000-000000000002'
let managerType = 'DNA'
let unitType = 'DNA_GROUP'
let mutations = 0
stub('../lib/auth', { authenticate: async () => ({ ok: true, context: { userId: 'lead', role: 'LEAD', ...(managerType === 'CHAPTER' ? { chapterId: 'chapter' } : {}) } }) })
stub('../lib/authorization', {
  canAccessOrganizationUnitPermission: async (_context: unknown, _unit: string, permission: string) => managerType === 'DNA' && ['DNA', 'DNA_GROUP'].includes(unitType) && permission === 'MANAGE_DNA_MEMBERS',
  canAccessChapterPermission: async () => false,
  memberManagementPermission: (type: string) => ['DNA', 'DNA_GROUP'].includes(type) ? 'MANAGE_DNA_MEMBERS' : 'MANAGE_CHAPTER_MEMBERS',
})
stub('../lib/prisma', { prisma: {
  organizationUnit: { findUnique: async () => ({ id: unitId, type: unitType, status: 'ACTIVE' }) },
  invitation: { findUnique: async () => ({ organization_unit_id: unitId }) },
} })
stub('../lib/server-cache', { getInvitationsServerCache: () => null, setInvitationsServerCache: () => {}, invalidateInvitationsServerCache: () => {} })
stub('../lib/invitations', {
  getInvitations: async (input: any) => { assert.equal(input.organizationUnitId, unitId); return { items: [], totalItems: 0 } },
  resendInvitation: async () => { mutations++; return { ok: true, expiresAt: new Date() } },
  cancelInvitation: async () => { mutations++; return { ok: true } },
})
const list = require('../app/api/v1/invitations/route')
const resend = require('../app/api/v1/invitations/[id]/resend/route')
const cancel = require('../app/api/v1/invitations/[id]/route')
it('DNA LEAD can list, resend and cancel using MANAGE_DNA_MEMBERS at DNA and DNA_GROUP scopes', async () => {
  managerType = 'DNA'; mutations = 0
  for (unitType of ['DNA', 'DNA_GROUP']) {
    assert.equal((await list.GET(new NextRequest(`http://localhost/api/v1/invitations?organizationUnitId=${unitId}`))).status, 200)
    assert.equal((await resend.POST(new NextRequest(`http://localhost/api/v1/invitations/${invitationId}/resend`, { method: 'POST' }))).status, 200)
    assert.equal((await cancel.DELETE(new NextRequest(`http://localhost/api/v1/invitations/${invitationId}`, { method: 'DELETE' }))).status, 200)
  }
  assert.equal(mutations, 4)
})
it('Chapter LEAD cannot list, resend or cancel DNA invitations', async () => {
  managerType = 'CHAPTER'; unitType = 'DNA_GROUP'; mutations = 0
  assert.equal((await list.GET(new NextRequest(`http://localhost/api/v1/invitations?organizationUnitId=${unitId}`))).status, 403)
  assert.equal((await resend.POST(new NextRequest(`http://localhost/api/v1/invitations/${invitationId}/resend`, { method: 'POST' }))).status, 403)
  assert.equal((await cancel.DELETE(new NextRequest(`http://localhost/api/v1/invitations/${invitationId}`, { method: 'DELETE' }))).status, 403)
  assert.equal(mutations, 0)
})

import { it } from 'node:test'
import assert from 'node:assert/strict'
const stub = (name: string, exports: unknown) => { const filename = require.resolve(name); require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module }
const unitId = '00000000-0000-4000-8000-000000000001'
let type = 'DNA_GROUP'
let permitted = true
stub('../lib/prisma', { prisma: { organizationUnit: { findUnique: async () => ({ id: unitId, type, status: 'ACTIVE' }) } } })
stub('../lib/authorization', {
  canAccessChapterPermission: async () => false,
  memberManagementPermission: (unitType: string) => unitType === 'DNA_GROUP' ? 'MANAGE_DNA_MEMBERS' : 'MANAGE_CHAPTER_MEMBERS',
  canAccessOrganizationUnitPermission: async (_actor: unknown, id: string, permission: string) => {
    assert.equal(id, unitId)
    assert.equal(permission, type === 'DNA_GROUP' ? 'MANAGE_DNA_MEMBERS' : 'MANAGE_CHAPTER_MEMBERS')
    return permitted
  },
})
const { resolveMemberInviteScope } = require('../lib/member-invite-scope')
it('resolves DNA_GROUP with DNA management permission and rejects parent DNA', async () => {
  const actor = { userId: 'lead', role: 'LEAD' }
  type = 'DNA_GROUP'
  assert.deepEqual(await resolveMemberInviteScope(actor, { organizationUnitId: unitId }), { ok: true, organizationUnitId: unitId })
  type = 'DNA'
  assert.equal((await resolveMemberInviteScope(actor, { organizationUnitId: unitId })).ok, false)
})
it('denies a Chapter actor without permission to the DNA group', async () => {
  type = 'DNA_GROUP'; permitted = false
  const result = await resolveMemberInviteScope({ userId: 'chapter-lead', role: 'LEAD', chapterId: 'chapter' }, { organizationUnitId: unitId })
  assert.equal(result.status, 403)
})

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertCanChangeUserStatus } from '../lib/user-status-rules'

describe('P1 Business Rules: assertCanChangeUserStatus', () => {
  const adminActor = { userId: 'admin-1', role: 'ADMIN' }
  const leadActor = { userId: 'lead-1', role: 'CHAPTER_LEADER', chapterId: 'chap-1' }

  it('Admin can deactivate an active member', () => {
    const target = { id: 'user-1', role: 'MEMBER', status: 'ACTIVE' }
    const result = assertCanChangeUserStatus(adminActor, target, 'INACTIVE')
    assert.equal(result.allowed, true)
  })

  it('Admin can reactivate an inactive member', () => {
    const target = { id: 'user-1', role: 'MEMBER', status: 'INACTIVE' }
    const result = assertCanChangeUserStatus(adminActor, target, 'ACTIVE')
    assert.equal(result.allowed, true)
  })

  it('Admin cannot deactivate another Admin via API', () => {
    const target = { id: 'admin-2', role: 'ADMIN', status: 'ACTIVE' }
    const result = assertCanChangeUserStatus(adminActor, target, 'INACTIVE')
    assert.equal(result.allowed, false)
    assert.equal(result.code, 'InvalidTransition')
  })

  it('Lead Chapter can deactivate an active member in their scope', () => {
    const target = { id: 'user-1', role: 'MEMBER', status: 'ACTIVE' }
    const result = assertCanChangeUserStatus(leadActor, target, 'INACTIVE')
    assert.equal(result.allowed, true)
  })

  it('Lead Chapter CANNOT reactivate an inactive member (Only Admin allowed)', () => {
    const target = { id: 'user-1', role: 'MEMBER', status: 'INACTIVE', deactivated_by_role: 'LEAD', deactivated_by_user_id: 'lead-1' }
    const result = assertCanChangeUserStatus(leadActor, target, 'ACTIVE')
    assert.equal(result.allowed, false)
    assert.equal(result.code, 'AccessDenied')
    assert.match(result.message || '', /Chỉ Admin mới có quyền kích hoạt lại/)
  })

  it('Lead Chapter CANNOT unlock a locked member', () => {
    const target = { id: 'user-1', role: 'MEMBER', status: 'LOCKED' }
    const result = assertCanChangeUserStatus(leadActor, target, 'ACTIVE')
    assert.equal(result.allowed, false)
    assert.equal(result.code, 'AdminUnlockRequired')
  })

  it('Lead Chapter cannot change status of an Admin or another Chapter Leader', () => {
    const adminTarget = { id: 'admin-2', role: 'ADMIN', status: 'ACTIVE' }
    const leadTarget = { id: 'lead-2', role: 'CHAPTER_LEADER', status: 'ACTIVE' }

    assert.equal(assertCanChangeUserStatus(leadActor, adminTarget, 'INACTIVE').allowed, false)
    assert.equal(assertCanChangeUserStatus(leadActor, leadTarget, 'INACTIVE').allowed, false)
  })

  it('Lead Chapter cannot change their own status', () => {
    const selfTarget = { id: 'lead-1', role: 'CHAPTER_LEADER', status: 'ACTIVE' }
    assert.equal(assertCanChangeUserStatus(leadActor, selfTarget, 'INACTIVE').allowed, false)
  })
})

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_EXTENSION_DAYS,
  MAX_LOGIN_ATTEMPTS,
  accountAfterExtension,
  accountAfterPasswordReset,
  deadlineLockExemption,
  failedLoginState,
  isOverdueLocked,
  isPasswordLocked,
  manualExtensionDueAt,
  ordinaryActivationBlock,
  validateExtendDeadlineInput,
} from '../lib/account-restriction-rules'

const USER_ID = '3f1c5a52-6c7e-4c86-9c0a-0d6a2f6d7a11'

describe('Password lock (KHBB 7.2)', () => {
  it('locks on the fifth wrong password and reports the remaining attempts before that', () => {
    assert.equal(MAX_LOGIN_ATTEMPTS, 5)
    assert.deepEqual([1, 2, 3, 4].map((count) => failedLoginState(count)), [
      { failedLoginCount: 1, locked: false, remainingAttempts: 4 },
      { failedLoginCount: 2, locked: false, remainingAttempts: 3 },
      { failedLoginCount: 3, locked: false, remainingAttempts: 2 },
      { failedLoginCount: 4, locked: false, remainingAttempts: 1 },
    ])
    assert.deepEqual(failedLoginState(5), { failedLoginCount: 5, locked: true, remainingAttempts: 0 })
  })

  it('stays locked and never reports negative attempts for counts left over from the old 10-try policy', () => {
    assert.deepEqual(failedLoginState(9), { failedLoginCount: 9, locked: true, remainingAttempts: 0 })
  })

  it('recognises a password lock by status + reason only, never by a time window', () => {
    assert.equal(isPasswordLocked({ status: 'LOCKED', lock_reason: 'PASSWORD_LOCK' }), true)
    assert.equal(isPasswordLocked({ status: 'ACTIVE', lock_reason: 'PASSWORD_LOCK' }), false)
    assert.equal(isPasswordLocked({ status: 'LOCKED', lock_reason: 'OVERDUE_LOCK' }), false)
  })

  it('a correct password reset clears only the password lock', () => {
    assert.deepEqual(accountAfterPasswordReset({ status: 'LOCKED', lock_reason: 'PASSWORD_LOCK' }, false, false), { status: 'ACTIVE', lockReason: null })
  })

  it('a password reset never opens an overdue lock, with or without a restriction row', () => {
    assert.deepEqual(accountAfterPasswordReset({ status: 'LOCKED', lock_reason: 'PASSWORD_LOCK' }, true, true), { status: 'LOCKED', lockReason: 'OVERDUE_LOCK' })
    assert.deepEqual(accountAfterPasswordReset({ status: 'LOCKED', lock_reason: 'OVERDUE_LOCK' }, false, false), { status: 'LOCKED', lockReason: 'OVERDUE_LOCK' })
  })

  it('a password reset keeps other restrictions and INACTIVE accounts as they are', () => {
    assert.deepEqual(accountAfterPasswordReset({ status: 'LOCKED', lock_reason: 'PASSWORD_LOCK' }, false, true), { status: 'LOCKED', lockReason: null })
    assert.deepEqual(accountAfterPasswordReset({ status: 'INACTIVE', lock_reason: 'PASSWORD_LOCK' }, false, false), { status: 'INACTIVE', lockReason: null })
  })
})

describe('Overdue lock (KHBB 7.1, 7.3)', () => {
  it('detects an overdue lock from an open DEADLINE restriction or from lock_reason', () => {
    assert.equal(isOverdueLocked({ status: 'LOCKED', lock_reason: null }, ['DEADLINE']), true)
    assert.equal(isOverdueLocked({ status: 'LOCKED', lock_reason: 'OVERDUE_LOCK' }, []), true)
    assert.equal(isOverdueLocked({ status: 'ACTIVE', lock_reason: null }, []), false)
    assert.equal(isOverdueLocked({ status: 'LOCKED', lock_reason: 'PASSWORD_LOCK' }, ['DIRECT_ADMIN']), false)
  })

  it('exempts Admin, LEAD (role or position) and INACTIVE accounts, and nobody else', () => {
    assert.equal(deadlineLockExemption({ role: 'ADMIN', status: 'ACTIVE' }), 'ADMIN')
    assert.equal(deadlineLockExemption({ role: 'LEAD', status: 'ACTIVE' }), 'LEAD')
    assert.equal(deadlineLockExemption({ role: 'MEMBER', status: 'ACTIVE' }, ['DNA_LEAD']), 'LEAD')
    assert.equal(deadlineLockExemption({ role: 'MEMBER', status: 'INACTIVE' }), 'INACTIVE')
    assert.equal(deadlineLockExemption({ role: 'MEMBER', status: 'ACTIVE' }, ['DEPARTMENT_LEAD_BKM']), null)
    assert.equal(deadlineLockExemption({ role: 'MEMBER', status: 'LOCKED' }), null, 'an already locked learner still gets the DEADLINE record')
  })

  it('gives the ordinary activation button no way to open an overdue or a password lock', () => {
    assert.equal(ordinaryActivationBlock({ status: 'LOCKED', lock_reason: null }, ['DEADLINE'])?.code, 'OverdueUnlockRequiresExtension')
    assert.equal(ordinaryActivationBlock({ status: 'LOCKED', lock_reason: 'OVERDUE_LOCK' }, [])?.code, 'OverdueUnlockRequiresExtension')
    assert.equal(ordinaryActivationBlock({ status: 'LOCKED', lock_reason: 'PASSWORD_LOCK' }, [])?.code, 'PasswordResetRequired')
    assert.equal(ordinaryActivationBlock({ status: 'LOCKED', lock_reason: null }, ['DIRECT_ADMIN']), null)
    assert.equal(ordinaryActivationBlock({ status: 'INACTIVE', lock_reason: null }, []), null)
  })

  it('after an extension the account is opened only if nothing else locks it', () => {
    assert.deepEqual(accountAfterExtension({ status: 'LOCKED', lock_reason: 'OVERDUE_LOCK' }, 0), { status: 'ACTIVE', lockReason: null })
    assert.deepEqual(accountAfterExtension({ status: 'LOCKED', lock_reason: 'PASSWORD_LOCK' }, 0), { status: 'LOCKED', lockReason: 'PASSWORD_LOCK' }, 'both locks: extend first, then mail')
    assert.deepEqual(accountAfterExtension({ status: 'LOCKED', lock_reason: 'OVERDUE_LOCK' }, 1), { status: 'LOCKED', lockReason: null })
    assert.deepEqual(accountAfterExtension({ status: 'INACTIVE', lock_reason: 'OVERDUE_LOCK' }, 0), { status: 'INACTIVE', lockReason: null })
  })
})

describe('Extend-deadline input (KHBB 5.5)', () => {
  const ok = { extensionDays: 7, reason: 'Học viên nghỉ ốm' }
  const fails = (userId: unknown, body: unknown) => {
    const result = validateExtendDeadlineInput(userId, body)
    assert.equal(result.ok, false)
    return result.ok ? null : result.error
  }

  it('accepts a whole number of days from 1 to 365 with a reason, and trims the reason', () => {
    for (const extensionDays of [1, 7, MAX_EXTENSION_DAYS]) {
      assert.deepEqual(validateExtendDeadlineInput(USER_ID, { ...ok, extensionDays }), { ok: true, extensionDays, reason: ok.reason })
    }
    assert.deepEqual(validateExtendDeadlineInput(USER_ID, { ...ok, reason: '  cần thêm thời gian  ' }), { ok: true, extensionDays: 7, reason: 'cần thêm thời gian' })
  })

  it('rejects every out-of-range or non-integer day count with a 400 (the backend cap, not only the UI)', () => {
    for (const extensionDays of [0, -1, 366, 1000, 1.5, NaN, Infinity, '7', null, undefined]) {
      const error = fails(USER_ID, { ...ok, extensionDays })
      assert.equal(error?.status, 400)
      assert.equal(error?.code, 'ValidationError')
    }
  })

  it('requires a reason', () => {
    for (const reason of [undefined, null, '', '   ', 5]) assert.equal(fails(USER_ID, { extensionDays: 7, reason })?.code, 'ReasonRequired')
    assert.equal(fails(USER_ID, { extensionDays: 7, reason: 'x'.repeat(501) })?.code, 'ValidationError')
  })

  it('rejects a malformed userId and a missing or non-object body without throwing', () => {
    for (const userId of ['abc', '', undefined, '3f1c5a52-6c7e-4c86-9c0a', `${USER_ID}; DROP TABLE users`]) assert.equal(fails(userId, ok)?.code, 'InvalidUserId')
    for (const body of [null, undefined, 'x', 7, [] as unknown]) assert.equal(fails(USER_ID, body)?.status, 400)
  })

  it('computes the new deadline from today, never from the old one: today + N days', () => {
    const today = new Date('2026-05-20T10:00:00.000Z')
    assert.equal(manualExtensionDueAt(today, 7).toISOString(), '2026-05-27T10:00:00.000Z')
    assert.equal(manualExtensionDueAt(today, 3).toISOString(), '2026-05-23T10:00:00.000Z')
  })
})

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import { ExtendDeadlineError, extendOverdueLock } from '../lib/deadline-extension'

const USER_ID = '3f1c5a52-6c7e-4c86-9c0a-0d6a2f6d7a11'
const ADMIN_ID = '8a6d2b1c-0f3e-4a57-8d11-2c9e5b7f4a22'
const NOW = new Date('2026-05-20T10:00:00.000Z')
const DAY = 86_400_000

interface Options {
  exists?: boolean
  user?: Partial<{ status: string; lock_reason: string | null; anonymized_at: Date | null }>
  restrictions?: string[]
  cycle?: boolean
  path?: boolean
}

/** In-memory transaction double that records every write, and serializes like the real FOR UPDATE lock. */
function fakeTx(options: Options = {}) {
  const state = {
    user: { id: USER_ID, status: 'LOCKED', lock_reason: 'OVERDUE_LOCK', anonymized_at: null as Date | null, ...options.user },
    restrictions: (options.restrictions ?? ['DEADLINE']).map((type) => ({ type, lifted: false })),
    writes: [] as string[],
    pathUpdate: null as { due_at: Date } | null,
    pathChanges: [] as { reason: string; due_at: Date }[],
    assignmentUpdates: [] as unknown[],
    audits: [] as { metadata: Record<string, unknown> }[],
    userUpdates: [] as Record<string, unknown>[],
  }
  const tx = {
    $queryRaw: async () => (options.exists === false ? [] : [{ id: USER_ID }]),
    user: {
      findUniqueOrThrow: async () => ({ ...state.user }),
      update: async ({ data }: { data: Record<string, unknown> }) => { state.userUpdates.push(data); Object.assign(state.user, { status: data.status, lock_reason: data.lock_reason }); return {} },
    },
    accessRestriction: {
      findMany: async () => state.restrictions.filter((row) => !row.lifted).map((row) => ({ type: row.type })),
      updateMany: async ({ where }: { where: { type: string } }) => { state.writes.push('lift'); state.restrictions.forEach((row) => { if (row.type === where.type) row.lifted = true }); return { count: 1 } },
    },
    learningCycle: { findFirst: async () => (options.cycle === false ? null : { id: 'cycle' }) },
    learningPath: {
      findUnique: async () => (options.path === false ? null : { id: 'path', budget: [], due_at: new Date(NOW.getTime() - 15 * DAY) }),
      update: async ({ data }: { data: { due_at: Date } }) => { state.pathUpdate = data; return {} },
    },
    learningPathChange: { create: async ({ data }: { data: { reason: string; due_at: Date } }) => { state.pathChanges.push(data); return {} } },
    userLearningAssignment: { updateMany: async (args: unknown) => { state.assignmentUpdates.push(args); return { count: 2 } } },
    auditLog: { create: async ({ data }: { data: { metadata: Record<string, unknown> } }) => { state.audits.push(data); return {} } },
  } as unknown as Prisma.TransactionClient
  const run = (extensionDays = 7, reason = 'Học viên nghỉ ốm') => extendOverdueLock(tx, { userId: USER_ID, adminId: ADMIN_ID, extensionDays, reason, now: () => NOW })
  return { state, run }
}

const rejects = async (promise: Promise<unknown>, status: number, code: string) => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ExtendDeadlineError, 'a business error, so the route answers 4xx instead of 500')
    assert.equal(error.status, status)
    assert.equal(error.code, code)
    return true
  })
}

describe('extendOverdueLock (Mở khóa & Gia hạn)', () => {
  it('sets the new deadline to today + N days, ignoring the old (expired) one', async () => {
    const f = fakeTx()
    const result = await f.run(7)
    assert.equal(result.newDueAt.getTime(), NOW.getTime() + 7 * DAY)
    assert.equal(f.state.pathUpdate?.due_at.getTime(), NOW.getTime() + 7 * DAY)
    assert.deepEqual(f.state.pathChanges.map((row) => row.reason), ['ADMIN_MANUAL_EXTENSION'])
    assert.equal(f.state.assignmentUpdates.length, 1, 'unfinished assignments go back to IN_PROGRESS')
    assert.equal(f.state.audits[0].metadata.extensionDays, 7)
    assert.equal(f.state.audits[0].metadata.reason, 'Học viên nghỉ ốm')
  })

  it('lifts the DEADLINE restriction and opens an account whose only cause was the overdue lock', async () => {
    const f = fakeTx()
    const result = await f.run()
    assert.equal(result.accountStatus, 'ACTIVE')
    assert.equal(result.accountLockReason, null)
    assert.equal(f.state.restrictions[0].lifted, true)
  })

  it('does not open an account that also has a password lock: extend first, then send the reset mail', async () => {
    const f = fakeTx({ user: { lock_reason: 'PASSWORD_LOCK' } })
    const result = await f.run()
    assert.equal(result.accountStatus, 'LOCKED')
    assert.equal(result.accountLockReason, 'PASSWORD_LOCK')
    assert.equal(f.state.restrictions[0].lifted, true, 'the overdue cause itself is still lifted')
  })

  it('keeps an account locked while another restriction is open, and keeps INACTIVE accounts INACTIVE', async () => {
    assert.equal((await fakeTx({ restrictions: ['DEADLINE', 'DIRECT_ADMIN'] }).run()).accountStatus, 'LOCKED')
    assert.equal((await fakeTx({ user: { status: 'INACTIVE' } }).run()).accountStatus, 'INACTIVE')
  })

  it('refuses a learner who is not overdue-locked with 409 NotOverdueLocked, writing nothing', async () => {
    for (const options of [
      { user: { status: 'ACTIVE', lock_reason: null }, restrictions: [] },
      { user: { status: 'LOCKED', lock_reason: 'PASSWORD_LOCK' }, restrictions: [] },
      { user: { status: 'LOCKED', lock_reason: null }, restrictions: ['DIRECT_ADMIN'] },
    ] as Options[]) {
      const f = fakeTx(options)
      await rejects(f.run(), 409, 'NotOverdueLocked')
      assert.equal(f.state.pathUpdate, null)
      assert.equal(f.state.pathChanges.length, 0)
      assert.equal(f.state.audits.length, 0)
    }
  })

  it('answers 4xx, not a thrown 500, for an unknown user, an anonymized user, no cycle and no path', async () => {
    await rejects(fakeTx({ exists: false }).run(), 404, 'UserNotFound')
    await rejects(fakeTx({ user: { anonymized_at: NOW } }).run(), 409, 'AccountRetired')
    await rejects(fakeTx({ cycle: false }).run(), 409, 'NoActiveLearningCycle')
    await rejects(fakeTx({ path: false }).run(), 409, 'NoActiveLearningPath')
  })

  it('a double click adds the days once: the second call sees the lock already lifted', async () => {
    const f = fakeTx()
    await f.run(7)
    const firstDue = f.state.pathUpdate?.due_at.getTime()
    await rejects(f.run(7), 409, 'NotOverdueLocked')
    assert.equal(f.state.pathUpdate?.due_at.getTime(), firstDue, 'the deadline did not move again')
    assert.equal(f.state.pathChanges.length, 1)
    assert.equal(f.state.audits.length, 1)
  })
})

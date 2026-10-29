import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateChapterTransferEligibility } from '../lib/chapter-term-rules'
import { chapterRewardState } from '../lib/chapter-reward-gate'

const season = {
  id: '2026-OCT',
  starts_at: new Date('2026-07-01T00:00:00+07:00'),
  ends_at: new Date('2027-01-01T00:00:00+07:00'),
  reward_boundary_at: new Date('2026-10-01T00:00:00+07:00'),
}

test('initial Chapter remains due but earns stars after the boundary until first successful transfer', () => {
  const result = evaluateChapterTransferEligibility({
    at: new Date('2026-10-26T12:00:00+07:00'),
    candidateSeason: season,
    appliedTransfers: [],
  })
  assert.equal(result.status, 'TRANSFER_OVERDUE')
  assert.equal(result.eligibleForSeason, true)
  assert.equal(result.paused, false)
})

test('previously transferred Chapter pauses after boundary; scheduling does not resume awards', () => {
  const result = evaluateChapterTransferEligibility({
    at: new Date('2026-10-26T12:00:00+07:00'),
    candidateSeason: season,
    appliedTransfers: [{ effective_at: new Date('2026-06-10T10:00:00+07:00'), applied_at: new Date('2026-06-10T10:00:00+07:00') }],
    scheduledInWindow: { effective_at: new Date('2026-10-30T00:00:00+07:00') },
  })
  assert.equal(result.paused, true)
  assert.equal(result.status, 'TRANSFER_OVERDUE')
  assert.equal(result.reason, 'CHAPTER_TRANSFER_OVERDUE')
})

test('September 10 application stays open across September 30', () => {
  const result = evaluateChapterTransferEligibility({
    at: new Date('2026-10-26T12:00:00+07:00'),
    candidateSeason: season,
    appliedTransfers: [{ effective_at: new Date('2026-09-10T10:00:00+07:00'), applied_at: new Date('2026-09-10T10:00:00+07:00') }],
  })
  assert.equal(result.paused, false)
  assert.equal(result.status, 'TRANSFER_APPLIED')
})

test('December Chapter can transfer in the April window with no six-month waiting period', () => {
  const spring = {
    id: '2026-APR',
    starts_at: new Date('2026-01-01T00:00:00+07:00'),
    ends_at: new Date('2026-07-01T00:00:00+07:00'),
    reward_boundary_at: new Date('2026-04-01T00:00:00+07:00'),
  }
  const result = evaluateChapterTransferEligibility({
    at: new Date('2026-04-15T00:00:00+07:00'),
    candidateSeason: spring,
    appliedTransfers: [],
  })
  assert.equal(result.status, 'TRANSFER_OVERDUE')
  assert.equal(result.paused, false)
  assert.equal(result.eligibleForSeason, true)
})

test('a transfer for the next window applied early counts once that window starts', () => {
  const spring = {
    id: '2027-APR',
    starts_at: new Date('2027-01-01T00:00:00+07:00'),
    ends_at: new Date('2027-07-01T00:00:00+07:00'),
    reward_boundary_at: new Date('2027-04-01T00:00:00+07:00'),
  }
  const result = evaluateChapterTransferEligibility({
    at: new Date('2027-04-15T00:00:00+07:00'),
    candidateSeason: spring,
    // Effective time belongs to the January–June window, but the row was
    // applied early in December. It must still close that window's pause.
    appliedTransfers: [{
      effective_at: new Date('2027-01-10T10:00:00+07:00'),
      applied_at: new Date('2026-12-20T10:00:00+07:00'),
    }],
  })
  assert.equal(result.status, 'TRANSFER_APPLIED')
  assert.equal(result.paused, false)
})

test('successful early September application immediately opens awards before October boundary', async () => {  const tx = {
    learningPolicy: { findUnique: async () => ({ cutover_at: new Date('2026-01-01'), mapping_approved_at: new Date('2026-01-01') }) },
    organizationMembership: { count: async () => 0 },
    chapterMember: { findUnique: async () => ({ chapter_id: 'c' }) },
    chapter: { findUnique: async () => ({ id: 'c', created_at: new Date('2025-06-01') }) },
    transferSeason: { findMany: async () => [season] },
    chapterReorganization: {
      findMany: async () => [{ effective_at: new Date('2026-09-10T12:00:00+07:00'), applied_at: new Date('2026-09-10T12:00:00+07:00') }],
      findFirst: async () => null,
    },
  }
  const state = await chapterRewardState(tx as any, 'member', new Date('2026-09-15T00:00:00+07:00'))
  assert.equal(state.paused, false)
  assert.equal(state.status, 'TRANSFER_APPLIED')
  assert.equal(state.seasonReason, 'OK')
})

test('a missing season never pauses a Chapter that has not transferred yet', async () => {
  const tx = {
    learningPolicy: { findUnique: async () => ({ cutover_at: new Date('2026-01-01'), mapping_approved_at: new Date('2026-01-01') }) },
    organizationMembership: { count: async () => 0 },
    chapterMember: { findUnique: async () => ({ chapter_id: 'c' }) },
    chapter: { findUnique: async () => ({ id: 'c', created_at: new Date('2025-06-01') }) },
    transferSeason: { findMany: async () => [] },
    chapterReorganization: { findMany: async () => [], findFirst: async () => null },
  }
  const state = await chapterRewardState(tx as any, 'member', new Date('2026-10-26T00:00:00+07:00'))
  assert.equal(state.paused, false)
  assert.equal(state.seasonReason, 'SEASON_NOT_CONFIGURED')
})

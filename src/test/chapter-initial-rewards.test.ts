import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateChapterTransferEligibility } from '../lib/chapter-term-rules'
import { chapterRewardState } from '../lib/chapter-reward-gate'

const season = { id: 'fall', starts_at: new Date('2026-09-01T00:00:00+07:00'), ends_at: new Date('2026-11-01T00:00:00+07:00'), reward_boundary_at: new Date('2026-10-01T00:00:00+07:00') }
test('initial Chapter remains due but earns stars after the boundary until first successful transfer', () => {
  const result = evaluateChapterTransferEligibility({ chapterCreatedAt: new Date('2025-06-01T00:00:00+07:00'), at: new Date('2026-10-26T12:00:00+07:00'), candidateSeason: season, hasPriorAppliedReorg: false })
  assert.equal(result.status, 'TRANSFER_OVERDUE')
  assert.equal(result.eligibleForSeason, true)
  assert.equal(result.paused, false)
})
test('previously transferred Chapter pauses after boundary; scheduling does not resume awards', () => {
  const result = evaluateChapterTransferEligibility({ chapterCreatedAt: new Date('2025-06-01'), at: new Date('2026-10-26'), candidateSeason: season, hasPriorAppliedReorg: true, scheduledReorgThisSeason: { effective_at: new Date('2026-10-30') } })
  assert.equal(result.paused, true)
})
test('September 10 application stays open across September 30', () => {
  const result = evaluateChapterTransferEligibility({ chapterCreatedAt: new Date('2025-06-01'), at: new Date('2026-10-26'), candidateSeason: season, hasPriorAppliedReorg: true, appliedReorgThisSeason: { applied_at: new Date('2026-09-10') } })
  assert.equal(result.paused, false)
})
test('December Chapter skips March window even when it reaches six months later', () => {
  const result = evaluateChapterTransferEligibility({ chapterCreatedAt: new Date('2025-12-01T00:00:00+07:00'), at: new Date('2026-04-15T00:00:00+07:00'), candidateSeason: { ...season, starts_at: new Date('2026-03-01T00:00:00+07:00'), reward_boundary_at: new Date('2026-04-01T00:00:00+07:00') }, hasPriorAppliedReorg: false })
  assert.equal(result.status, 'INITIAL_SEASON_SKIPPED'); assert.equal(result.paused, false)
})
test('successful early September application immediately opens awards before October boundary', async () => {
  const spring = { id: 'spring', starts_at: new Date('2026-03-01T00:00:00+07:00'), ends_at: new Date('2026-05-01T00:00:00+07:00'), reward_boundary_at: new Date('2026-04-01T00:00:00+07:00') }
  const tx = {
    learningPolicy: { findUnique: async () => ({ cutover_at: new Date('2026-01-01'), mapping_approved_at: new Date('2026-01-01') }) },
    organizationMembership: { count: async () => 0 }, chapterMember: { findUnique: async () => ({ chapter_id: 'c' }) }, chapter: { findUnique: async () => ({ id: 'c', created_at: new Date('2025-06-01') }) },
    transferSeason: { findUnique: async () => spring },
    chapterReorganization: { findFirst: async ({where}: any) => where.status === 'SCHEDULED' || where.transfer_season_id === 'spring' ? null : ({ id: 'applied-fall', applied_at: new Date('2026-09-10T12:00:00+07:00') }) },
  }
  assert.equal((await chapterRewardState(tx as any, 'member', new Date('2026-09-15T00:00:00+07:00'))).paused, false)
})

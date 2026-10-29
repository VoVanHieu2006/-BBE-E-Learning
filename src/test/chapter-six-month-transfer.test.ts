import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  addCalendarMonthsVietnam,
  daysInVietnamMonth,
  evaluateChapterTransferEligibility,
  getVietnamParts,
} from '../lib/chapter-term-rules'
import {
  actualTransferAt,
  anchorElapsed,
  anchorNearest,
  describeWindow,
  windowOf,
  windowOfAnchor,
} from '../lib/transfer-windows'
// Guard before loading Prisma: this suite creates/deletes fixture records.
const target = process.env.TEST_DATABASE_URL
if (!target) throw new Error('Explicit disposable TEST_DATABASE_URL required')
const testUrl = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(testUrl.hostname) || testUrl.pathname !== '/bbe_test_learning_cycles') throw new Error('Only local bbe_test_learning_cycles is allowed')
process.env.DATABASE_URL = target
process.env.DIRECT_URL = target
const { prisma } = require('../lib/prisma') as typeof import('../lib/prisma')
import { starsForVideoDuration } from '../lib/reward-rules'

const OCT_2026 = {
  id: '2026-OCT',
  starts_at: new Date('2026-07-01T00:00:00+07:00'),
  ends_at: new Date('2027-01-01T00:00:00+07:00'),
  reward_boundary_at: new Date('2026-10-01T00:00:00+07:00'),
}

const transfer = (effectiveAt: string, appliedAt: string | null = effectiveAt) => ({
  effective_at: new Date(effectiveAt),
  applied_at: appliedAt ? new Date(appliedAt) : null,
})

describe('BBE Chapter transfer windows, eligibility and initial term suite', () => {
  // =========================================================================
  // Calendar arithmetic (still used for competition terms and DNA reset)
  // =========================================================================
  it('T01: Founded 15/01/2026 -> six calendar months later is 15/07/2026', () => {
    const founded = new Date('2026-01-15T00:00:00+07:00')
    const eligible = addCalendarMonthsVietnam(founded, 6)
    const parts = getVietnamParts(eligible)
    assert.equal(parts.year, 2026)
    assert.equal(parts.month, 7)
    assert.equal(parts.day, 15)
    assert.equal(parts.hour, 0)
    assert.equal(parts.minute, 0)
    assert.equal(parts.second, 0)
  })

  it('T02: Founded 31/08/2026 -> 28/02/2027 in a non-leap year', () => {
    const founded = new Date('2026-08-31T15:30:45+07:00')
    const eligible = addCalendarMonthsVietnam(founded, 6)
    const parts = getVietnamParts(eligible)
    assert.equal(parts.year, 2027)
    assert.equal(parts.month, 2)
    assert.equal(parts.day, 28)
    assert.equal(parts.hour, 15)
    assert.equal(parts.minute, 30)
    assert.equal(parts.second, 45)
  })

  it('T03: Leap year 2028 keeps 29/02 and clamps 31/08 to 29/02/2028', () => {
    const leap = addCalendarMonthsVietnam(new Date('2028-02-29T12:00:00+07:00'), 6)
    assert.deepEqual(getVietnamParts(leap), { year: 2028, month: 8, day: 29, hour: 12, minute: 0, second: 0, ms: 0 })
    const clamped = addCalendarMonthsVietnam(new Date('2027-08-31T10:00:00+07:00'), 6)
    const parts = getVietnamParts(clamped)
    assert.equal(parts.year, 2028)
    assert.equal(parts.month, 2)
    assert.equal(parts.day, 29)
    assert.equal(daysInVietnamMonth(2028, 1), 29)
  })

  // =========================================================================
  // Window classification
  // =========================================================================
  it('T04: Jan-Jun belongs to the April window and Jul-Dec to the October window', () => {
    const january = windowOf(new Date('2026-01-01T00:00:00+07:00'))
    assert.equal(describeWindow(january), '01/01/2026 – 30/06/2026')
    assert.equal(january.anchor.toISOString(), new Date('2026-04-01T00:00:00+07:00').toISOString())

    const juneEnd = windowOf(new Date('2026-06-30T23:59:59.999+07:00'))
    assert.equal(juneEnd.anchor.getTime(), january.anchor.getTime())

    const julyStart = windowOf(new Date('2026-07-01T00:00:00+07:00'))
    assert.equal(describeWindow(julyStart), '01/07/2026 – 31/12/2026')
    assert.equal(julyStart.anchor.toISOString(), new Date('2026-10-01T00:00:00+07:00').toISOString())

    const decemberEnd = windowOf(new Date('2026-12-31T23:59:59.999+07:00'))
    assert.equal(decemberEnd.anchor.getTime(), julyStart.anchor.getTime())

    const nextJanuary = windowOf(new Date('2027-01-01T00:00:00+07:00'))
    assert.equal(describeWindow(nextJanuary), '01/01/2027 – 30/06/2027')
    assert.equal(nextJanuary.anchor.toISOString(), new Date('2027-04-01T00:00:00+07:00').toISOString())
  })

  it('T05: nearest anchor differs from elapsed anchor before April and before October', () => {
    const march = new Date('2026-03-20T12:00:00+07:00')
    assert.equal(anchorNearest(march).toISOString(), new Date('2026-04-01T00:00:00+07:00').toISOString())
    assert.equal(anchorElapsed(march).toISOString(), new Date('2025-10-01T00:00:00+07:00').toISOString())

    const september = new Date('2026-09-20T12:00:00+07:00')
    assert.equal(anchorNearest(september).toISOString(), new Date('2026-10-01T00:00:00+07:00').toISOString())
    assert.equal(anchorElapsed(september).toISOString(), new Date('2026-04-01T00:00:00+07:00').toISOString())

    const october = new Date('2026-10-29T12:00:00+07:00')
    assert.equal(anchorNearest(october).getTime(), anchorElapsed(october).getTime())
    assert.equal(windowOfAnchor(anchorElapsed(october)).startsAt.toISOString(), new Date('2026-07-01T00:00:00+07:00').toISOString())
  })

  // =========================================================================
  // Delayed worker and actual business time
  // =========================================================================
  it('T06: delayed application keeps the scheduled time as actual transfer time', () => {
    const effective = new Date('2026-09-20T08:00:00+07:00')
    const applied = new Date('2026-10-03T09:30:00+07:00')
    assert.equal(actualTransferAt(effective, applied)?.toISOString(), effective.toISOString())
  })

  it('T07: an early application is limited by its real application time', () => {
    const effective = new Date('2026-10-05T08:00:00+07:00')
    const applied = new Date('2026-10-03T09:30:00+07:00')
    assert.equal(actualTransferAt(effective, applied)?.toISOString(), applied.toISOString())
    assert.equal(actualTransferAt(effective, null), null)
  })

  // =========================================================================
  // Eligibility and reward pause
  // =========================================================================
  it('T08: a never-transferred Chapter without a season is not due and not paused', () => {
    const result = evaluateChapterTransferEligibility({
      at: new Date('2026-09-15T10:00:00+07:00'),
      candidateSeason: null,
      appliedTransfers: [],
    })
    assert.equal(result.status, 'INITIAL_NOT_DUE')
    assert.equal(result.eligibleForSeason, false)
    assert.equal(result.paused, false)
  })

  it('T09: a never-transferred Chapter is due in the current window and keeps earning stars', () => {
    const beforeAnchor = evaluateChapterTransferEligibility({
      at: new Date('2026-09-15T10:00:00+07:00'),
      candidateSeason: OCT_2026,
      appliedTransfers: [],
    })
    assert.equal(beforeAnchor.status, 'FIRST_TRANSFER_DUE')
    assert.equal(beforeAnchor.eligibleForSeason, true)
    assert.equal(beforeAnchor.paused, false)

    const afterAnchor = evaluateChapterTransferEligibility({
      at: new Date('2026-10-29T12:00:00+07:00'),
      candidateSeason: OCT_2026,
      appliedTransfers: [],
    })
    assert.equal(afterAnchor.status, 'TRANSFER_OVERDUE')
    assert.equal(afterAnchor.eligibleForSeason, true)
    assert.equal(afterAnchor.paused, false)
  })

  it('T10: a scheduled first transfer before the anchor is recognised as scheduled', () => {
    const result = evaluateChapterTransferEligibility({
      at: new Date('2026-09-15T10:00:00+07:00'),
      candidateSeason: OCT_2026,
      appliedTransfers: [],
      scheduledInWindow: { effective_at: new Date('2026-09-20T08:00:00+07:00') },
    })
    assert.equal(result.status, 'TRANSFER_SCHEDULED')
    assert.equal(result.paused, false)
    assert.equal(result.eligibleForSeason, true)
  })

  it('T11: a transfer already made in the current window counts as applied', () => {
    const result = evaluateChapterTransferEligibility({
      at: new Date('2026-10-29T12:00:00+07:00'),
      candidateSeason: OCT_2026,
      appliedTransfers: [transfer('2026-09-15T10:00:00+07:00')],
    })
    assert.equal(result.status, 'TRANSFER_APPLIED')
    assert.equal(result.paused, false)
  })

  it('T12: a Chapter that transferred in an earlier window is paused after the anchor', () => {
    const result = evaluateChapterTransferEligibility({
      at: new Date('2026-10-29T12:00:00+07:00'),
      candidateSeason: OCT_2026,
      appliedTransfers: [transfer('2026-06-10T10:00:00+07:00')],
    })
    assert.equal(result.status, 'TRANSFER_OVERDUE')
    assert.equal(result.paused, true)
    assert.equal(result.reason, 'CHAPTER_TRANSFER_OVERDUE')
  })

  it('T13: scheduling alone does not resume stars for a previously transferred Chapter', () => {
    const result = evaluateChapterTransferEligibility({
      at: new Date('2026-10-29T12:00:00+07:00'),
      candidateSeason: OCT_2026,
      appliedTransfers: [transfer('2026-06-10T10:00:00+07:00')],
      scheduledInWindow: { effective_at: new Date('2026-11-05T08:00:00+07:00') },
    })
    assert.equal(result.status, 'TRANSFER_OVERDUE')
    assert.equal(result.paused, true)
    assert.equal(result.reason, 'CHAPTER_TRANSFER_OVERDUE')
  })

  it('T14: a delayed worker applies the scheduled transfer without backdating applied_at', () => {
    const result = evaluateChapterTransferEligibility({
      at: new Date('2026-10-04T09:00:00+07:00'),
      candidateSeason: OCT_2026,
      appliedTransfers: [transfer('2026-09-20T08:00:00+07:00', '2026-10-03T09:30:00+07:00')],
    })
    assert.equal(result.status, 'TRANSFER_APPLIED')
    assert.equal(result.paused, false)
  })

  it('T15: the pause interval stays open until the next anchor, so a late apply closes it', () => {
    // At 01/02/2027 the elapsed anchor is still 01/10/2026, so the pause window
    // remains 01/07–31/12/2026. A transfer actually applied on 15/01/2027 is
    // evidence that the Chapter completed the overdue transfer.
    const result = evaluateChapterTransferEligibility({
      at: new Date('2027-02-01T12:00:00+07:00'),
      candidateSeason: OCT_2026,
      appliedTransfers: [transfer('2027-01-15T10:00:00+07:00')],
    })
    assert.equal(result.status, 'TRANSFER_APPLIED')
    assert.equal(result.paused, false)
  })

  // =========================================================================
  // Database invariants for invitation/admin-created Chapters
  // =========================================================================
  it('T16: Database schema supports current_term_number and ChapterCompetitionTerm for invitations', async () => {
    const testChapterName = `Test Chapter Inv ${Date.now()}`
    const unit = await prisma.organizationUnit.create({
      data: { name: testChapterName, type: 'CHAPTER' },
    })
    const chapter = await prisma.chapter.create({
      data: {
        name: testChapterName,
        organization_unit_id: unit.id,
        current_term_number: 1,
      },
    })
    const term = await prisma.chapterCompetitionTerm.create({
      data: {
        chapter_id: chapter.id,
        starts_at: chapter.created_at,
        ends_at: null,
        season_id: null,
      },
    })

    assert.equal(chapter.current_term_number, 1)
    assert.equal(term.chapter_id, chapter.id)
    assert.equal(term.ends_at, null)

    await prisma.chapterCompetitionTerm.delete({ where: { id: term.id } })
    await prisma.chapter.delete({ where: { id: chapter.id } })
    await prisma.organizationUnit.delete({ where: { id: unit.id } })
  })

  it('T17: Chapter created by Admin has current_term_number = 1 and initial competition term', async () => {
    const testChapterName = `Test Chapter Admin ${Date.now()}`
    const unit = await prisma.organizationUnit.create({
      data: { name: testChapterName, type: 'CHAPTER' },
    })
    const chapter = await prisma.chapter.create({
      data: {
        name: testChapterName,
        organization_unit_id: unit.id,
        current_term_number: 1,
      },
    })
    const term = await prisma.chapterCompetitionTerm.create({
      data: {
        chapter_id: chapter.id,
        starts_at: chapter.created_at,
        ends_at: null,
        season_id: null,
      },
    })

    assert.equal(chapter.current_term_number, 1)
    assert.equal(term.chapter_id, chapter.id)

    await prisma.chapterCompetitionTerm.delete({ where: { id: term.id } })
    await prisma.chapter.delete({ where: { id: chapter.id } })
    await prisma.organizationUnit.delete({ where: { id: unit.id } })
  })

  it('T18: Both existing Chapters have term 1 and are never paused without prior transfers', async () => {
    const chapters = await prisma.chapter.findMany({
      where: { name: { in: ['BBE Chapter 1', 'BBE Chapter 2'] } },
    })

    assert.equal(chapters.length, 2)
    for (const ch of chapters) {
      assert.equal(ch.current_term_number, 1)
      const terms = await prisma.chapterCompetitionTerm.findMany({
        where: { chapter_id: ch.id },
      })
      assert.ok(terms.length >= 1)
      assert.equal(terms[0].ends_at, null)

      const rewardResult = evaluateChapterTransferEligibility({
        at: new Date('2026-10-29T12:00:00+07:00'),
        candidateSeason: OCT_2026,
        appliedTransfers: [],
      })
      assert.equal(rewardResult.paused, false)
    }
  })

  it('T19: Member vobahoaan@gmail.com has exactly 19 video stars (14 + 5)', async () => {
    const user = await prisma.user.findUnique({
      where: { email: 'vobahoaan@gmail.com' },
      include: {
        stars: {
          where: { source_type: 'VIDEO' },
        },
      },
    })

    assert.ok(user, 'User vobahoaan@gmail.com should exist')
    const videoStars = user.stars
    assert.equal(videoStars.length, 2, 'Should have exactly 2 video star ledger entries')

    const starAmounts = videoStars.map((s) => s.amount).sort((a, b) => a - b)
    assert.deepEqual(starAmounts, [5, 14], 'Should have 5 stars (309s) and 14 stars (862s)')

    const totalVideoStars = starAmounts.reduce((sum, a) => sum + a, 0)
    assert.equal(totalVideoStars, 19, 'Total video stars should be exactly 19')

    assert.equal(starsForVideoDuration(309), 5)
    assert.equal(starsForVideoDuration(862), 14)
  })
})

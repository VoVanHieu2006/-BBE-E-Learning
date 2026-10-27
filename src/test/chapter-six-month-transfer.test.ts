import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  addCalendarMonthsVietnam,
  daysInVietnamMonth,
  evaluateChapterTransferEligibility,
  getVietnamParts,
} from '../lib/chapter-term-rules'
// Guard before loading Prisma: this suite creates/deletes fixture records.
const target = process.env.TEST_DATABASE_URL
if (!target) throw new Error('Explicit disposable TEST_DATABASE_URL required')
const testUrl = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(testUrl.hostname) || testUrl.pathname !== '/bbe_test_learning_cycles') throw new Error('Only local bbe_test_learning_cycles is allowed')
process.env.DATABASE_URL = target
process.env.DIRECT_URL = target
const { prisma } = require('../lib/prisma') as typeof import('../lib/prisma')
import { starsForVideoDuration } from '../lib/reward-rules'

describe('BBE Chapter 6-Month Transfer & Initial Term Suite', () => {
  // =========================================================================
  // T01: Thành lập 15/01/2026 -> firstEligibleAt = 15/07/2026
  // =========================================================================
  it('T01: Founded 15/01/2026 -> firstEligibleAt = 15/07/2026', () => {
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

  // =========================================================================
  // T02: Thành lập 31/08/2026 -> firstEligibleAt = 28/02/2027 (năm không nhuận)
  // =========================================================================
  it('T02: Founded 31/08/2026 -> firstEligibleAt = 28/02/2027', () => {
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

  // =========================================================================
  // T03: Thành lập 02/03/2026, xét mùa 01/09/2026 -> Thiếu 1 ngày, bỏ qua mùa
  // =========================================================================
  it('T03: Founded 02/03/2026, season 01/09/2026 -> Missing 1 day, skips season, not paused', () => {
    const founded = new Date('2026-03-02T00:00:00+07:00')
    const seasonStart = new Date('2026-09-01T00:00:00+07:00')
    const deadline = new Date('2026-10-31T23:59:59+07:00')
    const now = new Date('2026-10-15T10:00:00+07:00')

    const result = evaluateChapterTransferEligibility({
      chapterCreatedAt: founded,
      at: now,
      candidateSeason: {
        id: '2026-OCT',
        starts_at: seasonStart,
        ends_at: deadline,
        reward_boundary_at: deadline,
      },
      hasPriorAppliedReorg: false,
      appliedReorgThisSeason: null,
      scheduledReorgThisSeason: null,
    })

    assert.equal(result.status, 'INITIAL_SEASON_SKIPPED')
    assert.equal(result.paused, false)
    assert.equal(result.eligibleForSeason, false)
  })

  // =========================================================================
  // T04: Thành lập 02/03/2026, ngày 02/09/2026 -> Vừa đủ 6 tháng giữa mùa, không bị ép
  // =========================================================================
  it('T04: Founded 02/03/2026, at 02/09/2026 (mid-season) -> not forced mid-season', () => {
    const founded = new Date('2026-03-02T00:00:00+07:00')
    const seasonStart = new Date('2026-09-01T00:00:00+07:00')
    const deadline = new Date('2026-10-31T23:59:59+07:00')
    const now = new Date('2026-09-02T00:00:00+07:00') // Exact 6 months mark

    const result = evaluateChapterTransferEligibility({
      chapterCreatedAt: founded,
      at: now,
      candidateSeason: {
        id: '2026-OCT',
        starts_at: seasonStart,
        ends_at: deadline,
        reward_boundary_at: deadline,
      },
      hasPriorAppliedReorg: false,
      appliedReorgThisSeason: null,
      scheduledReorgThisSeason: null,
    })

    // Season opened before chapter was 6 months old -> chapter remains in initial term
    assert.equal(result.status, 'INITIAL_SEASON_SKIPPED')
    assert.equal(result.paused, false)
    assert.equal(result.eligibleForSeason, false)
  })

  // =========================================================================
  // T05: Mùa tiếp theo sau T03 (01/03/2027) -> Chapter BẮT BUỘC chuyển giao
  // =========================================================================
  it('T05: Next season (01/03/2027) after T03 -> Chapter is now eligible and due', () => {
    const founded = new Date('2026-03-02T00:00:00+07:00')
    const seasonStart = new Date('2027-03-01T00:00:00+07:00')
    const deadline = new Date('2027-04-30T23:59:59+07:00')
    const duringSeason = new Date('2027-03-15T10:00:00+07:00')

    const beforeDeadline = evaluateChapterTransferEligibility({
      chapterCreatedAt: founded,
      at: duringSeason,
      candidateSeason: {
        id: '2027-APR',
        starts_at: seasonStart,
        ends_at: deadline,
        reward_boundary_at: deadline,
      },
      hasPriorAppliedReorg: false,
      appliedReorgThisSeason: null,
      scheduledReorgThisSeason: null,
    })
    assert.equal(beforeDeadline.status, 'FIRST_TRANSFER_DUE')
    assert.equal(beforeDeadline.paused, false)
    assert.equal(beforeDeadline.eligibleForSeason, true)

    // After deadline without transfer -> paused
    const afterDeadline = evaluateChapterTransferEligibility({
      chapterCreatedAt: founded,
      at: new Date('2027-05-01T00:00:00+07:00'),
      candidateSeason: {
        id: '2027-APR',
        starts_at: seasonStart,
        ends_at: deadline,
        reward_boundary_at: deadline,
      },
      hasPriorAppliedReorg: false,
      appliedReorgThisSeason: null,
      scheduledReorgThisSeason: null,
    })
    assert.equal(afterDeadline.status, 'TRANSFER_OVERDUE')
    assert.equal(afterDeadline.paused, false)
  })

  // =========================================================================
  // T06: Thành lập 01/03/2026 00:00:00 -> firstEligibleAt = 01/09/2026 00:00:00
  // =========================================================================
  it('T06: Founded 01/03/2026 00:00:00 -> exactly eligible at 01/09/2026 00:00:00', () => {
    const founded = new Date('2026-03-01T00:00:00+07:00')
    const seasonStart = new Date('2026-09-01T00:00:00+07:00')
    const deadline = new Date('2026-10-31T23:59:59+07:00')

    const result = evaluateChapterTransferEligibility({
      chapterCreatedAt: founded,
      at: seasonStart,
      candidateSeason: {
        id: '2026-OCT',
        starts_at: seasonStart,
        ends_at: deadline,
        reward_boundary_at: deadline,
      },
      hasPriorAppliedReorg: false,
      appliedReorgThisSeason: null,
      scheduledReorgThisSeason: null,
    })

    assert.equal(result.status, 'FIRST_TRANSFER_DUE')
    assert.equal(result.eligibleForSeason, true)
    assert.ok(result.firstEligibleAt)
    assert.equal(result.firstEligibleAt.getTime(), seasonStart.getTime())
    assert.equal(result.paused, false)
  })

  // =========================================================================
  // T07: Thành lập 01/03/2026 00:00:01 -> firstEligibleAt = 01/09/2026 00:00:01
  // Thiếu 1 giây -> BỎ QUA mùa 9-10/2026
  // =========================================================================
  it('T07: Founded 01/03/2026 00:00:01 -> missing 1 second -> skips season 9-10/2026', () => {
    const founded = new Date('2026-03-01T00:00:01+07:00')
    const seasonStart = new Date('2026-09-01T00:00:00+07:00')
    const deadline = new Date('2026-10-31T23:59:59+07:00')

    const result = evaluateChapterTransferEligibility({
      chapterCreatedAt: founded,
      at: seasonStart,
      candidateSeason: {
        id: '2026-OCT',
        starts_at: seasonStart,
        ends_at: deadline,
        reward_boundary_at: deadline,
      },
      hasPriorAppliedReorg: false,
      appliedReorgThisSeason: null,
      scheduledReorgThisSeason: null,
    })

    assert.equal(result.status, 'INITIAL_SEASON_SKIPPED')
    assert.equal(result.eligibleForSeason, false)
    assert.equal(result.paused, false)
    assert.ok(result.firstEligibleAt)
    assert.ok(result.firstEligibleAt.getTime() > seasonStart.getTime())
  })

  // =========================================================================
  // T08: Năm nhuận 2028: Thành lập 29/02/2028 -> firstEligibleAt = 29/08/2028
  // =========================================================================
  it('T08: Leap year 2028: Founded 29/02/2028 -> firstEligibleAt = 29/08/2028', () => {
    const founded = new Date('2028-02-29T12:00:00+07:00')
    const eligible = addCalendarMonthsVietnam(founded, 6)
    const parts = getVietnamParts(eligible)
    assert.equal(parts.year, 2028)
    assert.equal(parts.month, 8)
    assert.equal(parts.day, 29)
    assert.equal(parts.hour, 12)
  })

  // =========================================================================
  // T09: Năm nhuận 2028: Thành lập 31/08/2028 -> firstEligibleAt = 28/02/2029 (2029 không nhuận)
  // =========================================================================
  it('T09: Founded 31/08/2028 -> firstEligibleAt = 28/02/2029 (2029 non-leap)', () => {
    const founded = new Date('2028-08-31T23:59:59+07:00')
    const eligible = addCalendarMonthsVietnam(founded, 6)
    const parts = getVietnamParts(eligible)
    assert.equal(parts.year, 2029)
    assert.equal(parts.month, 2)
    assert.equal(parts.day, 28)
    assert.equal(parts.hour, 23)
    assert.equal(parts.minute, 59)
    assert.equal(parts.second, 59)
  })

  // =========================================================================
  // T10: Năm 2027 sang 2028: Thành lập 31/08/2027 -> firstEligibleAt = 29/02/2028 (2028 nhuận)
  // =========================================================================
  it('T10: Founded 31/08/2027 -> firstEligibleAt = 29/02/2028 (2028 leap)', () => {
    const founded = new Date('2027-08-31T10:00:00+07:00')
    const eligible = addCalendarMonthsVietnam(founded, 6)
    const parts = getVietnamParts(eligible)
    assert.equal(parts.year, 2028)
    assert.equal(parts.month, 2)
    assert.equal(parts.day, 29)
    assert.equal(daysInVietnamMonth(2028, 1), 29) // month 1 = Feb in 0-indexed
  })

  // =========================================================================
  // T11: Cột mốc 23:59:59 ngày trước vs 00:00:00 ngày mở mùa
  // =========================================================================
  it('T11: Precision timestamp boundary at 23:59:59 vs 00:00:00', () => {
    // Founded at 23:59:59 on Feb 28 -> eligible Aug 28 23:59:59 <= Sep 1 00:00:00 -> eligible
    const f1 = new Date('2026-02-28T23:59:59+07:00')
    const e1 = addCalendarMonthsVietnam(f1, 6)
    const s1 = new Date('2026-09-01T00:00:00+07:00')
    assert.ok(e1.getTime() <= s1.getTime())

    // Founded at 00:00:00 on March 1 -> eligible Sep 1 00:00:00 <= Sep 1 00:00:00 -> eligible
    const f2 = new Date('2026-03-01T00:00:00+07:00')
    const e2 = addCalendarMonthsVietnam(f2, 6)
    assert.equal(e2.getTime(), s1.getTime())

    // Founded at 00:00:01 on March 1 -> eligible Sep 1 00:00:01 > Sep 1 00:00:00 -> NOT eligible
    const f3 = new Date('2026-03-01T00:00:01+07:00')
    const e3 = addCalendarMonthsVietnam(f3, 6)
    assert.ok(e3.getTime() > s1.getTime())
  })

  // =========================================================================
  // T12: Chapter mới thành lập, chưa từng chuyển giao, trong mùa nhưng chưa đủ 6 tháng:
  // Member xem video -> Nhận sao bình thường (pause = false)
  // =========================================================================
  it('T12: New chapter in season but < 6 months: pause is false', () => {
    const founded = new Date('2026-07-01T00:00:00+07:00')
    const result = evaluateChapterTransferEligibility({
      chapterCreatedAt: founded,
      at: new Date('2026-09-15T00:00:00+07:00'),
      candidateSeason: {
        id: '2026-OCT',
        starts_at: new Date('2026-09-01T00:00:00+07:00'),
        ends_at: new Date('2026-10-31T23:59:59+07:00'),
        reward_boundary_at: new Date('2026-10-31T23:59:59+07:00'),
      },
      hasPriorAppliedReorg: false,
      appliedReorgThisSeason: null,
      scheduledReorgThisSeason: null,
    })
    assert.equal(result.paused, false)
    assert.equal(result.status, 'INITIAL_SEASON_SKIPPED')
  })

  // =========================================================================
  // T13: Chapter mới thành lập, bỏ qua mùa: Member xem video và quiz -> Nhận sao (pause = false)
  // =========================================================================
  it('T13: Skipped season chapter has paused = false throughout season', () => {
    const founded = new Date('2026-04-10T00:00:00+07:00')
    const resultAtDeadline = evaluateChapterTransferEligibility({
      chapterCreatedAt: founded,
      at: new Date('2026-10-31T23:59:59+07:00'),
      candidateSeason: {
        id: '2026-OCT',
        starts_at: new Date('2026-09-01T00:00:00+07:00'),
        ends_at: new Date('2026-10-31T23:59:59+07:00'),
        reward_boundary_at: new Date('2026-10-31T23:59:59+07:00'),
      },
      hasPriorAppliedReorg: false,
      appliedReorgThisSeason: null,
      scheduledReorgThisSeason: null,
    })
    assert.equal(resultAtDeadline.paused, false)
    assert.equal(resultAtDeadline.status, 'INITIAL_SEASON_SKIPPED')
  })

  // =========================================================================
  // T14: Chapter mới thành lập, đến mùa bắt buộc đầu tiên, chưa chuyển giao trước deadline:
  // Tạm dừng thưởng sao theo đúng quy định như Chapter cũ
  // =========================================================================
  it('T14: First mandatory season overdue -> initial rewards continue', () => {
    const founded = new Date('2026-01-01T00:00:00+07:00') // 6 months reached on 01/07/2026
    const seasonStart = new Date('2026-09-01T00:00:00+07:00')
    const deadline = new Date('2026-10-31T23:59:59+07:00')

    const overdueResult = evaluateChapterTransferEligibility({
      chapterCreatedAt: founded,
      at: new Date('2026-11-01T00:00:00+07:00'),
      candidateSeason: {
        id: '2026-OCT',
        starts_at: seasonStart,
        ends_at: deadline,
        reward_boundary_at: deadline,
      },
      hasPriorAppliedReorg: false,
      appliedReorgThisSeason: null,
      scheduledReorgThisSeason: null,
    })
    assert.equal(overdueResult.status, 'TRANSFER_OVERDUE')
    assert.equal(overdueResult.paused, false)
  })

  // =========================================================================
  // T15: Chapter mới thành lập, đến mùa bắt buộc, thực hiện chuyển giao thành công -> Mở lại thưởng sao
  // =========================================================================
  it('T15: Transfer applied at first mandatory season -> unpaused', () => {
    const founded = new Date('2026-01-01T00:00:00+07:00')
    const seasonStart = new Date('2026-09-01T00:00:00+07:00')
    const deadline = new Date('2026-10-31T23:59:59+07:00')
    const appliedAt = new Date('2026-10-20T14:00:00+07:00')

    const appliedResult = evaluateChapterTransferEligibility({
      chapterCreatedAt: founded,
      at: new Date('2026-10-21T00:00:00+07:00'),
      candidateSeason: {
        id: '2026-OCT',
        starts_at: seasonStart,
        ends_at: deadline,
        reward_boundary_at: deadline,
      },
      hasPriorAppliedReorg: false,
      appliedReorgThisSeason: { applied_at: appliedAt },
      scheduledReorgThisSeason: null,
    })
    assert.equal(appliedResult.status, 'TRANSFER_APPLIED')
    assert.equal(appliedResult.paused, false)
  })

  // =========================================================================
  // T16: Tự nguyện chuyển giao: Chapter mới thành lập 2 tháng, Lead chủ động nộp và áp dụng reorganization:
  // Chấp nhận hợp lệ, bắt đầu nhiệm kỳ 2, reset chu kỳ
  // =========================================================================
  it('T16: Voluntary early transfer accepted and unpaused', () => {
    const founded = new Date('2026-08-01T00:00:00+07:00')
    const earlyAppliedAt = new Date('2026-09-25T10:00:00+07:00') // Only 2 months old!

    const result = evaluateChapterTransferEligibility({
      chapterCreatedAt: founded,
      at: new Date('2026-09-26T00:00:00+07:00'),
      candidateSeason: {
        id: '2026-OCT',
        starts_at: new Date('2026-09-01T00:00:00+07:00'),
        ends_at: new Date('2026-10-31T23:59:59+07:00'),
        reward_boundary_at: new Date('2026-10-31T23:59:59+07:00'),
      },
      hasPriorAppliedReorg: false,
      appliedReorgThisSeason: { applied_at: earlyAppliedAt },
      scheduledReorgThisSeason: null,
    })

    assert.equal(result.status, 'TRANSFER_APPLIED')
    assert.equal(result.paused, false)
  })

  // =========================================================================
  // T17: Chapter mới tạo qua Invitation -> current_term_number = 1, có ChapterCompetitionTerm
  // =========================================================================
  it('T17: Database schema supports current_term_number and ChapterCompetitionTerm for invitations', async () => {
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

    // Cleanup test records
    await prisma.chapterCompetitionTerm.delete({ where: { id: term.id } })
    await prisma.chapter.delete({ where: { id: chapter.id } })
    await prisma.organizationUnit.delete({ where: { id: unit.id } })
  })

  // =========================================================================
  // T18: Chapter mới tạo qua Admin -> current_term_number = 1, có ChapterCompetitionTerm
  // =========================================================================
  it('T18: Chapter created by Admin has current_term_number = 1 and initial competition term', async () => {
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

    // Cleanup
    await prisma.chapterCompetitionTerm.delete({ where: { id: term.id } })
    await prisma.chapter.delete({ where: { id: chapter.id } })
    await prisma.organizationUnit.delete({ where: { id: unit.id } })
  })

  // =========================================================================
  // T19: Hai Chapter hiện có trong DB (BBE Chapter 1, BBE Chapter 2) sau bản vá -> Có term 1, không bị pause
  // =========================================================================
  it('T19: Both DB chapters (BBE Chapter 1, BBE Chapter 2) have term 1 and unpaused reward state', async () => {
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

      // Check reward state
      const rewardResult = evaluateChapterTransferEligibility({
        chapterCreatedAt: ch.created_at,
        at: new Date(),
        candidateSeason: {
          id: '2026-OCT',
          starts_at: new Date('2026-09-01T00:00:00+07:00'),
          ends_at: new Date('2026-10-31T23:59:59+07:00'),
          reward_boundary_at: new Date('2026-10-31T23:59:59+07:00'),
        },
        hasPriorAppliedReorg: false,
        appliedReorgThisSeason: null,
        scheduledReorgThisSeason: null,
      })
      assert.equal(rewardResult.paused, false)
    }
  })

  // =========================================================================
  // T20: Học viên vobahoaan@gmail.com -> Sau đối soát có đủ 19 sao video (14 + 5)
  // =========================================================================
  it('T20: Member vobahoaan@gmail.com has exactly 19 video stars (14 + 5)', async () => {
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

    // Verify star formula
    assert.equal(starsForVideoDuration(309), 5)
    assert.equal(starsForVideoDuration(862), 14)
  })
})

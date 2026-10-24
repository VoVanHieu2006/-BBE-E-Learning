import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chapterCompetitionScore, ChapterStage } from '../lib/competition-ranking-rules'
import { rankChapters, rankIndividuals } from '../lib/competition-snapshots'

const DAY_MS = 86_400_000

describe('Phase 3 Leaderboard Oracle Suite - Independent Business Verification', () => {

  // =========================================================================
  // 1. FORMULAS: Normal & Transfer Months
  // =========================================================================

  it('Oracle 01: Normal month formula S_m = A_m / N_m without time weighting or bonuses', () => {
    // Hand calculation:
    // Stars A = 126, Members N = 28
    // S_m = 126 / 28 = 4.5
    const stage: ChapterStage = {
      startsAt: new Date('2026-08-01T00:00:00Z'),
      endsAt: new Date('2026-09-01T00:00:00Z'),
      memberCount: 28,
      qualifiedCount: 20,
      stars: 126,
    }
    const result = chapterCompetitionScore([stage], 'GREEN', { coreLessonCount: 50 })
    assert.equal(result.score, 4.5)
    assert.equal(result.eligible, true)
    assert.equal(result.stageResults?.length, 1)
    assert.equal(result.stageResults?.[0].stageScore, 4.5)
  })

  it('Oracle 02: Transfer month formula S_m = A_1 / N_1 + A_2 / N_2 (User mandatory requirement)', () => {
    // Hand calculation from User prompt:
    // Chapter A transfers on 15/09/2026.
    // Stage 1 (15 days): A1 = 120, N1 = 30 -> A1/N1 = 4.0
    // Stage 2 (15 days): A2 = 150, N2 = 25 -> A2/N2 = 6.0
    // Expected Monthly score S_m = 4.0 + 6.0 = 10.0
    // Note: Old baseline calculated (120 + 150) / 27.5 = 9.818... which is FORBIDDEN.
    const stages: ChapterStage[] = [
      {
        startsAt: new Date('2026-09-01T00:00:00Z'),
        endsAt: new Date('2026-09-15T00:00:00Z'),
        memberCount: 30,
        qualifiedCount: 20,
        stars: 120,
      },
      {
        startsAt: new Date('2026-09-15T00:00:00Z'),
        endsAt: new Date('2026-10-01T00:00:00Z'),
        memberCount: 25,
        qualifiedCount: 18,
        stars: 150,
      },
    ]
    const result = chapterCompetitionScore(stages, 'GREEN', { coreLessonCount: 50 })
    assert.equal(result.score, 10.0)
    assert.equal(result.eligible, true)
    // Verify each stage score is cleanly computed for term allocation
    assert.equal(result.stageResults?.length, 2)
    assert.equal(result.stageResults?.[0].stageScore, 4.0)
    assert.equal(result.stageResults?.[1].stageScore, 6.0)
  })

  // =========================================================================
  // 2. ELIGIBILITY CONDITIONS & THRESHOLDS
  // =========================================================================

  it('Oracle 03: Scale condition - Roster threshold strictly > 20 members (20 disqualified, 21 eligible)', () => {
    // Normal month with 20 members -> disqualified
    const stage20: ChapterStage = {
      startsAt: new Date(0),
      endsAt: new Date(30 * DAY_MS),
      memberCount: 20,
      qualifiedCount: 15,
      stars: 100,
    }
    const res20 = chapterCompetitionScore([stage20], 'GREEN', { coreLessonCount: 50 })
    assert.equal(res20.eligible, false)
    assert.ok(res20.exclusionReasons.includes('MEMBER_COUNT_NOT_ABOVE_20'))

    // Normal month with 21 members -> eligible
    const stage21: ChapterStage = {
      startsAt: new Date(0),
      endsAt: new Date(30 * DAY_MS),
      memberCount: 21,
      qualifiedCount: 15,
      stars: 105,
    }
    const res21 = chapterCompetitionScore([stage21], 'GREEN', { coreLessonCount: 50 })
    assert.equal(res21.eligible, true)
    assert.equal(res21.score, 5.0)
  })

  it('Oracle 04: Progress condition - Threshold >= 50% qualified (49.99% disqualified, 50% eligible)', () => {
    // 24 members: 11 qualified = 11/24 = 45.83% -> disqualified
    const stage45: ChapterStage = {
      startsAt: new Date(0),
      endsAt: new Date(30 * DAY_MS),
      memberCount: 24,
      qualifiedCount: 11,
      stars: 120,
    }
    const res45 = chapterCompetitionScore([stage45], 'GREEN', { coreLessonCount: 50 })
    assert.equal(res45.eligible, false)
    assert.ok(res45.exclusionReasons.includes('CORE_COMPLETION_BELOW_50_PERCENT'))

    // 24 members: 12 qualified = 12/24 = 50.0% -> eligible
    const stage50: ChapterStage = {
      startsAt: new Date(0),
      endsAt: new Date(30 * DAY_MS),
      memberCount: 24,
      qualifiedCount: 12,
      stars: 120,
    }
    const res50 = chapterCompetitionScore([stage50], 'GREEN', { coreLessonCount: 50 })
    assert.equal(res50.eligible, true)
    assert.equal(res50.score, 5.0)
  })

  it('Oracle 05: Transfer month conditions use time-weighted N_avg and R', () => {
    // Stage 1 (10 days): N1 = 30, Q1 = 20 -> N1*T1 = 300, Q1*T1 = 200
    // Stage 2 (20 days): N2 = 18, Q2 = 10 -> N2*T2 = 360, Q2*T2 = 200
    // Total T = 30 days
    // N_avg = (300 + 360) / 30 = 22.0 > 20 -> Scale ELIGIBLE
    // R = (200 + 200) / (300 + 360) = 400 / 660 = 60.6% >= 50% -> Progress ELIGIBLE
    // S_m = 60/30 + 36/18 = 2.0 + 2.0 = 4.0
    const stages: ChapterStage[] = [
      {
        startsAt: new Date(0),
        endsAt: new Date(10 * DAY_MS),
        memberCount: 30,
        qualifiedCount: 20,
        stars: 60,
      },
      {
        startsAt: new Date(10 * DAY_MS),
        endsAt: new Date(30 * DAY_MS),
        memberCount: 18,
        qualifiedCount: 10,
        stars: 36,
      },
    ]
    const res = chapterCompetitionScore(stages, 'YELLOW', { coreLessonCount: 50 })
    assert.equal(res.eligible, true)
    assert.equal(res.score, 4.0)
  })

  it('Oracle 06: Data errors - Zero roster or missing core lessons must return dataError, not score 0', () => {
    const zeroRoster: ChapterStage = {
      startsAt: new Date(0),
      endsAt: new Date(30 * DAY_MS),
      memberCount: 0,
      qualifiedCount: 0,
      stars: 0,
    }
    const resZeroRoster = chapterCompetitionScore([zeroRoster], 'GREEN', { coreLessonCount: 50 })
    assert.equal(resZeroRoster.score, null)
    assert.equal(resZeroRoster.eligible, false)
    assert.equal(resZeroRoster.dataError, 'ROSTER_ZERO')

    const zeroLessons: ChapterStage = {
      startsAt: new Date(0),
      endsAt: new Date(30 * DAY_MS),
      memberCount: 25,
      qualifiedCount: 20,
      stars: 100,
    }
    const resZeroLessons = chapterCompetitionScore([zeroLessons], 'GREEN', { coreLessonCount: 0 })
    assert.equal(resZeroLessons.score, null)
    assert.equal(resZeroLessons.eligible, false)
    assert.equal(resZeroLessons.dataError, 'CORE_LESSONS_ZERO')
  })

  // =========================================================================
  // 3. TRANSFER MONTH TERM SCORE SPLIT (Phương án B)
  // =========================================================================

  it('Oracle 07: Term score split - Stage 1 goes to Old Term, Stage 2 goes to New Term', () => {
    // Old Term: 2026-04-01 to 2026-09-15 12:00:00Z
    // New Term: 2026-09-15 12:00:00Z to 2027-04-01
    // Reorganization applied at 2026-09-15T12:00:00Z
    // September stages:
    // Stage 1: 2026-09-01T00:00:00Z to 2026-09-15T12:00:00Z -> score = 4.0
    // Stage 2: 2026-09-15T12:00:00Z to 2026-10-01T00:00:00Z -> score = 6.0
    // Total September month score = 10.0
    const stage1: ChapterStage = {
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2026-09-15T12:00:00Z'),
      memberCount: 30,
      qualifiedCount: 25,
      stars: 120, // 120 / 30 = 4.0
    }
    const stage2: ChapterStage = {
      startsAt: new Date('2026-09-15T12:00:00Z'),
      endsAt: new Date('2026-10-01T00:00:00Z'),
      memberCount: 25,
      qualifiedCount: 20,
      stars: 150, // 150 / 25 = 6.0
    }

    const monthResult = chapterCompetitionScore([stage1, stage2], 'GREEN', { coreLessonCount: 50 })
    assert.equal(monthResult.score, 10.0)

    // Simulate term allocation using stage midpoints as implemented in chapterSeasonRows:
    const oldTermStart = new Date('2026-04-01T00:00:00Z')
    const oldTermEnd = new Date('2026-09-15T12:00:00Z')
    const newTermStart = new Date('2026-09-15T12:00:00Z')
    const newTermEnd = new Date('2027-04-01T00:00:00Z')

    let oldTermScore = 0
    let newTermScore = 0

    for (const stage of monthResult.stageResults || []) {
      const midpoint = new Date((stage.startsAt.getTime() + stage.endsAt.getTime()) / 2)
      if (midpoint >= oldTermStart && midpoint < oldTermEnd) {
        oldTermScore += stage.stageScore
      }
      if (midpoint >= newTermStart && midpoint < newTermEnd) {
        newTermScore += stage.stageScore
      }
    }

    assert.equal(oldTermScore, 4.0)
    assert.equal(newTermScore, 6.0)
    assert.equal(oldTermScore + newTermScore, monthResult.score)
  })

  // =========================================================================
  // 4. HIGH-PRECISION RANKING & NO PRE-ROUNDING
  // =========================================================================

  it('Oracle 08: High-precision comparison - A = 10.123456789 beats B = 10.123456788 even though UI shows 10,123 for both', () => {
    const chapters = [
      {
        chapterId: 'chap-b',
        chapterName: 'Chapter B',
        score: 10.123456788,
        eligible: true,
        at70Rate: 0.8,
        kpiStatus: 'GREEN',
        exclusionReasons: [],
      },
      {
        chapterId: 'chap-a',
        chapterName: 'Chapter A',
        score: 10.123456789,
        eligible: true,
        at70Rate: 0.8,
        kpiStatus: 'GREEN',
        exclusionReasons: [],
      },
    ]

    const ranked = rankChapters(chapters, { isTerm: false })
    assert.equal(ranked[0].chapterId, 'chap-a')
    assert.equal(ranked[0].rank, 1)
    assert.equal(ranked[1].chapterId, 'chap-b')
    assert.equal(ranked[1].rank, 2)

    // Formatted UI check: both show 10,123
    const format3 = (val: number) => val.toLocaleString('vi-VN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    assert.equal(format3(ranked[0].score!), '10,123')
    assert.equal(format3(ranked[1].score!), '10,123')
  })

  // =========================================================================
  // 5. TIE-BREAKING: Month & Term
  // =========================================================================

  it('Oracle 09: Chapter Month tie-breaking - Same score, earlier lastStarAwardedAt (seconds) wins', () => {
    const timeEarly = new Date('2026-09-20T10:15:30Z')
    const timeLate = new Date('2026-09-20T10:15:31Z') // 1 second later

    const chapters = [
      {
        chapterId: 'chap-late',
        chapterName: 'Chapter Late',
        score: 8.5,
        eligible: true,
        at70Rate: 0.8,
        kpiStatus: 'GREEN',
        exclusionReasons: [],
        lastStarAwardedAt: timeLate,
      },
      {
        chapterId: 'chap-early',
        chapterName: 'Chapter Early',
        score: 8.5,
        eligible: true,
        at70Rate: 0.8,
        kpiStatus: 'GREEN',
        exclusionReasons: [],
        lastStarAwardedAt: timeEarly,
      },
    ]

    const ranked = rankChapters(chapters, { isTerm: false })
    assert.equal(ranked[0].chapterId, 'chap-early')
    assert.equal(ranked[0].rank, 1)
    assert.equal(ranked[1].chapterId, 'chap-late')
    assert.equal(ranked[1].rank, 2)
  })

  it('Oracle 10: Chapter Month true tie - Same score and same second of last star -> identical rank', () => {
    const exactSameSecond = new Date('2026-09-20T10:15:30.200Z')
    const exactSameSecond2 = new Date('2026-09-20T10:15:30.800Z') // Same second: Math.floor(getTime() / 1000)

    const chapters = [
      {
        chapterId: 'chap-1',
        chapterName: 'Chapter 1',
        score: 8.5,
        eligible: true,
        at70Rate: 0.8,
        kpiStatus: 'GREEN',
        exclusionReasons: [],
        lastStarAwardedAt: exactSameSecond,
      },
      {
        chapterId: 'chap-2',
        chapterName: 'Chapter 2',
        score: 8.5,
        eligible: true,
        at70Rate: 0.8,
        kpiStatus: 'GREEN',
        exclusionReasons: [],
        lastStarAwardedAt: exactSameSecond2,
      },
      {
        chapterId: 'chap-3',
        chapterName: 'Chapter 3',
        score: 7.0,
        eligible: true,
        at70Rate: 0.8,
        kpiStatus: 'GREEN',
        exclusionReasons: [],
      },
    ]

    const ranked = rankChapters(chapters, { isTerm: false })
    assert.equal(ranked[0].rank, 1)
    assert.equal(ranked[1].rank, 1) // True tie!
    assert.equal(ranked[2].rank, 3) // Standard 1-1-3 competition ranking
  })

  it('Oracle 11: Chapter Term tie-breaking - Total score first; if equal, more qualified months wins (User Prompt Example)', () => {
    // User Prompt Example:
    // Chapter A: 50.123456789, 5 months -> Rank 1
    // Chapter B: 50.123456789, 4 months -> Rank 2
    // Chapter C: 50.123456788, 6 months -> Rank 3 (Lower score always ranks lower!)
    const chapters = [
      {
        chapterId: 'chap-c',
        chapterName: 'Chapter C',
        score: 50.123456788,
        qualifiedMonthCount: 6,
        eligible: true,
        at70Rate: 0.9,
        kpiStatus: 'GREEN',
        exclusionReasons: [],
      },
      {
        chapterId: 'chap-b',
        chapterName: 'Chapter B',
        score: 50.123456789,
        qualifiedMonthCount: 4,
        eligible: true,
        at70Rate: 0.8,
        kpiStatus: 'GREEN',
        exclusionReasons: [],
      },
      {
        chapterId: 'chap-a',
        chapterName: 'Chapter A',
        score: 50.123456789,
        qualifiedMonthCount: 5,
        eligible: true,
        at70Rate: 0.85,
        kpiStatus: 'GREEN',
        exclusionReasons: [],
      },
    ]

    const ranked = rankChapters(chapters, { isTerm: true })
    assert.equal(ranked[0].chapterId, 'chap-a')
    assert.equal(ranked[0].rank, 1)
    assert.equal(ranked[1].chapterId, 'chap-b')
    assert.equal(ranked[1].rank, 2)
    assert.equal(ranked[2].chapterId, 'chap-c')
    assert.equal(ranked[2].rank, 3)
  })

  it('Oracle 12: Chapter Term true tie - Equal score and equal qualified months -> identical rank', () => {
    const chapters = [
      {
        chapterId: 'chap-x',
        chapterName: 'Chapter X',
        score: 45.0,
        qualifiedMonthCount: 5,
        eligible: true,
        at70Rate: 0.8,
        kpiStatus: 'GREEN',
        exclusionReasons: [],
      },
      {
        chapterId: 'chap-y',
        chapterName: 'Chapter Y',
        score: 45.0,
        qualifiedMonthCount: 5,
        eligible: true,
        at70Rate: 0.8,
        kpiStatus: 'GREEN',
        exclusionReasons: [],
      },
      {
        chapterId: 'chap-z',
        chapterName: 'Chapter Z',
        score: 40.0,
        qualifiedMonthCount: 6,
        eligible: true,
        at70Rate: 0.9,
        kpiStatus: 'GREEN',
        exclusionReasons: [],
      },
    ]

    const ranked = rankChapters(chapters, { isTerm: true })
    assert.equal(ranked[0].rank, 1)
    assert.equal(ranked[1].rank, 1) // Identical rank!
    assert.equal(ranked[2].rank, 3) // Standard 1-1-3 competition ranking
  })

  // =========================================================================
  // 6. INDIVIDUAL RANKING & TIE-BREAKING
  // =========================================================================

  it('Oracle 13: Individual ranking - Same stars, reached earlier in cycle (seconds) wins; equal = true tie', () => {
    const candidates = [
      { userId: 'u-fast', stars: 50, elapsedMs: 15_000 }, // 15 seconds
      { userId: 'u-slow', stars: 50, elapsedMs: 18_000 }, // 18 seconds
      { userId: 'u-tie-1', stars: 40, elapsedMs: 10_200 }, // 10 seconds
      { userId: 'u-tie-2', stars: 40, elapsedMs: 10_900 }, // 10 seconds (same second)
    ]

    const ranked = rankIndividuals(candidates)
    assert.equal(ranked[0].userId, 'u-fast')
    assert.equal(ranked[0].rank, 1)
    assert.equal(ranked[1].userId, 'u-slow')
    assert.equal(ranked[1].rank, 2)
    assert.equal(ranked[2].rank, 3)
    assert.equal(ranked[3].rank, 3) // Tied at Rank 3!
  })
})

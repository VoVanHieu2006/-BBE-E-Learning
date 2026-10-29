import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  actualTransferAt,
  anchorElapsed,
  anchorNearest,
  describeWindow,
  describeWindowName,
  isWithinWindow,
  nextWindow,
  termOfAnchor,
  windowOf,
  windowOfAnchor,
} from '../lib/transfer-windows'
import {
  checkSeasonConfiguration,
  classifySeasonForWindow,
  describeSeasonState,
  isLegacySixMonthSeason,
  seasonWindowOf,
} from '../lib/transfer-season-lookup'

const at = (value: string) => new Date(value)
const season = (startsAt: string, endsAt: string, boundaryAt: string, id = 's', code = 'S') => ({
  id,
  code,
  starts_at: at(startsAt),
  ends_at: at(endsAt),
  reward_boundary_at: at(boundaryAt),
})

const APR_2026 = season('2026-01-01T00:00:00+07:00', '2026-07-01T00:00:00+07:00', '2026-04-01T00:00:00+07:00', 'apr', '2026-APR')
const OCT_2026 = season('2026-07-01T00:00:00+07:00', '2027-01-01T00:00:00+07:00', '2026-10-01T00:00:00+07:00', 'oct', '2026-OCT')

describe('Transfer windows', () => {
  it('classifies every instant into exactly one half-open window', () => {
    const cases: Array<[string, string, string]> = [
      ['2026-01-01T00:00:00+07:00', '01/01/2026 – 30/06/2026', '2026-04-01T00:00:00+07:00'],
      ['2026-03-31T23:59:59.999+07:00', '01/01/2026 – 30/06/2026', '2026-04-01T00:00:00+07:00'],
      ['2026-06-30T23:59:59.999+07:00', '01/01/2026 – 30/06/2026', '2026-04-01T00:00:00+07:00'],
      ['2026-07-01T00:00:00+07:00', '01/07/2026 – 31/12/2026', '2026-10-01T00:00:00+07:00'],
      ['2026-12-31T23:59:59.999+07:00', '01/07/2026 – 31/12/2026', '2026-10-01T00:00:00+07:00'],
      ['2027-01-01T00:00:00+07:00', '01/01/2027 – 30/06/2027', '2027-04-01T00:00:00+07:00'],
    ]
    for (const [instant, label, anchor] of cases) {
      const window = windowOf(at(instant))
      assert.equal(describeWindow(window), label)
      assert.equal(window.anchor.getTime(), at(anchor).getTime())
      assert.equal(isWithinWindow(at(instant), window), true)
      assert.equal(window.endsAt.getTime() > at(instant).getTime(), true)
    }
  })

  it('links a window to its competition term', () => {
    assert.equal(termOfAnchor(APR_2026.reward_boundary_at!).startsAt.toISOString(), APR_2026.reward_boundary_at!.toISOString())
    assert.equal(termOfAnchor(APR_2026.reward_boundary_at!).endsAt.toISOString(), at('2026-10-01T00:00:00+07:00').toISOString())
  })

  it('advances April to October and October to the next April', () => {
    const nextFromApril = nextWindow(windowOfAnchor(APR_2026.reward_boundary_at!))
    assert.equal(describeWindow(nextFromApril), '01/07/2026 – 31/12/2026')
    const nextFromOctober = nextWindow(windowOfAnchor(OCT_2026.reward_boundary_at!))
    assert.equal(describeWindow(nextFromOctober), '01/01/2027 – 30/06/2027')
  })

  it('keeps nearest and elapsed anchors distinct before the anchor date', () => {
    const early = at('2026-02-01T00:00:00+07:00')
    assert.equal(anchorNearest(early).toISOString(), APR_2026.reward_boundary_at!.toISOString())
    assert.equal(anchorElapsed(early).toISOString(), at('2025-10-01T00:00:00+07:00').toISOString())
    assert.equal(describeWindowName(windowOf(early)), 'giai đoạn tháng 4/2026')
  })

  it('uses the earlier of scheduled and real application time', () => {
    const scheduled = at('2026-09-20T08:00:00+07:00')
    const appliedLate = at('2026-10-03T09:30:00+07:00')
    assert.equal(actualTransferAt(scheduled, appliedLate)?.toISOString(), scheduled.toISOString())
    const appliedEarly = at('2026-09-18T09:30:00+07:00')
    assert.equal(actualTransferAt(at('2026-10-05T08:00:00+07:00'), appliedEarly)?.toISOString(), appliedEarly.toISOString())
    assert.equal(actualTransferAt(scheduled, null), null)
  })
})

describe('Transfer season lookup', () => {
  it('accepts exactly one standard season per window', () => {
    const april = classifySeasonForWindow([APR_2026], at('2026-05-01T00:00:00+07:00'))
    assert.equal(april.reason, 'OK')
    assert.equal(april.season?.id, 'apr')
    assert.equal(april.message, null)

    const october = classifySeasonForWindow([APR_2026, OCT_2026], at('2026-11-01T00:00:00+07:00'))
    assert.equal(october.reason, 'OK')
    assert.equal(october.season?.id, 'oct')
  })

  it('reports a missing season for the window', () => {
    const result = classifySeasonForWindow([APR_2026], at('2026-11-01T00:00:00+07:00'))
    assert.equal(result.reason, 'SEASON_NOT_CONFIGURED')
    assert.match(result.message || '', /giai đoạn tháng 10\/2026/)
  })

  it('reports overlapping seasons instead of guessing', () => {
    const duplicate = season('2026-07-01T00:00:00+07:00', '2026-12-31T23:59:59+07:00', '2026-10-01T00:00:00+07:00', 'dup', 'DUP')
    const result = classifySeasonForWindow([OCT_2026, duplicate], at('2026-11-01T00:00:00+07:00'))
    assert.equal(result.reason, 'SEASON_OVERLAP')
    assert.equal(result.seasons.length, 2)
    assert.match(result.message || '', /2 mùa chuyển giao/)
  })

  it('recognises the legacy six-month block and refuses to use it as the window', () => {
    const legacy = season('2026-04-01T00:00:00+07:00', '2026-10-01T00:00:00+07:00', '2026-04-01T00:00:00+07:00', 'legacy', 'LEGACY')
    assert.equal(isLegacySixMonthSeason(legacy), true)
    const result = classifySeasonForWindow([legacy], at('2026-05-01T00:00:00+07:00'))
    assert.equal(result.reason, 'SEASON_LEGACY_WINDOW')
    assert.equal(seasonWindowOf(legacy).startsAt.toISOString(), APR_2026.starts_at.toISOString())
  })

  it('reports a wrong reward boundary and wrong dates separately', () => {
    const wrongBoundary = season('2026-07-01T00:00:00+07:00', '2027-01-01T00:00:00+07:00', '2026-09-01T00:00:00+07:00')
    assert.equal(classifySeasonForWindow([wrongBoundary], at('2026-11-01T00:00:00+07:00')).reason, 'SEASON_BOUNDARY_MISMATCH')

    const partial = season('2026-08-01T00:00:00+07:00', '2026-12-01T00:00:00+07:00', '2026-10-01T00:00:00+07:00')
    assert.equal(classifySeasonForWindow([partial], at('2026-11-01T00:00:00+07:00')).reason, 'SEASON_NOT_COVERING_DATE')

    const shifted = season('2026-06-01T00:00:00+07:00', '2027-02-01T00:00:00+07:00', '2026-10-01T00:00:00+07:00')
    assert.equal(classifySeasonForWindow([shifted], at('2026-11-01T00:00:00+07:00')).reason, 'SEASON_WINDOW_MISMATCH')
  })

  it('validates new season configuration exactly', () => {
    assert.equal(checkSeasonConfiguration(APR_2026.starts_at, APR_2026.ends_at, APR_2026.reward_boundary_at).ok, true)
    assert.equal(checkSeasonConfiguration(OCT_2026.starts_at, OCT_2026.ends_at, OCT_2026.reward_boundary_at).ok, true)

    const wrongWindow = checkSeasonConfiguration(at('2026-04-01T00:00:00+07:00'), at('2026-10-01T00:00:00+07:00'), at('2026-04-01T00:00:00+07:00'))
    assert.equal(wrongWindow.ok, false)
    assert.equal(wrongWindow.reason, 'SEASON_WINDOW_MISMATCH')

    const wrongBoundary = checkSeasonConfiguration(APR_2026.starts_at, APR_2026.ends_at, at('2026-04-01T00:00:01+07:00'))
    assert.equal(wrongBoundary.ok, false)
    assert.equal(wrongBoundary.reason, 'SEASON_BOUNDARY_MISMATCH')
  })

  it('labels the configuration state naturally for the Admin view', () => {
    assert.equal(describeSeasonState(APR_2026).state, 'EXACT')
    assert.equal(describeSeasonState(season('2026-04-01T00:00:00+07:00', '2026-10-01T00:00:00+07:00', '2026-04-01T00:00:00+07:00')).state, 'LEGACY')
    assert.equal(describeSeasonState(season('2026-01-01T00:00:00+07:00', '2026-07-01T00:00:00+07:00', '2026-05-01T00:00:00+07:00')).state, 'BOUNDARY_MISMATCH')
  })
})

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_VIDEO_DURATION_SECONDS, normalizeDurationSeconds, parseDurationInput } from '../lib/validation/duration'
import { addCalendarMonthsVietnam, daysInVietnamMonth, getVietnamParts } from '../lib/vietnam-calendar'
import { getUrgencyLevel } from '../lib/deadline-urgency'

describe('thời lượng video Admin nhập tay', () => {
  it('accepts whole seconds from 1 second to 12 hours', () => {
    assert.equal(normalizeDurationSeconds(1), 1)
    assert.equal(normalizeDurationSeconds(754), 754)
    assert.equal(normalizeDurationSeconds(' 754 '), 754)
    assert.equal(normalizeDurationSeconds(MAX_VIDEO_DURATION_SECONDS), 43200)
    assert.equal(normalizeDurationSeconds(59.9), 59, 'fractions are truncated, never rounded up')
  })
  for (const bad of [0, -5, 43201, NaN, Infinity, '3:00', 'abc', '', '12.5', '-3', '1e3', null, undefined, true, {}, [60]]) {
    it(`rejects ${JSON.stringify(bad) ?? String(bad)}`, () => assert.equal(normalizeDurationSeconds(bad), null))
  }
  it('reads seconds, mm:ss and h:mm:ss', () => {
    assert.equal(parseDurationInput('754'), 754)
    assert.equal(parseDurationInput('12:34'), 754)
    assert.equal(parseDurationInput('1:02:03'), 3723)
    assert.equal(parseDurationInput(' 0:05 '), 5)
    assert.equal(parseDurationInput('12:00:00'), 43200)
  })
  for (const bad of ['', '   ', '0', '0:00', '12:00:01', '1:2:3:4', ':30', '1:', 'a:10', '1:-5', '1.5:00', '10 phút']) {
    it(`rejects typed duration "${bad}"`, () => assert.equal(parseDurationInput(bad), null))
  }
})

describe('lịch Việt Nam (UTC+7)', () => {
  const vn = (text: string) => new Date(`${text}+07:00`)
  it('knows month lengths including leap years', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((month) => daysInVietnamMonth(2026, month)), [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
    assert.equal(daysInVietnamMonth(2028, 1), 29)
    assert.equal(daysInVietnamMonth(2100, 1), 28)
    assert.equal(daysInVietnamMonth(2000, 1), 29)
  })
  it('adds calendar months and keeps the time of day', () => {
    assert.equal(addCalendarMonthsVietnam(vn('2026-01-15T09:30:15.250'), 6).getTime(), vn('2026-07-15T09:30:15.250').getTime())
    assert.equal(addCalendarMonthsVietnam(vn('2026-11-22T00:00:00'), 3).getTime(), vn('2027-02-22T00:00:00').getTime())
    assert.equal(addCalendarMonthsVietnam(vn('2026-03-10T12:00:00'), -4).getTime(), vn('2025-11-10T12:00:00').getTime())
    assert.equal(addCalendarMonthsVietnam(vn('2026-03-10T12:00:00'), 0).getTime(), vn('2026-03-10T12:00:00').getTime())
  })
  it('clamps to the last day of a shorter month (31/08 + 6 months = 28/02, 29/02 in a leap year)', () => {
    assert.equal(addCalendarMonthsVietnam(vn('2026-08-31T08:00:00'), 6).getTime(), vn('2027-02-28T08:00:00').getTime())
    assert.equal(addCalendarMonthsVietnam(vn('2027-08-31T08:00:00'), 6).getTime(), vn('2028-02-29T08:00:00').getTime())
    assert.equal(addCalendarMonthsVietnam(vn('2026-01-31T08:00:00'), 3).getTime(), vn('2026-04-30T08:00:00').getTime())
  })
  it('uses the Vietnamese date, not the UTC date, around midnight', () => {
    // 00:30 on 1 July in Vietnam is still 30 June in UTC.
    const start = vn('2026-07-01T00:30:00')
    assert.equal(start.toISOString(), '2026-06-30T17:30:00.000Z')
    assert.deepEqual(getVietnamParts(start), { year: 2026, month: 7, day: 1, hour: 0, minute: 30, second: 0, ms: 0 })
    assert.equal(addCalendarMonthsVietnam(start, 6).getTime(), vn('2027-01-01T00:30:00').getTime())
    assert.deepEqual(getVietnamParts(new Date('2026-12-31T17:00:00.000Z')), { year: 2027, month: 1, day: 1, hour: 0, minute: 0, second: 0, ms: 0 })
  })
})

describe('mức độ gấp của hạn học', () => {
  const key = (days: number | null) => getUrgencyLevel(days).key
  it('maps remaining days to the right level at every boundary', () => {
    const expected: Array<[number, string]> = [
      [1, 'URGENT_1D'], [2, 'URGENT_3D'], [3, 'URGENT_3D'], [4, 'URGENT_5D'], [5, 'URGENT_5D'], [6, 'URGENT_10D'], [10, 'URGENT_10D'],
      [11, 'URGENT_15D'], [15, 'URGENT_15D'], [16, 'URGENT_20D'], [20, 'URGENT_20D'], [21, 'URGENT_30D'], [30, 'URGENT_30D'], [31, 'RELAXED_OVER_30D'], [365, 'RELAXED_OVER_30D'],
    ]
    for (const [days, level] of expected) assert.equal(key(days), level, `${days} ngày`)
  })
  it('an overdue deadline says how many days late and is the only state besides the last 24h that pulses', () => {
    assert.deepEqual([key(-1), getUrgencyLevel(-1).label, getUrgencyLevel(-12).badgeText], ['OVERDUE', 'Quá hạn 1 ngày', '🚨 Quá hạn 12 ngày'])
    assert.deepEqual([-3, 1, 2, 5, 10, 20, 30, 60, null].map((days) => getUrgencyLevel(days).isPulse), [true, true, false, false, false, false, false, false, false])
  })
  it('no deadline is shown as a plain mandatory course, without a countdown or alarm', () => {
    const none = getUrgencyLevel(null)
    assert.equal(none.label, 'Khóa học bắt buộc')
    assert.equal(none.isPulse, false)
    assert.doesNotMatch(none.badgeText, /Còn|Quá hạn|\d/)
  })
  it('the label never promises more time than is left', () => {
    for (let days = 1; days <= 30; days += 1) {
      const promised = Number(getUrgencyLevel(days).label.match(/dưới (\d+)/)?.[1].replace('24', '1'))
      assert.ok(days <= promised, `${days} ngày hiển thị "${getUrgencyLevel(days).label}"`)
    }
  })
  it('every level has text and colours so the badge is never blank', () => {
    for (const days of [null, -2, 1, 3, 5, 10, 15, 20, 30, 45]) {
      const level = getUrgencyLevel(days)
      for (const field of ['label', 'badgeText', 'textColor', 'bgColor', 'borderColor'] as const) assert.ok(level[field], `${days}: ${field}`)
      assert.ok(level.badgeText.includes(level.label))
    }
  })
})

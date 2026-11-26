import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildChapterExclusionPills, formatMonthKeyLabel } from '../lib/chapter-exclusion-pills'

describe('formatMonthKeyLabel', () => {
  it('formats YYYY-MM month key into Vietnamese MM/YYYY label', () => {
    assert.equal(formatMonthKeyLabel('2026-11'), 'tháng 11/2026')
    assert.equal(formatMonthKeyLabel('2026-03'), 'tháng 03/2026')
  })

  it('falls back cleanly when month key is missing or malformed', () => {
    assert.equal(formatMonthKeyLabel(null), 'tháng này')
    assert.equal(formatMonthKeyLabel(''), 'tháng này')
    assert.equal(formatMonthKeyLabel('invalid'), 'tháng này')
  })
})

describe('buildChapterExclusionPills', () => {
  it('hides passing conditions and renders only failing/missing pills matching Admin style', () => {
    const pills = buildChapterExclusionPills(
      {
        conditions: [
          { kind: 'MEMBER_COUNT', value: 21, threshold: 20, operator: 'GT', state: 'PASS', reasonCode: null },
          { kind: 'CORE_COMPLETION', value: 0.07, threshold: 0.5, operator: 'GTE', state: 'FAIL', reasonCode: 'CORE_COMPLETION_BELOW_50_PERCENT' },
          { kind: 'KPI', value: 'GREEN', threshold: ['YELLOW', 'GREEN'], operator: 'IN', state: 'PASS', reasonCode: null },
        ],
      },
      { monthKey: '2026-11' }
    )

    assert.deepEqual(pills, [
      {
        key: 'CORE_COMPLETION',
        icon: '📘',
        text: 'Chưa đạt 50% thành viên ≥70% (7% đã đạt)',
        tone: 'amber',
      },
    ])
  })

  it('renders all three pills for typical excluded chapter with month label on missing KPI', () => {
    const pills = buildChapterExclusionPills(
      {
        conditions: [
          { kind: 'MEMBER_COUNT', value: 11, threshold: 20, operator: 'GT', state: 'FAIL', reasonCode: 'MEMBER_COUNT_NOT_ABOVE_20' },
          { kind: 'CORE_COMPLETION', value: 0, threshold: 0.5, operator: 'GTE', state: 'FAIL', reasonCode: 'CORE_COMPLETION_BELOW_50_PERCENT' },
          { kind: 'KPI', value: null, threshold: ['YELLOW', 'GREEN'], operator: 'IN', state: 'MISSING_DATA', reasonCode: 'WAITING_KPI' },
        ],
      },
      { monthKey: '2026-11' }
    )

    assert.deepEqual(pills, [
      { key: 'MEMBER_COUNT', icon: '👥', text: 'Chưa có trên 20 thành viên (11 học viên)', tone: 'amber' },
      { key: 'CORE_COMPLETION', icon: '📘', text: 'Chưa đạt 50% thành viên ≥70% (0% đã đạt)', tone: 'amber' },
      { key: 'KPI', icon: '📅', text: 'Chưa nhập KPI tháng 11/2026', tone: 'slate' },
    ])
  })

  it('renders ROSTER_ZERO chapter cleanly matching BBE FLY CHAPTER card in Admin UI', () => {
    const pills = buildChapterExclusionPills(
      {
        conditions: [
          { kind: 'MEMBER_COUNT', value: 0, threshold: 20, operator: 'GT', state: 'FAIL', reasonCode: 'ROSTER_ZERO' },
          { kind: 'CORE_COMPLETION', value: null, threshold: 0.5, operator: 'GTE', state: 'MISSING_DATA', reasonCode: 'ROSTER_ZERO' },
          { kind: 'KPI', value: null, threshold: ['YELLOW', 'GREEN'], operator: 'IN', state: 'MISSING_DATA', reasonCode: 'WAITING_KPI' },
        ],
      },
      { monthKey: '2026-11' }
    )

    assert.deepEqual(pills, [
      { key: 'MEMBER_COUNT', icon: '👥', text: 'Không có thành viên', tone: 'amber' },
      { key: 'CORE_COMPLETION', icon: '📘', text: 'Chưa đạt 50% thành viên ≥70% (0% đã đạt)', tone: 'amber' },
      { key: 'KPI', icon: '📅', text: 'Chưa nhập KPI tháng 11/2026', tone: 'slate' },
    ])
  })

  it('handles CORE_LESSONS_ZERO and RED/BLACK KPI with red tone', () => {
    const pills = buildChapterExclusionPills(
      {
        conditions: [
          { kind: 'MEMBER_COUNT', value: 25, threshold: 20, operator: 'GT', state: 'PASS', reasonCode: null },
          { kind: 'CORE_COMPLETION', value: null, threshold: 0.5, operator: 'GTE', state: 'MISSING_DATA', reasonCode: 'CORE_LESSONS_ZERO' },
          { kind: 'KPI', value: 'RED', threshold: ['YELLOW', 'GREEN'], operator: 'IN', state: 'FAIL', reasonCode: 'KPI_NOT_ELIGIBLE' },
        ],
      },
      { monthKey: '2026-11' }
    )

    assert.deepEqual(pills, [
      { key: 'CORE_COMPLETION', icon: '📚', text: 'Chưa có bài học cốt lõi', tone: 'amber' },
      { key: 'KPI', icon: '🔴', text: 'KPI Đỏ hoặc Đen', tone: 'red' },
    ])
  })

  it('never rounds failing completion percentage up to 50% in both condition and reasonCode paths', () => {
    const conditionPills = buildChapterExclusionPills({
      conditions: [
        { kind: 'MEMBER_COUNT', value: 25, threshold: 20, operator: 'GT', state: 'PASS', reasonCode: null },
        { kind: 'CORE_COMPLETION', value: 0.4996, threshold: 0.5, operator: 'GTE', state: 'FAIL', reasonCode: 'CORE_COMPLETION_BELOW_50_PERCENT' },
        { kind: 'KPI', value: 'GREEN', threshold: ['YELLOW', 'GREEN'], operator: 'IN', state: 'PASS', reasonCode: null },
      ],
    })

    assert.equal(conditionPills.length, 1)
    assert.equal(conditionPills[0].text, 'Chưa đạt 50% thành viên ≥70% (49,9% đã đạt)')

    const reasonPills = buildChapterExclusionPills({
      exclusionReasons: ['CORE_COMPLETION_BELOW_50_PERCENT'],
      atLeast70Percent: 49.96,
    })
    assert.equal(reasonPills.length, 1)
    assert.equal(reasonPills[0].text, 'Chưa đạt 50% thành viên ≥70% (49,9% đã đạt)')
  })

  it('distinguishes SNAPSHOT_CONDITIONS_MISSING KPI from missing monthly KPI input', () => {
    const pills = buildChapterExclusionPills(
      {
        conditions: [
          { kind: 'MEMBER_COUNT', value: 25, threshold: 20, operator: 'GT', state: 'PASS', reasonCode: null },
          { kind: 'CORE_COMPLETION', value: 0.8, threshold: 0.5, operator: 'GTE', state: 'PASS', reasonCode: null },
          { kind: 'KPI', value: null, threshold: ['YELLOW', 'GREEN'], operator: 'IN', state: 'MISSING_DATA', reasonCode: 'SNAPSHOT_CONDITIONS_MISSING' },
        ],
      },
      { monthKey: '2026-11' }
    )

    assert.deepEqual(pills, [
      { key: 'KPI', icon: '📅', text: 'Chưa có dữ liệu KPI', tone: 'slate' },
    ])
  })

  it('maps term exclusionReasons without leaking raw enum codes', () => {
    const pills = buildChapterExclusionPills({
      exclusionReasons: ['NO_ELIGIBLE_CLOSED_MONTH', 'SOME_FUTURE_UNKNOWN_CODE'],
    })

    assert.deepEqual(pills, [
      { key: 'NO_ELIGIBLE_CLOSED_MONTH', icon: '📅', text: 'Chưa có tháng đã chốt nào đủ điều kiện', tone: 'amber' },
      { key: 'SOME_FUTURE_UNKNOWN_CODE', icon: '⚠️', text: 'Chưa đủ dữ liệu để xếp hạng', tone: 'slate' },
    ])
    for (const pill of pills) {
      assert.doesNotMatch(pill.text, /[A-Z]+_[A-Z_0-9]+/)
    }
  })
})

import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CHAPTER_ROSTER_COLUMNS, EXACT_7_BANS, ORDERED_7_BANS, ORDERED_CHAPTER_ROSTER } from '../lib/departments'
import { STANDARD_DEPARTMENTS } from '../lib/learning-catalog'
import { buildInvitationUrl } from '../lib/invitation-link'
import { design } from '../lib/design'
import { getCachedMemberLeaderboard, invalidateMemberLeaderboardCache, setCachedMemberLeaderboard } from '../lib/member-leaderboard-cache'
import { getCachedChapterLeaderboard, setCachedChapterLeaderboard } from '../lib/chapter-leaderboard-cache'
import { getServerMetadataCache, getUserQueryCache, setServerMetadataCache, setUserQueryCache } from '../lib/server-cache'
import { invalidateOrganizationViews } from '../lib/organization-view-cache'
import { copyTextLater } from '../lib/clipboard'
import { soundEffects } from '../lib/audio-effects'

describe('7 ban chuẩn của Chapter', () => {
  it('every list names the same seven departments, each once', () => {
    assert.equal(new Set(EXACT_7_BANS).size, 7)
    assert.deepEqual([...ORDERED_7_BANS].sort(), [...EXACT_7_BANS].sort())
    assert.deepEqual(STANDARD_DEPARTMENTS.map(([, name]) => name).sort(), [...EXACT_7_BANS].sort(), 'the learning catalogue uses the same seven names')
  })
  it('the roster starts with the President followed by the seven departments in display order', () => {
    assert.deepEqual(ORDERED_CHAPTER_ROSTER, ['Chủ Tịch', ...ORDERED_7_BANS])
    assert.deepEqual(CHAPTER_ROSTER_COLUMNS.map((column) => column.key), [...ORDERED_CHAPTER_ROSTER])
    for (const column of CHAPTER_ROSTER_COLUMNS) {
      assert.equal(column.label, column.key)
      assert.equal(column.shortLabel, column.key.replace(/^Ban /, ''))
    }
  })
})

describe('link kích hoạt lời mời', () => {
  const previous = process.env.NEXT_PUBLIC_APP_URL
  afterEach(() => { if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = previous })
  it('points at the configured site and falls back to localhost only when nothing is configured', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://hoc.bbe.example'
    assert.equal(buildInvitationUrl('abc123'), 'https://hoc.bbe.example/accept-invitation?token=abc123')
    delete process.env.NEXT_PUBLIC_APP_URL
    assert.equal(buildInvitationUrl('abc123'), 'http://localhost:3000/accept-invitation?token=abc123')
  })
})

describe('bảng màu', () => {
  it('every colour is a hex value and text on the surface is readable (contrast at least 4.5:1)', () => {
    for (const [name, value] of Object.entries(design.colors)) assert.match(value, /^#[0-9a-fA-F]{6}$/, name)
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
    for (const text of ['onSurface', 'onSurfaceVariant', 'navy', 'primary', 'error'] as const) {
      assert.ok(contrast(design.colors[text], design.colors.surface) >= 4.5, `${text} trên nền: ${contrast(design.colors[text], design.colors.surface).toFixed(2)}`)
    }
    assert.ok(contrast(design.colors.white, design.colors.primary) >= 4.5, 'chữ trắng trên nút chính')
  })
  it('BUG-UX-CONTRAST: the secondary text colour (outline, used for hints and captions) is readable on the surface', { todo: 'BUG-UX-CONTRAST: known defect, see docs/qa/defects.md' }, () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const [hi, lo] = [luminance(design.colors.outline), luminance(design.colors.surface)].sort((x, y) => y - x)
    assert.ok((hi + 0.05) / (lo + 0.05) >= 4.5, `tỉ lệ tương phản ${((hi + 0.05) / (lo + 0.05)).toFixed(2)}:1`)
  })
})

describe('bộ nhớ đệm bảng xếp hạng', () => {
  it('serves a cached member leaderboard for under 30 seconds, then expires', () => {
    invalidateMemberLeaderboardCache()
    assert.equal(getCachedMemberLeaderboard(1_000), null)
    setCachedMemberLeaderboard([{ rank: 1 }], 1_000)
    assert.deepEqual(getCachedMemberLeaderboard(30_999), [{ rank: 1 }])
    assert.equal(getCachedMemberLeaderboard(31_000), null)
    setCachedMemberLeaderboard([], 5_000)
    assert.deepEqual(getCachedMemberLeaderboard(5_001), [], 'an empty leaderboard is still a cached answer')
    invalidateMemberLeaderboardCache()
    assert.equal(getCachedMemberLeaderboard(5_001), null)
  })
  it('an organisation change clears every list that shows people, units or rankings', () => {
    const now = Date.now()
    setCachedMemberLeaderboard([{ rank: 1 }], now)
    setCachedChapterLeaderboard({ rows: [] }, 'latest', now)
    setUserQueryCache('users:page=1', { items: [1] })
    setServerMetadataCache({ stats: {}, publishedCourses: [] })
    invalidateOrganizationViews()
    assert.equal(getCachedMemberLeaderboard(now), null)
    assert.equal(getCachedChapterLeaderboard('latest', now), null)
    assert.equal(getUserQueryCache('users:page=1', 60_000), null)
    assert.equal(getServerMetadataCache(60_000), null)
  })
})

describe('sao chép link mời vào clipboard', () => {
  const globals = globalThis as any
  const saved = { navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), ClipboardItem: globals.ClipboardItem, document: globals.document }
  const setNavigator = (value: unknown) => Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })
  afterEach(() => {
    if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator); else delete globals.navigator
    globals.ClipboardItem = saved.ClipboardItem
    globals.document = saved.document
  })
  const fakeDocument = (copies: boolean | Error) => {
    const state = { appended: 0, removed: 0, value: '' }
    globals.document = {
      createElement: () => ({ style: {}, setAttribute() {}, select() {}, set value(text: string) { state.value = text } }),
      body: { appendChild() { state.appended += 1 }, removeChild() { state.removed += 1 } },
      execCommand: () => { if (copies instanceof Error) throw copies; return copies },
    }
    return state
  }
  it('uses the async clipboard with a pending value so the click permission is kept', async () => {
    let written: any
    globals.ClipboardItem = class { constructor(public items: Record<string, Promise<Blob>>) {} }
    setNavigator({ clipboard: { write: async (items: any[]) => { written = await (await items[0].items['text/plain']).text() } } })
    assert.equal(await copyTextLater(Promise.resolve('https://bbe.example/accept-invitation?token=t')), 'copied')
    assert.equal(written, 'https://bbe.example/accept-invitation?token=t')
  })
  it('falls back to writeText, then to the hidden textarea', async () => {
    globals.ClipboardItem = undefined
    let text = ''
    setNavigator({ clipboard: { writeText: async (value: string) => { text = value } } })
    assert.equal(await copyTextLater(Promise.resolve('link')), 'copied')
    assert.equal(text, 'link')
    setNavigator({ clipboard: { writeText: async () => { throw new Error('NotAllowedError') } } })
    const state = fakeDocument(true)
    assert.equal(await copyTextLater(Promise.resolve('link-2')), 'copied')
    assert.deepEqual(state, { appended: 1, removed: 1, value: 'link-2' })
  })
  it('reports failure instead of pretending the link was copied', async () => {
    globals.ClipboardItem = undefined
    setNavigator({})
    fakeDocument(false)
    assert.equal(await copyTextLater(Promise.resolve('link')), 'failed')
    fakeDocument(new Error('blocked'))
    assert.equal(await copyTextLater(Promise.resolve('link')), 'failed')
  })
  it('reports no_text when the link could not be fetched, and never touches the clipboard', async () => {
    globals.ClipboardItem = undefined
    let touched = false
    setNavigator({ clipboard: { writeText: async () => { touched = true } } })
    assert.equal(await copyTextLater(Promise.resolve(null)), 'no_text')
    assert.equal(await copyTextLater(Promise.reject(new Error('network'))), 'no_text')
    assert.equal(touched, false)
  })
})

describe('âm thanh nhận sao', () => {
  const globals = globalThis as any
  afterEach(() => { delete globals.window })
  it('is silent and safe on the server and in browsers without Web Audio', () => {
    assert.doesNotThrow(() => soundEffects.playStarChime())
    globals.window = {}
    assert.doesNotThrow(() => soundEffects.playStarChime())
  })
  it('plays four notes, each with a shimmer overtone, and never throws when the browser blocks audio', () => {
    const started: number[] = []
    let resumed = 0
    const node = () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } })
    class FakeAudioContext {
      currentTime = 10
      state = 'suspended'
      destination = {}
      resume() { resumed += 1; return Promise.reject(new Error('NotAllowedError')) }
      createGain() { return node() }
      createOscillator() { return { type: '', frequency: { setValueAtTime(freq: number) { started.push(freq) } }, connect() {}, start() {}, stop() {} } }
    }
    globals.window = { AudioContext: FakeAudioContext }
    soundEffects.playStarChime()
    assert.deepEqual(started, [523.25, 1046.5, 659.25, 1318.5, 783.99, 1567.98, 1046.5, 2093])
    assert.equal(resumed, 1)
    globals.window = { AudioContext: class { constructor() { throw new Error('blocked') } } }
    assert.doesNotThrow(() => soundEffects.playStarChime())
  })
})

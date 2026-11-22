import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fetchYouTubeInfo, formatDuration, lookupYouTube, parseIsoDuration, parseYouTubeVideoId } from '../lib/youtube/duration'

// Rule: the lesson duration drives "watched the whole video" and the star reward, so it is never invented.
const ID = 'dQw4w9WgXcQ'
type Reply = { status?: number; json?: unknown; text?: string } | 'network-error'
type Routes = { api?: Reply; oembed?: Reply; watch?: Reply; player?: Reply | Reply[] }
let calls: string[] = []
const realFetch = globalThis.fetch
const realKey = process.env.YOUTUBE_API_KEY
const realTimeout = globalThis.setTimeout
function serve(routes: Routes) {
  let playerCall = 0
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input)
    const kind = url.includes('googleapis.com/youtube/v3') ? 'api' : url.includes('/oembed') ? 'oembed' : url.includes('/youtubei/v1/player') ? 'player' : url.includes('/watch?') ? 'watch' : 'other'
    calls.push(kind)
    assert.notEqual(kind, 'other', `unexpected request to ${url}`)
    let reply = routes[kind as keyof Routes] ?? { status: 404 }
    if (Array.isArray(reply)) reply = reply[Math.min(playerCall++, reply.length - 1)]
    if (reply === 'network-error') throw new TypeError('fetch failed')
    const body = reply.text ?? JSON.stringify(reply.json ?? {})
    return new Response(body, { status: reply.status ?? 200 })
  }) as typeof fetch
}
beforeEach(() => {
  calls = []
  delete process.env.YOUTUBE_API_KEY
  // The module backs off between retries; run those waits immediately.
  globalThis.setTimeout = ((handler: () => void) => realTimeout(handler, 0)) as unknown as typeof setTimeout
})
afterEach(() => {
  globalThis.fetch = realFetch
  globalThis.setTimeout = realTimeout
  if (realKey === undefined) delete process.env.YOUTUBE_API_KEY
  else process.env.YOUTUBE_API_KEY = realKey
})
const watchHtml = (fields: string) => `<html><title>Bài học số 1 - YouTube</title><script>{"playabilityStatus":{"status":"OK"},${fields}}</script></html>`

describe('tách ID video từ link Admin dán', () => {
  for (const link of [
    ID, `https://www.youtube.com/watch?v=${ID}`, `https://youtube.com/watch?feature=share&v=${ID}&t=30s`, `https://youtu.be/${ID}`, `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/embed/${ID}`, `https://www.youtube.com/shorts/${ID}`, `https://m.youtube.com/watch?v=${ID}`, `  https://www.youtube.com/watch?v=${ID}  `,
    `https://www.youtube.com/v/${ID}`,
  ]) it(`reads ${link.trim()}`, () => assert.equal(parseYouTubeVideoId(link), ID))
  // The module supports recorded livestreams, and YouTube's share link for them is /live/<id>.
  it('BUG-YOUTUBE-LIVE-LINK: reads the share link of a recorded livestream', { todo: 'BUG-YOUTUBE-LIVE-LINK: known defect, see docs/qa/defects.md' }, () => {
    assert.equal(parseYouTubeVideoId(`https://www.youtube.com/live/${ID}`), ID)
    assert.equal(parseYouTubeVideoId(`https://www.youtube.com/live/${ID}?si=abc`), ID)
  })
  for (const link of ['', '   ', 'https://vimeo.com/123456789', 'https://www.youtube.com/', 'ngắn', 'https://www.youtube.com/watch?v=short', 'quá dài không phải id']) {
    it(`returns nothing for "${link}"`, () => assert.equal(parseYouTubeVideoId(link), ''))
  }
})

describe('hiển thị và đọc thời lượng', () => {
  it('formats seconds for people', () => {
    assert.equal(formatDuration(0), '0:00')
    assert.equal(formatDuration(-5), '0:00')
    assert.equal(formatDuration(5), '0 phút 05 giây')
    assert.equal(formatDuration(754), '12 phút 34 giây')
    assert.equal(formatDuration(3600), '1 giờ 0 phút')
    assert.equal(formatDuration(3723), '1 giờ 2 phút 3 giây')
  })
  it('reads ISO-8601 durations from the YouTube Data API', () => {
    assert.equal(parseIsoDuration('PT1H2M3S'), 3723)
    assert.equal(parseIsoDuration('PT90S'), 90)
    assert.equal(parseIsoDuration('PT12M'), 720)
    assert.equal(parseIsoDuration('P1DT2H'), 93600)
    assert.equal(parseIsoDuration('PT1.6S'), 2)
    for (const bad of [null, undefined, '', 'P0D', 'PT0S', '12:34', 'abc']) assert.equal(parseIsoDuration(bad), 0)
  })
})

describe('tra cứu video', () => {
  it('uses the Data API when a key is configured', async () => {
    process.env.YOUTUBE_API_KEY = 'unit-test-key'
    serve({ api: { json: { items: [{ snippet: { title: 'Tầm nhìn BBE', channelTitle: 'BBE' }, contentDetails: { duration: 'PT12M34S' } }] } }, oembed: { json: { title: 'khác', author_name: 'khác' } }, watch: { status: 429 } })
    const result = await lookupYouTube(ID)
    assert.deepEqual(result, { status: 'ok', reason: null, info: { videoId: ID, title: 'Tầm nhìn BBE', authorName: 'BBE', durationSeconds: 754, durationKnown: true, source: 'api', thumbnail: `https://i.ytimg.com/vi/${ID}/hqdefault.jpg` } })
    assert.ok(!calls.includes('player'))
  })
  it('does not call the Data API without a key and reads the duration from the watch page', async () => {
    serve({ oembed: { json: { title: 'Bài 1', author_name: 'BBE' } }, watch: { text: watchHtml('"lengthSeconds":"600"') } })
    const result = await lookupYouTube(ID)
    assert.ok(result.status === 'ok')
    assert.deepEqual([result.info.durationSeconds, result.info.durationKnown, result.info.source, result.info.title, result.info.authorName], [600, true, 'watch', 'Bài 1', 'BBE'])
    assert.ok(!calls.includes('api'))
  })
  it('falls back to approxDurationMs, then the schema.org duration, then the page title', async () => {
    serve({ oembed: { status: 401 }, watch: { text: watchHtml('"approxDurationMs":"61499"') } })
    let result = await lookupYouTube(ID)
    assert.ok(result.status === 'ok')
    assert.deepEqual([result.info.durationSeconds, result.info.title], [61, 'Bài học số 1'])
    serve({ oembed: { status: 401 }, watch: { text: '<meta itemprop="duration" content="PT2M5S">' } })
    result = await lookupYouTube(ID)
    assert.ok(result.status === 'ok')
    assert.deepEqual([result.info.durationSeconds, result.info.title], [125, 'Video YouTube'])
  })
  it('asks the player endpoint when the watch page hides the duration, trying each client until one answers', async () => {
    serve({ oembed: { json: { title: 'Bài 1' } }, watch: { text: '<html>consent</html>' }, player: [{ status: 400 }, { json: { videoDetails: {} } }, { json: { videoDetails: { lengthSeconds: '321' } } }] })
    const result = await lookupYouTube(ID)
    assert.ok(result.status === 'ok')
    assert.deepEqual([result.info.durationSeconds, result.info.source], [321, 'innertube'])
    assert.equal(calls.filter((kind) => kind === 'player').length, 3)
  })
  it('a running livestream (absurd length) is reported as unknown duration, never as a number', async () => {
    serve({ oembed: { json: { title: 'Trực tiếp' } }, watch: { text: watchHtml('"lengthSeconds":"121601512"') }, player: { json: { videoDetails: { lengthSeconds: '121601512' } } } })
    const result = await lookupYouTube(ID)
    assert.deepEqual(result, { status: 'ok', reason: 'LIVE_STREAM', info: { videoId: ID, title: 'Trực tiếp', authorName: '', durationSeconds: 0, durationKnown: false, source: 'none', thumbnail: `https://i.ytimg.com/vi/${ID}/hqdefault.jpg` } })
  })
  it('a video that exists but whose duration no source reveals stays unknown (Admin must type it)', async () => {
    serve({ oembed: { json: { title: 'Bài 1' } }, watch: { status: 429 }, player: { status: 403 } })
    const result = await lookupYouTube(ID)
    assert.ok(result.status === 'ok')
    assert.deepEqual([result.info.durationSeconds, result.info.durationKnown, result.info.source], [0, false, 'none'])
  })
  it('a deleted or private video is not_found', async () => {
    serve({ oembed: { status: 404 }, watch: { text: '{"playabilityStatus":{"status":"ERROR","reason":"Video unavailable"}}' } })
    assert.deepEqual(await lookupYouTube(ID), { status: 'not_found', reason: 'NOT_FOUND' })
    serve({ oembed: { status: 401 }, watch: { text: '{"playabilityStatus":{"status":"UNPLAYABLE"}}' } })
    assert.deepEqual(await lookupYouTube(ID), { status: 'not_found', reason: 'NOT_FOUND' })
    assert.equal(await fetchYouTubeInfo(ID), null)
  })
  it('the phrase "Video unavailable" elsewhere in a playable page does not mark the video as missing', async () => {
    serve({ oembed: { status: 401 }, watch: { text: watchHtml('"lengthSeconds":"90","related":"Video unavailable"') } })
    const result = await lookupYouTube(ID)
    assert.ok(result.status === 'ok')
    assert.equal(result.info.durationSeconds, 90)
  })
  it('when YouTube cannot be reached at all the answer is lookup_failed (retry), not "video does not exist"', async () => {
    serve({ oembed: 'network-error', watch: 'network-error' })
    assert.deepEqual(await lookupYouTube(ID), { status: 'lookup_failed', reason: 'FETCH_FAILED' })
    assert.equal(calls.filter((kind) => kind === 'oembed').length, 3, 'each source is tried 3 times')
    assert.equal(await fetchYouTubeInfo(ID), null)
  })
  it('one unreachable source does not hide a video another source confirms', async () => {
    serve({ oembed: 'network-error', watch: { text: watchHtml('"lengthSeconds":"45"') } })
    const result = await lookupYouTube(ID)
    assert.ok(result.status === 'ok')
    assert.equal(result.info.durationSeconds, 45)
  })
})

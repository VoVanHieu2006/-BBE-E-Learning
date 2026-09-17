/**
 * Lấy thông tin video YouTube (tiêu đề, tác giả, thời lượng chính xác) — module thuần TS,
 * dùng chung cho API route `youtube/info` và script repair dữ liệu.
 *
 * Thứ tự nguồn:
 *   1. oEmbed  -> xác nhận tồn tại, lấy tiêu đề/tác giả (KHÔNG có thời lượng)
 *   2. Trang watch -> INNERTUBE_API_KEY/VERSION + các mẫu regex thời lượng
 *   3. InnerTube youtubei/v1/player -> videoDetails.lengthSeconds (nguồn thời lượng chính)
 *
 * Nguyên tắc: KHÔNG bao giờ bịa thời lượng. Không xác định được thì trả durationSeconds = 0
 * kèm durationKnown = false để lớp trên yêu cầu nhập tay.
 */

import { MAX_VIDEO_DURATION_SECONDS } from '../validation/duration'

export interface YouTubeInfo {
  videoId: string
  title: string
  authorName: string
  durationSeconds: number
  durationKnown: boolean
  thumbnail: string
}

/**
 * ok            — kiểm tra xong (thời lượng có thể chưa xác định, xem durationKnown)
 * not_found     — YouTube xác nhận video không tồn tại / riêng tư / không nhúng được
 * lookup_failed — không gọi được YouTube (lỗi mạng). KHÁC với not_found, phải thử lại.
 */
export type YouTubeLookup =
  | { status: 'ok'; info: YouTubeInfo }
  | { status: 'not_found' }
  | { status: 'lookup_failed' }

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// Khoá InnerTube công khai của client WEB (chỉ dùng cho endpoint công khai).
// Chỉ dùng làm phương án cuối khi không trích được khoá từ chính trang watch.
const FALLBACK_INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
const FALLBACK_CLIENT_VERSION = '2.20240101.00.00'
const FETCH_ATTEMPTS = 3

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Livestream trả về lengthSeconds khổng lồ (bằng thời gian đã phát, vd 121601512s),
 * nên chỉ chấp nhận thời lượng nằm trong khoảng hợp lệ.
 */
function isPlausibleDuration(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds >= 1 && seconds <= MAX_VIDEO_DURATION_SECONDS
}

/** Tách ID 11 ký tự từ link YouTube đầy đủ hoặc ID thô. Trả về chuỗi rỗng nếu không tách được. */
export function parseYouTubeVideoId(raw: string): string {
  const text = (raw || '').trim()
  if (!text) return ''

  const match = text.match(
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/\s]{11})/i
  )
  if (match && match[1]) return match[1]

  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text

  return ''
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const remM = m % 60
    return `${h} giờ ${remM} phút ${s > 0 ? `${s} giây` : ''}`.trim()
  }
  return `${m} phút ${s.toString().padStart(2, '0')} giây`
}

/**
 * fetch kèm retry cho lỗi mạng tạm thời. Trả về null CHỈ khi mọi lần thử đều ném lỗi
 * (tức là không nhận được phản hồi HTTP nào) — để phân biệt với lỗi 404 của YouTube.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response | null> {
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      return await fetch(url, init)
    } catch {
      if (attempt < FETCH_ATTEMPTS - 1) await sleep(400 * (attempt + 1))
    }
  }
  return null
}

function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

function parseIsoDuration(match: RegExpMatchArray): number {
  const h = parseInt(match[1] || '0', 10)
  const m = parseInt(match[2] || '0', 10)
  const s = parseInt(match[3] || '0', 10)
  return h * 3600 + m * 60 + s
}

interface OEmbedResult {
  value: { title: string; authorName: string } | null
  networkError: boolean
}

async function fetchOEmbed(videoId: string): Promise<OEmbedResult> {
  const res = await fetchWithRetry(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
    { headers: { 'User-Agent': UA }, cache: 'no-store' }
  )

  if (!res) return { value: null, networkError: true }
  if (!res.ok) return { value: null, networkError: false }

  try {
    const data = await res.json()
    return { value: { title: data?.title || '', authorName: data?.author_name || '' }, networkError: false }
  } catch {
    return { value: null, networkError: true }
  }
}

interface WatchPage {
  valid: boolean
  isLiveContent: boolean
  durationSeconds: number
  title: string
  innertubeKey: string
  innertubeClientVersion: string
}

interface WatchPageResult {
  page: WatchPage
  networkError: boolean
}

const EMPTY_WATCH_PAGE: WatchPage = {
  valid: false,
  isLiveContent: false,
  durationSeconds: 0,
  title: '',
  innertubeKey: '',
  innertubeClientVersion: '',
}

async function fetchWatchPage(videoId: string): Promise<WatchPageResult> {
  const res = await fetchWithRetry(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    },
    cache: 'no-store',
  })

  if (!res) return { page: EMPTY_WATCH_PAGE, networkError: true }
  if (!res.ok) return { page: EMPTY_WATCH_PAGE, networkError: false }

  let html: string
  try {
    html = await res.text()
  } catch {
    return { page: EMPTY_WATCH_PAGE, networkError: true }
  }

  const page: WatchPage = { ...EMPTY_WATCH_PAGE }

  const isUnavailable =
    html.includes('"playabilityStatus":{"status":"ERROR"') ||
    html.includes('"playabilityStatus":{"status":"UNPLAYABLE"') ||
    html.includes('Video unavailable') ||
    html.includes("This video isn't available anymore")

  if (!isUnavailable) {
    page.valid = true

    const liveMatch = html.match(/"isLiveContent"\s*:\s*(true|false)/)
    page.isLiveContent = liveMatch ? liveMatch[1] === 'true' : false

    // Livestream không có thời lượng cố định — bỏ qua lengthSeconds khổng lồ của nó
    if (!page.isLiveContent) {
      const lenMatch = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/)
      const approxMatch = html.match(/"approxDurationMs"\s*:\s*"(\d+)"/)
      const schemaMatch = html.match(/itemprop="duration" content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/)

      let seconds = 0
      if (lenMatch && lenMatch[1]) {
        seconds = parseInt(lenMatch[1], 10)
      } else if (approxMatch && approxMatch[1]) {
        seconds = Math.round(parseInt(approxMatch[1], 10) / 1000)
      } else if (schemaMatch) {
        seconds = parseIsoDuration(schemaMatch)
      }

      if (isPlausibleDuration(seconds)) page.durationSeconds = seconds
    }

    const titleTagMatch = html.match(/<title>([^<]+)<\/title>/)
    if (titleTagMatch && titleTagMatch[1]) {
      page.title = titleTagMatch[1].replace(' - YouTube', '').trim()
    }
  }

  const keyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)
  const verMatch = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)
  page.innertubeKey = keyMatch ? keyMatch[1] : ''
  page.innertubeClientVersion = verMatch ? verMatch[1] : ''

  return { page, networkError: false }
}

/**
 * Gọi InnerTube player để lấy lengthSeconds — nguồn thời lượng đáng tin nhất,
 * hoạt động cả khi trang watch bị chặn scrape.
 */
async function fetchPlayerDuration(
  videoId: string,
  apiKey: string,
  clientName: string,
  clientVersion: string
): Promise<number> {
  const client: Record<string, any> = { clientName, clientVersion, hl: 'vi', gl: 'VN' }
  if (clientName === 'ANDROID') client.androidSdkVersion = 30

  const res = await fetchWithRetry(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    },
    body: JSON.stringify({ context: { client }, videoId, contentCheckOk: true, racyCheckOk: true }),
    cache: 'no-store',
  })

  if (!res || !res.ok) return 0

  try {
    const data = await res.json()
    if (data?.videoDetails?.isLiveContent === true) return 0
    const lengthRaw = data?.videoDetails?.lengthSeconds
    const seconds = lengthRaw ? parseInt(String(lengthRaw), 10) : 0
    return isPlausibleDuration(seconds) ? seconds : 0
  } catch {
    return 0
  }
}

/**
 * Tra cứu đầy đủ, phân biệt rõ 3 kết quả (xem YouTubeLookup).
 * Nếu video tồn tại nhưng không xác định được thời lượng (live, premiere, bị chặn đo),
 * trả status 'ok' với durationKnown = false — KHÔNG bịa số.
 */
export async function lookupYouTube(videoId: string): Promise<YouTubeLookup> {
  const [oembed, watchResult] = await Promise.all([fetchOEmbed(videoId), fetchWatchPage(videoId)])
  const watch = watchResult.page

  // Cả hai nguồn đều không nhận được phản hồi HTTP => lỗi mạng, chưa thể kết luận
  if (oembed.networkError && watchResult.networkError) {
    return { status: 'lookup_failed' }
  }

  const exists = Boolean(oembed.value) || watch.valid
  if (!exists) return { status: 'not_found' }

  let durationSeconds = watch.durationSeconds

  if (durationSeconds <= 0 && !watch.isLiveContent) {
    const apiKey = watch.innertubeKey || FALLBACK_INNERTUBE_KEY
    const attempts: Array<{ clientName: string; clientVersion: string; key: string }> = [
      { clientName: 'WEB', clientVersion: watch.innertubeClientVersion || FALLBACK_CLIENT_VERSION, key: apiKey },
      { clientName: 'WEB', clientVersion: FALLBACK_CLIENT_VERSION, key: FALLBACK_INNERTUBE_KEY },
      { clientName: 'ANDROID', clientVersion: '19.09.37', key: FALLBACK_INNERTUBE_KEY },
    ]

    for (const attempt of attempts) {
      const found = await fetchPlayerDuration(videoId, attempt.key, attempt.clientName, attempt.clientVersion)
      if (found > 0) {
        durationSeconds = found
        break
      }
    }
  }

  const durationKnown = isPlausibleDuration(durationSeconds)

  return {
    status: 'ok',
    info: {
      videoId,
      title: oembed.value?.title || watch.title || 'Video YouTube',
      authorName: oembed.value?.authorName || '',
      durationSeconds: durationKnown ? durationSeconds : 0,
      durationKnown,
      thumbnail: thumbnailUrl(videoId),
    },
  }
}

/** Bản rút gọn cho API route: null nghĩa là không dùng được (không tồn tại hoặc lỗi mạng). */
export async function fetchYouTubeInfo(videoId: string): Promise<YouTubeInfo | null> {
  const result = await lookupYouTube(videoId)
  return result.status === 'ok' ? result.info : null
}

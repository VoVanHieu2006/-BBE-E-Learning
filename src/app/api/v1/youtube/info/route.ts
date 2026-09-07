import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/v1/youtube/info?videoId=...
 * Auto-extract YouTube video title, exact duration in seconds, and thumbnail.
 * Strictly verifies video existence & embeddability.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const rawId = url.searchParams.get('videoId') || ''

  // Support full YouTube URLs (standard, shorts, embed, youtu.be) and raw 11-char ID
  let videoId = rawId.trim()
  const match = videoId.match(
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/\s]{11})/i
  )
  if (match && match[1]) {
    videoId = match[1]
  }

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json(
      { error: { code: 'InvalidVideoId', message: 'ID video YouTube phải có đúng 11 ký tự' } },
      { status: 400 }
    )
  }

  try {
    let title = ''
    let authorName = ''
    let isOembedValid = false

    // 1. Verify existence via YouTube oEmbed API
    try {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          cache: 'no-store',
        }
      )

      if (oembedRes.ok) {
        const odata = await oembedRes.json()
        title = odata.title || ''
        authorName = odata.author_name || ''
        isOembedValid = true
      }
    } catch {}

    // 2. Fetch watch page to extract exact duration and verify playability
    let durationSeconds = 0
    let isWatchPageValid = false

    try {
      const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        cache: 'no-store',
      })

      if (pageRes.ok) {
        const html = await pageRes.text()

        // Check playability status
        const isUnavailable =
          html.includes('"playabilityStatus":{"status":"ERROR"') ||
          html.includes('"playabilityStatus":{"status":"UNPLAYABLE"') ||
          html.includes('Video unavailable') ||
          html.includes("This video isn't available anymore")

        if (!isUnavailable) {
          isWatchPageValid = true

          // Exact duration matchers
          const lenMatch = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/)
          const approxMatch = html.match(/"approxDurationMs"\s*:\s*"(\d+)"/)
          const schemaMatch = html.match(/itemprop="duration" content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/)

          if (lenMatch && lenMatch[1]) {
            durationSeconds = parseInt(lenMatch[1], 10)
          } else if (approxMatch && approxMatch[1]) {
            durationSeconds = Math.round(parseInt(approxMatch[1], 10) / 1000)
          } else if (schemaMatch) {
            const h = parseInt(schemaMatch[1] || '0', 10)
            const m = parseInt(schemaMatch[2] || '0', 10)
            const s = parseInt(schemaMatch[3] || '0', 10)
            durationSeconds = h * 3600 + m * 60 + s
          }

          if (!title) {
            const titleTagMatch = html.match(/<title>([^<]+)<\/title>/)
            if (titleTagMatch && titleTagMatch[1]) {
              title = titleTagMatch[1].replace(' - YouTube', '').trim()
            }
          }
        }
      }
    } catch {}

    // If neither oEmbed nor watch page indicates a valid playable video, reject!
    if (!isOembedValid && !isWatchPageValid) {
      return NextResponse.json(
        {
          error: {
            code: 'VideoNotFound',
            message:
              'Video YouTube không tồn tại, ở chế độ riêng tư hoặc không cho phép nhúng. Vui lòng kiểm tra lại link hoặc ID video.',
          },
        },
        { status: 404 }
      )
    }

    // Default duration to at least 60s if YouTube didn't return duration tag (e.g. some live streams)
    const finalDuration = durationSeconds > 0 ? durationSeconds : 180

    return NextResponse.json(
      {
        videoId,
        title: title || 'Video YouTube',
        authorName: authorName || '',
        durationSeconds: finalDuration,
        durationFormatted: formatDuration(finalDuration),
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      },
      { status: 200 }
    )
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: 'FetchError',
          message: 'Lỗi khi kiểm tra thông tin video từ YouTube. Vui lòng thử lại.',
        },
      },
      { status: 500 }
    )
  }
}

function formatDuration(seconds: number): string {
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

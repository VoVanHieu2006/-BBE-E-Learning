import { NextRequest, NextResponse } from 'next/server'
import { formatDuration, lookupYouTube, parseYouTubeVideoId } from '@/lib/youtube/duration'

/**
 * GET /api/v1/youtube/info?videoId=...
 * Trả về tiêu đề, tác giả, thumbnail và thời lượng thật của video YouTube.
 * Nếu không xác định được thời lượng (live/premiere/bị chặn), trả durationKnown = false
 * và durationSeconds = 0 — KHÔNG bịa số mặc định. Admin phải nhập tay trước khi lưu.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const rawId = url.searchParams.get('videoId') || ''
  const videoId = parseYouTubeVideoId(rawId)

  if (!videoId) {
    return NextResponse.json(
      { error: { code: 'InvalidVideoId', message: 'ID video YouTube phải có đúng 11 ký tự' } },
      { status: 400 }
    )
  }

  try {
    const result = await lookupYouTube(videoId)

    if (result.status === 'lookup_failed') {
      return NextResponse.json(
        {
          error: {
            code: 'FetchError',
            message: 'Không kết nối được tới YouTube để kiểm tra video. Vui lòng thử lại.',
          },
        },
        { status: 502 }
      )
    }

    if (result.status === 'not_found') {
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

    const info = result.info

    return NextResponse.json(
      {
        videoId: info.videoId,
        title: info.title,
        authorName: info.authorName,
        durationSeconds: info.durationSeconds,
        durationFormatted: info.durationKnown ? formatDuration(info.durationSeconds) : '',
        durationKnown: info.durationKnown,
        source: info.source,
        reason: result.reason,
        thumbnail: info.thumbnail,
      },
      {
        status: 200,
        // Không cache kết quả chưa xác định được thời lượng (có thể do YouTube chặn tạm thời)
        headers: info.durationKnown
          ? { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' }
          : { 'Cache-Control': 'no-store' },
      }
    )
  } catch {
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

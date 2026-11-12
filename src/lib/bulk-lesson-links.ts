import { parseYouTubeVideoId } from './youtube/duration'

export type BulkLinkStatus = 'ok' | 'invalid' | 'duplicate_in_list' | 'duplicate_existing'

export interface BulkLinkLine {
  /** Số dòng (bắt đầu từ 1) trong ô văn bản admin dán vào — dùng để báo lỗi đúng chỗ. */
  line: number
  raw: string
  videoId: string
  status: BulkLinkStatus
}

export const MAX_BULK_LESSONS = 100
export const MAX_LESSON_TITLE_LENGTH = 255

/**
 * Tách văn bản (mỗi dòng một link YouTube hoặc ID 11 ký tự) thành danh sách theo ĐÚNG thứ tự dòng.
 * - Bỏ dòng trống.
 * - Dòng không nhận diện được video -> 'invalid'.
 * - Video lặp lại trong danh sách (chỉ giữ lần đầu) -> 'duplicate_in_list'.
 * - Video đã có sẵn trong khóa học -> 'duplicate_existing'.
 */
export function parseBulkYoutubeLinks(text: string, existingVideoIds: Iterable<string> = []): BulkLinkLine[] {
  const existing = new Set(existingVideoIds)
  const seen = new Set<string>()
  const rows: BulkLinkLine[] = []

  text.split(/\r\n|\r|\n/).forEach((rawLine, index) => {
    const raw = rawLine.trim()
    if (!raw) return
    const videoId = parseYouTubeVideoId(raw)
    let status: BulkLinkStatus = 'ok'
    if (!videoId) status = 'invalid'
    else if (seen.has(videoId)) status = 'duplicate_in_list'
    else if (existing.has(videoId)) status = 'duplicate_existing'
    if (videoId) seen.add(videoId)
    rows.push({ line: index + 1, raw, videoId, status })
  })

  return rows
}

/** Tiêu đề bài học lấy từ tên video; cắt theo giới hạn cột DB (255) và có dự phòng nếu rỗng. */
export function lessonTitleFromVideo(videoTitle: string | null | undefined): string {
  const title = (videoTitle || '').trim().slice(0, MAX_LESSON_TITLE_LENGTH).trim()
  return title.length >= 2 ? title : 'Video YouTube'
}

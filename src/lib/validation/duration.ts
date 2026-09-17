/**
 * Chuẩn hoá & kiểm tra thời lượng video (đơn vị: giây).
 * Dùng chung cho API route (server) và form admin (client) — module thuần TS, không phụ thuộc Next.
 */

export const MIN_VIDEO_DURATION_SECONDS = 1
export const MAX_VIDEO_DURATION_SECONDS = 43200 // 12 giờ

/**
 * Ép một giá trị thô (từ JSON body, DB, hoặc query) về số nguyên giây hợp lệ.
 * Chỉ nhận số hoặc chuỗi số thuần (vd "754"). Các dạng khác như "3:00", "abc", NaN,
 * số âm, 0, hoặc vượt 12 giờ đều trả về null để caller tự quyết định báo lỗi.
 */
export function normalizeDurationSeconds(value: unknown): number | null {
  let n: number

  if (typeof value === 'number') {
    n = value
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!/^\d+$/.test(trimmed)) return null
    n = Number(trimmed)
  } else {
    return null
  }

  if (!Number.isFinite(n)) return null

  const seconds = Math.trunc(n)
  if (seconds < MIN_VIDEO_DURATION_SECONDS || seconds > MAX_VIDEO_DURATION_SECONDS) return null

  return seconds
}

/**
 * Đọc thời lượng admin nhập tay. Chấp nhận:
 *   "754"      -> 754 giây
 *   "12:34"    -> 754 giây
 *   "1:02:03"  -> 3723 giây
 * Trả về null nếu không hợp lệ.
 */
export function parseDurationInput(value: string): number | null {
  const raw = (value || '').trim()
  if (!raw) return null

  if (raw.includes(':')) {
    const parts = raw.split(':')
    if (parts.length < 2 || parts.length > 3) return null
    if (parts.some((p) => !/^\d+$/.test(p.trim()))) return null

    const nums = parts.map((p) => Number(p.trim()))
    const seconds =
      nums.length === 2 ? nums[0] * 60 + nums[1] : nums[0] * 3600 + nums[1] * 60 + nums[2]

    return normalizeDurationSeconds(seconds)
  }

  return normalizeDurationSeconds(raw)
}

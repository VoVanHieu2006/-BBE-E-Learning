export const FUN_NAME_ANIMALS = [
  'Sóc', 'Chuột', 'Chó', 'Mèo', 'Thỏ', 'Gấu', 'Hổ', 'Sư tử', 'Voi', 'Khỉ',
  'Cáo', 'Sói', 'Hươu', 'Nai', 'Ngựa', 'Heo', 'Bò', 'Dê', 'Cừu', 'Gà',
  'Vịt', 'Ngỗng', 'Chim sẻ', 'Cú mèo', 'Đại bàng', 'Vẹt', 'Chim cánh cụt', 'Rùa', 'Ếch', 'Cá heo',
  'Cá voi', 'Bạch tuộc', 'Cua', 'Ong', 'Bướm', 'Kiến', 'Nhím', 'Gấu trúc', 'Hà mã', 'Rái cá',
] as const

export const FUN_NAME_ADJECTIVES = [
  'nhí nhảnh', 'vui vẻ', 'tức giận', 'lém lỉnh', 'tinh nghịch', 'hiền lành', 'dũng cảm', 'chăm chỉ', 'siêng năng', 'mơ màng',
  'ngái ngủ', 'háu ăn', 'lanh lợi', 'thông thái', 'nhút nhát', 'hào hứng', 'điềm tĩnh', 'tò mò', 'bướng bỉnh', 'đáng yêu',
  'mạnh mẽ', 'nhanh nhẹn', 'thong thả', 'ham học', 'lạc quan', 'bí ẩn', 'hớn hở', 'ngơ ngác', 'tự tin', 'chu đáo',
] as const

export const FUN_NAME_COMBINATIONS = FUN_NAME_ANIMALS.length * FUN_NAME_ADJECTIVES.length

export const RETIRED_ACCOUNT_NAME = 'Tài khoản đã gỡ'

function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Stable, non-persisted playful name so the same user keeps the same name across reloads. */
export function funDisplayName(userId: string): string {
  const index = fnv1a(String(userId ?? '')) % FUN_NAME_COMBINATIONS
  const animal = FUN_NAME_ANIMALS[index % FUN_NAME_ANIMALS.length]
  const adjective = FUN_NAME_ADJECTIVES[Math.floor(index / FUN_NAME_ANIMALS.length)]
  return `${animal} ${adjective}`
}

export type PublicNameSource = {
  display_name?: string | null
  anonymized_at?: Date | string | null
} | null | undefined

/** Name shown to other members: never derived from email. */
export function publicDisplayName(userId: string, user: PublicNameSource): string {
  if (user?.anonymized_at) return RETIRED_ACCOUNT_NAME
  return user?.display_name?.trim() || funDisplayName(userId)
}

/**
 * Name for the member's own greeting: the saved display name, else the stable fun name.
 * Never derived from email. Returns null only when neither a name nor a user id is known yet.
 */
export function greetingName(userId: string | null | undefined, displayName: string | null | undefined): string | null {
  const saved = typeof displayName === 'string' ? displayName.trim() : ''
  if (saved) return saved
  return userId ? funDisplayName(userId) : null
}

/** Ranking row safe for members: drops `email` and fills a complete `displayName`. */
export function publicRankingRow<T extends { userId: string }>(row: T, user: PublicNameSource): Omit<T, 'email' | 'displayName'> & { displayName: string } {
  const { email: _email, displayName: _displayName, ...rest } = row as T & { email?: unknown; displayName?: unknown }
  return { ...rest, displayName: publicDisplayName(row.userId, user) }
}

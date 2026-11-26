const MAX_COVER_URL_LENGTH = 1000
const LOCAL_COVER_PATH = /^\/images\/[A-Za-z0-9._/-]+$/

/**
 * Course cover URL rule: an HTTPS URL (Cloudinary uploads) or a safe path to a
 * bundled image under /images/ (demo/seed covers in public/images).
 */
export function isAllowedCoverUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > MAX_COVER_URL_LENGTH) return false
  if (value.startsWith('https://')) return true
  return LOCAL_COVER_PATH.test(value) && !value.includes('..') && !value.includes('//')
}

import crypto from 'crypto'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { prisma } from './prisma'

function referencesAsset(value: unknown, id: string): boolean {
  if (typeof value === 'string') {
    if (value === id) return true
    // Covers may have been copied by URL without a stored public ID. Prefer
    // retaining an ambiguous URL match to deleting another course's object.
    if (/^https:\/\//.test(value)) {
      try { return decodeURIComponent(value).includes(id) } catch { return true }
    }
    return false
  }
  if (Array.isArray(value)) return value.some(item => referencesAsset(item, id))
  if (value && typeof value === 'object') return Object.values(value).some(item => referencesAsset(item, id))
  return false
}

async function hasLiveReference(id: string, storage: boolean) {
  const [document, covers, drafts] = await Promise.all([
    // Document rows have a lesson FK; this also covers other lessons/courses.
    storage ? prisma.document.findFirst({ where: { storage_key: id }, select: { id: true } }) : null,
    prisma.course.findMany({ select: { cover_public_id: true, cover_url: true } }),
    // Draft content is a nested JSON snapshot (camelCase; tolerate legacy
    // snake_case too). A draft can be the last remaining reference to a file.
    prisma.courseDraft.findMany({ select: { content: true } }),
  ])
  return Boolean(document) || covers.some(cover => referencesAsset(cover, id)) || drafts.some(draft => referencesAsset(draft.content, id))
}

/** Only call AFTER the DB transaction commits. Storage failure never rolls back a successful deletion. */
export async function cleanupDeletedContentAssets(assets: { storageKeys: string[]; coverPublicId: string | null }) {
  for (const key of Array.from(new Set(assets.storageKeys))) {
    try {
      if (await hasLiveReference(key, true)) continue
      const s3 = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } })
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }))
    } catch { console.error('[content-delete] Không xóa được tài liệu R2 sau khi đã xóa nội dung.') }
  }
  if (assets.coverPublicId) {
    try {
      if (await hasLiveReference(assets.coverPublicId, false)) return
      const cloud = process.env.CLOUDINARY_CLOUD_NAME, apiKey = process.env.CLOUDINARY_API_KEY, secret = process.env.CLOUDINARY_API_SECRET
      if (!cloud || !apiKey || !secret) throw new Error('CloudinaryNotConfigured')
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const signature = crypto.createHash('sha1').update(`public_id=${assets.coverPublicId}&timestamp=${timestamp}${secret}`).digest('hex')
      const body = new URLSearchParams({ public_id: assets.coverPublicId, timestamp, api_key: apiKey, signature })
      const response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/destroy`, { method: 'POST', body, signal: AbortSignal.timeout(10_000) })
      const result = await response.json()
      if (!response.ok || !['ok', 'not found'].includes(result.result)) throw new Error('CloudinaryDeleteFailed')
    } catch { console.error('[content-delete] Không xóa được ảnh bìa Cloudinary sau khi đã xóa nội dung.') }
  }
}

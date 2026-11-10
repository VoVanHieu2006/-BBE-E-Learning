import crypto from 'crypto'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'

/** Only call AFTER the DB transaction commits. Storage failure never rolls back a successful deletion. */
export async function cleanupDeletedContentAssets(assets: { storageKeys: string[]; coverPublicId: string | null }) {
  for (const key of Array.from(new Set(assets.storageKeys))) {
    try {
      const s3 = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } })
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }))
    } catch { console.error('[content-delete] Không xóa được tài liệu R2 sau khi đã xóa nội dung.') }
  }
  if (assets.coverPublicId) {
    try {
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

import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

export async function POST(request: NextRequest, { params }: { params: { lessonId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin' } }, { status: 403 })

  const body = await request.json()
  const { fileName, mimeType, fileSize } = body || {}

  if (!fileName || fileName.trim().length < 1) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'fileName bắt buộc' } }, { status: 400 })
  }

  const storageKey = `docs/${params.lessonId}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9.]/g, '-')}`

  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: storageKey,
    ContentType: mimeType || 'application/octet-stream',
  })

  const url = await getSignedUrl(s3, command, { expiresIn: 300 }) // 5 min

  return NextResponse.json({
    storageKey,
    fileName: fileName.trim(),
    mimeType: mimeType || 'application/octet-stream',
    fileSize: fileSize || null,
    uploadUrl: url,
    expiresIn: 300,
  })
}

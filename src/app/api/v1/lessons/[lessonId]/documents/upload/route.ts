import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

/**
 * POST /api/v1/lessons/{lessonId}/documents/upload
 * Direct multipart/form-data upload to Cloudflare R2 + DB record creation
 */
export async function POST(request: NextRequest, { params }: { params: { lessonId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin' } }, { status: 403 })
  }

  const lesson = await prisma.lesson.findUnique({ where: { id: params.lessonId } })
  if (!lesson) {
    return NextResponse.json({ error: { code: 'LessonNotFound', message: 'Bài học không tồn tại' } }, { status: 404 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: { code: 'ValidationError', message: 'Thiếu file tải lên' } }, { status: 400 })
    }

    const fileName = file.name
    const mimeType = file.type || 'application/octet-stream'
    const fileSize = file.size
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const storageKey = `docs/${params.lessonId}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9.]/g, '-')}`

    // 1. Upload to Cloudflare R2
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: storageKey,
        Body: buffer,
        ContentType: mimeType,
      })
    )

    // 2. Create document record in database
    const document = await prisma.document.create({
      data: {
        lesson_id: params.lessonId,
        file_name: fileName,
        storage_key: storageKey,
        mime_type: mimeType,
        file_size: BigInt(fileSize),
      },
    })

    return NextResponse.json({
      documentId: document.id,
      id: document.id,
      fileName: document.file_name,
      storageKey: document.storage_key,
      mimeType: document.mime_type,
      fileSize: Number(document.file_size),
    }, { status: 201 })
  } catch (err: any) {
    console.error('[DOCUMENT UPLOAD ERROR]:', err)
    return NextResponse.json({
      error: { code: 'UploadFailed', message: 'Tải lên tài liệu thất bại: ' + (err.message || 'Lỗi server') },
    }, { status: 500 })
  }
}

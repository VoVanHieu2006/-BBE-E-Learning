import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkLessonProgression } from '@/lib/progression'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

export async function GET(request: NextRequest, { params }: { params: { documentId: string } }) {
  const auth = await authenticate(request).catch(() => ({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Auth error' } }))
  if (!auth.ok || !(auth as any).context) {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Vui lòng đăng nhập để tải tài liệu.' } }, { status: 401 })
  }
  const context = (auth as any).context!

  const doc = await prisma.document.findUnique({
    where: { id: params.documentId },
    include: {
      lesson: {
        include: {
          session: {
            include: {
              course: {
                select: { status: true, visibility: true },
              },
            },
          },
        },
      },
    },
  })

  if (!doc) {
    return NextResponse.json({ error: { code: 'DocumentNotFound', message: 'Tài liệu không tồn tại' } }, { status: 404 })
  }

  const course = doc.lesson?.session?.course

  if (!course || !doc.lesson) {
    return NextResponse.json({ error: { code: 'DocumentNotFound' } }, { status: 404 })
  }
  if (course.status !== 'PUBLISHED' && context.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Khóa học chưa được xuất bản.' } }, { status: 403 })
  }
  if (context.role !== 'ADMIN') {
    const gate = await checkLessonProgression(context.userId, doc.lesson_id, 'VIEW')
    if (gate.ok === false) {
      return NextResponse.json({ error: { code: gate.code, message: gate.message } }, { status: 403 })
    }
  }

  try {
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: doc.storage_key,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(doc.file_name)}"`,
    })
    const url = await getSignedUrl(s3, command, { expiresIn: 300 })

    return NextResponse.json({
      downloadUrl: url,
      fileName: doc.file_name,
      mimeType: doc.mime_type,
      fileSize: Number(doc.file_size),
      expiresIn: 300,
    }, { status: 200 })
  } catch (err: any) {
    console.error('[DOCUMENT DOWNLOAD PRESIGN ERROR]:', err)
    return NextResponse.json({
      error: { code: 'DownloadFailed', message: 'Không thể tạo liên kết tải xuống: ' + (err.message || 'Lỗi R2') },
    }, { status: 500 })
  }
}

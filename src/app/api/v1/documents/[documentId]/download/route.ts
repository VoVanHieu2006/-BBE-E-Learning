import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
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
  const isPublicCourse = course?.visibility === 'PUBLIC' && course?.status === 'PUBLISHED'

  // If course is Private, require active authenticated account
  if (!isPublicCourse) {
    if (!auth.ok || (auth as any).context?.role === undefined) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Cần đăng nhập để tải tài liệu của khóa học nội bộ' } }, { status: 403 })
    }

    const user = await prisma.user.findUnique({ where: { id: (auth as any).context!.userId } })
    if (!user || user.status !== 'ACTIVE') {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Tài khoản phải ở trạng thái Active' } }, { status: 403 })
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

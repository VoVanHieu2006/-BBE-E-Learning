import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DRAFT_UUID } from '@/lib/course-draft'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

export const runtime = 'nodejs'

/** Stages bytes only; the document association is created atomically at draft publish. */
export async function POST(request: NextRequest, { params }: { params: { courseId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context!.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin được tải tài liệu.' } }, { status: 403 })
  if (!DRAFT_UUID.test(params.courseId)) return NextResponse.json({ error: { code: 'CourseNotFound' } }, { status: 404 })
  const course = await prisma.course.findUnique({ where: { id: params.courseId }, select: { status: true } })
  if (course?.status !== 'PUBLISHED') return NextResponse.json({ error: { code: 'CourseNotPublished', message: 'Hãy tải lại trình chỉnh sửa khóa học.' } }, { status: 409 })
  const data = await request.formData().catch(() => null)
  const file = data?.get('file')
  if (!(file instanceof File) || file.size < 1 || file.size > 100 * 1024 * 1024 || file.name.length > 255) return NextResponse.json({ error: { code: 'ValidationError', message: 'Tài liệu phải từ 1 byte đến 100 MB, tên tối đa 255 ký tự.' } }, { status: 400 })
  const storageKey = `docs/drafts/${params.courseId}/${randomUUID()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '-')}`
  const mimeType = file.type || 'application/octet-stream'
  const s3 = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } })
  try {
    await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: storageKey, Body: Buffer.from(await file.arrayBuffer()), ContentType: mimeType }))
    return NextResponse.json({ id: `temp-${randomUUID()}`, fileName: file.name, fileSize: file.size, mimeType, storageKey }, { status: 201 })
  } catch {
    return NextResponse.json({ error: { code: 'UploadFailed', message: 'Không tải được tài liệu. Vui lòng thử lại.' } }, { status: 502 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { lessonId: string } }) {
  try {
    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
    if ((auth as any).context!.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin' } }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const { fileName, storageKey, mimeType, fileSize } = body || {}

    if (!fileName || !storageKey) {
      return NextResponse.json({ error: { code: 'ValidationError', message: 'fileName và storageKey bắt buộc' } }, { status: 400 })
    }

    const document = await prisma.document.create({
      data: {
        lesson_id: params.lessonId,
        file_name: fileName,
        storage_key: storageKey,
        mime_type: mimeType || 'application/octet-stream',
        file_size: BigInt(fileSize || 0),
      },
    })

    return NextResponse.json({
      documentId: document.id,
      fileName: document.file_name,
      storageKey: document.storage_key,
      mimeType: document.mime_type,
      fileSize: Number(document.file_size),
    }, { status: 201 })
  } catch (err: any) {
    console.error('[DOCUMENT CONFIRM ERROR]:', err)
    return NextResponse.json({ error: { code: 'ServerError', message: err.message || 'Lỗi lưu thông tin tài liệu' } }, { status: 500 })
  }
}

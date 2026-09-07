import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

export async function DELETE(request: NextRequest, { params }: { params: { documentId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin' } }, { status: 403 })

  const doc = await prisma.document.findUnique({ where: { id: params.documentId } })
  if (!doc) return NextResponse.json({ error: { code: 'DocumentNotFound', message: 'Tài liệu không tồn tại' } }, { status: 404 })

  // Delete from R2
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: doc.storage_key }))
  } catch (e: any) {
    console.error('[R2] Delete object error:', e.message)
    // Continue to delete DB record even if R2 delete fails
  }

  // Delete DB record
  await prisma.document.delete({ where: { id: params.documentId } })

  return NextResponse.json({ documentId: params.documentId, deleted: true }, { status: 200 })
}

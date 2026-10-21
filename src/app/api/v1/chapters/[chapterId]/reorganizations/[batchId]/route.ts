import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { canAccessChapterPermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { applyDueChapterReorganizations } from '@/lib/chapter-reorganizations'

/**
 * POST /api/v1/chapters/[chapterId]/reorganizations/[batchId]
 * Áp dụng ngay lập tức một đợt chuyển giao nhiệm kỳ đang lên lịch (không cần chờ đến giờ hẹn)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { chapterId: string; batchId: string } }
) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const hasPerm = await canAccessChapterPermission(auth.context!, params.chapterId, 'MANAGE_CHAPTER_MEMBERS')
  if (!hasPerm) {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền quản lý thành viên chapter' } }, { status: 403 })
  }

  const batch = await prisma.chapterReorganization.findFirst({
    where: { id: params.batchId, chapter_id: params.chapterId, status: 'SCHEDULED' },
  })

  if (!batch) {
    return NextResponse.json({ error: { code: 'BatchNotFound', message: 'Không tìm thấy đợt chuyển giao đang lên lịch' } }, { status: 404 })
  }

  // Cập nhật effective_at về thời điểm hiện tại và áp dụng ngay
  const applied = await applyDueChapterReorganizations(new Date(), batch.id, true)
  if (!applied) {
    const failed = await prisma.chapterReorganization.findUnique({ where: { id: batch.id } })
    return NextResponse.json({ error: { code: 'TransferApplyFailed', message: failed?.last_error || 'Đợt chuyển giao đã thay đổi trạng thái. Hãy tải lại.' } }, { status: 409 })
  }

  return NextResponse.json({ success: true, message: 'Đã áp dụng chuyển giao nhiệm kỳ thành công!' })
}

/**
 * DELETE /api/v1/chapters/[chapterId]/reorganizations/[batchId]
 * Hủy một đợt chuyển giao nhiệm kỳ đang lên lịch
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { chapterId: string; batchId: string } }
) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const hasPerm = await canAccessChapterPermission(auth.context!, params.chapterId, 'MANAGE_CHAPTER_MEMBERS')
  if (!hasPerm) {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền quản lý thành viên chapter' } }, { status: 403 })
  }

  const batch = await prisma.chapterReorganization.findFirst({
    where: { id: params.batchId, chapter_id: params.chapterId, status: 'SCHEDULED' },
  })

  if (!batch) {
    return NextResponse.json({ error: { code: 'BatchNotFound', message: 'Không tìm thấy đợt chuyển giao đang lên lịch' } }, { status: 404 })
  }

  // Xóa batch và các item liên quan
  await prisma.chapterReorganization.updateMany({
    where: { id: batch.id, chapter_id: params.chapterId, status: 'SCHEDULED' },
    data: { status: 'CANCELLED', cancelled_at: new Date() },
  })

  return NextResponse.json({ success: true, message: 'Đã hủy đợt chuyển giao nhiệm kỳ đã lên lịch!' })
}

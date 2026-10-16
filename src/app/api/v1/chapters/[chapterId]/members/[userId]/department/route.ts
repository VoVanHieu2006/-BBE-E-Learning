import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { canAccessChapterPermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { reconcileLearningAssignmentsForUser } from '@/lib/learning-assignments'

export async function POST(
  request: NextRequest,
  { params }: { params: { chapterId: string; userId: string } }
) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const isLeader = auth.context!.role === 'CHAPTER_LEADER' || auth.context!.role === 'ADMIN'
  const hasPerm = await canAccessChapterPermission(auth.context!, params.chapterId, 'MANAGE_CHAPTER_MEMBERS')
  if (!isLeader && !hasPerm) {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền quản lý thành viên chapter' } }, { status: 403 })
  }

  const chapter = await prisma.chapter.findUnique({
    where: { id: params.chapterId },
    select: { id: true, organization_unit_id: true },
  })

  if (!chapter || !chapter.organization_unit_id) {
    return NextResponse.json({ error: { code: 'ChapterNotFound', message: 'Chapter không tồn tại' } }, { status: 404 })
  }

  const body = await request.json().catch(() => ({}))
  const departmentUnitId = typeof body.departmentUnitId === 'string' ? body.departmentUnitId.trim() : null

  // Tìm tất cả các ban của Chapter
  const departments = await prisma.organizationUnit.findMany({
    where: { parent_id: chapter.organization_unit_id, type: 'DEPARTMENT' },
    select: { id: true, name: true },
  })
  const deptIds = departments.map((d) => d.id)

  if (departmentUnitId && !deptIds.includes(departmentUnitId)) {
    return NextResponse.json({ error: { code: 'InvalidDepartment', message: 'Ban không thuộc Chapter này' } }, { status: 400 })
  }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    // 1. Kết thúc các membership và position hiện tại trong các Ban thuộc Chapter
    await tx.organizationMembership.updateMany({
      where: {
        user_id: params.userId,
        unit_id: { in: deptIds },
        status: 'ACTIVE',
        ends_at: null,
      },
      data: {
        status: 'ENDED',
        ends_at: now,
      },
    })

    await tx.positionAssignment.updateMany({
      where: {
        user_id: params.userId,
        unit_id: { in: deptIds },
        ends_at: null,
      },
      data: {
        ends_at: now,
      },
    })

    // 2. Nếu có departmentUnitId mới, tạo membership mới
    if (departmentUnitId) {
      await tx.organizationMembership.create({
        data: {
          user_id: params.userId,
          unit_id: departmentUnitId,
          status: 'ACTIVE',
          starts_at: now,
        },
      })
    }
  })

  await reconcileLearningAssignmentsForUser(params.userId).catch(() => {})

  return NextResponse.json({ success: true, departmentUnitId })
}

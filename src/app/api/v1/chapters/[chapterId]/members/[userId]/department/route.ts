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

  const targetDept = departments.find((d) => d.id === departmentUnitId)
  const isPresident = targetDept?.name.toLowerCase() === 'chủ tịch'
  const makeLead = isPresident ? true : Boolean(body.makeLead)

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    // 1. Kết thúc các membership và position hiện tại trong các Ban thuộc Chapter của user này
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
      // Nếu là Ban Chủ Tịch: Đóng toàn bộ membership và position của Chủ tịch cũ (chỉ 0 hoặc 1 người)
      if (isPresident) {
        await tx.organizationMembership.updateMany({
          where: {
            unit_id: departmentUnitId,
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
            unit_id: departmentUnitId,
            ends_at: null,
          },
          data: {
            ends_at: now,
          },
        })
      }

      await tx.organizationMembership.create({
        data: {
          user_id: params.userId,
          unit_id: departmentUnitId,
          status: 'ACTIVE',
          starts_at: now,
        },
      })

      // 3. Nếu được bầu làm Trưởng ban (LT) hoặc Chủ tịch
      if (makeLead) {
        // Kết thúc chức vụ Trưởng ban cũ trong ban này
        await tx.positionAssignment.updateMany({
          where: {
            unit_id: departmentUnitId,
            ends_at: null,
          },
          data: {
            ends_at: now,
          },
        })

        let leadPos = await tx.position.findFirst({
          where: { code: 'DEPARTMENT_LEAD' },
          select: { id: true },
        })

        if (!leadPos) {
          leadPos = await tx.position.create({
            data: {
              code: 'DEPARTMENT_LEAD',
              name: 'Trưởng ban (LT)',
              scope: 'DEPARTMENT',
              is_manager: true,
            },
            select: { id: true },
          })
        }

        await tx.positionAssignment.create({
          data: {
            user_id: params.userId,
            unit_id: departmentUnitId,
            position_id: leadPos.id,
            is_primary: true,
            starts_at: now,
            appointed_by: auth.context!.userId,
          },
        })
      }
    }
  })

  await reconcileLearningAssignmentsForUser(params.userId).catch(() => {})

  return NextResponse.json({ success: true, departmentUnitId, isLead: makeLead })
}

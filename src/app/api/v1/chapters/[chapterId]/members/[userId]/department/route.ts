import { OrganizationConflict } from '@/lib/chapter-lead'
import { updateChapterDepartment } from '@/lib/chapter-department-update'
import { lockLearningUser } from '@/lib/learning-periods'
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

  const hasPerm = await canAccessChapterPermission(auth.context!, params.chapterId, 'MANAGE_CHAPTER_MEMBERS')
  if (!hasPerm) {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền quản lý thành viên chapter' } }, { status: 403 })
  }

  const chapter = await prisma.chapter.findUnique({
    where: { id: params.chapterId },
    select: { id: true, organization_unit_id: true },
  })

  if (!chapter || !chapter.organization_unit_id) {
    return NextResponse.json({ error: { code: 'ChapterNotFound', message: 'Chapter không tồn tại' } }, { status: 404 })
  }

  const member = await prisma.chapterMember.findUnique({ where: { user_id: params.userId } })
  if (!member || member.chapter_id !== params.chapterId) return NextResponse.json({ error: { code: 'MemberNotInChapter' } }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const departmentUnitId = typeof body.departmentUnitId === 'string' ? body.departmentUnitId.trim() : null

  // Tìm tất cả các ban của Chapter
  const departments = await prisma.organizationUnit.findMany({
    where: { parent_id: chapter.organization_unit_id, type: 'DEPARTMENT' },
    select: { id: true, name: true },
  })
  const deptIds = departments.map((d) => d.id)

  if (departmentUnitId && departmentUnitId !== chapter.organization_unit_id && !deptIds.includes(departmentUnitId)) {
    return NextResponse.json({ error: { code: 'InvalidDepartment', message: 'Ban không thuộc Chapter này' } }, { status: 400 })
  }

  const targetDept = departments.find((d) => d.id === departmentUnitId)
  const isPresident = targetDept?.name.toLowerCase() === 'chủ tịch'
  const makeLead = isPresident ? true : Boolean(body.makeLead)


  try {
  const updated = await updateChapterDepartment({ chapterId: params.chapterId, userId: params.userId, departmentUnitId, makeLead, actorId: auth.context!.userId })
  return NextResponse.json({ success: true, ...updated })
  } catch (error) {
    if (error instanceof OrganizationConflict) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 409 })
    throw error
  }
}

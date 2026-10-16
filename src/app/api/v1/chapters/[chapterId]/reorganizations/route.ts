import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { canAccessChapterPermission } from '@/lib/authorization'
import { getOrganizationUnitTreeIds } from '@/lib/learning-assignments'
import { applyDueChapterReorganizations } from '@/lib/chapter-reorganizations'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: { chapterId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (
    auth.context!.role !== 'ADMIN' &&
    !(await canAccessChapterPermission(auth.context!, params.chapterId, 'VIEW_MEMBER_PROGRESS'))
  ) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }

  const batches = await prisma.chapterReorganization.findMany({
    where: { chapter_id: params.chapterId },
    include: { items: true },
    orderBy: { effective_at: 'desc' },
  })

  // Bổ sung thông tin user và tên Ban cho từng item để frontend dựng lại 7 cột lịch sử
  const allUserIds = Array.from(new Set(batches.flatMap((b) => b.items.map((i) => i.user_id))))
  const allDeptIds = Array.from(new Set(batches.flatMap((b) => b.items.map((i) => i.department_unit_id))))

  const [users, depts] = await Promise.all([
    allUserIds.length
      ? prisma.user.findMany({ where: { id: { in: allUserIds } }, select: { id: true, email: true, display_name: true } })
      : Promise.resolve([]),
    allDeptIds.length
      ? prisma.organizationUnit.findMany({ where: { id: { in: allDeptIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ])

  const userMap = new Map(users.map((u) => [u.id, u]))
  const deptMap = new Map(depts.map((d) => [d.id, d.name]))

  const enriched = batches.map((b) => ({
    ...b,
    items: b.items.map((i) => ({
      ...i,
      email: userMap.get(i.user_id)?.email || '',
      displayName: i.display_name || userMap.get(i.user_id)?.display_name || userMap.get(i.user_id)?.email || '',
      departmentName: deptMap.get(i.department_unit_id) || '',
      isLead: i.is_primary,
    })),
  }))

  return NextResponse.json({ items: enriched })
}

export async function POST(request: NextRequest, { params }: { params: { chapterId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (
    auth.context!.role !== 'ADMIN' &&
    !(await canAccessChapterPermission(auth.context!, params.chapterId, 'MANAGE_CHAPTER_MEMBERS'))
  ) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const effectiveAt = body?.effectiveAt ? new Date(body.effectiveAt) : null
  const rows = Array.isArray(body?.items) ? body.items : []

  if (
    !effectiveAt ||
    !Number.isFinite(effectiveAt.getTime()) ||
    !rows.length ||
    rows.some(
      (row: any) =>
        !row ||
        typeof row.userId !== 'string' ||
        typeof row.departmentUnitId !== 'string' ||
        (row.positionId != null && typeof row.positionId !== 'string') ||
        (row.displayName != null &&
          (typeof row.displayName !== 'string' || row.displayName.trim().length < 2 || row.displayName.trim().length > 120))
    )
  ) {
    return NextResponse.json(
      { error: { code: 'ValidationError', message: 'Ngày hiệu lực hợp lệ và mỗi dòng cần userId, departmentUnitId.' } },
      { status: 400 }
    )
  }

  if (new Set(rows.map((row: any) => row.userId)).size !== rows.length) {
    return NextResponse.json({ error: { code: 'DuplicateUser', message: 'Có thành viên trùng lặp trong danh sách.' } }, { status: 400 })
  }

  const chapter = await prisma.chapter.findUnique({
    where: { id: params.chapterId },
    select: { organization_unit_id: true },
  })
  if (!chapter?.organization_unit_id) {
    return NextResponse.json({ error: { code: 'ChapterNotFound' } }, { status: 404 })
  }

  const allowedUnits = new Set(await getOrganizationUnitTreeIds(chapter.organization_unit_id))
  const departments = await prisma.organizationUnit.findMany({
    where: { id: { in: rows.map((row: any) => row.departmentUnitId) } },
    select: { id: true, type: true },
  })

  if (
    departments.length !== new Set(rows.map((row: any) => row.departmentUnitId)).size ||
    departments.some((unit) => unit.type !== 'DEPARTMENT' || !allowedUnits.has(unit.id))
  ) {
    return NextResponse.json({ error: { code: 'DepartmentScopeInvalid', message: 'Ban không hợp lệ trong Chapter này.' } }, { status: 400 })
  }

  const isImmediate = effectiveAt.getTime() <= Date.now() + 60000

  const batch = await prisma.chapterReorganization.create({
    data: {
      chapter_id: params.chapterId,
      effective_at: effectiveAt,
      status: 'SCHEDULED',
      source_url: typeof body.sourceUrl === 'string' ? body.sourceUrl.slice(0, 2000) : null,
      created_by_user_id: auth.context!.userId,
      confirmed_at: new Date(),
      items: {
        create: rows.map((row: any) => ({
          user_id: row.userId,
          display_name: row.displayName?.trim() || null,
          department_unit_id: row.departmentUnitId,
          position_id: row.positionId || null,
          is_primary: row.isPrimary !== false,
        })),
      },
    },
    include: { items: true },
  })

  if (isImmediate) {
    await applyDueChapterReorganizations(new Date())
  }

  return NextResponse.json({ item: batch, appliedImmediately: isImmediate }, { status: 201 })
}

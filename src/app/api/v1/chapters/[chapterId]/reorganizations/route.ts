import { activeLearningPolicy } from '@/lib/learning-periods'
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

  // Tự động kiểm tra và áp dụng chuyển giao nhiệm kỳ nếu đã đến thời gian hiệu lực


  const batches = await prisma.chapterReorganization.findMany({
    where: { chapter_id: params.chapterId },
    include: { items: true },
    orderBy: { effective_at: 'desc' },
  })

  // Bổ sung thông tin user và tên Ban cho từng item để frontend dựng lại 7 cột lịch sử
  const allUserIds = Array.from(new Set(batches.flatMap((b) => b.items.map((i) => i.user_id))))
  const allDeptIds = Array.from(new Set(batches.flatMap((b) => b.items.flatMap((i) => i.department_unit_id ? [i.department_unit_id] : []))))

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
    effectiveAt: b.effective_at,
    appliedAt: b.applied_at,
    termNumber: b.term_number,
    itemCount: b.items.length,
    items: b.items.map((i) => ({
      ...i,
      email: userMap.get(i.user_id)?.email || '',
      displayName: i.display_name || userMap.get(i.user_id)?.display_name || userMap.get(i.user_id)?.email || '',
      departmentName: i.department_unit_id ? deptMap.get(i.department_unit_id) || '' : 'Chủ Tịch',
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
  const termNumber = body?.termNumber != null ? Number(body.termNumber) : null
  let rows = Array.isArray(body?.items) ? body.items : []

  if (
    !effectiveAt ||
    !Number.isFinite(effectiveAt.getTime()) ||
    !rows.length ||
    (termNumber != null && (!Number.isInteger(termNumber) || termNumber < 1)) ||
    rows.some(
      (row: any) =>
        !row ||
        typeof row.userId !== 'string' ||
        (row.departmentUnitId != null && typeof row.departmentUnitId !== 'string') ||
        (row.positionId != null && typeof row.positionId !== 'string') ||
        (row.displayName != null &&
          (typeof row.displayName !== 'string' || row.displayName.trim().length < 2 || row.displayName.trim().length > 120))
    )
  ) {
    return NextResponse.json(
      { error: { code: 'ValidationError', message: 'Vui lòng chọn ngày giờ hiệu lực hợp lệ, số thứ tự nhiệm kỳ và kiểm tra đầy đủ danh sách phân ban trước khi xác nhận chuyển giao.' } },
      { status: 400 }
    )
  }

  if (new Set(rows.map((row: any) => row.userId)).size !== rows.length) {
    return NextResponse.json({ error: { code: 'DuplicateUser', message: 'Có thành viên trùng lặp trong danh sách.' } }, { status: 400 })
  }

  const chapter = await prisma.chapter.findUnique({
    where: { id: params.chapterId },
    select: { organization_unit_id: true, current_term_number: true },
  })
  if (!chapter?.organization_unit_id) {
    return NextResponse.json({ error: { code: 'ChapterNotFound' } }, { status: 404 })
  }
  const legacyPresidentUnits = await prisma.organizationUnit.findMany({ where: { parent_id: chapter.organization_unit_id, type: 'DEPARTMENT', name: { equals: 'Chủ Tịch', mode: 'insensitive' } }, select: { id: true } })
  const presidentIds = new Set([chapter.organization_unit_id, ...legacyPresidentUnits.map((unit) => unit.id)])
  const presidentPosition = await prisma.position.upsert({ where: { code: 'CHAPTER_PRESIDENT' }, update: {}, create: { code: 'CHAPTER_PRESIDENT', name: 'Chủ tịch Chapter', scope: 'CHAPTER' } })
  if (rows.some((row: any) => !row.departmentUnitId && row.positionId !== presidentPosition.id)) return NextResponse.json({ error: { code: 'ChapterPresidentPositionRequired' } }, { status: 400 })
  rows = rows.map((row: any) => !row.departmentUnitId || presidentIds.has(row.departmentUnitId) ? { ...row, departmentUnitId: null, positionId: presidentPosition.id } : row)
  if (rows.filter((row: any) => !row.departmentUnitId).length > 1) return NextResponse.json({ error: { code: 'MultipleChapterPresidents' } }, { status: 400 })
  const positionIds = Array.from(new Set<string>(rows.flatMap((row: any) => row.positionId ? [row.positionId as string] : [])))
  const positions = await prisma.position.findMany({ where: { id: { in: positionIds } }, select: { id: true, scope: true, code: true } })
  if (rows.some((row: any) => row.positionId && !positions.some((position) => position.id === row.positionId && (row.departmentUnitId ? position.scope === 'DEPARTMENT' : position.code === 'CHAPTER_PRESIDENT')))) return NextResponse.json({ error: { code: 'PositionScopeInvalid' } }, { status: 400 })
  const members = await prisma.chapterMember.count({ where: { chapter_id: params.chapterId, user_id: { in: rows.map((row: any) => row.userId) }, user: { role: 'MEMBER', status: 'ACTIVE' } } })
  if (members !== rows.length) return NextResponse.json({ error: { code: 'MemberScopeInvalid' } }, { status: 409 })

  if (chapter.current_term_number && termNumber != null && termNumber <= chapter.current_term_number) {
    return NextResponse.json(
      {
        error: {
          code: 'InvalidTermNumber',
          message: `Nhiệm kỳ mới (Nhiệm kỳ ${termNumber}) phải lớn hơn nhiệm kỳ hiện tại của Chapter (Nhiệm kỳ ${chapter.current_term_number}).`,
        },
      },
      { status: 400 }
    )
  }

  const allowedUnits = new Set(await getOrganizationUnitTreeIds(chapter.organization_unit_id))
  const departments = await prisma.organizationUnit.findMany({
    where: { id: { in: rows.flatMap((row: any) => row.departmentUnitId ? [row.departmentUnitId] : []) } },
    select: { id: true, name: true, type: true },
  })

  if (
    departments.length !== new Set(rows.flatMap((row: any) => row.departmentUnitId ? [row.departmentUnitId] : [])).size ||
    departments.some((unit) => unit.type !== 'DEPARTMENT' || !allowedUnits.has(unit.id))
  ) {
    return NextResponse.json({ error: { code: 'DepartmentScopeInvalid', message: 'Ban không hợp lệ trong Chapter này.' } }, { status: 400 })
  }

  // Ràng buộc Ban Chủ Tịch chỉ có tối đa 1 người (0 hoặc 1)
  const presidentDept = departments.find((d) => d.name.toLowerCase() === 'chủ tịch')
  if (presidentDept) {
    const presidentCount = rows.filter((r: any) => r.departmentUnitId === presidentDept.id).length
    if (presidentCount > 1) {
      return NextResponse.json(
        { error: { code: 'ValidationError', message: 'Ban Chủ Tịch chỉ được phép có tối đa 1 người (0 hoặc 1).' } },
        { status: 400 }
      )
    }
  }

  // Chỉ cho phép 1 đợt chuyển giao lên lịch tại một thời điểm
  const existingScheduled = await prisma.chapterReorganization.findFirst({
    where: {
      chapter_id: params.chapterId,
      status: 'SCHEDULED',
    },
  })
  if (existingScheduled) {
    return NextResponse.json(
      {
        error: {
          code: 'ScheduledReorganizationExists',
          message: 'Đã có đợt chuyển giao nhiệm kỳ đang được lên lịch. Vui lòng áp dụng hoặc hủy đợt hiện tại trước khi lên lịch đợt mới.',
        },
      },
      { status: 409 }
    )
  }

  let transferSeasonId: string | null = null
  if (await activeLearningPolicy(prisma, effectiveAt)) {
    const seasons = await prisma.transferSeason.findMany({ where: { starts_at: { lte: effectiveAt }, ends_at: { gt: effectiveAt } } })
    if (seasons.length !== 1) return NextResponse.json({ error: { code: 'TransferSeasonNotConfigured', message: 'Admin cần cấu hình mùa chuyển giao cho thời điểm đã chọn.' } }, { status: 409 })
    transferSeasonId = seasons[0].id
    const applied = await prisma.chapterReorganization.count({ where: { chapter_id: params.chapterId, transfer_season_id: transferSeasonId, status: 'APPLIED' } })
    if (applied) return NextResponse.json({ error: { code: 'TransferSeasonAlreadyApplied' } }, { status: 409 })
  }
  const isImmediate = effectiveAt.getTime() <= Date.now() + 60000

  const batch = await prisma.chapterReorganization.create({
    data: {
      chapter_id: params.chapterId,
      transfer_season_id: transferSeasonId,
      effective_at: effectiveAt,
      term_number: termNumber,
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
    await applyDueChapterReorganizations(new Date(), batch.id, true)
  }

  const saved = await prisma.chapterReorganization.findUnique({ where: { id: batch.id }, include: { items: true } })
  return NextResponse.json({ item: saved, appliedImmediately: saved?.status === 'APPLIED' }, { status: 201 })
}

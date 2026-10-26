import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { canAccessChapterPermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { EXACT_7_BANS, ORDERED_CHAPTER_ROSTER, CHAPTER_ROSTER_COLUMNS } from '@/lib/departments'
import { listChapterMembers } from '@/lib/chapter-members'
import { getActiveMetricChapterIds } from '@/lib/active-chapters'
import { applyDueChapterReorganizations } from '@/lib/chapter-reorganizations'
import { ensureChapterStandardDepartments } from '@/lib/chapter-departments'

export async function GET(
  request: NextRequest,
  { params }: { params: { chapterId: string } }
) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const isLeader = auth.context!.role === 'ADMIN' || (auth.context!.role === 'CHAPTER_LEADER' && auth.context!.chapterId === params.chapterId)
  const hasPerm = await canAccessChapterPermission(auth.context!, params.chapterId, 'VIEW_MEMBER_PROGRESS')
  if (!isLeader && !hasPerm) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }
  if (auth.context!.role !== 'ADMIN' && !(await getActiveMetricChapterIds()).includes(params.chapterId)) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }

  // Tự động kiểm tra và áp dụng chuyển giao nhiệm kỳ nếu đã đến thời gian hiệu lực
  await applyDueChapterReorganizations(new Date()).catch(() => {})


  const chapter = await prisma.chapter.findUnique({
    where: { id: params.chapterId },
    select: { id: true, name: true, organization_unit_id: true, current_term_number: true },
  })

  if (!chapter || !chapter.organization_unit_id) {
    return NextResponse.json({ error: { code: 'ChapterNotFound' } }, { status: 404 })
  }

  // Ensure all 7 standard departments exist for this chapter
  await ensureChapterStandardDepartments(chapter.organization_unit_id)

  const [departments, allChapterMembers, scheduledBatchRecord, presidentAssignments] = await Promise.all([
    prisma.organizationUnit.findMany({
      where: {
        parent_id: chapter.organization_unit_id,
        type: 'DEPARTMENT',
      },
      include: {
        memberships: {
          where: {
            status: 'ACTIVE',
            OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }],
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                display_name: true,
                role: true,
                status: true,
              },
            },
          },
        },
        positions: {
          where: {
            OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }],
          },
          include: {
            position: true,
          },
        },
      },
    }),
    listChapterMembers(params.chapterId, { roles: ['MEMBER'], status: 'ACTIVE' }),
    prisma.chapterReorganization.findFirst({
      where: { chapter_id: params.chapterId, status: 'SCHEDULED' },
      include: { items: true },
      orderBy: { effective_at: 'asc' },
    }),
    prisma.positionAssignment.findMany({ where: { unit_id: chapter.organization_unit_id, position: { code: 'CHAPTER_PRESIDENT' }, starts_at: { lte: new Date() }, OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }], user: { role: 'MEMBER', status: 'ACTIVE' } }, include: { user: { select: { id: true, email: true, display_name: true, role: true, status: true } } } }),
  ])

  const deptMap = new Map(departments.map((d) => [d.name, d]))
  const assignedUserIds = new Set<string>()

  const roster = ORDERED_CHAPTER_ROSTER.map((banName) => {
    if (banName === 'Chủ Tịch' && (presidentAssignments.length || !departments.some((department) => department.name === 'Chủ Tịch' && department.memberships.length))) {
      const members = presidentAssignments.map((assignment) => {
        assignedUserIds.add(assignment.user_id)
        return { userId: assignment.user_id, email: assignment.user.email, displayName: assignment.user.display_name || 'Chủ tịch', role: assignment.user.role, status: assignment.user.status, isLead: true }
      })
      return { id: chapter.organization_unit_id, name: 'Chủ Tịch', lead: members[0] || null, members, total: members.length }
    }
    const dept = deptMap.get(banName) || departments.find(d => d.name.toLowerCase() === banName.toLowerCase())
    if (!dept) {
      return {
        id: null,
        name: banName,
        lead: null,
        members: [],
        total: 0,
      }
    }

    const leadPositions = dept.positions.filter(
      (p) =>
        p.position.code === 'DEPARTMENT_LEAD' ||
        p.position.code === 'CHAPTER_MANAGER' ||
        p.position.is_manager
    )
    const leadUserIds = new Set(leadPositions.map((p) => p.user_id))

    // Tách thành viên và lead (loại bỏ Lead Chapter và Admin)
    const memberItems = dept.memberships
      .filter((m) => m.user && m.user.status === 'ACTIVE' && m.user.role === 'MEMBER' && m.user.email !== 'chapter.lead.demo@bbe.vn')
      .map((m) => {
        assignedUserIds.add(m.user.id)
        const isLead = leadUserIds.has(m.user.id) || (banName === 'Chủ Tịch' && m.user.role === 'MEMBER' && leadUserIds.has(m.user.id))
        return {
          userId: m.user.id,
          email: m.user.email,
          displayName: m.user.display_name || m.user.email.split('@')[0],
          role: m.user.role,
          status: m.user.status,
          isLead,
        }
      })

    // Sắp xếp: Lead lên đầu tiên, các thành viên khác phía sau
    memberItems.sort((a, b) => {
      if (a.isLead && !b.isLead) return -1
      if (!a.isLead && b.isLead) return 1
      return a.displayName.localeCompare(b.displayName, 'vi')
    })

    const lead = memberItems.find((m) => m.isLead) || memberItems[0] || null

    return {
      id: dept.id,
      name: dept.name,
      lead,
      members: memberItems,
      total: memberItems.length,
    }
  })

  // Các thành viên Chapter chưa có ban (chỉ lấy MEMBER)
  const unassignedMembers = allChapterMembers
    .filter((m) => !assignedUserIds.has(m.userId) && m.role === 'MEMBER' && m.email !== 'chapter.lead.demo@bbe.vn')
    .map((m) => ({
      userId: m.userId,
      email: m.email,
      displayName: m.displayName || m.email.split('@')[0],
      role: m.role,
      status: m.status,
    }))

  const availableDepartments = roster
    .filter((r) => r.id)
    .map((r) => ({ id: r.id!, name: r.name }))

  // Xử lý đợt chuyển giao đang chờ hiệu lực (nếu có)
  let scheduledBatch: any = null
  if (scheduledBatchRecord && scheduledBatchRecord.items.length > 0) {
    const itemUserIds = Array.from(new Set(scheduledBatchRecord.items.map((i) => i.user_id)))
    const itemUsers = await prisma.user.findMany({
      where: { id: { in: itemUserIds }, status: 'ACTIVE' },
      select: { id: true, email: true, display_name: true },
    })
    const userMap = new Map(itemUsers.map((u) => [u.id, u]))
    const deptIdToName = new Map(departments.map((d) => [d.id, d.name]))

    const newTerm = ORDERED_CHAPTER_ROSTER.map((banName) => {
      const dept = departments.find((d) => d.name.toLowerCase() === banName.toLowerCase())
      const deptItems = scheduledBatchRecord.items
        .filter((i) => userMap.has(i.user_id) && (i.department_unit_id ? deptIdToName.get(i.department_unit_id)?.toLowerCase() === banName.toLowerCase() : banName === 'Chủ Tịch'))
        .map((i) => ({
          userId: i.user_id,
          email: userMap.get(i.user_id)?.email || '',
          displayName: i.display_name || userMap.get(i.user_id)?.display_name || userMap.get(i.user_id)?.email || '',
          departmentUnitId: i.department_unit_id,
          departmentName: banName,
          isLead: i.is_primary,
        }))
      deptItems.sort((a, b) => {
        if (a.isLead && !b.isLead) return -1
        if (!a.isLead && b.isLead) return 1
        return a.displayName.localeCompare(b.displayName, 'vi')
      })
      return {
        departmentId: dept?.id || null,
        departmentName: banName,
        lead: deptItems.find((m) => m.isLead) || deptItems[0] || null,
        members: deptItems,
        total: deptItems.length,
      }
    })

    // Danh sách thành viên hiện tại của Chapter không có tên trong đợt chuyển giao tiếp theo
    const itemUserIdSet = new Set(itemUserIds)
    const userToCurrentDeptName = new Map<string, string>()
    for (const d of departments) {
      for (const m of d.memberships) {
        if (m.user?.id && m.user.status === 'ACTIVE') {
          userToCurrentDeptName.set(m.user.id, d.name)
        }
      }
    }

    const unmatchedCurrentMembers = allChapterMembers
      .filter((m) => !itemUserIdSet.has(m.userId) && m.role === 'MEMBER' && m.email !== 'chapter.lead.demo@bbe.vn')
      .map((m) => ({
        userId: m.userId,
        email: m.email,
        displayName: m.displayName || m.email.split('@')[0],
        currentDepartmentName: userToCurrentDeptName.get(m.userId) || 'Chưa phân Ban',
      }))

    scheduledBatch = {
      id: scheduledBatchRecord.id,
      effectiveAt: scheduledBatchRecord.effective_at,
      termNumber: scheduledBatchRecord.term_number,
      sourceUrl: scheduledBatchRecord.source_url,
      totalItems: newTerm.reduce((sum, department) => sum + department.total, 0),
      status: scheduledBatchRecord.status,
      newTerm,
      unmatchedCurrentMembers,
    }
  }

  return NextResponse.json({
    chapterId: chapter.id,
    chapterName: chapter.name,
    currentTermNumber: chapter.current_term_number,
    roster,
    unassignedMembers,
    departments: availableDepartments,
    scheduledBatch,
    totalMembers: allChapterMembers.length,
  })
}


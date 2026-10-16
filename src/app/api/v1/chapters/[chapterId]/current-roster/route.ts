import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { canAccessChapterPermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { EXACT_7_BANS, ORDERED_7_BANS } from '@/lib/departments'
import { listChapterMembers } from '@/lib/chapter-members'

export async function GET(
  request: NextRequest,
  { params }: { params: { chapterId: string } }
) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const isLeader = auth.context!.role === 'CHAPTER_LEADER' || auth.context!.role === 'ADMIN'
  const hasPerm = await canAccessChapterPermission(auth.context!, params.chapterId, 'VIEW_MEMBER_PROGRESS')
  if (!isLeader && !hasPerm) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }

  const chapter = await prisma.chapter.findUnique({
    where: { id: params.chapterId },
    select: { id: true, name: true, organization_unit_id: true },
  })

  if (!chapter || !chapter.organization_unit_id) {
    return NextResponse.json({ error: { code: 'ChapterNotFound' } }, { status: 404 })
  }

  const [departments, allChapterMembers] = await Promise.all([
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
  ])

  const deptMap = new Map(departments.map((d) => [d.name, d]))
  const assignedUserIds = new Set<string>()

  const roster = ORDERED_7_BANS.map((banName) => {
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

    // Tách thành viên và lead
    const memberItems = dept.memberships
      .filter((m) => m.user)
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

  // Các thành viên Chapter chưa có ban
  const unassignedMembers = allChapterMembers
    .filter((m) => !assignedUserIds.has(m.userId) && m.email !== 'chapter.lead.demo@bbe.vn')
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

  return NextResponse.json({
    chapterId: chapter.id,
    chapterName: chapter.name,
    roster,
    unassignedMembers,
    departments: availableDepartments,
    totalMembers: roster.reduce((sum, r) => sum + r.total, 0),
  })
}


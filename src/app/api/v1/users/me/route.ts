import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLearningManagerKind } from '@/lib/manager-learning-access'
import { invalidateMemberLeaderboardCache } from '@/lib/member-leaderboard-cache'
import { invalidateChapterLeaderboardCache } from '@/lib/chapter-leaderboard-cache'
import { invalidateServerUsersCache } from '@/lib/server-cache'

function toRoman(num: number): string {
  if (!num || num <= 0) return ''
  const romanLookup: [number, string][] = [
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ]
  let result = ''
  let n = num
  for (const [val, rom] of romanLookup) {
    while (n >= val) {
      result += rom
      n -= val
    }
  }
  return result || String(num)
}

/**
 * GET /api/v1/users/me
 * Get current user info.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: (auth as any).context!.userId },
    include: {
      chapter_members: {
        take: 1,
        include: { chapter: { select: { id: true, name: true, current_term_number: true } } },
      },
    },
  })

  if (!user) {
    return NextResponse.json({ error: { code: 'UserNotFound', message: 'Người dùng không tồn tại' } }, { status: 404 })
  }

  const now = new Date()
  const [memberships, positions, formerLt, allDepartmentMemberships, appliedReorgItems] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: { user_id: user.id, status: 'ACTIVE', starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
      select: { unit: { select: { id: true, name: true, type: true, parent: { select: { id: true, name: true, type: true } } } } },
    }),
    prisma.positionAssignment.findMany({
      where: { user_id: user.id, starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
      select: { position: { select: { code: true, name: true, scope: true } }, unit: { select: { id: true, name: true, type: true } } },
    }),
    prisma.positionAssignment.findFirst({ where: { user_id: user.id, position: { code: 'DEPARTMENT_LEAD' } }, select: { id: true } }),
    prisma.organizationMembership.findMany({
      where: { user_id: user.id, unit: { type: 'DEPARTMENT' } },
      include: { unit: true },
      orderBy: { starts_at: 'desc' },
    }),
    prisma.chapterReorganizationItem.findMany({
      where: { user_id: user.id, reorganization: { status: 'APPLIED' } },
      include: { reorganization: true },
      orderBy: { reorganization: { applied_at: 'desc' } },
    }),
  ])

  const dnaMembership = memberships.find(({ unit }) => unit.type === 'DNA' || unit.type === 'DNA_GROUP')
  const departmentMembership = memberships.find(({ unit }) => unit.type === 'DEPARTMENT')
  const managerKind = await getLearningManagerKind(user.id, user.role)

  const chapter = user.chapter_members?.[0]?.chapter || null
  const currentTermNumber = chapter?.current_term_number || null
  const currentTermLabel = currentTermNumber ? `Nhiệm kỳ ${currentTermNumber} (${toRoman(currentTermNumber)})` : null

  const currentDepartment = departmentMembership ? {
    id: departmentMembership.unit.id,
    name: departmentMembership.unit.name,
    termNumber: currentTermNumber,
    termLabel: currentTermLabel,
  } : null

  const departmentHistory = allDepartmentMemberships.map((m, idx) => {
    const isCurrent = m.status === 'ACTIVE' && (!m.ends_at || m.ends_at > now)
    const matchingReorg = appliedReorgItems.find((r) => r.department_unit_id === m.unit_id)
    const termNum = isCurrent
      ? currentTermNumber
      : (matchingReorg?.reorganization?.term_number || (currentTermNumber && currentTermNumber > idx ? currentTermNumber - idx : null))
    const termLbl = termNum ? `Nhiệm kỳ ${termNum} (${toRoman(termNum)})` : null
    return {
      id: m.id,
      departmentId: m.unit_id,
      departmentName: m.unit.name,
      termNumber: termNum,
      termLabel: termLbl,
      status: isCurrent ? 'ACTIVE' : 'ENDED',
      startsAt: m.starts_at,
      endsAt: m.ends_at,
    }
  })

  return NextResponse.json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    status: user.status,
    chapterId: managerKind === 'LEAD_DNA' ? null : chapter?.id || null,
    chapterName: managerKind === 'LEAD_DNA' ? null : chapter?.name || null,
    currentTermNumber,
    currentTermLabel,
    currentDepartment,
    departmentHistory,
    department: departmentMembership ? { id: departmentMembership.unit.id, name: departmentMembership.unit.name } : null,
    dna: dnaMembership ? {
      active: true,
      unitId: dnaMembership.unit.type === 'DNA' ? dnaMembership.unit.id : dnaMembership.unit.parent?.id,
      unitName: dnaMembership.unit.type === 'DNA' ? dnaMembership.unit.name : dnaMembership.unit.parent?.name,
      groupId: dnaMembership.unit.type === 'DNA_GROUP' ? dnaMembership.unit.id : null,
      groupName: dnaMembership.unit.type === 'DNA_GROUP' ? dnaMembership.unit.name : null,
      role: positions.some((assignment) => assignment.position.code === 'DNA_LEAD') ? 'LEAD_DNA' : 'DNA_MEMBER',
    } : { active: false, unitId: null, unitName: null, groupId: null, groupName: null, role: null },
    positions: positions.map((assignment) => ({ ...assignment.position, unitId: assignment.unit.id, unitName: assignment.unit.name })),
    managerKind,
    capabilities: { formerOrCurrentLt: managerKind ? false : Boolean(formerLt), dnaFullLearningAccess: managerKind ? false : Boolean(dnaMembership), learningEnabled: !managerKind },
  }, { status: 200 })
}

/** Members may maintain their own display name; email remains the unique identity. */
export async function PATCH(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''
  if (displayName.length < 2 || displayName.length > 120) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Tên hiển thị cần từ 2 đến 120 ký tự.' } }, { status: 400 })
  }
  const user = await prisma.user.update({
    where: { id: auth.context!.userId },
    data: { display_name: displayName },
    select: { id: true, email: true, display_name: true },
  })

  // Invalidate leaderboard and server caches so changes reflect immediately
  invalidateMemberLeaderboardCache()
  invalidateChapterLeaderboardCache()
  invalidateServerUsersCache()

  return NextResponse.json({ id: user.id, email: user.email, displayName: user.display_name })
}

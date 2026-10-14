import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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
        include: { chapter: { select: { id: true, name: true } } },
      },
    },
  })

  if (!user) {
    return NextResponse.json({ error: { code: 'UserNotFound', message: 'Người dùng không tồn tại' } }, { status: 404 })
  }

  const now = new Date()
  const [memberships, positions, formerLt] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: { user_id: user.id, status: 'ACTIVE', starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
      select: { unit: { select: { id: true, name: true, type: true, parent: { select: { id: true, name: true, type: true } } } } },
    }),
    prisma.positionAssignment.findMany({
      where: { user_id: user.id, starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
      select: { position: { select: { code: true, name: true, scope: true } }, unit: { select: { id: true, name: true, type: true } } },
    }),
    prisma.positionAssignment.findFirst({ where: { user_id: user.id, position: { code: 'DEPARTMENT_LEAD' } }, select: { id: true } }),
  ])
  const dnaMembership = memberships.find(({ unit }) => unit.type === 'DNA' || unit.type === 'DNA_GROUP')
  const departmentMembership = memberships.find(({ unit }) => unit.type === 'DEPARTMENT')

  return NextResponse.json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    status: user.status,
    chapterId: user.chapter_members?.[0]?.chapter?.id || null,
    chapterName: user.chapter_members?.[0]?.chapter?.name || null,
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
    capabilities: { formerOrCurrentLt: Boolean(formerLt), dnaFullLearningAccess: Boolean(dnaMembership) },
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
  return NextResponse.json({ id: user.id, email: user.email, displayName: user.display_name })
}

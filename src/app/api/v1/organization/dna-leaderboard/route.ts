import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { listManagedOrganizationUnits } from '@/lib/authorization'
import { getLearningManagerKind } from '@/lib/manager-learning-access'
import { prisma } from '@/lib/prisma'
import { publicDisplayName } from '@/lib/fun-display-name'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const managerKind = await getLearningManagerKind(auth.context!.userId, auth.context!.role)
  if (managerKind !== 'LEAD_DNA' && auth.context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Lead DNA hoặc Admin được xem bảng xếp hạng nội bộ DNA.' } }, { status: 403 })
  }

  const managed = await listManagedOrganizationUnits(auth.context!)
  const unitIds = managed.filter((unit) => unit.type === 'DNA_GROUP').map((unit) => unit.id)
  if (!unitIds.length) return NextResponse.json({ items: [], totalCount: 0 })

  const now = new Date()
  const participants = await prisma.positionAssignment.findMany({
    where: {
      unit_id: { in: unitIds }, unit: { type: 'DNA_GROUP', status: 'ACTIVE', code: { not: 'TT' } },
      position: { code: 'DNA_MEMBER' },
      starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }],
      user: { status: 'ACTIVE', role: 'MEMBER' },
    },
    select: { user: { select: { id: true, display_name: true, anonymized_at: true } }, unit: { select: { name: true, type: true, code: true } } },
  })
  const users = new Map<string, { userId: string; displayName: string; groupName: string | null }>()
  for (const row of participants) {
    const current = users.get(row.user.id)
    users.set(row.user.id, {
      userId: row.user.id, displayName: publicDisplayName(row.user.id, row.user),
      groupName: row.unit.type === 'DNA_GROUP' ? row.unit.name : current?.groupName || null,
    })
  }
  const ids = Array.from(users.keys())
  const starRows = ids.length ? await prisma.starLedger.findMany({ where: { user_id: { in: ids } }, select: { user_id: true, amount: true, awarded_at: true } }) : []
  const totals = new Map<string, number>()
  const achievedAt = new Map<string, Date>()
  for (const row of starRows) {
    totals.set(row.user_id, (totals.get(row.user_id) || 0) + row.amount)
    if (row.amount > 0 && (!achievedAt.has(row.user_id) || row.awarded_at > achievedAt.get(row.user_id)!)) achievedAt.set(row.user_id, row.awarded_at)
  }
  const items = Array.from(users.values()).map((user) => ({ ...user, stars: totals.get(user.userId) || 0, starsAchievedAt: achievedAt.get(user.userId)?.toISOString() || null }))
    .sort((a, b) => b.stars - a.stars || new Date(a.starsAchievedAt || 8640000000000000).getTime() - new Date(b.starsAchievedAt || 8640000000000000).getTime() || a.userId.localeCompare(b.userId))
    .map((item, index) => ({ ...item, rank: index + 1 }))
  return NextResponse.json({ items, totalCount: items.length })
}

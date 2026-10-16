import { prisma } from './prisma'

/** A Chapter contributes to public metrics only while it has an active lead. */
export async function getActiveMetricChapterIds(now = new Date()): Promise<string[]> {
  const chapters = await prisma.chapter.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        { chapter_members: { some: { user: { status: 'ACTIVE', role: 'CHAPTER_LEADER' } } } },
        { organization_unit: { positions: { some: {
          position: { code: 'CHAPTER_MANAGER' }, user: { status: 'ACTIVE' },
          starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }],
        } } } },
      ],
    },
    select: { id: true },
  })
  return chapters.map((chapter) => chapter.id)
}

export async function getParentChapterId(unitId: string): Promise<string | null> {
  const visited = new Set<string>()
  let currentId: string | null = unitId
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const unit: { parent_id: string | null; chapter: { id: string } | null } | null = await prisma.organizationUnit.findUnique({
      where: { id: currentId }, select: { parent_id: true, chapter: { select: { id: true } } },
    })
    if (!unit) return null
    if (unit.chapter) return unit.chapter.id
    currentId = unit.parent_id
  }
  return null
}

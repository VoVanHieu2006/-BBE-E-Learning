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

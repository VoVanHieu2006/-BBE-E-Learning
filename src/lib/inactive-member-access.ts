import { prisma } from './prisma'

export async function canViewInactiveChapterMember(context: { userId: string; role: string; chapterId?: string | null }, chapterId: string): Promise<boolean> {
  if (context.role === 'ADMIN') return true
  if (context.role === 'CHAPTER_LEADER' && context.chapterId === chapterId) return true
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId }, select: { organization_unit_id: true } })
  if (!chapter?.organization_unit_id) return false
  const now = new Date()
  const assignment = await prisma.positionAssignment.findFirst({
    where: {
      user_id: context.userId, unit_id: chapter.organization_unit_id,
      position: { code: 'CHAPTER_MANAGER' }, starts_at: { lte: now },
      OR: [{ ends_at: null }, { ends_at: { gt: now } }],
    }, select: { id: true },
  })
  return Boolean(assignment)
}

import { prisma } from './prisma'
import { chapterLeadScope } from './chapter-lead'

export async function canViewInactiveChapterMember(context: { userId: string; role: string; chapterId?: string | null }, chapterId: string): Promise<boolean> {
  if (context.role === 'ADMIN') return true
  const lead = await chapterLeadScope(context.userId)
  if (lead.isLead) return lead.chapterId === chapterId
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

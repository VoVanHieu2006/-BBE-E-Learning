import { prisma } from '@/lib/prisma'

/** Lead Chapter and Lead DNA are management-only accounts, never learners. */
export async function getLearningManagerKind(userId: string, role?: string | null) {
  if (!role) role = (await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role
  if (role === 'ADMIN') return null
  if (role === 'CHAPTER_LEADER') return 'LEAD_CHAPTER' as const
  const dnaLead = await prisma.positionAssignment.findFirst({
    where: {
      user_id: userId,
      position: { code: { in: ['DNA_LEAD', 'DNA_MANAGER', 'CHAPTER_LEAD', 'CHAPTER_MANAGER'] } },
      starts_at: { lte: new Date() },
      OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }],
    },
    select: { id: true, position: { select: { code: true } } },
  })
  return dnaLead ? (['CHAPTER_LEAD', 'CHAPTER_MANAGER'].includes(dnaLead.position.code) ? 'LEAD_CHAPTER' as const : 'LEAD_DNA' as const) : null
}

export async function isLearningManager(userId: string, role?: string | null) {
  return Boolean(await getLearningManagerKind(userId, role))
}

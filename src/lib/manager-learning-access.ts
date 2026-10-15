import { prisma } from '@/lib/prisma'

/** Lead Chapter and Lead DNA are management-only accounts, never learners. */
export async function getLearningManagerKind(userId: string, role?: string | null) {
  if (role === 'CHAPTER_LEADER') return 'LEAD_CHAPTER' as const
  const dnaLead = await prisma.positionAssignment.findFirst({
    where: {
      user_id: userId,
      position: { code: 'DNA_LEAD' },
      starts_at: { lte: new Date() },
      OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }],
    },
    select: { id: true },
  })
  return dnaLead ? 'LEAD_DNA' as const : null
}

export async function isLearningManager(userId: string, role?: string | null) {
  return Boolean(await getLearningManagerKind(userId, role))
}

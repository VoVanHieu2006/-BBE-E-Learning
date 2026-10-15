import { StarReason } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { hasActiveDnaAffiliation } from '@/lib/affiliation-access'
import { isLearningManager } from '@/lib/manager-learning-access'
export { starsForVideoDuration, starsForQuizScore } from '@/lib/reward-rules'

export async function canEarnStarsForCourse(userId: string, courseId: string): Promise<boolean> {
  if (await isLearningManager(userId)) return false
  if (await hasActiveDnaAffiliation(userId)) return true
  const assignments = await prisma.userLearningAssignment.findMany({
    where: { user_id: userId, course_id: courseId, ended_at: null },
    select: { can_earn_stars: true },
  })

  // Stars require an explicit assignment, and a restrictive matching rule
  // cannot be overridden by a broad rule granting rewards.
  return assignments.length > 0 && assignments.every((assignment) => assignment.can_earn_stars)
}

export async function awardStars(input: {
  userId: string
  amount: number
  reason: StarReason
  rewardKey: string
  sourceType: string
  sourceId: string
  metadata?: Record<string, unknown>
}) {
  if (input.amount <= 0) return { awarded: false, amount: 0 }
  if (await isLearningManager(input.userId)) return { awarded: false, amount: 0 }

  try {
    const entry = await prisma.starLedger.create({
      data: {
        user_id: input.userId,
        amount: input.amount,
        reason: input.reason,
        reward_key: input.rewardKey,
        source_type: input.sourceType,
        source_id: input.sourceId,
        metadata: input.metadata as any,
      },
    })
    return { awarded: true, amount: entry.amount, entryId: entry.id }
  } catch (error: any) {
    // reward_key is unique: retrying a heartbeat/submit is safe and never pays twice.
    if (error?.code === 'P2002') return { awarded: false, amount: 0 }
    throw error
  }
}

export async function getUserStarBalance(userId: string): Promise<number> {
  if (await isLearningManager(userId)) return 0
  const result = await prisma.starLedger.aggregate({ where: { user_id: userId }, _sum: { amount: true } })
  return result._sum.amount || 0
}

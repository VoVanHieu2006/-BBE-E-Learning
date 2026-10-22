import { StarReason } from '@prisma/client'
import { prisma } from './prisma'
import { hasActiveDnaAffiliation } from './affiliation-access'
import { isLearningManager } from './manager-learning-access'
import { rewardEligibility } from './learning-periods'
export { starsForVideoDuration, starsForQuizScore } from './reward-rules'

export async function canEarnStarsForCourse(userId: string, courseId: string): Promise<boolean> {
  return rewardEligibility(prisma, userId, courseId, new Date())
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
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { role: true, status: true } })
  if (user?.role !== 'MEMBER' || user.status !== 'ACTIVE') return { awarded: false, amount: 0 }
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

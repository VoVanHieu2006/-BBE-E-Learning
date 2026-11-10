import { prisma } from './prisma'
import { isLearningManager } from './manager-learning-access'
import { rewardEligibility } from './learning-periods'
export { starsForVideoDuration, starsForQuizScore } from './reward-rules'

export async function canEarnStarsForCourse(userId: string, courseId: string): Promise<boolean> {
  return rewardEligibility(prisma, userId, courseId, new Date())
}

export async function getUserStarBalance(userId: string, role?: string | null): Promise<number> {
  if (await isLearningManager(userId, role)) return 0
  const result = await prisma.starLedger.aggregate({ where: { user_id: userId }, _sum: { amount: true } })
  return result._sum.amount || 0
}

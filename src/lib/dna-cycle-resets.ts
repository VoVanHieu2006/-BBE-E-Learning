import { prisma } from './prisma'
import { activeLearningPolicy, enqueueAssignmentSync, learningContext, lockLearningUser } from './learning-periods'
import { chapterRewardBoundary } from './chapter-reward-gate'

/** DNA resets at the fixed April/October Vietnam boundary, independent of Chapter transfers. */
export async function applyDueDnaCycleResets() {
  const now = new Date()
  const policy = await activeLearningPolicy(prisma, now)
  if (!policy?.cutover_at) return 0
  const boundary = chapterRewardBoundary(now)
  const seasons = boundary >= policy.cutover_at ? [{ id: boundary.toISOString(), starts_at: boundary }] : []
  let applied = 0
  for (const season of seasons) await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`dna-reset:${season.id}`}))::text`
    const key = `dna-reset:${season.id}`
    if (await tx.learningSnapshot.findUnique({ where: { key } })) return
    const members = await tx.organizationMembership.findMany({ where: {
      unit: { type: { in: ['DNA', 'DNA_GROUP'] } }, status: 'ACTIVE', starts_at: { lte: season.starts_at }, ends_at: null,
    }, select: { user_id: true }, distinct: ['user_id'], orderBy: { user_id: 'asc' } })
    const userIds = members.map((row) => row.user_id)
    const before = []
    let actual = now
    for (const userId of userIds) {
      actual = await lockLearningUser(tx, userId)
      const context = await learningContext(tx, userId, actual)
      if (!context || context.cycle.starts_at >= season.starts_at) continue
      before.push({ userId, previousCycleId: context.cycle.id })
      await tx.learningCycle.update({ where: { id: context.cycle.id }, data: { ends_at: actual } })
      await tx.learningCycle.create({ data: { user_id: userId, starts_at: actual, trigger_key: `dna:${season.id}:${userId}` } })
      await tx.lessonProgress.updateMany({ where: { user_id: userId }, data: { completed: false, completed_at: null, last_position_seconds: 0, furthest_watched_position_seconds: 0, last_watched_at: null } })
      await tx.attempt.updateMany({ where: { user_id: userId, status: 'IN_PROGRESS' }, data: { status: 'CANCELLED', submitted_at: actual, cancellation_reason: 'DNA_SEASON_RESET' } })
      await tx.userLearningAssignment.updateMany({ where: { user_id: userId, ended_at: null }, data: { ended_at: actual } })
      await tx.supplementalLearningRequirement.updateMany({ where: { user_id: userId, ended_at: null }, data: { ended_at: actual } })
      await enqueueAssignmentSync(tx, userId, `dna-sync:${season.id}:${userId}`)
    }
    await tx.learningSnapshot.create({ data: { key, kind: 'DNA_SEASON_RESET', captured_at: actual, payload: { scheduledAt: season.starts_at.toISOString(), actualAt: actual.toISOString(), users: before } } })
    applied++
  }, { timeout: 30_000 })
  return applied
}

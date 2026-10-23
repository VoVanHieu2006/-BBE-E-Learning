import { Prisma, CompetitionMonth, LearningPolicy, LearningCycle } from '@prisma/client'
import { competitionMonthBounds } from './learning-cycle-rules'
import { chapterRewardState } from './chapter-reward-gate'

export type LearningTx = Prisma.TransactionClient
/** Lock order for learning writers: user -> attempt/progress -> reward rows. */
export async function lockLearningUser(tx: LearningTx, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`
  if (!rows.length) throw new Error('UserNotFound')
  const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
  return clock.now
}

export async function activeLearningPolicy(tx: LearningTx, now: Date) {
  const policy = await tx.learningPolicy.findUnique({ where: { id: 'default' } })
  return policy?.cutover_at && policy.mapping_approved_at && policy.cutover_at <= now ? policy : null
}

/** Lock a competition period before sampling the business timestamp. */
export async function lockCompetitionScope(tx: LearningTx, now: Date): Promise<{ policy: LearningPolicy; month: CompetitionMonth; now: Date } | null> {
  const [initialClock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
  now = initialClock.now
  const policy = await activeLearningPolicy(tx, now)
  if (!policy?.cutover_at) return null
  const bounds = competitionMonthBounds(now, policy.cutover_at)
  const month = await tx.competitionMonth.upsert({
    where: { key: bounds.key }, update: {},
    create: { key: bounds.key, starts_at: bounds.startsAt, ends_at: bounds.endsAt },
  })
  await tx.$queryRaw`SELECT id FROM competition_months WHERE id=${month.id}::uuid FOR SHARE`
  const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
  if (clock.now >= month.ends_at) return lockCompetitionScope(tx, clock.now)
  const lockedMonth = await tx.competitionMonth.findUniqueOrThrow({ where: { id: month.id } })
  if (lockedMonth.state !== 'OPEN') throw new Error('CompetitionMonthClosed')
  return { policy, month: lockedMonth, now: clock.now }
}

/** Caller holds the user's lock. Transition import never infers historical terms. */
export async function learningContext(tx: LearningTx, userId: string, now: Date): Promise<{ month: CompetitionMonth; cycle: LearningCycle; now: Date } | null> {
  const policy = await activeLearningPolicy(tx, now)
  if (!policy?.cutover_at) return null
  const bounds = competitionMonthBounds(now, policy.cutover_at)
  let month = await tx.competitionMonth.findUnique({ where: { key: bounds.key } })
  if (!month) {
    month = await tx.competitionMonth.upsert({
      where: { key: bounds.key },
      update: {},
      create: { key: bounds.key, starts_at: bounds.startsAt, ends_at: bounds.endsAt },
    })
  }
  // The month row is immutable for the purpose of a heartbeat. This avoids an
  // upsert + FOR SHARE + two clock queries on every video heartbeat.
  if (month.ends_at <= now) {
    const next = competitionMonthBounds(month.ends_at, policy.cutover_at)
    month = await tx.competitionMonth.findUnique({ where: { key: next.key } })
      || await tx.competitionMonth.upsert({ where: { key: next.key }, update: {}, create: { key: next.key, starts_at: next.startsAt, ends_at: next.endsAt } })
  }
  let cycle = await tx.learningCycle.findFirst({ where: { user_id: userId, ends_at: null } })
  if (!cycle) {
    const chapter = await tx.chapterMember.findUnique({ where: { user_id: userId } })
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { created_at: true } })
    const legacy = user.created_at <= policy.cutover_at!
    cycle = await tx.learningCycle.create({ data: {
      user_id: userId, chapter_id: chapter?.chapter_id, trigger_key: `cutover:${userId}`,
      starts_at: legacy ? policy.cutover_at! : now, provenance: legacy ? 'LEGACY' : 'NATIVE',
    } })
    const progress = await tx.lessonProgress.findMany({ where: { user_id: userId } })
    if (progress.length) await tx.cycleLessonProgress.createMany({ data: progress.map((row) => ({
      user_id: userId, lesson_id: row.lesson_id, learning_cycle_id: cycle!.id,
      furthest_seconds: row.furthest_watched_position_seconds || 0,
      completed_at: row.completed_at, provenance: legacy ? 'LEGACY' : 'NATIVE',
    })), skipDuplicates: true })
    // Import evidence of the earliest assignment and the latest old deadline.
    const assignments = await tx.userLearningAssignment.findMany({ where: { user_id: userId }, orderBy: { assigned_at: 'asc' } })
    const dates = assignments.flatMap((row) => row.due_at ? [row.due_at.getTime()] : [])
    const importedDue = dates.length ? new Date(Math.max(...dates)) : null
    await tx.learningPath.create({ data: {
      user_id: userId, learning_cycle_id: cycle.id,
      starts_at: assignments[0]?.assigned_at || now, imported_due_at: importedDue, due_at: importedDue,
    } })
  }
  return { month, cycle, now }
}

export async function rewardEligibility(tx: LearningTx, userId: string, courseId: string, now: Date) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, status: true, anonymized_at: true } })
  if (!user || user.role !== 'MEMBER' || user.status !== 'ACTIVE' || user.anonymized_at) return false
  const lead = await tx.positionAssignment.count({ where: {
    user_id: userId, position: { code: { in: ['DNA_LEAD', 'DNA_MANAGER', 'CHAPTER_LEAD'] } },
    starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }],
  } })
  if (lead) return false
  const course = await tx.course.findUnique({ where: { id: courseId }, select: { status: true } })
  if (course?.status !== 'PUBLISHED') return false
  if ((await chapterRewardState(tx, userId, now)).paused) return false
  return true
}

export async function enqueueAssignmentSync(tx: LearningTx, userId: string, eventKey: string) {
  await tx.learningOutbox.upsert({
    where: { event_key: eventKey }, update: {},
    create: { event_key: eventKey, kind: 'RECONCILE_ASSIGNMENTS', user_id: userId, payload: {} },
  })
}

/** Pure reads never create a cycle or run a transfer. */
export async function currentCycleAttemptFilter(tx: LearningTx, userId: string): Promise<Prisma.AttemptWhereInput> {
  const cycle = await tx.learningCycle.findFirst({ where: { user_id: userId, ends_at: null } })
  if (!cycle) return {}
  return cycle.provenance === 'LEGACY'
    ? { OR: [{ learning_cycle_id: cycle.id }, { learning_cycle_id: null, started_at: { lt: cycle.starts_at } }] }
    : { learning_cycle_id: cycle.id }
}

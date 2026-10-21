import { prisma } from './prisma'
import { normalizeLearningOrganization } from './normalize-learning-organization'
import { activeLearningPolicy, enqueueAssignmentSync, lockLearningUser } from './learning-periods'
import { prepareOrganizationTransition } from './organization-transition'
import { competitionMonthBounds } from './learning-cycle-rules'
import { captureCourseRequirementVersion } from './course-requirements'

/** A durable one-time transition import; this never resets training or old deadlines. */
export async function initializeLearningCutover() {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM learning_policy WHERE id = 'default' FOR UPDATE`
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    const policy = await activeLearningPolicy(tx, clock.now)
    if (!policy?.cutover_at) return false
    const bounds = competitionMonthBounds(clock.now, policy.cutover_at)
    await tx.competitionMonth.upsert({ where: { key: bounds.key }, update: {}, create: { key: bounds.key, starts_at: bounds.startsAt, ends_at: bounds.endsAt } })
    const key = `cutover:${policy.cutover_at.toISOString()}`
    if (await tx.learningSnapshot.findUnique({ where: { key } })) return false
    const users = await tx.user.findMany({ where: { anonymized_at: null }, select: { id: true }, orderBy: { id: 'asc' } })
    for (const user of users) await lockLearningUser(tx, user.id)
    await normalizeLearningOrganization(tx, undefined, true)
    const dna = await tx.organizationMembership.findMany({ where: { status: 'ACTIVE', starts_at: { lte: clock.now }, OR: [{ ends_at: null }, { ends_at: { gt: clock.now } }], unit: { type: { in: ['DNA', 'DNA_GROUP'] } } }, select: { user_id: true, unit_id: true } })
    for (const member of dna) await prepareOrganizationTransition(tx, member.user_id, member.unit_id)
    const kpis = await tx.chapterMonthlyKpi.findMany()
    for (const kpi of kpis) await tx.learningSnapshot.upsert({ where: { key: `kpi-baseline:${kpi.id}` }, update: {}, create: { key: `kpi-baseline:${kpi.id}`, kind: 'CHAPTER_KPI_HISTORY', captured_at: clock.now, payload: { chapterId: kpi.chapter_id, month: kpi.month_start.toISOString().slice(0, 7), status: kpi.status, provenance: 'LEGACY' } } })
    const courses = await tx.course.findMany({ where: { status: 'PUBLISHED' }, select: { id: true } })
    for (const course of courses) await captureCourseRequirementVersion(tx, course.id, clock.now)
    for (const user of users) await enqueueAssignmentSync(tx, user.id, `${key}:${user.id}`)
    const chapters = await tx.chapter.findMany({ select: { id: true } })
    for (const chapter of chapters) if (!await tx.chapterCompetitionTerm.count({ where: { chapter_id: chapter.id, ends_at: null } })) {
      await tx.chapterCompetitionTerm.create({ data: { chapter_id: chapter.id, starts_at: policy.cutover_at } })
    }
    await tx.learningSnapshot.create({ data: { key, kind: 'CUTOVER_IMPORT_SCHEDULED', captured_at: clock.now, payload: { configuredCutoverAt: policy.cutover_at.toISOString(), actualAt: clock.now.toISOString(), queuedUsers: users.length, legacyStarsReclassified: 0 } } })
    return true
  }, { timeout: 30_000 })
}

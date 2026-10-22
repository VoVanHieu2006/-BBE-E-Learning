import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { activeLearningPolicy, lockLearningUser, lockCompetitionScope } from './learning-periods'

/** Call while holding the course lock. Each publish captures the full requirement set once. */
export async function captureCourseRequirementVersion(tx: Prisma.TransactionClient, courseId: string, now: Date) {
  const course = await tx.course.findUniqueOrThrow({ where: { id: courseId }, include: {
    sessions: { include: { lessons: { include: { assessment: { select: { id: true } } } } } },
    final_assessment: { include: { final_exam_versions: { where: { is_active: true }, select: { id: true } } } },
  } })
  const lessons = course.sessions.flatMap((session) => session.lessons)
  const lessonIds = lessons.map((lesson) => lesson.id).sort()
  const assessmentIds = lessons.flatMap((lesson) => lesson.assessment ? [lesson.assessment.id] : []).sort()
  const finalVersion = course.final_assessment?.final_exam_versions[0]?.id || null
  const fingerprint = JSON.stringify({ lessonIds, assessmentIds, finalVersion })
  const previous = await tx.courseRequirementVersion.findFirst({ where: { course_id: courseId }, orderBy: { version: 'desc' } })
  if (previous?.fingerprint === fingerprint) return { version: previous, addedLessonIds: [] as string[] }
  const version = await tx.courseRequirementVersion.create({ data: {
    course_id: courseId, version: previous ? previous.version + 1 : course.content_version,
    lesson_ids: lessonIds, assessment_ids: assessmentIds, final_version_id: finalVersion,
    fingerprint, published_at: now,
  } })
  await tx.course.update({ where: { id: courseId }, data: { content_version: version.version } })
  return { version, addedLessonIds: previous ? lessonIds.filter((id) => !previous.lesson_ids.includes(id)) : [] }
}

export async function executePublishCourseRequirements(tx: Prisma.TransactionClient, courseId: string, now: Date) {
  const course = await tx.course.findUniqueOrThrow({ where: { id: courseId } })
  const configuredPolicy = await tx.learningPolicy.findUnique({ where: { id: 'default' } })
  if (configuredPolicy?.cutover_at && !course.program_id) throw new Error('PublishedCourseProgramRequired')
  if (await activeLearningPolicy(tx, now)) {
    if (!course.program_id) throw new Error('PublishedCourseProgramRequired')
    const { version, addedLessonIds } = await captureCourseRequirementVersion(tx, courseId, now)
    if (addedLessonIds.length) {
      const extraDays = addedLessonIds.length * Math.max(Math.ceil(course.mandatory_default_due_days / version.lesson_ids.length), 3)
      const assignments = await tx.userLearningAssignment.findMany({ where: { course_id: courseId, ended_at: null, mandatory: true } })
      for (const assignment of assignments) if (assignment.learning_cycle_id) {
        const cycle = await tx.learningCycle.findUnique({ where: { id: assignment.learning_cycle_id } })
        if (!cycle || cycle.ends_at) continue
        const path = await tx.learningPath.findUnique({ where: { learning_cycle_id: cycle.id } })
        if (!path) continue
        const baseTime = path.due_at ? path.due_at.getTime() : now.getTime()
        const newDueAt = new Date(baseTime + extraDays * 86_400_000)
        await tx.learningPath.update({
          where: { id: path.id },
          data: { due_at: newDueAt },
        })
        await tx.userLearningAssignment.updateMany({
          where: { user_id: assignment.user_id, learning_cycle_id: cycle.id, mandatory: true, ended_at: null },
          data: { due_at: newDueAt },
        })
        await tx.learningNotice.upsert({
          where: { event_key: `content:${version.id}:${assignment.user_id}` },
          update: {},
          create: {
            user_id: assignment.user_id,
            event_key: `content:${version.id}:${assignment.user_id}`,
            title: 'Khóa học có nội dung bổ sung',
            body: `${course.title}: ${addedLessonIds.length} bài mới, +${extraDays} ngày vào hạn hoàn thành chung. Hạn mới: ${newDueAt.toLocaleDateString('vi-VN')}.`,
          },
        })
      }
    }
  }

  await tx.coursePublicationEvent.create({
    data: { course_id: courseId, status: 'PUBLISHED', effective_at: now },
  })

  return tx.course.update({
    where: { id: courseId },
    data: { status: 'PUBLISHED', published_at: now },
  })
}

export async function publishCourseRequirements(courseId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('learning-catalog-configuration'))::text`
    const assignments = await tx.userLearningAssignment.findMany({ where: { course_id: courseId, ended_at: null, mandatory: true }, orderBy: { user_id: 'asc' } })
    for (const userId of Array.from(new Set(assignments.map((row) => row.user_id)))) await lockLearningUser(tx, userId)
    await tx.$queryRaw`SELECT id FROM courses WHERE id = ${courseId}::uuid FOR UPDATE`
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    const scope = await lockCompetitionScope(tx, clock.now)
    const now = scope?.now || clock.now
    return executePublishCourseRequirements(tx, courseId, now)
  }, { timeout: 30_000 })
}

export async function enforceSupplementalDeadlines() {
  return 0
}

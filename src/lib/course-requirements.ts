import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { lockLearningUser, lockCompetitionScope } from './learning-periods'
import { enqueueCourseStatusReconcile } from './course-status-outbox'
import {
  CONTENT_UPDATE_REASON, RequirementDiff, RequirementState, additionalDays, buildRequirementFingerprint, diffRequirementState,
  hasLearnableAddition, parseRequirementFingerprint, sameRequirementFingerprint, updatedDueAt,
} from './course-update-rules'

const EMPTY_STATE: RequirementState = { lessons: new Map(), finalVersionId: null }

/** Trạng thái yêu cầu ở phiên bản trước (đọc cả dấu vân tay định dạng cũ chỉ có 3 khóa). */
async function previousRequirementState(
  tx: Prisma.TransactionClient,
  previous: { lesson_ids: string[]; assessment_ids: string[]; final_version_id: string | null; fingerprint: string },
): Promise<RequirementState> {
  const parsed = parseRequirementFingerprint(previous.fingerprint)
  const videoIds = new Set(parsed?.videoLessonIds ?? previous.lesson_ids) // định dạng cũ: bài nào cũng bắt buộc có video
  let quizIds: Set<string>
  if (parsed?.quizLessonIds) quizIds = new Set(parsed.quizLessonIds)
  else {
    const rows = previous.assessment_ids.length
      ? await tx.assessment.findMany({ where: { id: { in: previous.assessment_ids } }, select: { lesson_id: true } })
      : []
    quizIds = new Set(rows.flatMap((row) => (row.lesson_id ? [row.lesson_id] : [])))
  }
  return {
    lessons: new Map(previous.lesson_ids.map((id) => [id, { hasVideo: videoIds.has(id), hasQuiz: quizIds.has(id) }])),
    finalVersionId: previous.final_version_id,
  }
}

/** Call while holding the course lock. Each publish captures the full requirement set once. */
export async function captureCourseRequirementVersion(tx: Prisma.TransactionClient, courseId: string, now: Date) {
  const course = await tx.course.findUniqueOrThrow({ where: { id: courseId }, include: {
    sessions: { include: { lessons: { include: { video: { select: { id: true } }, assessment: { select: { id: true } } } } } },
    final_assessment: { include: { final_exam_versions: { where: { is_active: true }, select: { id: true } } } },
  } })
  const lessons = course.sessions.flatMap((session) => session.lessons)
  const lessonIds = lessons.map((lesson) => lesson.id).sort()
  const assessmentIds = lessons.flatMap((lesson) => lesson.assessment ? [lesson.assessment.id] : []).sort()
  const finalVersion = course.final_assessment?.final_exam_versions[0]?.id || null
  // Dấu vân tay gồm cả video, quiz và đề thi cuối (KHBB 5.6), không chỉ id bài học.
  const fingerprint = buildRequirementFingerprint({
    lessonIds, assessmentIds, finalVersion,
    videoLessonIds: lessons.filter((lesson) => lesson.video).map((lesson) => lesson.id),
    quizLessonIds: lessons.filter((lesson) => lesson.assessment).map((lesson) => lesson.id),
  })
  const previous = await tx.courseRequirementVersion.findFirst({ where: { course_id: courseId }, orderBy: { version: 'desc' } })
  if (previous && sameRequirementFingerprint(previous.fingerprint, fingerprint)) {
    return { version: previous, diff: diffRequirementState(null, EMPTY_STATE), addedLessonIds: [] as string[], lessonCount: lessonIds.length, changed: false }
  }
  const diff = previous
    ? diffRequirementState(await previousRequirementState(tx, previous), {
        lessons: new Map(lessons.map((lesson) => [lesson.id, { hasVideo: Boolean(lesson.video), hasQuiz: Boolean(lesson.assessment) }])),
        finalVersionId: finalVersion,
      })
    : diffRequirementState(null, EMPTY_STATE)
  const version = await tx.courseRequirementVersion.create({ data: {
    course_id: courseId, version: previous ? Math.max(previous.version + 1, course.content_version) : course.content_version,
    lesson_ids: lessonIds, assessment_ids: assessmentIds, final_version_id: finalVersion,
    fingerprint, published_at: now,
  } })
  await tx.course.update({ where: { id: courseId }, data: { content_version: version.version } })
  const addedLessonIds = previous ? lessonIds.filter((id) => !previous.lesson_ids.includes(id)) : []
  return { version, diff, addedLessonIds, lessonCount: lessonIds.length, changed: true }
}

function describeDiff(diff: RequirementDiff): string {
  const parts: string[] = []
  const newLessons = diff.newLessonsFull.length + diff.newLessonsVideoOnly.length + diff.newLessonsQuizOnly.length
  if (newLessons) parts.push(`${newLessons} bài mới`)
  if (diff.videoAdded.length) parts.push(`${diff.videoAdded.length} video mới`)
  if (diff.quizAdded.length) parts.push(`${diff.quizAdded.length} quiz mới`)
  if (diff.finalAdded) parts.push('bài thi cuối khóa mới')
  return parts.join(', ')
}

/**
 * Áp một lần cập nhật nội dung khóa (KHBB 5.6, 6.2) cho mọi người thuộc khóa, trong transaction của người gọi:
 * cộng ngày tính từ lúc cập nhật, mở lại khóa đã xong, ghi `learning_path_changes`, gửi thông báo.
 * Idempotent: cập nhật lại cùng nội dung (cùng dấu vân tay) không tạo phiên bản mới nên không cộng thêm,
 * và thông báo dùng khóa sự kiện theo phiên bản + người nhận.
 */
export async function applyCourseContentUpdate(
  tx: Prisma.TransactionClient,
  course: { id: string; title: string; mandatory_default_due_days: number },
  version: { id: string },
  diff: RequirementDiff,
  lessonCount: number,
  now: Date,
  actorUserId: string | null = null,
) {
  if (!hasLearnableAddition(diff)) return { addedDays: 0, notified: 0, reopened: 0 }
  const addedDays = additionalDays(diff, course.mandatory_default_due_days, lessonCount)
  const summary = describeDiff(diff)
  const assignments = await tx.userLearningAssignment.findMany({ where: { course_id: course.id, ended_at: null } })
  let notified = 0
  const reopenedLog: { userId: string; previousCompletedAt: string | null }[] = []
  for (const assignment of assignments) {
    let newDueAt: Date | null = null
    let reopened = false
    const cycle = assignment.learning_cycle_id ? await tx.learningCycle.findUnique({ where: { id: assignment.learning_cycle_id } }) : null
    if (assignment.mandatory && cycle && !cycle.ends_at && addedDays > 0) {
      const path = await tx.learningPath.findUnique({ where: { learning_cycle_id: cycle.id } })
      if (path) {
        const completed = assignment.status === 'COMPLETED' || Boolean(assignment.completed_at)
        newDueAt = updatedDueAt({ now, currentDueAt: path.due_at ?? assignment.due_at, completed, addedDays })
        if (completed) {
          // Mở lại khóa đã xong cùng transaction với hạn mới để cron không khóa ngay.
          reopened = true
          reopenedLog.push({ userId: assignment.user_id, previousCompletedAt: assignment.completed_at ? assignment.completed_at.toISOString() : null })
          await tx.userLearningAssignment.update({ where: { id: assignment.id }, data: { status: 'ASSIGNED', completed_at: null, due_at: newDueAt } })
        }
        await tx.learningPath.update({ where: { id: path.id }, data: { due_at: newDueAt } })
        await tx.userLearningAssignment.updateMany({
          where: { user_id: assignment.user_id, learning_cycle_id: cycle.id, mandatory: true, ended_at: null, completed_at: null },
          data: { due_at: newDueAt },
        })
        await tx.learningPathChange.create({ data: {
          path_id: path.id, changed_at: now, previous_budget: path.budget ?? [], next_budget: path.budget ?? [],
          due_at: newDueAt, reason: CONTENT_UPDATE_REASON,
        } })
      }
    }
    const doneNote = reopened && assignment.completed_at
      ? ` Bạn đã hoàn thành khóa này ngày ${assignment.completed_at.toLocaleDateString('vi-VN')}; hãy học phần mới để hoàn thành lại.`
      : ''
    const dueNote = newDueAt ? ` +${addedDays} ngày; hạn mới: ${newDueAt.toLocaleDateString('vi-VN')}.` : ''
    const eventKey = `content:${version.id}:${assignment.user_id}`
    await tx.learningNotice.upsert({
      where: { event_key: eventKey },
      update: {},
      create: {
        user_id: assignment.user_id, event_key: eventKey, title: 'Khóa học có nội dung bổ sung',
        body: `${course.title}: ${summary}.${dueNote}${doneNote}`,
      },
    })
    notified++
  }
  if (reopenedLog.length) {
    await tx.auditLog.create({ data: {
      actor_user_id: actorUserId, action: 'COURSE_REOPENED_BY_UPDATE', entity_type: 'COURSE', entity_id: course.id,
      metadata: { versionId: version.id, addedDays, summary, reopened: reopenedLog } as unknown as Prisma.InputJsonValue,
    } })
  }
  return { addedDays, notified, reopened: reopenedLog.length }
}

/**
 * Cập nhật khóa đang xuất bản từ bản nháp thay đổi: không đổi trạng thái, không tạo sự kiện xuất bản mới.
 * Gọi khi đang giữ khóa của khóa học và của các học viên liên quan.
 */
export async function executeCourseContentUpdate(tx: Prisma.TransactionClient, courseId: string, now: Date, actorUserId: string | null = null) {
  const course = await tx.course.findUniqueOrThrow({ where: { id: courseId } })
  if (!course.program_id) throw new Error('PublishedCourseProgramRequired')
  const captured = await captureCourseRequirementVersion(tx, courseId, now)
  const applied = captured.changed
    ? await applyCourseContentUpdate(tx, course, captured.version, captured.diff, captured.lessonCount, now, actorUserId)
    : { addedDays: 0, notified: 0, reopened: 0 }
  return { version: captured.version, changed: captured.changed, ...applied }
}

export async function executePublishCourseRequirements(tx: Prisma.TransactionClient, courseId: string, now: Date) {
  const course = await tx.course.findUniqueOrThrow({ where: { id: courseId } })
  if (!course.program_id) throw new Error('PublishedCourseProgramRequired')
  const captured = await captureCourseRequirementVersion(tx, courseId, now)
  if (captured.changed) await applyCourseContentUpdate(tx, course, captured.version, captured.diff, captured.lessonCount, now)

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
    const now = scope.now
    const updated = await executePublishCourseRequirements(tx, courseId, now)
    // Xuất bản (lại): khóa trở lại bộ khóa như được thêm lại, áp cửa sổ 3 ngày (KHBB 5.7, 6.3).
    await enqueueCourseStatusReconcile(tx, courseId, 'PUBLISHED', now)
    return updated
  }, { timeout: 30_000 })
}

export async function enforceSupplementalDeadlines() {
  return 0
}

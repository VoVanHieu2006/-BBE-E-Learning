import { Prisma } from '@prisma/client'
import { CourseDraftContent, CourseDraftError, DraftAssessment, DraftFinal, DRAFT_UUID, assertDraftPublishable, needsFinalExamVersion, questionGradingFingerprint, reconcileDraftIds } from './course-draft'
import { courseDraftInclude, courseDraftSnapshot, DraftAssessmentRow, questionSnapshot } from './course-draft-snapshot'
import { createFinalExamVersion } from './final-exam-version'
import { assertFinalExamBankCapacity } from './final-exam-bank'
import { existingScheduleOf, hasCurrentMonthLockingAttempts, ScheduleColumns, scheduleChanged, scheduleColumns } from './assessment-schedule'
import { AssessmentConfig, AssessmentConfigUpdate, resolveAssessmentConfigUpdate, validateLessonBankForCounts } from './quiz-schedule-rules'

type Tx = Prisma.TransactionClient
const persisted = (id?: string) => id && DRAFT_UUID.test(id) ? id : undefined
const blocked = (code: string): never => { throw new CourseDraftError(code, 'Nội dung đã có lượt làm; không thể xóa để bảo toàn lịch sử và kết quả.', 409) }
const references = (q: { _count: { attempt_questions: number; attempt_answers: number } }) => q._count.attempt_questions + q._count.attempt_answers

export interface ScheduledUpdate {
  assessmentId: string; type: 'LESSON' | 'COURSE_FINAL'; lessonId: string | null
  currentQuestionCount: number; currentDurationMinutes: number
  questionCount: number; durationMinutes: number; effectiveAt: string; effectiveMonthKey: string
}

/**
 * The draft carries the schedule it was edited against. Once that schedule's month has begun (or nothing locks
 * this month any more), its values are what the admin wants active; an explicit change of the active value wins.
 */
function draftRequest(a: DraftFinal, current: AssessmentConfig, locked: boolean, now: Date) {
  const base = {
    questionCount: a.questionCount, durationMinutes: a.durationMinutes, cancelSchedule: a.cancelSchedule === true,
    scheduledQuestionCount: a.scheduledQuestionCount ?? null, scheduledDurationMinutes: a.scheduledDurationMinutes ?? null,
  }
  if (base.cancelSchedule) return base
  const due = typeof a.scheduledEffectiveAt === 'string' && Date.parse(a.scheduledEffectiveAt) <= now.getTime()
  if (locked && !due) return base
  const pick = (active: number, scheduled: number | null, currentValue: number) => scheduled === null || (!due && active !== currentValue) ? active : scheduled
  return {
    questionCount: pick(base.questionCount, base.scheduledQuestionCount, current.questionCount),
    durationMinutes: pick(base.durationMinutes, base.scheduledDurationMinutes, current.durationMinutes),
    scheduledQuestionCount: null, scheduledDurationMinutes: null, cancelSchedule: false,
  }
}

async function resolveConfig(tx: Tx, a: DraftFinal, before: (ScheduleColumns & { id: string }) | null, now: Date) {
  const locked = before ? await hasCurrentMonthLockingAttempts(tx, before.id, now) : false
  const current = before ? { questionCount: before.question_count, durationMinutes: before.duration_minutes } : { questionCount: a.questionCount, durationMinutes: a.durationMinutes }
  const existingSchedule = existingScheduleOf(before)
  const config = resolveAssessmentConfigUpdate({ current, existingSchedule, requested: draftRequest(a, current, locked, now), hasCurrentMonthLockingAttempts: locked, now })
  return { config, current, existingSchedule }
}

function scheduledUpdate(assessmentId: string, type: ScheduledUpdate['type'], lessonId: string | null, config: AssessmentConfigUpdate): ScheduledUpdate {
  const s = config.schedule!
  return { assessmentId, type, lessonId, currentQuestionCount: config.questionCount, currentDurationMinutes: config.durationMinutes,
    questionCount: s.questionCount, durationMinutes: s.durationMinutes, effectiveAt: s.effectiveAt.toISOString(), effectiveMonthKey: s.effectiveMonthKey }
}

async function applyAssessment(tx: Tx, lessonId: string, a: DraftAssessment | null, before: DraftAssessmentRow | null, actor: string, now: Date, updates: ScheduledUpdate[]) {
  reconcileDraftIds(before ? [before] : [], a ? [a] : [])
  if (!a) {
    if (before?._count.attempts) blocked('AssessmentVersionRequired')
    if (before) await tx.assessment.delete({ where: { id: before.id } })
    return
  }
  const { config, existingSchedule } = await resolveConfig(tx, a, before, now)
  // Dual budget: the bank must serve this month's active count and next month's scheduled count.
  const bank = validateLessonBankForCounts({
    questionCount: config.questionCount, scheduledQuestionCount: config.schedule?.questionCount ?? null,
    poolCounts: a.pools.map(p => a.questions.filter(q => q.poolId === p.id).length), totalQuestions: a.questions.length,
  })
  if (bank.ok === false) throw new CourseDraftError(bank.code, bank.message, 400)
  const data = { title: a.title.trim(), description: a.description || null, question_count: config.questionCount, duration_minutes: config.durationMinutes, ...scheduleColumns(config, actor, now) }
  const assessment = before
    ? await tx.assessment.update({ where: { id: before.id }, data })
    : await tx.assessment.create({ data: { ...data, type: 'LESSON', lesson_id: lessonId, created_by: actor } })
  if (scheduleChanged(config, existingSchedule)) updates.push(scheduledUpdate(assessment.id, 'LESSON', lessonId, config))

  // Referenced questions are archived (never deleted or regraded in place) so attempt history keeps its rows.
  const archive = (id: string) => tx.question.update({ where: { id }, data: { archived_at: now, pool_id: null } })
  const removedQuestions = reconcileDraftIds(before?.questions || [], a.questions)
  const removedRows = (before?.questions || []).filter(q => removedQuestions.includes(q.id))
  for (const q of removedRows.filter(q => references(q) > 0)) await archive(q.id)
  await tx.question.deleteMany({ where: { id: { in: removedRows.filter(q => references(q) === 0).map(q => q.id) }, assessment_id: assessment.id } })
  const removedPools = reconcileDraftIds(before?.question_pools || [], a.pools)
  await tx.questionPool.deleteMany({ where: { assessment_id: assessment.id, id: { in: removedPools } } })
  // Free every final position before reordering; pool order is unique within the quiz.
  const temporaryOrder = Math.max(-1, ...(before?.question_pools || []).map(p => p.sort_order), a.pools.length - 1) + 1
  for (const [index, p] of Array.from((before?.question_pools || []).filter(p => !removedPools.includes(p.id)).entries())) {
    await tx.questionPool.update({ where: { id: p.id }, data: { sort_order: temporaryOrder + index } })
  }
  const poolIds = new Map<string, string>()
  for (const [index, p] of Array.from(a.pools.entries())) {
    const data = { name: p.name.trim(), sort_order: index }
    const pool = persisted(p.id)
      ? await tx.questionPool.update({ where: { id: p.id! }, data })
      : await tx.questionPool.create({ data: { ...data, assessment_id: assessment.id } })
    poolIds.set(p.id!, pool.id)
  }
  for (const [index, q] of Array.from(a.questions.entries())) {
    const old = before?.questions.find(row => row.id === q.id)
    const removedOptions = reconcileDraftIds(old?.options || [], q.options)
    const regraded = Boolean(old && references(old) > 0 && questionGradingFingerprint(questionSnapshot(old)) !== questionGradingFingerprint(q))
    if (regraded) await archive(old!.id)
    const inPlace = regraded ? undefined : old
    const data = { question_text: q.questionText, question_type: q.questionType, points: q.points, explanation: q.explanation || null, sort_order: index, pool_id: q.poolId ? poolIds.get(q.poolId)! : null }
    const question = inPlace
      ? await tx.question.update({ where: { id: inPlace.id }, data })
      : await tx.question.create({ data: { ...data, assessment_id: assessment.id } })
    // Referenced options and their answer keys remain untouched, including their IDs.
    if (inPlace && references(inPlace) > 0) continue
    if (inPlace) await tx.questionOption.deleteMany({ where: { question_id: question.id, id: { in: removedOptions } } })
    for (const [oIndex, o] of Array.from(q.options.entries())) {
      const data = { option_text: o.optionText, is_correct: o.isCorrect, sort_order: oIndex }
      if (inPlace && persisted(o.id)) await tx.questionOption.update({ where: { id: o.id! }, data })
      else await tx.questionOption.create({ data: { ...data, question_id: question.id } })
    }
  }
}

/** Caller holds catalog/course/user locks. No transaction, requirement publish or cache side effects here. */
export async function applyCourseDraft(tx: Tx, courseId: string, content: CourseDraftContent, actor: string, now = new Date()): Promise<{ scheduledUpdates: ScheduledUpdate[] }> {
  assertDraftPublishable(content)
  const scheduledUpdates: ScheduledUpdate[] = []
  const before = await tx.course.findUniqueOrThrow({ where: { id: courseId }, include: courseDraftInclude })
  const oldContent = courseDraftSnapshot(before)
  const removedSessions = reconcileDraftIds(before.sessions, content.sessions)
  for (const s of before.sessions) {
    const after = content.sessions.find(row => row.id === s.id)
    const removed = after ? reconcileDraftIds(s.lessons, after.lessons) : s.lessons.map(l => l.id)
    if (s.lessons.some(l => removed.includes(l.id) && l.assessment?._count.attempts)) blocked(after ? 'LessonHasAttempts' : 'SessionHasAttempts')
    await tx.lesson.deleteMany({ where: { session_id: s.id, id: { in: removed } } })
  }
  await tx.session.deleteMany({ where: { course_id: courseId, id: { in: removedSessions } } })
  for (const [sIndex, s] of Array.from(content.sessions.entries())) {
    const oldSession = before.sessions.find(row => row.id === s.id)
    const data = { title: s.title.trim(), description: s.description || null, sort_order: sIndex }
    const session = oldSession ? await tx.session.update({ where: { id: oldSession.id }, data }) : await tx.session.create({ data: { ...data, course_id: courseId } })
    reconcileDraftIds(oldSession?.lessons || [], s.lessons)
    for (const [lIndex, l] of Array.from(s.lessons.entries())) {
      const oldLesson = oldSession?.lessons.find(row => row.id === l.id)
      const data = { title: l.title.trim(), description: l.description || null, sort_order: lIndex }
      const lesson = oldLesson ? await tx.lesson.update({ where: { id: oldLesson.id }, data }) : await tx.lesson.create({ data: { ...data, session_id: session.id } })
      if (l.video) {
        const data = { youtube_video_id: l.video.youtubeVideoId, duration_seconds: l.video.durationSeconds }
        await tx.video.upsert({ where: { lesson_id: lesson.id }, update: data, create: { ...data, lesson_id: lesson.id } })
      } else await tx.video.deleteMany({ where: { lesson_id: lesson.id } })
      const removedDocuments = reconcileDraftIds(oldLesson?.documents || [], l.documents)
      await tx.document.deleteMany({ where: { lesson_id: lesson.id, id: { in: removedDocuments } } })
      for (const d of l.documents) {
        const data = { file_name: d.fileName, storage_key: d.storageKey, mime_type: d.mimeType, file_size: BigInt(d.fileSize) }
        if (persisted(d.id)) await tx.document.update({ where: { id: d.id! }, data })
        else await tx.document.create({ data: { ...data, lesson_id: lesson.id } })
      }
      await applyAssessment(tx, lesson.id, l.assessment, oldLesson?.assessment || null, actor, now, scheduledUpdates)
    }
  }
  reconcileDraftIds(before.final_assessment ? [before.final_assessment] : [], content.finalAssessment ? [content.finalAssessment] : [])
  const beforeFinal = before.final_assessment
  if (!content.finalAssessment && beforeFinal) {
    if (beforeFinal._count.attempts) blocked('AssessmentVersionRequired')
    await tx.assessment.delete({ where: { id: beforeFinal.id } })
  } else if (content.finalAssessment) {
    const f = content.finalAssessment
    // With current-month attempts the version keeps this month's count/duration; only the bank/title may refresh.
    const { config, existingSchedule } = await resolveConfig(tx, f, beforeFinal, now)
    const target = { ...f, questionCount: config.questionCount, durationMinutes: config.durationMinutes }
    const current = await tx.course.findUniqueOrThrow({ where: { id: courseId }, include: courseDraftInclude })
    const newContent = courseDraftSnapshot(current)
    const bank = (c: CourseDraftContent) => c.sessions.flatMap(s => s.lessons.flatMap(l => l.assessment?.questions || []))
    let finalId = beforeFinal?.id
    if (needsFinalExamVersion(oldContent.finalAssessment, target, bank(oldContent), bank(newContent), Boolean(beforeFinal?.final_exam_versions.length))) {
      finalId = (await createFinalExamVersion(tx, courseId, { title: f.title, description: f.description || null, questionCount: config.questionCount, durationMinutes: config.durationMinutes }, actor)).assessment.id
    }
    if (finalId && (config.scheduleAction === 'UPSERT' || (config.scheduleAction === 'CLEAR' && existingSchedule))) {
      await tx.assessment.update({ where: { id: finalId }, data: scheduleColumns(config, actor, now) })
    }
    if (finalId && scheduleChanged(config, existingSchedule)) scheduledUpdates.push(scheduledUpdate(finalId, 'COURSE_FINAL', null, config))
  }
  await assertFinalExamBankCapacity(tx, courseId)
  await tx.course.update({ where: { id: courseId }, data: {
    title: content.title.trim(), description: content.description || null, visibility: content.visibility,
    ...(content.coverUrl !== undefined ? { cover_url: content.coverUrl, cover_public_id: content.coverPublicId } : {}),
  } })
  return { scheduledUpdates }
}

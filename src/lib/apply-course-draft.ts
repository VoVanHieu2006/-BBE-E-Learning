import { Prisma } from '@prisma/client'
import { CourseDraftContent, CourseDraftError, DraftAssessment, DRAFT_UUID, assertQuestionEditAllowed, needsFinalExamVersion, reconcileDraftIds } from './course-draft'
import { courseDraftInclude, courseDraftSnapshot, draftAssessmentInclude, DraftAssessmentRow, questionSnapshot } from './course-draft-snapshot'
import { createFinalExamVersion } from './final-exam-version'
import { assertFinalExamBankCapacity } from './final-exam-bank'

type Tx = Prisma.TransactionClient
const persisted = (id?: string) => id && DRAFT_UUID.test(id) ? id : undefined
const blocked = (code: string): never => { throw new CourseDraftError(code, 'Nội dung đã có lượt làm; không thể xóa để bảo toàn lịch sử và kết quả.', 409) }

async function applyAssessment(tx: Tx, lessonId: string, a: DraftAssessment | null, before: DraftAssessmentRow | null, actor: string) {
  reconcileDraftIds(before ? [before] : [], a ? [a] : [])
  if (!a) {
    if (before?._count.attempts) blocked('AssessmentVersionRequired')
    if (before) await tx.assessment.delete({ where: { id: before.id } })
    return
  }
  const data = { title: a.title.trim(), description: a.description || null, question_count: a.questionCount, duration_minutes: a.durationMinutes }
  const assessment = before
    ? await tx.assessment.update({ where: { id: before.id }, data })
    : await tx.assessment.create({ data: { ...data, type: 'LESSON', lesson_id: lessonId, created_by: actor } })
  const removedQuestions = reconcileDraftIds(before?.questions || [], a.questions)
  const removedPools = reconcileDraftIds(before?.question_pools || [], a.pools)
  for (const q of before?.questions || []) {
    assertQuestionEditAllowed(questionSnapshot(q), a.questions.find(next => next.id === q.id) || null, q._count.attempt_questions + q._count.attempt_answers)
  }
  await tx.question.deleteMany({ where: { id: { in: removedQuestions }, assessment_id: assessment.id } })
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
    const data = { question_text: q.questionText, question_type: q.questionType, points: q.points, explanation: q.explanation || null, sort_order: index, pool_id: q.poolId ? poolIds.get(q.poolId)! : null }
    const question = old
      ? await tx.question.update({ where: { id: old.id }, data })
      : await tx.question.create({ data: { ...data, assessment_id: assessment.id } })
    // Referenced options and their answer keys remain untouched, including their IDs.
    if (old && old._count.attempt_questions + old._count.attempt_answers > 0) continue
    const removedOptions = reconcileDraftIds(old?.options || [], q.options)
    await tx.questionOption.deleteMany({ where: { question_id: question.id, id: { in: removedOptions } } })
    for (const [oIndex, o] of Array.from(q.options.entries())) {
      const data = { option_text: o.optionText, is_correct: o.isCorrect, sort_order: oIndex }
      if (persisted(o.id)) await tx.questionOption.update({ where: { id: o.id! }, data })
      else await tx.questionOption.create({ data: { ...data, question_id: question.id } })
    }
  }
  await tx.questionPool.deleteMany({ where: { assessment_id: assessment.id, id: { in: removedPools } } })
}

/** Caller holds catalog/course/user locks. No transaction, requirement publish or cache side effects here. */
export async function applyCourseDraft(tx: Tx, courseId: string, content: CourseDraftContent, actor: string) {
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
      await applyAssessment(tx, lesson.id, l.assessment, oldLesson?.assessment || null, actor)
    }
  }
  reconcileDraftIds(before.final_assessment ? [before.final_assessment] : [], content.finalAssessment ? [content.finalAssessment] : [])
  if (!content.finalAssessment && before.final_assessment) {
    if (before.final_assessment._count.attempts) blocked('AssessmentVersionRequired')
    await tx.assessment.delete({ where: { id: before.final_assessment.id } })
  } else if (content.finalAssessment) {
    const current = await tx.course.findUniqueOrThrow({ where: { id: courseId }, include: courseDraftInclude })
    const newContent = courseDraftSnapshot(current)
    const bank = (c: CourseDraftContent) => c.sessions.flatMap(s => s.lessons.flatMap(l => l.assessment?.questions || []))
    if (needsFinalExamVersion(oldContent.finalAssessment, content.finalAssessment, bank(oldContent), bank(newContent), Boolean(before.final_assessment?.final_exam_versions.length))) {
      await createFinalExamVersion(tx, courseId, { ...content.finalAssessment, description: content.finalAssessment.description || null }, actor)
    }
  }
  await assertFinalExamBankCapacity(tx, courseId)
  await tx.course.update({ where: { id: courseId }, data: {
    title: content.title.trim(), description: content.description || null, visibility: content.visibility,
    ...(content.coverUrl !== undefined ? { cover_url: content.coverUrl, cover_public_id: content.coverPublicId } : {}),
  } })
}

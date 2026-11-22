import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { Api, as, login, type Session } from './api'
import { sql } from './db'
import type { AccountKey } from './seed'

export const PASSWORD = 'E2e-Learner-9x!'
let counter = 0
export function unique(prefix: string) { counter += 1; return `${prefix}-${Date.now().toString(36)}-${counter}` }
export function uniqueEmail(prefix = 'learner') { return `${unique(prefix)}@e2e.bbe.test`.toLowerCase() }

// A confirmed product defect: the assertion states the documented intent (docs/business-rules.md) and is
// expected to fail until the product is fixed. `E2E_STRICT=1` runs these as ordinary (red) tests.
// Playwright reports a defect test that starts passing, so a fix cannot go unnoticed.
const expectDefect = (id: string) => { if (process.env.E2E_STRICT !== '1') test.fail(true, `${id}: known defect, see docs/qa/defects.md`) }
export function defect(id: string, title: string, body: (args: { request: APIRequestContext }) => Promise<void>) {
  test(`[${id}] ${title}`, { annotation: { type: 'defect', description: id } }, async ({ request }) => { expectDefect(id); await body({ request }) })
}
export function uiDefect(id: string, title: string, body: (args: { page: Page; request: APIRequestContext }) => Promise<void>) {
  test(`[${id}] ${title}`, { annotation: { type: 'defect', description: id } }, async ({ page, request }) => { expectDefect(id); await body({ page, request }) })
}

export type Learner = { email: string; password: string; session: Session; api: Api; userId: string }

/** Invite → link → accept: the only supported way to create an account, so every fixture exercises it. */
export async function inviteLink(request: APIRequestContext, inviter: AccountKey, email: string, unitType: 'DEPARTMENT' | 'DNA_GROUP' = 'DEPARTMENT', unitName?: string) {
  const manager = await as(request, inviter)
  const units = (await manager.get('/api/v1/organization/managed-units')).body.items as { id: string; name: string; type: string; canManageMembers: boolean }[]
  const unit = units.find((item) => item.type === unitType && item.canManageMembers && (!unitName || item.name === unitName))
  if (!unit) throw new Error(`${inviter} manages no ${unitType} unit ${unitName || ''}`)
  const invitation = await manager.post('/api/v1/invitations/member', { email, organizationUnitId: unit.id })
  expect(invitation.status, JSON.stringify(invitation.body)).toBe(201)
  const link = await manager.post(`/api/v1/invitations/${invitation.body.invitationId}/link`)
  expect(link.status, JSON.stringify(link.body)).toBe(200)
  return { invitationId: invitation.body.invitationId as string, unit, link: link.body.link as string, token: new URL(link.body.link).searchParams.get('token') as string, invitation: invitation.body }
}

export async function createLearner(request: APIRequestContext, options: { inviter?: AccountKey; unitType?: 'DEPARTMENT' | 'DNA_GROUP'; unitName?: string; prefix?: string } = {}): Promise<Learner> {
  const email = uniqueEmail(options.prefix)
  const { token } = await inviteLink(request, options.inviter || 'chapterLead', email, options.unitType, options.unitName)
  const accepted = await new Api(request).post('/api/v1/invitations/accept', { token, email, password: PASSWORD, confirmPassword: PASSWORD })
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
  const session = await login(request, email, PASSWORD)
  return { email, password: PASSWORD, session, api: new Api(request, session.accessToken), userId: session.user.id }
}

export type LessonSpec = { title?: string; durationSeconds?: number; quiz?: { questions: number; perAttempt?: number; durationMinutes?: number } }
export type BuiltCourse = { courseId: string; title: string; sessionId: string; lessons: { lessonId: string; videoId: string; durationSeconds: number; assessmentId?: string }[] }

export function quizQuestions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    questionText: `Câu hỏi ${index + 1}: đáp án nào đúng?`,
    options: [{ optionText: 'Đúng', isCorrect: true }, { optionText: 'Sai A', isCorrect: false }, { optionText: 'Sai B', isCorrect: false }],
  }))
}

/** Authors a course through the same Admin API the editor uses. */
export async function createCourse(request: APIRequestContext, options: { lessons: LessonSpec[]; visibility?: 'PUBLIC' | 'PRIVATE'; programCode?: string | null; publish?: boolean; title?: string } ): Promise<BuiltCourse> {
  const admin = await as(request, 'admin')
  const title = options.title || unique('E2E khóa học')
  const course = await admin.post('/api/v1/courses', { title, description: 'Khóa học do bộ test E2E tạo', visibility: options.visibility || 'PRIVATE' })
  expect(course.status, JSON.stringify(course.body)).toBe(201)
  const courseId = course.body.courseId as string
  const session = await admin.post(`/api/v1/courses/${courseId}/sessions`, { title: 'Chương 1' })
  expect(session.status, JSON.stringify(session.body)).toBe(201)
  const lessons: BuiltCourse['lessons'] = []
  for (const [index, spec] of options.lessons.entries()) {
    const durationSeconds = spec.durationSeconds ?? 40
    const lesson = await admin.post(`/api/v1/sessions/${session.body.sessionId}/lessons`, { title: spec.title || `Bài ${index + 1}`, youtubeVideoId: 'M7lc1UVf-VE', durationSeconds })
    expect(lesson.status, JSON.stringify(lesson.body)).toBe(201)
    let assessmentId: string | undefined
    if (spec.quiz) {
      const assessment = await admin.post(`/api/v1/lessons/${lesson.body.lessonId}/assessment`, {
        title: `Quiz bài ${index + 1}`, questions: quizQuestions(spec.quiz.questions), questionCount: spec.quiz.perAttempt ?? spec.quiz.questions, durationMinutes: spec.quiz.durationMinutes ?? 5,
      })
      expect(assessment.status, JSON.stringify(assessment.body)).toBe(201)
      assessmentId = assessment.body.assessmentId
    }
    lessons.push({ lessonId: lesson.body.lessonId, videoId: lesson.body.video.videoId, durationSeconds, assessmentId })
  }
  const programCode = options.programCode === undefined ? 'EXTENDED' : options.programCode
  if (programCode) expect((await admin.patch(`/api/v1/courses/${courseId}`, { programCode })).status).toBe(200)
  if (options.publish !== false) {
    const published = await admin.post(`/api/v1/courses/${courseId}/publish`)
    expect(published.status, JSON.stringify(published.body)).toBe(200)
  }
  return { courseId, title, sessionId: session.body.sessionId, lessons }
}

/** Fixture time travel: pretends `seconds` of wall-clock time passed since the learner's last heartbeat. */
export async function ageLastHeartbeat(userId: string, lessonId: string, seconds: number) {
  await sql(`UPDATE monthly_video_replays SET last_heartbeat_at = last_heartbeat_at - make_interval(secs => $3)
             WHERE user_id = $1 AND video_id = (SELECT id FROM videos WHERE lesson_id = $2) AND last_heartbeat_at IS NOT NULL`, [userId, lessonId, seconds])
  await sql(`UPDATE lesson_progress SET last_watched_at = last_watched_at - make_interval(secs => $3) WHERE user_id = $1 AND lesson_id = $2`, [userId, lessonId, seconds])
}

/** An honest full viewing at 1× speed: heartbeats every 20 s of (simulated) wall-clock time, then ENDED. */
export async function watchWholeVideo(learner: Learner, lessonId: string, durationSeconds: number, viewSessionId = unique('view')) {
  const beat = (positionSeconds: number, event: string) => learner.api.patch(`/api/v1/lessons/${lessonId}/progress`, { positionSeconds, event, viewSessionId, playbackRate: 1, playerDurationSeconds: durationSeconds })
  let last = await beat(0, 'PLAY')
  expect(last.status, JSON.stringify(last.body)).toBe(200)
  for (let position = 0; position < durationSeconds;) {
    const step = Math.min(20, durationSeconds - position)
    await ageLastHeartbeat(learner.userId, lessonId, step)
    position += step
    last = await beat(position, position >= durationSeconds ? 'ENDED' : 'HEARTBEAT')
    expect(last.status, JSON.stringify(last.body)).toBe(200)
  }
  return last
}

/** Answers the first `correct` questions correctly and the rest wrongly, then submits. */
export async function takeQuiz(learner: Learner, assessmentId: string, correct: number) {
  const attempt = await learner.api.post(`/api/v1/assessments/${assessmentId}/attempts`)
  expect([200, 201], JSON.stringify(attempt.body)).toContain(attempt.status)
  const questions = attempt.body.questions as { questionId: string; options: { optionId: string; optionText: string }[] }[]
  for (const [index, question] of questions.entries()) {
    const option = question.options.find((item) => (item.optionText === 'Đúng') === (index < correct))!
    const saved = await learner.api.put(`/api/v1/attempts/${attempt.body.attemptId}/answers/${question.questionId}`, { selectedOptionId: option.optionId })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
  }
  const submitted = await learner.api.post(`/api/v1/attempts/${attempt.body.attemptId}/submit`)
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)
  return { attemptId: attempt.body.attemptId as string, attempt: attempt.body, result: submitted.body }
}

/** Fixture time travel past the retake cooldown (NEXT_PUBLIC_QUIZ_COOLDOWN_MINUTES, default 2 minutes). */
export async function skipQuizCooldown(userId: string, assessmentId: string) {
  await sql(`UPDATE attempts SET submitted_at = submitted_at - interval '1 hour', started_at = started_at - interval '1 hour', expires_at = expires_at - interval '1 hour'
             WHERE user_id = $1 AND assessment_id = $2 AND status <> 'IN_PROGRESS'`, [userId, assessmentId])
}

export async function starBalance(learner: Learner) {
  const stars = await learner.api.get('/api/v1/stars/me')
  expect(stars.status).toBe(200)
  return stars.body.balance as number
}

import { expect, test } from '@playwright/test'
import { as, errorCode } from '../support/api'
import { one, sql } from '../support/db'
import { createCourse, createLearner, quizQuestions, skipQuizCooldown, starBalance, takeQuiz, watchWholeVideo } from '../support/fixtures'

// Intent: docs/business-rules.md "Quiz và sao".
async function readyForQuiz(request: any, questions = 20, extra: { perAttempt?: number; durationMinutes?: number } = {}) {
  const course = await createCourse(request, { lessons: [{ quiz: { questions, ...extra } }, {}] })
  const learner = await createLearner(request)
  await watchWholeVideo(learner, course.lessons[0].lessonId, 40)
  return { course, learner, lesson: course.lessons[0], assessmentId: course.lessons[0].assessmentId!, videoStars: 1 }
}

test.describe('Điều kiện làm quiz', () => {
  test('chưa xem xong video thì chưa được làm quiz, có lời giải thích', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{ quiz: { questions: 4 } }] })
    const learner = await createLearner(request)
    const early = await learner.api.post(`/api/v1/assessments/${course.lessons[0].assessmentId}/attempts`)
    expect(early.status).toBe(403)
    expect(early.body.error.message).toMatch(/video/i)
    expect((await learner.api.get(`/api/v1/lessons/${course.lessons[0].lessonId}/progress`)).body.canAssess).toBe(false)
    await watchWholeVideo(learner, course.lessons[0].lessonId, 40)
    expect((await learner.api.get(`/api/v1/lessons/${course.lessons[0].lessonId}/progress`)).body.canAssess).toBe(true)
  })

  test('Admin và Lead không làm quiz', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{ quiz: { questions: 2 } }] })
    for (const account of ['chapterLead', 'dnaLead', 'admin'] as const) {
      const result = await (await as(request, account)).post(`/api/v1/assessments/${course.lessons[0].assessmentId}/attempts`)
      expect(result.status, account).toBe(403)
    }
  })

  test('đề phát cho người học: đúng số câu, có hạn nộp theo durationMinutes, không lộ đáp án', async ({ request }) => {
    const { learner, assessmentId } = await readyForQuiz(request, 12, { perAttempt: 8, durationMinutes: 7 })
    const before = Date.now()
    const attempt = await learner.api.post(`/api/v1/assessments/${assessmentId}/attempts`)
    expect(attempt.status).toBeLessThan(300)
    expect(attempt.body).toMatchObject({ attemptNumber: 1, questionCount: 8, durationMinutes: 7, passingPercent: 85, isResumed: false })
    expect(attempt.body.questions).toHaveLength(8)
    expect(new Set(attempt.body.questions.map((question: any) => question.questionId)).size, 'không lặp câu').toBe(8)
    const minutes = (new Date(attempt.body.expiresAt).getTime() - before) / 60_000
    expect(minutes).toBeGreaterThan(6.9)
    expect(minutes).toBeLessThan(7.1)
    expect(JSON.stringify(attempt.body)).not.toMatch(/isCorrect|is_correct|correctOptionId|explanation/)
  })

  test('tải lại trang giữa chừng tiếp tục đúng lượt đang làm với câu trả lời đã lưu, không tạo lượt mới', async ({ request }) => {
    const { learner, assessmentId } = await readyForQuiz(request, 5)
    const first = await learner.api.post(`/api/v1/assessments/${assessmentId}/attempts`)
    const question = first.body.questions[0]
    const saved = await learner.api.put(`/api/v1/attempts/${first.body.attemptId}/answers/${question.questionId}`, { selectedOptionId: question.options[0].optionId })
    expect(saved.status).toBe(200)
    const resumed = await learner.api.post(`/api/v1/assessments/${assessmentId}/attempts`)
    expect(resumed.status).toBeLessThan(300)
    expect(resumed.body).toMatchObject({ attemptId: first.body.attemptId, isResumed: true, expiresAt: first.body.expiresAt })
    expect(resumed.body.existingAnswers[question.questionId]).toBe(question.options[0].optionId)
    expect(resumed.body.questions.map((item: any) => item.questionId)).toEqual(first.body.questions.map((item: any) => item.questionId))
    const attempts = await sql(`SELECT id FROM attempts WHERE user_id = $1 AND assessment_id = $2`, [learner.userId, assessmentId])
    expect(attempts).toHaveLength(1)
  })

  test('không trả lời hộ: người khác không xem, không trả lời, không nộp được lượt làm của tôi', async ({ request }) => {
    const { learner, assessmentId } = await readyForQuiz(request, 3)
    const attempt = await learner.api.post(`/api/v1/assessments/${assessmentId}/attempts`)
    const question = attempt.body.questions[0]
    const other = await createLearner(request)
    for (const actor of [other.api, await as(request, 'chapterLead')]) {
      expect([403, 404]).toContain((await actor.get(`/api/v1/attempts/${attempt.body.attemptId}`)).status)
      expect([403, 404]).toContain((await actor.put(`/api/v1/attempts/${attempt.body.attemptId}/answers/${question.questionId}`, { selectedOptionId: question.options[0].optionId })).status)
      expect([403, 404]).toContain((await actor.post(`/api/v1/attempts/${attempt.body.attemptId}/submit`)).status)
    }
    expect((await one(`SELECT status FROM attempts WHERE id = $1`, [attempt.body.attemptId])).status).toBe('IN_PROGRESS')
  })

  test('đáp án không thuộc câu hỏi bị từ chối', async ({ request }) => {
    const { learner, assessmentId } = await readyForQuiz(request, 3)
    const attempt = await learner.api.post(`/api/v1/assessments/${assessmentId}/attempts`)
    const [first, second] = attempt.body.questions
    const answer = (questionId: string, selectedOptionId: unknown) => learner.api.put(`/api/v1/attempts/${attempt.body.attemptId}/answers/${questionId}`, { selectedOptionId })
    expect((await answer(first.questionId, second.options[0].optionId)).status).toBeGreaterThanOrEqual(400)
    expect((await answer(first.questionId, 'khong-ton-tai')).status).toBeGreaterThanOrEqual(400)
    expect((await answer('00000000-0000-4000-8000-000000000000', first.options[0].optionId)).status).toBeGreaterThanOrEqual(400)
    expect((await answer(first.questionId, first.options[1].optionId)).status).toBe(200)
    expect((await answer(first.questionId, first.options[0].optionId)).status, 'đổi đáp án trước khi nộp').toBe(200)
  })
})

test.describe('Chấm điểm và ngưỡng 85%', () => {
  test('17/20 = 85% là đạt, mở bài sau, cộng 17 sao', async ({ request }) => {
    const { course, learner, assessmentId, videoStars } = await readyForQuiz(request)
    const { result } = await takeQuiz(learner, assessmentId, 17)
    expect(result).toMatchObject({ scorePercent: 85, passed: true })
    expect(result.starReward).toMatchObject({ awarded: true, amount: 17 })
    expect(await starBalance(learner)).toBe(videoStars + 17)
    expect((await learner.api.get(`/api/v1/lessons/${course.lessons[1].lessonId}`)).status).toBe(200)
    expect(result.answers.filter((answer: any) => answer.isCorrect)).toHaveLength(17)
    expect(result.answers.every((answer: any) => answer.correctOptionId), 'sau khi nộp mới thấy đáp án đúng').toBe(true)
  })

  test('16/20 = 80% là trượt: không sao quiz, bài sau vẫn khóa, phải chờ hết thời gian chờ mới làm lại', async ({ request }) => {
    const { course, learner, assessmentId, videoStars } = await readyForQuiz(request)
    const { result } = await takeQuiz(learner, assessmentId, 16)
    expect(result).toMatchObject({ scorePercent: 80, passed: false })
    expect(result.starReward?.awarded ?? false).toBe(false)
    expect(await starBalance(learner)).toBe(videoStars)
    const next = await learner.api.get(`/api/v1/lessons/${course.lessons[1].lessonId}`)
    expect(next.status).toBe(403)
    expect(next.body.error.message, 'người học biết cần đạt quiz').toMatch(/kiểm tra|quiz/i)
    const retake = await learner.api.post(`/api/v1/assessments/${assessmentId}/attempts`)
    expect(retake.status).toBe(429)
    expect(errorCode(retake)).toBe('CooldownActive')
    const history = await learner.api.get(`/api/v1/assessments/${assessmentId}/attempts/me`)
    expect(history.body.cooldownMinutes).toBe(2)
    expect(history.body.remainingMs).toBeGreaterThan(60_000)
    expect(history.body.remainingMs).toBeLessThanOrEqual(120_000)
  })

  test('làm lại sau thời gian chờ: sao chỉ cộng phần vượt mốc cao nhất đã thưởng (17 → 16 → 19 → 20 → 20 nhận 17, 0, 2, 1, 0)', async ({ request }) => {
    const { learner, assessmentId, videoStars } = await readyForQuiz(request)
    const expected: [number, number][] = [[17, 17], [16, 0], [19, 2], [20, 1], [20, 0]]
    let total = videoStars
    for (const [correct, stars] of expected) {
      const { result } = await takeQuiz(learner, assessmentId, correct)
      expect(result.starReward?.amount ?? 0, `${correct}/20`).toBe(stars)
      total += stars
      expect(await starBalance(learner), `sau lượt ${correct}/20`).toBe(total)
      await skipQuizCooldown(learner.userId, assessmentId)
    }
    expect(total).toBe(videoStars + 20)
    expect((await learner.api.get(`/api/v1/assessments/${assessmentId}/attempts/me`)).body.items).toHaveLength(5)
  })

  test('nộp hai lần hoặc bấm đúp không cộng sao lặp và không đổi kết quả', async ({ request }) => {
    const { learner, assessmentId, videoStars } = await readyForQuiz(request)
    const { attemptId, result } = await takeQuiz(learner, assessmentId, 18)
    const [second, third] = await Promise.all([learner.api.post(`/api/v1/attempts/${attemptId}/submit`), learner.api.post(`/api/v1/attempts/${attemptId}/submit`)])
    for (const repeat of [second, third]) {
      expect(repeat.status).toBe(200)
      expect(repeat.body).toMatchObject({ scorePercent: result.scorePercent, passed: true })
    }
    expect(await starBalance(learner)).toBe(videoStars + 18)
    const late = await learner.api.put(`/api/v1/attempts/${attemptId}/answers/${result.answers[19].questionId}`, { selectedOptionId: result.answers[19].correctOptionId })
    expect(late.status, 'không sửa đáp án sau khi nộp').toBeGreaterThanOrEqual(400)
    expect((await learner.api.get(`/api/v1/attempts/${attemptId}`)).body.answers.filter((answer: any) => answer.isCorrect)).toHaveLength(18)
  })

  test('bỏ trống câu được tính là sai; nộp bài trắng là 0%', async ({ request }) => {
    const { learner, assessmentId, videoStars } = await readyForQuiz(request, 4)
    const attempt = await learner.api.post(`/api/v1/assessments/${assessmentId}/attempts`)
    const submitted = await learner.api.post(`/api/v1/attempts/${attempt.body.attemptId}/submit`)
    expect(submitted.status).toBe(200)
    expect(submitted.body).toMatchObject({ scorePercent: 0, passed: false })
    expect(await starBalance(learner)).toBe(videoStars)
  })

  test('hết giờ: câu trả lời gửi muộn bị từ chối, bài tự nộp với những câu đã lưu', async ({ request }) => {
    const { learner, assessmentId } = await readyForQuiz(request, 4)
    const attempt = await learner.api.post(`/api/v1/assessments/${assessmentId}/attempts`)
    const [first, second] = attempt.body.questions
    const right = (question: any) => question.options.find((option: any) => option.optionText === 'Đúng').optionId
    expect((await learner.api.put(`/api/v1/attempts/${attempt.body.attemptId}/answers/${first.questionId}`, { selectedOptionId: right(first) })).status).toBe(200)
    await sql(`UPDATE attempts SET expires_at = now() - interval '5 seconds' WHERE id = $1`, [attempt.body.attemptId])
    const late = await learner.api.put(`/api/v1/attempts/${attempt.body.attemptId}/answers/${second.questionId}`, { selectedOptionId: right(second) })
    expect(late.status, 'server giữ hạn nộp, không tin đồng hồ client').toBeGreaterThanOrEqual(400)
    const submitted = await learner.api.post(`/api/v1/attempts/${attempt.body.attemptId}/submit`)
    expect(submitted.status).toBe(200)
    expect(submitted.body).toMatchObject({ scorePercent: 25, passed: false })
    expect(['SUBMITTED', 'AUTO_SUBMITTED', 'EXPIRED']).toContain((await one(`SELECT status FROM attempts WHERE id = $1`, [attempt.body.attemptId])).status)
  })

  test('cron tự nộp bài quá hạn; cron đòi đúng secret', async ({ request }) => {
    const { learner, assessmentId } = await readyForQuiz(request, 4)
    const attempt = await learner.api.post(`/api/v1/assessments/${assessmentId}/attempts`)
    await sql(`UPDATE attempts SET expires_at = now() - interval '5 seconds' WHERE id = $1`, [attempt.body.attemptId])
    expect((await request.post('/api/internal/attempts/auto-submit', { headers: { Cookie: 'x=1' } })).status()).toBe(401)
    expect((await request.post('/api/internal/attempts/auto-submit', { headers: { Cookie: 'x=1', Authorization: 'Bearer sai-secret' } })).status()).toBe(401)
    expect((await learner.api.post('/api/internal/attempts/auto-submit')).status, 'token người dùng không thay được secret').toBe(401)
    const cron = await request.post('/api/internal/attempts/auto-submit', { headers: { Cookie: 'x=1', Authorization: 'Bearer e2e-fixture-only-cron-secret' } })
    expect(cron.status(), await cron.text()).toBe(200)
    expect((await one(`SELECT status FROM attempts WHERE id = $1`, [attempt.body.attemptId])).status).not.toBe('IN_PROGRESS')
  })

  test('đề được chụp theo lượt làm: kết quả cũ không đổi dù ngân hàng câu hỏi bị sửa trực tiếp', async ({ request }) => {
    const { learner, assessmentId } = await readyForQuiz(request, 4)
    const { attemptId, result } = await takeQuiz(learner, assessmentId, 4)
    await sql(`UPDATE question_options SET is_correct = NOT is_correct WHERE question_id IN (SELECT id FROM questions WHERE assessment_id = $1)`, [assessmentId])
    const reread = await learner.api.get(`/api/v1/attempts/${attemptId}`)
    expect(reread.body.passed).toBe(true)
    expect(reread.body.answers.map((answer: any) => answer.isCorrect)).toEqual(result.answers.map((answer: any) => answer.isCorrect))
  })

  test('trường score phải cùng đơn vị ở kết quả nộp bài và ở lịch sử lượt làm', async ({ request }) => {
    const { learner, assessmentId } = await readyForQuiz(request)
    const { attemptId, result } = await takeQuiz(learner, assessmentId, 18)
    const reread = await learner.api.get(`/api/v1/attempts/${attemptId}`)
    expect(reread.body.score).toBe(result.score)
  })
})

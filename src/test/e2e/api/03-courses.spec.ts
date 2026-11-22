import { expect, test } from '@playwright/test'
import { as, errorCode, guest } from '../support/api'
import { createCourse, createLearner, quizQuestions, starBalance, takeQuiz, unique, watchWholeVideo } from '../support/fixtures'

// Intent: docs/business-rules.md "Nội dung và video" — Course → Session → Lesson, DRAFT/PUBLISHED độc lập PUBLIC/PRIVATE.
test.describe('Soạn khóa học (Admin)', () => {
  test('khóa mới là DRAFT; thiếu tiêu đề bị từ chối', async ({ request }) => {
    const admin = await as(request, 'admin')
    expect((await admin.post('/api/v1/courses', { description: 'Không có tiêu đề' })).status).toBe(400)
    expect((await admin.post('/api/v1/courses', { title: '   ' })).status).toBe(400)
    const created = await admin.post('/api/v1/courses', { title: unique('Khóa nháp'), visibility: 'PRIVATE' })
    expect(created.status).toBe(201)
    const course = await admin.get(`/api/v1/courses/${created.body.courseId}`)
    expect(course.body).toMatchObject({ status: 'DRAFT', visibility: 'PRIVATE', sessions: [] })
  })

  test('xuất bản bị chặn từng bước: khóa rỗng → chương rỗng → chưa gắn chương trình → thành công', async ({ request }) => {
    const admin = await as(request, 'admin')
    const courseId = (await admin.post('/api/v1/courses', { title: unique('Khóa kiểm tra xuất bản') })).body.courseId
    const publish = () => admin.post(`/api/v1/courses/${courseId}/publish`)
    const empty = await publish()
    expect(empty.status).toBe(400)
    expect(errorCode(empty)).toBe('EmptyCourse')
    const session = await admin.post(`/api/v1/courses/${courseId}/sessions`, { title: 'Chương 1' })
    expect(errorCode(await publish())).toBe('EmptySession')
    const lesson = await admin.post(`/api/v1/sessions/${session.body.sessionId}/lessons`, { title: 'Bài 1', youtubeVideoId: 'M7lc1UVf-VE', durationSeconds: 60 })
    expect(lesson.status).toBe(201)
    const noProgram = await publish()
    expect(noProgram.status).toBe(409)
    expect(errorCode(noProgram)).toBe('PublishedCourseProgramRequired')
    for (const failure of [empty, noProgram]) expect(failure.body.error.message, 'Admin được báo lý do bằng lời').toBeTruthy()
    expect((await admin.patch(`/api/v1/courses/${courseId}`, { programCode: 'EXTENDED' })).status).toBe(200)
    const published = await publish()
    expect(published.status, JSON.stringify(published.body)).toBe(200)
    expect((await admin.get(`/api/v1/courses/${courseId}`)).body.status).toBe('PUBLISHED')
  })

  test('bài học cần tiêu đề; chương của khóa không tồn tại trả 404', async ({ request }) => {
    const admin = await as(request, 'admin')
    const course = await createCourse(request, { lessons: [{}], publish: false })
    expect((await admin.post(`/api/v1/sessions/${course.sessionId}/lessons`, { youtubeVideoId: 'M7lc1UVf-VE', durationSeconds: 30 })).status).toBe(400)
    expect((await admin.post('/api/v1/sessions/00000000-0000-4000-8000-000000000000/lessons', { title: 'Bài mồ côi', youtubeVideoId: 'M7lc1UVf-VE', durationSeconds: 30 })).status).toBe(404)
    expect((await admin.post('/api/v1/courses/00000000-0000-4000-8000-000000000000/sessions', { title: 'Chương mồ côi' })).status).toBe(404)
    expect((await admin.get('/api/v1/courses/00000000-0000-4000-8000-000000000000')).status).toBe(404)
  })

  test('quiz: mỗi câu cần nội dung, ít nhất hai đáp án và đúng một đáp án đúng; số câu mỗi lượt nằm trong ngân hàng', async ({ request }) => {
    const admin = await as(request, 'admin')
    const course = await createCourse(request, { lessons: [{}], publish: false })
    const save = (body: unknown) => admin.post(`/api/v1/lessons/${course.lessons[0].lessonId}/assessment`, body)
    const good = quizQuestions(4)
    const invalid = [
      { title: 'Thiếu câu hỏi', questions: [], questionCount: 1, durationMinutes: 5 },
      { title: 'Một đáp án', questions: [{ questionText: 'Câu?', options: [{ optionText: 'A', isCorrect: true }] }], questionCount: 1, durationMinutes: 5 },
      { title: 'Không đáp án đúng', questions: [{ questionText: 'Câu?', options: [{ optionText: 'A', isCorrect: false }, { optionText: 'B', isCorrect: false }] }], questionCount: 1, durationMinutes: 5 },
      { title: 'Câu rỗng', questions: [{ questionText: ' ', options: good[0].options }], questionCount: 1, durationMinutes: 5 },
      { title: 'Nhiều hơn ngân hàng', questions: good, questionCount: 5, durationMinutes: 5 },
      { title: 'Thời gian 0', questions: good, questionCount: 4, durationMinutes: 0 },
      { title: 'Thời gian quá dài', questions: good, questionCount: 4, durationMinutes: 241 },
    ]
    for (const body of invalid) {
      const result = await save(body)
      expect(result.status, body.title).toBe(400)
      expect(result.body.error.message, body.title).toBeTruthy()
    }
    const saved = await save({ title: 'Quiz hợp lệ', questions: good, questionCount: 3, durationMinutes: 7 })
    expect(saved.status, JSON.stringify(saved.body)).toBe(201)
    const lesson = await admin.get(`/api/v1/lessons/${course.lessons[0].lessonId}`)
    expect(lesson.body.assessment).toMatchObject({ questionCount: 3, bankQuestionCount: 4, durationMinutes: 7, passingPercent: 85 })
  })

  test('chỉ Admin soạn nội dung: Lead và thành viên bị 403, khách bị 401, trên mọi thao tác ghi', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{ quiz: { questions: 2 } }] })
    const lessonId = course.lessons[0].lessonId
    const writes: [string, 'post' | 'patch' | 'delete' | 'put', unknown][] = [
      ['/api/v1/courses', 'post', { title: 'Khóa trái phép' }],
      [`/api/v1/courses/${course.courseId}`, 'patch', { title: 'Đổi tên trái phép' }],
      [`/api/v1/courses/${course.courseId}`, 'delete', undefined],
      [`/api/v1/courses/${course.courseId}/publish`, 'post', {}],
      [`/api/v1/courses/${course.courseId}/unpublish`, 'post', {}],
      [`/api/v1/courses/${course.courseId}/sessions`, 'post', { title: 'Chương trái phép' }],
      [`/api/v1/courses/${course.courseId}/draft`, 'put', { title: 'Nháp trái phép' }],
      [`/api/v1/sessions/${course.sessionId}`, 'patch', { title: 'Đổi tên trái phép' }],
      [`/api/v1/sessions/${course.sessionId}`, 'delete', undefined],
      [`/api/v1/sessions/${course.sessionId}/lessons`, 'post', { title: 'Bài trái phép', youtubeVideoId: 'M7lc1UVf-VE', durationSeconds: 30 }],
      [`/api/v1/lessons/${lessonId}`, 'patch', { title: 'Đổi tên trái phép' }],
      [`/api/v1/lessons/${lessonId}`, 'delete', undefined],
      [`/api/v1/lessons/${lessonId}/assessment`, 'post', { title: 'Quiz trái phép', questions: quizQuestions(1), questionCount: 1, durationMinutes: 1 }],
      [`/api/v1/lessons/${lessonId}/assessment`, 'delete', undefined],
      [`/api/v1/assessments/${course.lessons[0].assessmentId}`, 'delete', undefined],
    ]
    for (const [path, method, body] of writes) {
      for (const account of ['chapterLead', 'dnaLead', 'member'] as const) {
        const actor = await as(request, account)
        const result = method === 'delete' ? await actor.delete(path) : await actor[method](path, body)
        expect(result.status, `${account} ${method.toUpperCase()} ${path}`).toBe(403)
      }
      const anonymous = guest(request)
      const result = method === 'delete' ? await anonymous.delete(path) : await anonymous[method](path, body)
      expect(result.status, `khách ${method.toUpperCase()} ${path}`).toBe(401)
    }
    const admin = await as(request, 'admin')
    const intact = await admin.get(`/api/v1/courses/${course.courseId}`)
    expect(intact.body).toMatchObject({ title: course.title, status: 'PUBLISHED' })
    expect(intact.body.sessions[0].lessons).toHaveLength(1)
  })
})

test.describe('Ai nhìn thấy khóa học nào', () => {
  test('khách chỉ thấy khóa PUBLISHED + PUBLIC; thành viên thấy mọi khóa đã xuất bản; nháp chỉ Admin thấy', async ({ request }) => {
    const publicCourse = await createCourse(request, { lessons: [{}], visibility: 'PUBLIC' })
    const privateCourse = await createCourse(request, { lessons: [{}], visibility: 'PRIVATE' })
    const draftCourse = await createCourse(request, { lessons: [{}], visibility: 'PUBLIC', publish: false })
    const anonymous = guest(request)
    const member = await as(request, 'member')
    const admin = await as(request, 'admin')
    const ids = async (actor: typeof anonymous) => {
      const list = await actor.get('/api/v1/courses?limit=200')
      expect(list.status).toBe(200)
      return (list.body.items as any[]).map((item) => item.courseId || item.id)
    }
    const guestIds = await ids(anonymous)
    expect(guestIds).toContain(publicCourse.courseId)
    expect(guestIds).not.toContain(privateCourse.courseId)
    expect(guestIds).not.toContain(draftCourse.courseId)
    const memberIds = await ids(member)
    expect(memberIds).toEqual(expect.arrayContaining([publicCourse.courseId, privateCourse.courseId]))
    expect(memberIds).not.toContain(draftCourse.courseId)
    expect(await ids(admin)).toEqual(expect.arrayContaining([publicCourse.courseId, privateCourse.courseId, draftCourse.courseId]))

    expect((await anonymous.get(`/api/v1/courses/${publicCourse.courseId}`)).status).toBe(200)
    expect([401, 403, 404]).toContain((await anonymous.get(`/api/v1/courses/${privateCourse.courseId}`)).status)
    expect([401, 403, 404]).toContain((await anonymous.get(`/api/v1/courses/${draftCourse.courseId}`)).status)
    expect([403, 404]).toContain((await member.get(`/api/v1/courses/${draftCourse.courseId}`)).status)
    expect([401, 403, 404]).toContain((await anonymous.get(`/api/v1/lessons/${privateCourse.lessons[0].lessonId}`)).status)
    expect([403, 404]).toContain((await member.get(`/api/v1/lessons/${draftCourse.lessons[0].lessonId}`)).status)
    expect((await member.get(`/api/v1/courses/${privateCourse.courseId}`)).status).toBe(200)
  })

  test('khách xem bài công khai tự do nhưng không có quiz, tiến độ hay sao', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{ quiz: { questions: 2 } }, {}], visibility: 'PUBLIC' })
    const anonymous = guest(request)
    const first = await anonymous.get(`/api/v1/lessons/${course.lessons[0].lessonId}`)
    expect(first.status).toBe(200)
    expect(first.body.video.youtubeVideoId).toBeTruthy()
    expect(first.body.assessment, 'khách không được mời làm quiz').toBeNull()
    expect((await anonymous.get(`/api/v1/lessons/${course.lessons[1].lessonId}`)).status, 'khách không bị khóa tuần tự').toBe(200)
    expect((await anonymous.patch(`/api/v1/lessons/${course.lessons[0].lessonId}/progress`, { positionSeconds: 5, event: 'PLAY', viewSessionId: 'guest' })).status).toBe(401)
    expect((await anonymous.post(`/api/v1/assessments/${course.lessons[0].assessmentId}/attempts`)).status).toBe(401)
    for (const path of ['/api/v1/stars/me', '/api/v1/learning/me', '/api/v1/members/me/courses', '/api/v1/members/me/deadlines', `/api/v1/courses/${course.courseId}/my-progress`, '/api/v1/streak']) {
      expect((await anonymous.get(path)).status, path).toBe(401)
    }
  })

  test('không ai nhận được đáp án đúng trước khi nộp bài', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{ quiz: { questions: 3 } }], visibility: 'PUBLIC' })
    const learner = await createLearner(request)
    for (const actor of [guest(request), learner.api, await as(request, 'chapterLead')]) {
      for (const path of [`/api/v1/courses/${course.courseId}`, `/api/v1/lessons/${course.lessons[0].lessonId}`, `/api/v1/lessons/${course.lessons[0].lessonId}/assessment`, `/api/v1/assessments/${course.lessons[0].assessmentId}`]) {
        const result = await actor.get(path)
        expect(JSON.stringify(result.body), path).not.toMatch(/isCorrect|is_correct|correctOptionId/)
      }
    }
    const admin = await as(request, 'admin')
    const bank = await admin.get(`/api/v1/lessons/${course.lessons[0].lessonId}/assessment`)
    expect(bank.status).toBe(200)
    expect(JSON.stringify(bank.body), 'Admin soạn đề thấy đáp án').toMatch(/isCorrect/)
  })
})

test.describe('Hủy xuất bản và sửa nội dung đang dùng', () => {
  test('hủy xuất bản ẩn khóa với người học nhưng giữ nguyên tiến độ; xuất bản lại thì tiến độ còn đó', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{}, {}] })
    const learner = await createLearner(request)
    await watchWholeVideo(learner, course.lessons[0].lessonId, 40)
    const admin = await as(request, 'admin')
    const unpublished = await admin.post(`/api/v1/courses/${course.courseId}/unpublish`)
    expect(unpublished.status).toBe(200)
    expect(unpublished.body.status).toBe('DRAFT')
    expect([403, 404]).toContain((await learner.api.get(`/api/v1/courses/${course.courseId}`)).status)
    expect([403, 404]).toContain((await learner.api.get(`/api/v1/lessons/${course.lessons[0].lessonId}`)).status)
    const hidden = await watchWholeVideo(learner, course.lessons[1].lessonId, 40)
    expect(hidden.body.starReward?.awarded ?? false, 'khóa đã hủy xuất bản không phát sao').toBe(false)
    expect(await starBalance(learner)).toBe(1)
    expect((await admin.post(`/api/v1/courses/${course.courseId}/publish`)).status).toBe(200)
    const progress = await learner.api.get(`/api/v1/courses/${course.courseId}/my-progress`)
    expect(progress.body.completedLessons).toBeGreaterThanOrEqual(1)
    expect(progress.body.sessions[0].lessons[1].canView).toBe(true)
  })

  test('quiz đã có lượt làm không sửa hoặc xóa được (giữ lịch sử)', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{ quiz: { questions: 4 } }] })
    const learner = await createLearner(request)
    await watchWholeVideo(learner, course.lessons[0].lessonId, 40)
    await takeQuiz(learner, course.lessons[0].assessmentId!, 4)
    const admin = await as(request, 'admin')
    const edited = await admin.post(`/api/v1/lessons/${course.lessons[0].lessonId}/assessment`, { title: 'Đề đã sửa', questions: quizQuestions(2), questionCount: 2, durationMinutes: 5 })
    expect(edited.status).toBe(409)
    expect(edited.body.error.message, 'Admin được chỉ cách sửa đúng').toBeTruthy()
    expect((await admin.delete(`/api/v1/lessons/${course.lessons[0].lessonId}/assessment`)).status).toBe(409)
    const attempts = await learner.api.get(`/api/v1/assessments/${course.lessons[0].assessmentId}/attempts/me`)
    expect(attempts.body.items).toHaveLength(1)
  })
})

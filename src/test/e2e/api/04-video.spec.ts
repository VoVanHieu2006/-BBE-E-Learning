import { expect, test } from '@playwright/test'
import { as, errorCode } from '../support/api'
import { sql } from '../support/db'
import { ageLastHeartbeat, createCourse, createLearner, defect, starBalance, unique, watchWholeVideo, type Learner } from '../support/fixtures'

// Intent: docs/business-rules.md "Nội dung và video" — phải xem hết, server xác nhận thời gian xem liên tục,
// tối đa 2×, chống tua trước; client tự khai completed hoặc tua tới cuối là không đủ.
const beat = (learner: Learner, lessonId: string, body: Record<string, unknown>) =>
  learner.api.patch(`/api/v1/lessons/${lessonId}/progress`, { event: 'HEARTBEAT', playbackRate: 1, ...body })

test.describe('Xem video trung thực', () => {
  test('xem hết video: server xác nhận hoàn thành, cộng sao một lần (1 sao mỗi phút tròn, tối thiểu 1), hiển thị 100%', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{ durationSeconds: 120 }] })
    const learner = await createLearner(request)
    expect(await starBalance(learner)).toBe(0)
    const done = await watchWholeVideo(learner, course.lessons[0].lessonId, 120)
    expect(done.body).toMatchObject({ videoCompleted: true, progressPercentage: 100, furthestWatchedPositionSeconds: 120 })
    expect(done.body.starReward).toMatchObject({ awarded: true, amount: 2 })
    expect(await starBalance(learner)).toBe(2)
    const state = await learner.api.get(`/api/v1/lessons/${course.lessons[0].lessonId}/progress`)
    expect(state.body).toMatchObject({ videoCompleted: true, lessonCompleted: true })
  })

  test('xem lại video đã xong trong cùng tháng không cộng sao lần hai', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{}] })
    const learner = await createLearner(request)
    await watchWholeVideo(learner, course.lessons[0].lessonId, 40)
    const again = await watchWholeVideo(learner, course.lessons[0].lessonId, 40)
    expect(again.body.starReward?.awarded ?? false).toBe(false)
    expect(again.body.videoCompleted).toBe(true)
    expect(await starBalance(learner)).toBe(1)
    const ledger = await sql(`SELECT amount FROM star_ledger WHERE user_id = $1 AND reason = 'VIDEO_COMPLETION'`, [learner.userId])
    expect(ledger).toHaveLength(1)
  })

  test('dừng giữa chừng lưu vị trí để lần sau xem tiếp, chưa tính hoàn thành và chưa có sao', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{ durationSeconds: 200 }] })
    const learner = await createLearner(request)
    const lessonId = course.lessons[0].lessonId
    const view = unique('view')
    await beat(learner, lessonId, { positionSeconds: 0, event: 'PLAY', viewSessionId: view })
    for (const position of [20, 40, 60]) {
      await ageLastHeartbeat(learner.userId, lessonId, 20)
      await beat(learner, lessonId, { positionSeconds: position, viewSessionId: view })
    }
    const paused = await beat(learner, lessonId, { positionSeconds: 60, event: 'PAUSE', viewSessionId: view })
    expect(paused.body).toMatchObject({ videoCompleted: false, furthestWatchedPositionSeconds: 60, progressPercentage: 30 })
    const resumed = await learner.api.get(`/api/v1/lessons/${lessonId}/progress`)
    expect(resumed.body).toMatchObject({ videoCompleted: false, furthestWatchedPositionSeconds: 60 })
    expect(await starBalance(learner)).toBe(0)
  })

  test('không hiển thị 100% khi mới xem 99,x% (video dài, còn thiếu hơn dung sai 1%)', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{ durationSeconds: 2000 }] })
    const learner = await createLearner(request)
    const lessonId = course.lessons[0].lessonId
    const view = unique('view')
    await beat(learner, lessonId, { positionSeconds: 0, event: 'PLAY', viewSessionId: view })
    let last: any
    for (let position = 200; position <= 1970; position += position + 200 > 1970 && position < 1970 ? 1970 - position : 200) {
      await ageLastHeartbeat(learner.userId, lessonId, 200)
      last = await beat(learner, lessonId, { positionSeconds: position, viewSessionId: view })
    }
    expect(last.body.furthestWatchedPositionSeconds).toBeGreaterThanOrEqual(1965)
    expect(last.body.furthestWatchedPositionSeconds).toBeLessThan(1980)
    expect(last.body.videoCompleted).toBe(false)
    expect(last.body.progressPercentage, '98,5% không được làm tròn thành 100%').toBeLessThan(100)
    const ended = await beat(learner, lessonId, { positionSeconds: 2000, event: 'ENDED', viewSessionId: view })
    expect(ended.body.videoCompleted, 'ENDED ngay lập tức, chưa xem 30 giây cuối').toBe(false)
    expect(ended.body.progressPercentage).toBeLessThan(100)
  })
})

test.describe('Chống gian lận video', () => {
  test('client tự khai completed / ENDED ở cuối video mà không có thời gian xem thì không hoàn thành', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{ durationSeconds: 300 }, {}] })
    const learner = await createLearner(request)
    const lessonId = course.lessons[0].lessonId
    const forged = await beat(learner, lessonId, { positionSeconds: 300, furthestWatchedPositionSeconds: 300, event: 'ENDED', viewSessionId: unique('view'), completed: true, videoCompleted: true, progressPercentage: 100 })
    expect(forged.status).toBe(200)
    expect(forged.body.videoCompleted).toBe(false)
    expect(forged.body.furthestWatchedPositionSeconds).toBeLessThan(15)
    expect(await starBalance(learner)).toBe(0)
    expect((await learner.api.get(`/api/v1/lessons/${course.lessons[1].lessonId}`)).status, 'bài sau vẫn khóa').toBe(403)
  })

  test('tua trước không được tính: vị trí xa nhất chỉ tăng theo thời gian thật đã xem', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{ durationSeconds: 600 }] })
    const learner = await createLearner(request)
    const lessonId = course.lessons[0].lessonId
    const view = unique('view')
    await beat(learner, lessonId, { positionSeconds: 0, event: 'PLAY', viewSessionId: view })
    await ageLastHeartbeat(learner.userId, lessonId, 20)
    const seeked = await beat(learner, lessonId, { positionSeconds: 550, viewSessionId: view })
    expect(seeked.body.furthestWatchedPositionSeconds, '20 giây xem thật ở 1× không thể thành 550 giây').toBeLessThanOrEqual(30)
    expect(seeked.body.videoCompleted).toBe(false)
  })

  test('tốc độ khai báo trên 2× bị giới hạn ở 2×', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{ durationSeconds: 600 }] })
    const learner = await createLearner(request)
    const lessonId = course.lessons[0].lessonId
    const view = unique('view')
    await beat(learner, lessonId, { positionSeconds: 0, event: 'PLAY', viewSessionId: view, playbackRate: 16 })
    await ageLastHeartbeat(learner.userId, lessonId, 20)
    const fast = await beat(learner, lessonId, { positionSeconds: 320, viewSessionId: view, playbackRate: 16 })
    expect(fast.body.furthestWatchedPositionSeconds, '20 giây × tối đa 2× = 40 giây (+ dung sai nhỏ)').toBeLessThanOrEqual(50)
  })

  test('xem ở 2× trong đủ thời gian thật thì được tính (tốc độ hợp lệ không bị phạt)', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{ durationSeconds: 120 }] })
    const learner = await createLearner(request)
    const lessonId = course.lessons[0].lessonId
    const view = unique('view')
    await beat(learner, lessonId, { positionSeconds: 0, event: 'PLAY', viewSessionId: view, playbackRate: 2 })
    let last: any
    for (const position of [40, 80, 120]) {
      await ageLastHeartbeat(learner.userId, lessonId, 20)
      last = await beat(learner, lessonId, { positionSeconds: position, viewSessionId: view, playbackRate: 2, event: position === 120 ? 'ENDED' : 'HEARTBEAT' })
    }
    expect(last.body.videoCompleted).toBe(true)
  })

  test('khoảng lặng quá 5 phút giữa hai heartbeat không được tính là thời gian xem', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{ durationSeconds: 900 }] })
    const learner = await createLearner(request)
    const lessonId = course.lessons[0].lessonId
    const view = unique('view')
    await beat(learner, lessonId, { positionSeconds: 0, event: 'PLAY', viewSessionId: view })
    await ageLastHeartbeat(learner.userId, lessonId, 600)
    const stale = await beat(learner, lessonId, { positionSeconds: 600, viewSessionId: view })
    expect(stale.body.furthestWatchedPositionSeconds).toBeLessThanOrEqual(10)
  })

  // Mỗi request được cộng "grace" 2–6 giây bất kể thời gian thật, nên gửi dồn request là xong video.
  defect('BUG-VIDEO-SPAM', 'gửi dồn heartbeat không được hoàn thành video 10 phút trong vài giây', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{ durationSeconds: 600 }] })
    const learner = await createLearner(request)
    const lessonId = course.lessons[0].lessonId
    const view = unique('view')
    const started = Date.now()
    let last = await beat(learner, lessonId, { positionSeconds: 0, event: 'PLAY', viewSessionId: view, playbackRate: 2 })
    for (let index = 0; index < 160 && !last.body.videoCompleted; index += 1) {
      last = await beat(learner, lessonId, { positionSeconds: (last.body.furthestWatchedPositionSeconds ?? 0) + 6, viewSessionId: view, playbackRate: 2 })
    }
    const realSeconds = (Date.now() - started) / 1000
    expect(last.body.furthestWatchedPositionSeconds, `chỉ ${realSeconds.toFixed(1)} giây thật đã trôi qua`).toBeLessThanOrEqual(realSeconds * 2 + 12)
    expect(last.body.videoCompleted).toBe(false)
    expect(await starBalance(learner)).toBe(0)
  })

  test('dữ liệu tiến độ sai định dạng bị từ chối, không làm hỏng tiến độ', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{}] })
    const learner = await createLearner(request)
    const lessonId = course.lessons[0].lessonId
    const invalid: Record<string, unknown>[] = [
      { positionSeconds: -5, viewSessionId: 'v' }, { positionSeconds: 'abc', viewSessionId: 'v' }, { positionSeconds: 5, viewSessionId: 'có dấu cách' },
      { positionSeconds: 5, viewSessionId: 'v', event: 'FINISHED' }, { positionSeconds: 5, viewSessionId: 'x'.repeat(500) },
      { positionSeconds: 5, viewSessionId: 'v', playerDurationSeconds: -1 },
    ]
    for (const body of invalid) expect((await beat(learner, lessonId, body)).status, JSON.stringify(body).slice(0, 70)).toBe(400)
    expect((await beat(learner, '00000000-0000-4000-8000-000000000000', { positionSeconds: 1, viewSessionId: 'v' })).status).toBe(404)
    expect((await learner.api.get(`/api/v1/lessons/${lessonId}/progress`)).body.furthestWatchedPositionSeconds).toBe(0)
  })

  test('Lead không ghi tiến độ học; Admin xem thử được nhưng không bao giờ nhận sao', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{}] })
    for (const account of ['chapterLead', 'dnaLead'] as const) {
      const actor = await as(request, account)
      const result = await actor.patch(`/api/v1/lessons/${course.lessons[0].lessonId}/progress`, { positionSeconds: 1, event: 'PLAY', viewSessionId: 'v' })
      expect(result.status, account).toBe(403)
      expect(errorCode(result), account).toBe('ManagementOnlyAccount')
      expect(result.body.error.message).toBeTruthy()
    }
    const admin = await as(request, 'admin')
    const preview = await watchWholeVideo({ api: admin, userId: admin.session.user.id } as Learner, course.lessons[0].lessonId, 40)
    expect(preview.body.starReward?.awarded ?? false).toBe(false)
    expect((await admin.get('/api/v1/stars/me')).body.balance).toBe(0)
    const rows = await sql(`SELECT count(*)::int AS total FROM star_ledger l JOIN users u ON u.id = l.user_id WHERE u.role IN ('ADMIN', 'LEAD')`)
    expect(rows[0].total).toBe(0)
  })
})

test.describe('Mở khóa bài tuần tự', () => {
  test('bài 2 khóa cho tới khi xem xong video bài 1; lý do khóa được nói rõ', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{}, {}, {}] })
    const learner = await createLearner(request)
    const [first, second, third] = course.lessons
    const locked = await learner.api.get(`/api/v1/lessons/${second.lessonId}`)
    expect(locked.status).toBe(403)
    expect(errorCode(locked)).toBe('PreviousLessonIncomplete')
    expect(locked.body.error.message).toMatch(/hoàn thành/)
    expect((await beat(learner, second.lessonId, { positionSeconds: 1, event: 'PLAY', viewSessionId: 'v' })).status, 'không ghi tiến độ cho bài đang khóa').toBe(403)
    const before = await learner.api.get(`/api/v1/courses/${course.courseId}/my-progress`)
    expect(before.body.sessions[0].lessons.map((lesson: any) => lesson.canView)).toEqual([true, false, false])
    expect(before.body).toMatchObject({ progressPercentage: 0, completedLessons: 0, totalLessons: 3 })

    await watchWholeVideo(learner, first.lessonId, 40)
    expect((await learner.api.get(`/api/v1/lessons/${second.lessonId}`)).status).toBe(200)
    expect((await learner.api.get(`/api/v1/lessons/${third.lessonId}`)).status, 'không nhảy cóc qua bài 2').toBe(403)
    const after = await learner.api.get(`/api/v1/courses/${course.courseId}/my-progress`)
    expect(after.body.sessions[0].lessons.map((lesson: any) => lesson.canView)).toEqual([true, true, false])
    expect(after.body).toMatchObject({ completedLessons: 1, progressPercentage: 33 })
  })

  test('tiến độ của người này không ảnh hưởng người khác', async ({ request }) => {
    const course = await createCourse(request, { lessons: [{}, {}] })
    const first = await createLearner(request)
    const second = await createLearner(request)
    await watchWholeVideo(first, course.lessons[0].lessonId, 40)
    expect((await second.api.get(`/api/v1/lessons/${course.lessons[1].lessonId}`)).status).toBe(403)
    expect((await second.api.get(`/api/v1/courses/${course.courseId}/my-progress`)).body.completedLessons).toBe(0)
    expect(await starBalance(second)).toBe(0)
  })
})

import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { isLearningManager } from '@/lib/manager-learning-access'
import { startMonthlyReview, monthlyReviewMessages } from '@/lib/monthly-review'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/v1/learning/monthly-review  { lessonId }
 *
 * "Xem lại tháng này": mở lượt xem thưởng của tháng hiện tại cho đúng một bài
 * mà người học đã xem xong video. Idempotent, không cộng Star, không đụng tiến độ chu kỳ.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const userId = auth.context!.userId
  if (await isLearningManager(userId, auth.context!.role)) {
    return NextResponse.json({ error: { code: 'ManagementOnlyAccount', message: 'Tài khoản quản lý không ghi nhận tiến độ học tập.' } }, { status: 403 })
  }
  const body = await request.json().catch(() => ({}))
  const lessonId = typeof body?.lessonId === 'string' ? body.lessonId : ''
  // Only one lesson at a time: the learner never resets more than what they clicked on.
  // A `courseId` (or any extra scope) is rejected on purpose.
  if (!UUID.test(lessonId) || body?.courseId !== undefined) {
    return NextResponse.json({ error: { code: 'InvalidReviewScope', message: 'Hãy chọn một bài học để xem lại.' } }, { status: 400 })
  }
  const result = await startMonthlyReview(userId, lessonId)
  if ('error' in result) {
    return NextResponse.json({ error: { code: 'ReviewScopeNotFound', message: 'Không tìm thấy bài học đã xuất bản để xem lại.' } }, { status: 404 })
  }
  ;(globalThis as any).__bbeLearningMeCache?.delete(userId)
  if (result.status === 'NOTHING_TO_REVIEW') {
    return NextResponse.json({ error: { code: 'NothingToReview', message: monthlyReviewMessages.NOTHING_TO_REVIEW }, ...result }, { status: 409 })
  }
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}

import { DAY_MS } from './learning-cycle-rules'

/**
 * Quy tắc thuần cho "Cập nhật khóa học" (KHBB 5.6, 6.1, 6.2). Không chạm database nên test được trực tiếp.
 */

/** Bài thi cuối khóa mới (khóa trước đó chưa có) cộng cố định 3 ngày. */
export const FINAL_EXAM_ADDED_DAYS = 3
/** Sàn số ngày của một bài. */
export const MIN_DAYS_PER_LESSON = 3

export interface LessonDayShares { perLesson: number; videoPart: number; quizPart: number }

/**
 * Số ngày của một bài = max(ceil(T / L_sau), 3); chia đôi: phần video = ceil(perLesson / 2) (tối thiểu 1),
 * phần quiz = phần còn lại. Video + quiz luôn bằng đúng một bài.
 */
export function lessonDayShares(courseDays: number, lessonCountAfter: number): LessonDayShares {
  const count = Math.max(1, Math.floor(lessonCountAfter))
  const perLesson = Math.max(Math.ceil(Math.max(0, courseDays) / count), MIN_DAYS_PER_LESSON)
  const videoPart = Math.max(1, Math.ceil(perLesson / 2))
  return { perLesson, videoPart, quizPart: perLesson - videoPart }
}

/** Trạng thái từng bài ở một phiên bản yêu cầu: có video không, có quiz không. */
export interface RequirementLessonState { hasVideo: boolean; hasQuiz: boolean }
export interface RequirementState {
  lessons: Map<string, RequirementLessonState>
  /** Id phiên bản đề thi cuối đang chạy; null nếu khóa chưa có bài thi cuối. */
  finalVersionId: string | null
}

export interface RequirementDiff {
  newLessonsFull: string[]       // bài mới có đủ video và quiz
  newLessonsVideoOnly: string[]  // bài mới chỉ có video
  newLessonsQuizOnly: string[]   // bài mới chỉ có quiz (không có video)
  videoAdded: string[]           // video thêm vào bài đã có
  quizAdded: string[]            // quiz thêm vào bài đã có
  finalAdded: boolean            // bài thi cuối khóa mới (trước đó chưa có)
  finalReplaced: boolean         // đổi đề (đã có sẵn) - không cộng ngày
}

export function diffRequirementState(previous: RequirementState | null, next: RequirementState): RequirementDiff {
  const diff: RequirementDiff = {
    newLessonsFull: [], newLessonsVideoOnly: [], newLessonsQuizOnly: [], videoAdded: [], quizAdded: [], finalAdded: false, finalReplaced: false,
  }
  // Lần xuất bản đầu tiên: mọi thứ là nội dung ban đầu, không phải bổ sung.
  if (!previous) return diff
  Array.from(next.lessons.entries()).forEach(([id, state]) => {
    const before = previous.lessons.get(id)
    if (!before) {
      if (state.hasVideo && state.hasQuiz) diff.newLessonsFull.push(id)
      else if (state.hasVideo) diff.newLessonsVideoOnly.push(id)
      else if (state.hasQuiz) diff.newLessonsQuizOnly.push(id)
      return
    }
    if (!before.hasVideo && state.hasVideo) diff.videoAdded.push(id)
    if (!before.hasQuiz && state.hasQuiz) diff.quizAdded.push(id)
  })
  if (!previous.finalVersionId && next.finalVersionId) diff.finalAdded = true
  else if (previous.finalVersionId && next.finalVersionId && previous.finalVersionId !== next.finalVersionId) diff.finalReplaced = true
  return diff
}

/** Cộng tất cả trong một lần cập nhật (KHBB 5.6). */
export function additionalDays(diff: RequirementDiff, courseDays: number, lessonCountAfter: number): number {
  const { perLesson, videoPart, quizPart } = lessonDayShares(courseDays, lessonCountAfter)
  return diff.newLessonsFull.length * perLesson
    + diff.newLessonsVideoOnly.length * videoPart
    + diff.newLessonsQuizOnly.length * quizPart
    + diff.videoAdded.length * videoPart
    + diff.quizAdded.length * quizPart
    + (diff.finalAdded ? FINAL_EXAM_ADDED_DAYS : 0)
}

export function hasLearnableAddition(diff: RequirementDiff): boolean {
  return Boolean(diff.newLessonsFull.length || diff.newLessonsVideoOnly.length || diff.newLessonsQuizOnly.length
    || diff.videoAdded.length || diff.quizAdded.length || diff.finalAdded)
}

/**
 * Hạn mới sau khi cập nhật khóa (KHBB 5.6), tính TỪ LÚC CẬP NHẬT chứ không cộng vào hạn cũ của người đã xong:
 *  - đã xong khóa: lúc cập nhật + số ngày cộng;
 *  - đang học dở: hạn hiện tại + số ngày cộng (cộng dồn; chưa có hạn thì tính từ lúc cập nhật).
 * Hạn chung không bao giờ bị rút ngắn (gia hạn tay, khóa khác chưa xong có hạn muộn hơn).
 */
export function updatedDueAt(input: { now: Date; currentDueAt: Date | null; completed: boolean; addedDays: number }): Date {
  const { now, currentDueAt, completed, addedDays } = input
  if (addedDays <= 0) return currentDueAt || now
  const added = addedDays * DAY_MS
  const candidate = completed ? now.getTime() + added : (currentDueAt ? currentDueAt.getTime() : now.getTime()) + added
  return new Date(currentDueAt ? Math.max(candidate, currentDueAt.getTime()) : candidate)
}

/** Dấu vân tay mở rộng: bao gồm bài có video, bài có quiz và đề thi cuối (không chỉ id bài học). */
export interface RequirementFingerprintInput {
  lessonIds: string[]
  assessmentIds: string[]
  finalVersion: string | null
  videoLessonIds: string[]
  quizLessonIds: string[]
}

export function buildRequirementFingerprint(input: RequirementFingerprintInput): string {
  const sort = (ids: string[]) => [...ids].sort()
  return JSON.stringify({
    lessonIds: sort(input.lessonIds), assessmentIds: sort(input.assessmentIds), finalVersion: input.finalVersion,
    videoLessonIds: sort(input.videoLessonIds), quizLessonIds: sort(input.quizLessonIds),
  })
}

/** Đọc dấu vân tay (kể cả định dạng cũ chỉ có 3 khóa). `videoLessonIds`/`quizLessonIds` là null khi định dạng cũ. */
export function parseRequirementFingerprint(fingerprint: string): {
  lessonIds: string[]; assessmentIds: string[]; finalVersion: string | null; videoLessonIds: string[] | null; quizLessonIds: string[] | null
} | null {
  try {
    const raw = JSON.parse(fingerprint)
    const list = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : null)
    return {
      lessonIds: list(raw.lessonIds) || [], assessmentIds: list(raw.assessmentIds) || [],
      finalVersion: typeof raw.finalVersion === 'string' ? raw.finalVersion : null,
      videoLessonIds: list(raw.videoLessonIds), quizLessonIds: list(raw.quizLessonIds),
    }
  } catch { return null }
}

/**
 * Hai dấu vân tay có cùng nội dung không. Dấu vân tay cũ (không có videoLessonIds/quizLessonIds) chỉ so ba khóa cũ,
 * để lần cập nhật đầu tiên sau khi triển khai không tạo thêm phiên bản vô nghĩa.
 */
export function sameRequirementFingerprint(previous: string, next: string): boolean {
  if (previous === next) return true
  const a = parseRequirementFingerprint(previous), b = parseRequirementFingerprint(next)
  if (!a || !b) return false
  const same = (x: string[], y: string[]) => x.length === y.length && [...x].sort().every((v, i) => v === [...y].sort()[i])
  if (!same(a.lessonIds, b.lessonIds) || !same(a.assessmentIds, b.assessmentIds) || a.finalVersion !== b.finalVersion) return false
  if (a.videoLessonIds === null || a.quizLessonIds === null) return true
  return same(a.videoLessonIds, b.videoLessonIds || []) && same(a.quizLessonIds, b.quizLessonIds || [])
}

/** Tên lý do ghi trong `learning_path_changes`. */
export const CONTENT_UPDATE_REASON = 'LESSONS_ADDED_TO_COURSE'

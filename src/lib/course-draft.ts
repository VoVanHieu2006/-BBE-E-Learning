import { normalizeDurationSeconds } from './validation/duration'

export const DRAFT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export class CourseDraftError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
export interface DraftOption { id?: string; optionText: string; isCorrect: boolean; sortOrder?: number }
export interface DraftQuestion {
  id?: string; questionText: string; questionType: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE'; points: number
  explanation?: string | null; poolId?: string | null; sortOrder?: number; options: DraftOption[]
}
export interface DraftFinal { id?: string; title: string; description?: string | null; questionCount: number; durationMinutes: number }
export interface DraftAssessment extends DraftFinal { pools: { id?: string; name: string }[]; questions: DraftQuestion[] }
export interface DraftDocument { id?: string; fileName: string; fileSize: number; mimeType: string; storageKey: string }
export interface DraftLesson {
  id?: string; title: string; description?: string | null; sortOrder?: number
  video: { youtubeVideoId: string; durationSeconds: number } | null
  documents: DraftDocument[]; assessment: DraftAssessment | null
}
export interface DraftSession { id?: string; title: string; description?: string | null; sortOrder?: number; lessons: DraftLesson[] }
export interface CourseDraftContent {
  title: string; description?: string | null; visibility: 'PUBLIC' | 'PRIVATE'; sessions: DraftSession[]
  finalAssessment: DraftFinal | null
  coverUrl?: string | null; coverPublicId?: string | null
}

const invalid = (message: string): never => { throw new CourseDraftError('ValidationError', message) }
const text = (v: unknown, min = 1, max = 255) => typeof v === 'string' && v.trim().length >= min && v.length <= max
const integer = (v: unknown, min: number, max: number) => Number.isInteger(v) && Number(v) >= min && Number(v) <= max

/** Accept a complete snapshot only: missing collections must never mean delete everything. */
export function validateDraftContent(value: unknown, before?: CourseDraftContent): CourseDraftContent {
  const c = structuredClone(value) as CourseDraftContent
  if (!c || typeof c !== 'object' || !text(c.title, 2) || !['PUBLIC', 'PRIVATE'].includes(c.visibility) || !Array.isArray(c.sessions) || !('finalAssessment' in c)) invalid('Nội dung bản nháp không đầy đủ hoặc không hợp lệ.')
  const seen = new Set<string>()
  const id = (row: { id?: string }) => {
    if (!row || typeof row !== 'object') invalid('Nội dung bản nháp không hợp lệ.')
    if (row.id === undefined) return
    if (typeof row.id !== 'string' || (!DRAFT_UUID.test(row.id) && !/^temp-[\w-]+$/.test(row.id))) invalid('ID bản nháp không hợp lệ.')
    if (seen.has(row.id)) invalid('ID trùng trong bản nháp.')
    seen.add(row.id)
  }
  const description = (row: { description?: string | null }) => {
    if (row.description !== undefined && row.description !== null && typeof row.description !== 'string') invalid('Mô tả bản nháp không hợp lệ.')
  }
  description(c)
  if (c.coverUrl !== undefined && c.coverUrl !== null && (!text(c.coverUrl, 1, 1000) || !c.coverUrl.startsWith('https://'))) invalid('Đường dẫn ảnh bìa không hợp lệ.')
  if (c.coverPublicId !== undefined && c.coverPublicId !== null && !text(c.coverPublicId, 1, 500)) invalid('Mã ảnh bìa không hợp lệ.')
  const config = (a: DraftFinal) => {
    id(a)
    description(a)
    if (!text(a.title, 2) || !integer(a.questionCount, 1, 10000) || !integer(a.durationMinutes, 1, 240)) invalid('Cấu hình bài kiểm tra không hợp lệ: tiêu đề, số câu hoặc thời gian.')
  }
  for (const s of c.sessions) {
    if (!s || !text(s.title) || !Array.isArray(s.lessons)) invalid('Buổi học trong bản nháp không hợp lệ.')
    id(s)
    description(s)
    for (const l of s.lessons) {
      if (!l || !text(l.title) || !Array.isArray(l.documents) || !('video' in l) || !('assessment' in l)) invalid('Bài học trong bản nháp không đầy đủ.')
      id(l)
      description(l)
      if (l.video) {
        const duration = normalizeDurationSeconds(l.video.durationSeconds)
        if (!text(l.video.youtubeVideoId) || duration === null) invalid('Video cần mã và thời lượng hợp lệ (1 giây đến 12 giờ).')
        l.video.durationSeconds = duration!
      }
      for (const d of l.documents) {
        id(d)
        const old = d.id && DRAFT_UUID.test(d.id)
          ? before?.sessions.find(row => row.id === s.id)?.lessons.find(row => row.id === l.id)?.documents.find(row => row.id === d.id)
          : undefined
        const unchanged = old && old.fileName === d.fileName && old.storageKey === d.storageKey && old.mimeType === d.mimeType && old.fileSize === d.fileSize
        if (!text(d.fileName) || !text(d.storageKey, 1, 500) || !text(d.mimeType, 1, 100) || (!unchanged && !integer(d.fileSize, 1, 100 * 1024 * 1024))) invalid('Tài liệu bản nháp không hợp lệ.')
      }
      const a = l.assessment
      if (!a) continue
      config(a)
      if (!Array.isArray(a.questions) || !a.questions.length || a.questions.length > 100 || !Array.isArray(a.pools) || a.pools.length > 20 || a.questionCount > a.questions.length) invalid('Ngân hàng quiz không đủ câu hoặc không hợp lệ.')
      const poolCounts = new Map<string, number>()
      for (const p of a.pools) { id(p); if (!p.id || !text(p.name)) invalid('Tên nhóm câu hỏi không hợp lệ.'); poolCounts.set(p.id!, 0) }
      for (const q of a.questions) {
        id(q)
        if (!text(q.questionText, 1, 100000) || !['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE'].includes(q.questionType) || !integer(q.points, 1, 100000) || !Array.isArray(q.options) || q.options.length < 2 || !q.options.some(o => o?.isCorrect === true)) invalid('Câu hỏi cần nội dung, điểm và ít nhất hai đáp án với đáp án đúng.')
        if (q.explanation !== undefined && q.explanation !== null && typeof q.explanation !== 'string') invalid('Giải thích câu hỏi không hợp lệ.')
        for (const o of q.options) { id(o); if (!text(o.optionText, 1, 100000) || typeof o.isCorrect !== 'boolean') invalid('Đáp án không hợp lệ.') }
        if (a.pools.length) {
          if (!q.poolId || !poolCounts.has(q.poolId)) invalid('Câu hỏi phải thuộc nhóm của quiz.')
          poolCounts.set(q.poolId!, poolCounts.get(q.poolId!)! + 1)
        } else if (q.poolId) invalid('Nhóm câu hỏi không thuộc quiz.')
      }
      if (a.pools.length && (a.questionCount < a.pools.length || a.questionCount > a.pools.length * Math.min(...Array.from(poolCounts.values())))) invalid('Ngân hàng nhóm câu hỏi không đủ để phân phối cân bằng.')
    }
  }
  if (c.finalAssessment) config(c.finalAssessment)
  return c
}

/** Incomplete outlines can be saved while editing, but cannot replace a published course. */
export function assertDraftPublishable(content: CourseDraftContent) {
  if (!content.sessions.length) throw new CourseDraftError('EmptyCourse', 'Không thể xuất bản khóa học không có buổi học nào.')
  for (const session of content.sessions) {
    if (!session.lessons.length) throw new CourseDraftError('EmptySession', `Buổi học "${session.title}" không có bài học nào.`)
  }
}

/** UUIDs must refer to this exact parent; new records use temporary IDs. */
export function reconcileDraftIds(existing: { id: string }[], incoming: { id?: string }[]): string[] {
  const owned = new Set(existing.map(r => r.id))
  const seen = new Set<string>()
  for (const row of incoming) {
    if (!row.id) continue
    if (seen.has(row.id)) invalid('ID trùng trong bản nháp.')
    if (DRAFT_UUID.test(row.id) && !owned.has(row.id)) invalid('ID không thuộc nội dung đang sửa.')
    seen.add(row.id)
  }
  return existing.filter(r => !seen.has(r.id)).map(r => r.id)
}

const grading = (q: DraftQuestion) => JSON.stringify({
  questionText: q.questionText, questionType: q.questionType, points: q.points, explanation: q.explanation || null,
  options: q.options.map(o => ({ id: o.id, optionText: o.optionText, isCorrect: o.isCorrect })).sort((a, b) => (a.id || '').localeCompare(b.id || '')),
})
export function assertQuestionEditAllowed(before: DraftQuestion, after: DraftQuestion | null, references: number) {
  if (references && (!after || grading(before) !== grading(after))) throw new CourseDraftError('QuestionHasAttempts', 'Câu hỏi đã có lượt làm; không thể xóa hoặc đổi nội dung/đáp án để bảo toàn lịch sử.', 409)
}

const finalConfig = (a: DraftFinal | null) => a && JSON.stringify([a.title, a.description || null, a.questionCount, a.durationMinutes])
export function needsFinalExamVersion(before: DraftFinal | null, after: DraftFinal | null, oldBank: DraftQuestion[], newBank: DraftQuestion[], hasActiveVersion: boolean) {
  if (!after) return false
  const bank = (qs: DraftQuestion[]) => JSON.stringify(qs.map(q => [q.id, grading(q)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
  return !hasActiveVersion || finalConfig(before) !== finalConfig(after) || bank(oldBank) !== bank(newBank)
}

export function assertDraftVersion(expected: unknown, actual: number, base: unknown, contentVersion: number) {
  if (expected !== actual || base !== contentVersion) throw new CourseDraftError('ConcurrencyConflict', 'Phiên bản đã thay đổi bởi Admin khác. Hãy tải lại trang trước khi lưu, cập nhật hoặc bỏ thay đổi.', 409)
}

/** Draft numbers restart after discard; identity prevents stale requests matching a replacement draft. */
export function assertDraftIdentity(expected: unknown, actual: string | null) {
  if (expected !== actual) throw new CourseDraftError('ConcurrencyConflict', 'Bản nháp đã được thay thế hoặc bỏ bởi Admin khác. Hãy tải lại trang.', 409)
}

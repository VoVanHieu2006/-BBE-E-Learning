/**
 * Nhãn trạng thái ở thanh trên cùng của trình sửa khóa học.
 * Thuần (không gọi API): chỉ diễn giải trạng thái mà useCourseEditor đã có.
 */
export type CourseEditorStatusInput = {
  isPublished: boolean
  draftSaving: boolean
  draftConflict: boolean
  draftError: boolean
  draftSaveFailed: boolean
  hasDraftChanges: boolean
  hasUnsavedCourseInfo: boolean
}

export type CourseEditorStatusKind = 'conflict' | 'invalid-draft' | 'save-failed' | 'saving' | 'pending' | 'up-to-date'
export type CourseEditorStatusTone = 'danger' | 'neutral' | 'warning' | 'success'
export type CourseEditorStatus = { kind: CourseEditorStatusKind; label: string; tone: CourseEditorStatusTone }

export function getCourseEditorStatus(s: CourseEditorStatusInput): CourseEditorStatus | null {
  if (!s.isPublished) {
    // Khóa học chưa xuất bản lưu thẳng vào bản chính; chỉ thông tin khóa học có thể đang chưa lưu.
    return s.hasUnsavedCourseInfo ? { kind: 'pending', label: 'Có thay đổi chưa lưu', tone: 'warning' } : null
  }
  if (s.draftConflict) return { kind: 'conflict', label: 'Bản nháp đã đổi bởi Admin khác', tone: 'danger' }
  if (s.draftError) return { kind: 'invalid-draft', label: 'Bản nháp lỗi', tone: 'danger' }
  if (s.draftSaveFailed) return { kind: 'save-failed', label: 'Lỗi lưu nháp, thử lại', tone: 'danger' }
  if (s.draftSaving) return { kind: 'saving', label: 'Đang lưu nháp…', tone: 'neutral' }
  if (s.hasDraftChanges || s.hasUnsavedCourseInfo) return { kind: 'pending', label: 'Có thay đổi chưa cập nhật', tone: 'warning' }
  return { kind: 'up-to-date', label: 'Đã cập nhật', tone: 'success' }
}

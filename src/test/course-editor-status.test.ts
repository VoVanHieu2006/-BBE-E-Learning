import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CourseEditorStatusInput, getCourseEditorStatus } from '../lib/course-editor-status'

const base: CourseEditorStatusInput = {
  isPublished: true, draftSaving: false, draftConflict: false, draftError: false,
  draftSaveFailed: false, hasDraftChanges: false, hasUnsavedCourseInfo: false,
}
const kind = (patch: Partial<CourseEditorStatusInput>) => getCourseEditorStatus({ ...base, ...patch })?.kind ?? null

describe('getCourseEditorStatus', () => {
  it('published course without draft is up to date', () => {
    assert.deepEqual(getCourseEditorStatus(base), { kind: 'up-to-date', label: 'Đã cập nhật', tone: 'success' })
  })
  it('draft changes or unsaved info are pending (orange)', () => {
    assert.deepEqual(getCourseEditorStatus({ ...base, hasDraftChanges: true }), { kind: 'pending', label: 'Có thay đổi chưa cập nhật', tone: 'warning' })
    assert.equal(kind({ hasUnsavedCourseInfo: true }), 'pending')
  })
  it('saving overrides pending', () => {
    assert.equal(kind({ draftSaving: true, hasDraftChanges: true }), 'saving')
  })
  it('failed draft save is never reported as saved', () => {
    assert.deepEqual(getCourseEditorStatus({ ...base, draftSaveFailed: true }), { kind: 'save-failed', label: 'Lỗi lưu nháp, thử lại', tone: 'danger' })
    assert.equal(kind({ draftSaveFailed: true, hasDraftChanges: true, draftSaving: true }), 'save-failed')
  })
  it('conflict and invalid draft take priority', () => {
    assert.equal(kind({ draftConflict: true, draftError: true, draftSaveFailed: true }), 'conflict')
    assert.equal(kind({ draftError: true, draftSaveFailed: true }), 'invalid-draft')
  })
  it('unpublished course only reports unsaved course info', () => {
    assert.equal(kind({ isPublished: false }), null)
    assert.equal(kind({ isPublished: false, hasDraftChanges: true }), null)
    assert.deepEqual(getCourseEditorStatus({ ...base, isPublished: false, hasUnsavedCourseInfo: true }), { kind: 'pending', label: 'Có thay đổi chưa lưu', tone: 'warning' })
  })
})

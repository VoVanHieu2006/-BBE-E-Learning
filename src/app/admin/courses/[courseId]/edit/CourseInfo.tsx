'use client';
import Card from '@/components/ui/Card';
import type { CourseEditorState } from './useCourseEditor';

type Props = Pick<CourseEditorState,
  'hasUnsavedCourseInfo' |
  'handleSaveInfo' |
  'isPublished' |
  'form' |
  'setForm' |
  'course' |
  'coverUploading' |
  'handleCoverUpload'
>;

export default function CourseInfo({
  hasUnsavedCourseInfo,
  handleSaveInfo,
  isPublished,
  form,
  setForm,
  course,
  coverUploading,
  handleCoverUpload
}: Props) {
  return (
    <Card className="p-6 border border-[#eff4ff] shadow-sm">
              <h2 className="text-xl font-bold text-[#172554] mb-4" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                Thông tin chung khóa học
              </h2>
              {hasUnsavedCourseInfo && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800">Bạn có thay đổi chưa lưu.</div>}
              <form onSubmit={handleSaveInfo} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-[#172554] mb-1">Tiêu đề khóa học *</label>
                  <input
                    type="text"
                    required
                    disabled={isPublished}
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] disabled:bg-slate-100 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#172554] mb-1">Mô tả</label>
                  <textarea
                    rows={3}
                    disabled={isPublished}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] disabled:bg-slate-100 disabled:cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-[#172554] mb-2">Ảnh bìa khóa học</label>
                  <div className="flex flex-col sm:flex-row gap-4 sm:items-start">
                    {course.coverUrl ? (
                      <div className="relative group shrink-0">
                        <img
                          src={course.coverUrl}
                          alt="Ảnh bìa khóa học"
                          className="aspect-video w-56 rounded-xl object-cover border border-[#cbdbf5] shadow-xs"
                        />
                        <div className="absolute inset-0 rounded-xl bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold pointer-events-none">
                          Tỷ lệ chuẩn 16:9
                        </div>
                      </div>
                    ) : (
                      <div className="aspect-video w-56 rounded-xl border-2 border-dashed border-[#cbdbf5] bg-[#f8f9ff] flex flex-col items-center justify-center text-xs text-[#737686] gap-1 p-2 text-center shrink-0">
                        <span className="text-2xl">🖼️</span>
                        <span className="font-medium">Chưa có ảnh bìa</span>
                        <span className="text-[10px] text-slate-400">Khuyến nghị 16:9</span>
                      </div>
                    )}
                    <div className="space-y-2 flex-1">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={isPublished || coverUploading}
                        onChange={(event) => { void handleCoverUpload(event.target.files?.[0]); event.currentTarget.value = ''; }}
                        className="block text-sm text-[#172554] file:mr-3 file:rounded-lg file:border-0 file:bg-[#eff4ff] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[#2563EB] hover:file:bg-[#dbeafe] disabled:opacity-60 cursor-pointer"
                      />
                      <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-xl text-xs space-y-1">
                        <p className="font-semibold text-blue-900 flex items-center gap-1.5">
                          <span>💡</span> Kích thước chuẩn khuyến nghị: <strong className="text-[#2563EB]">1280 × 720 px</strong> (Tỷ lệ vàng 16:9)
                        </p>
                        <p className="text-blue-800/80 text-[11px] leading-relaxed">
                          • Định dạng: <strong>JPG, PNG, WebP</strong> · Tối đa <strong>8 MB</strong> {coverUploading ? '· đang tải lên...' : ''}.<br />
                          • Độ phân giải tối thiểu: <strong>640 × 360 px</strong> (hoặc 1920 × 1080 px Full HD). Tỷ lệ chuẩn 16:9 đảm bảo ảnh bìa hiển thị sắc nét, đồng bộ và không bị méo mó trên toàn hệ thống.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
                  <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2 text-sm font-medium text-[#172554] cursor-pointer">
                      <input
                        type="radio"
                        name="visibility"
                        value="PUBLIC"
                        disabled={isPublished}
                        checked={form.visibility === 'PUBLIC'}
                        onChange={() => setForm({ ...form, visibility: 'PUBLIC' })}
                        className="text-[#2563EB]"
                      />
                      Công khai (Public — Xem không cần đăng nhập)
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium text-[#172554] cursor-pointer">
                      <input
                        type="radio"
                        name="visibility"
                        value="PRIVATE"
                        disabled={isPublished}
                        checked={form.visibility === 'PRIVATE'}
                        onChange={() => setForm({ ...form, visibility: 'PRIVATE' })}
                        className="text-[#2563EB]"
                      />
                      Nội bộ (Private — Chỉ thành viên đăng nhập)
                    </label>
                  </div>

                </div>
              </form>
            </Card>
  );
}

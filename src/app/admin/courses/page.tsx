'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import { apiFetch, clearApiCache, getCachedApiData } from '@/lib/api/client';
import { useAdmin } from '../AdminContext';

export default function AdminCoursesPage() {
  const { mounted } = useAdmin();

  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
  };

  useEffect(() => {
    const cached = getCachedApiData<any>('/api/v1/courses');
    if (cached?.items) {
      setCourses(cached.items);
      setLoading(false);
    }
    loadCourses();
  }, []);

  async function loadCourses() {
    const res = await apiFetch('/api/v1/courses');
    if (res.ok && res.data) {
      setCourses(res.data.items || []);
    }
    setLoading(false);
  }

  async function handleTogglePublish(courseId: string, currentStatus: string) {
    const action = currentStatus === 'PUBLISHED' ? 'unpublish' : 'publish';
    const nextStatus = currentStatus === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';

    setActionLoadingId(courseId);
    clearApiCache('/api/v1/courses');

    const res = await apiFetch(`/api/v1/courses/${courseId}/${action}`, { method: 'POST' });

    if (res.ok) {
      setCourses((prev) =>
        prev.map((c) =>
          (c.courseId || c.id) === courseId
            ? { ...c, status: nextStatus, publishedAt: nextStatus === 'PUBLISHED' ? new Date().toISOString() : null }
            : c
        )
      );
      showToast('success', action === 'publish' ? 'Đã công khai khóa học thành công!' : 'Đã chuyển khóa học về bản nháp.');
    } else {
      showToast('error', res.error?.message || `Không thể ${action === 'publish' ? 'công khai' : 'bỏ công khai'} khóa học.`);
    }
    setActionLoadingId(null);
  }

  async function handleDeleteCourse(courseId: string, title: string) {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa khóa học "${title}"? Tất cả bài học liên quan sẽ bị xóa.`)) {
      return;
    }

    setActionLoadingId(courseId);
    clearApiCache('/api/v1/courses');

    const res = await apiFetch(`/api/v1/courses/${courseId}`, { method: 'DELETE' });
    if (res.ok) {
      setCourses((prev) => prev.filter((c) => (c.courseId || c.id) !== courseId));
      showToast('success', `Đã xóa khóa học "${title}" thành công.`);
    } else {
      showToast('error', res.error?.message || 'Lỗi khi xóa khóa học.');
    }
    setActionLoadingId(null);
  }

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Quản lý khóa học
          </h1>
          <p className="text-[#737686] mt-1 text-sm">Danh sách tất cả các khóa học trên hệ thống đào tạo BBE</p>
        </div>
        <Link href="/admin/courses/new">
          <Button>＋ Tạo khóa học mới</Button>
        </Link>
      </div>

      {!mounted || (loading && courses.length === 0) ? (
        <div className="space-y-4 animate-pulse">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-32 bg-white rounded-3xl border border-[#eff4ff] p-6 space-y-3">
              <div className="h-6 bg-slate-200 rounded-md w-1/3"></div>
              <div className="h-4 bg-slate-100 rounded-md w-2/3"></div>
            </div>
          ))}
        </div>
      ) : courses.length === 0 ? (
        <Card className="text-center py-16">
          <p className="text-xl font-bold text-[#172554] mb-2">Chưa có khóa học nào</p>
          <p className="text-sm text-[#737686] mb-6">Hãy bắt đầu tạo khóa học đầu tiên để cung cấp tài liệu cho học viên.</p>
          <Link href="/admin/courses/new">
            <Button>＋ Tạo khóa học mới ngay</Button>
          </Link>
        </Card>
      ) : (
        <div className="space-y-4">
          {courses.map((course) => {
            const cId = course.courseId || course.id;
            const isPublished = course.status === 'PUBLISHED';
            const isBusy = actionLoadingId === cId;

            return (
              <Card key={cId} className="p-6 border border-[#eff4ff] hover:shadow-md transition">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`whitespace-nowrap inline-flex items-center text-xs font-bold px-2.5 py-0.5 rounded-full ${
                          isPublished ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {isPublished ? '✓ Published' : 'Bản nháp (Draft)'}
                      </span>
                      <span
                        className={`whitespace-nowrap inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${
                          course.visibility === 'PUBLIC'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {course.visibility === 'PUBLIC' ? 'Public' : 'Private'}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-[#172554]">{course.title}</h3>
                    <p className="text-sm text-[#737686] line-clamp-1">{course.description || 'Chưa có mô tả'}</p>
                    <div className="flex items-center gap-4 text-xs text-[#737686] pt-1">
                      <span>Buổi học: {course.sessionCount || 0}</span>
                      {course.publishedAt && (
                        <span suppressHydrationWarning>Công khai: {new Date(course.publishedAt).toLocaleDateString('vi-VN')}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      href={`/admin/courses/${cId}/edit`}
                      onMouseEnter={() => {
                        apiFetch(`/api/v1/courses/${cId}`);
                        apiFetch(`/api/v1/courses/${cId}/assessment`);
                      }}
                    >
                      <Button variant="outline" size="sm">
                        ✏️ Chỉnh sửa nội dung
                      </Button>
                    </Link>

                    <Button
                      size="sm"
                      variant={isPublished ? 'secondary' : 'primary'}
                      loading={isBusy}
                      onClick={() => handleTogglePublish(cId, course.status)}
                    >
                      {isPublished ? 'Hạ về bản nháp' : 'Công khai'}
                    </Button>

                    <button
                      onClick={() => handleDeleteCourse(cId, course.title)}
                      disabled={isBusy}
                      className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition"
                      title="Xóa khóa học"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

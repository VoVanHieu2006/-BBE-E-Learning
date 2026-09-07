'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { apiFetch, clearApiCache } from '@/lib/api/client';

export default function AdminNewCoursePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: '',
    description: '',
    visibility: 'PRIVATE' as 'PUBLIC' | 'PRIVATE',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    clearApiCache('/api/v1/courses');

    const res = await apiFetch('/api/v1/courses', {
      method: 'POST',
      body: JSON.stringify(form),
    });

    if (!res.ok) {
      setError(res.error?.message || 'Không thể tạo khóa học. Vui lòng thử lại.');
      setLoading(false);
      return;
    }

    const courseId = res.data?.courseId || res.data?.id;
    setSuccess('Tạo khóa học thành công! Đang mở trình chỉnh sửa nội dung...');
    router.replace(`/admin/courses/${courseId}/edit`);
  };

  return (
    <>
        <div className="mb-6">
          <Link
            href="/admin/courses"
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white border border-[#cbdbf5] text-xs font-bold text-[#172554] hover:bg-[#eff4ff] hover:text-[#2563EB] hover:border-[#2563EB] shadow-xs transition-all"
          >
            ← Quay lại danh sách khóa học
          </Link>
        </div>

        <h1 className="text-3xl font-bold text-[#172554] mb-2" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
          Tạo khóa học mới
        </h1>
        <p className="text-xs text-[#737686] mb-6">
          Khởi tạo khóa học ban đầu ở trạng thái Bản nháp (Draft), sau đó thêm các buổi học và bài giảng video.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-4 text-sm font-medium">
            ⚠️ {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl mb-4 text-sm font-medium">
            ✓ {success}
          </div>
        )}

        <Card className="p-6 border border-[#eff4ff] shadow-sm max-w-3xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-[#172554] mb-1.5">
                Tiêu đề khóa học <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="title"
                value={form.title}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 border border-[#cbdbf5] rounded-xl text-[#0b1c30] placeholder-[#737686] focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent transition text-sm font-medium"
                placeholder="Ví dụ: Kỹ năng giao tiếp và đào tạo chuẩn văn hóa BBE"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#172554] mb-1.5">Mô tả</label>
              <textarea
                name="description"
                value={form.description}
                onChange={handleChange}
                rows={4}
                className="w-full px-4 py-3 border border-[#cbdbf5] rounded-xl text-[#0b1c30] placeholder-[#737686] focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent transition text-sm"
                placeholder="Mô tả nội dung, mục tiêu và kết quả đạt được sau khóa học (tùy chọn)"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#172554] mb-1.5">Chế độ hiển thị</label>
              <div className="flex flex-col sm:flex-row gap-4 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="visibility"
                    value="PUBLIC"
                    checked={form.visibility === 'PUBLIC'}
                    onChange={handleChange}
                    className="h-4 w-4 text-[#2563EB]"
                  />
                  <span className="text-sm font-medium text-[#172554]">Công khai (Khách & Thành viên đều xem được)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="visibility"
                    value="PRIVATE"
                    checked={form.visibility === 'PRIVATE'}
                    onChange={handleChange}
                    className="h-4 w-4 text-[#2563EB]"
                  />
                  <span className="text-sm font-medium text-[#172554]">Nội bộ (Chỉ thành viên đăng nhập)</span>
                </label>
              </div>
            </div>
            <div className="pt-3 border-t border-[#eff4ff] flex justify-end gap-3">
              <Link href="/admin/courses">
                <Button variant="outline" type="button">
                  Hủy
                </Button>
              </Link>
              <Button type="submit" loading={loading} loadingText="Đang tạo...">
                Tạo khóa học & Thêm nội dung →
              </Button>
            </div>
          </form>
        </Card>
    </>
  );
}

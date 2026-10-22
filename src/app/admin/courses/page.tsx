'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import { apiFetch, clearApiCache, getCachedApiData } from '@/lib/api/client';
import { useAdmin } from '../AdminContext';

interface TrainingProgramDef {
  code: string;
  title: string;
  badge: string;
  description: string;
  icon: string;
  accentBg: string;
  accentBorder: string;
  badgeColor: string;
}

const TRAINING_PROGRAMS: TrainingProgramDef[] = [
  {
    code: 'CORE_MEMBER',
    title: 'Chương trình Hội viên cốt lõi',
    badge: 'Hội viên cốt lõi',
    description: 'Các khóa học nền tảng bắt buộc dành cho Thành viên Chapter',
    icon: '🎓',
    accentBg: 'bg-blue-50/50',
    accentBorder: 'border-blue-200',
    badgeColor: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  {
    code: 'CORE_LEADER',
    title: 'Chương trình Ban điều hành (LT) cốt lõi',
    badge: 'LT cốt lõi',
    description: 'Các khóa học nghiệp vụ chuyên môn dành cho Trưởng ban và Chủ tịch Chapter',
    icon: '👑',
    accentBg: 'bg-purple-50/50',
    accentBorder: 'border-purple-200',
    badgeColor: 'bg-purple-100 text-purple-800 border-purple-200',
  },
  {
    code: 'CORE_DNA',
    title: 'Chương trình DNA cốt lõi',
    badge: 'DNA cốt lõi',
    description: 'Các khóa học đặc thù dành cho thành viên và ban lãnh đạo khối DNA',
    icon: '🧬',
    accentBg: 'bg-emerald-50/50',
    accentBorder: 'border-emerald-200',
    badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  {
    code: 'EXTENDED',
    title: 'Chương trình Mở rộng / Khuyến khích',
    badge: 'Mở rộng',
    description: 'Các khóa học kỹ năng mềm, phương pháp làm việc và phát triển toàn diện tự chọn',
    icon: '🚀',
    accentBg: 'bg-slate-50/50',
    accentBorder: 'border-slate-200',
    badgeColor: 'bg-slate-100 text-slate-800 border-slate-200',
  },
];

export default function AdminCoursesPage() {
  const { mounted } = useAdmin();

  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [changingProgramId, setChangingProgramId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Trạng thái đóng/mở của 4 Accordion + Khối chưa phân loại
  const [openAccordions, setOpenAccordions] = useState<Record<string, boolean>>({
    UNCATEGORIZED: true,
    CORE_MEMBER: true,
    CORE_LEADER: true,
    CORE_DNA: true,
    EXTENDED: true,
  });

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
  };

  const toggleAccordion = (key: string) => {
    setOpenAccordions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  useEffect(() => {
    const cached = getCachedApiData<any>('/api/v1/courses?limit=100');
    if (cached?.items) {
      setCourses(cached.items);
      setLoading(false);
    }
    loadCourses();
  }, []);

  async function loadCourses() {
    const res = await apiFetch('/api/v1/courses?limit=100');
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
    clearApiCache(`/api/v1/courses/${courseId}`);

    const res = await apiFetch(`/api/v1/courses/${courseId}/${action}`, { method: 'POST' });

    clearApiCache('/api/v1/courses');
    clearApiCache(`/api/v1/courses/${courseId}`);

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

  async function handleChangeProgram(courseId: string, newProgramCode: string, courseTitle: string) {
    setChangingProgramId(courseId);
    clearApiCache('/api/v1/courses');
    clearApiCache(`/api/v1/courses/${courseId}`);

    const res = await apiFetch(`/api/v1/courses/${courseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ programCode: newProgramCode || null }),
    });

    clearApiCache('/api/v1/courses');
    clearApiCache(`/api/v1/courses/${courseId}`);

    if (res.ok) {
      const selectedProgram = TRAINING_PROGRAMS.find((p) => p.code === newProgramCode);
      const programName = selectedProgram ? selectedProgram.title : 'Chưa phân loại';

      setCourses((prev) =>
        prev.map((c) => {
          if ((c.courseId || c.id) === courseId) {
            return {
              ...c,
              programCode: newProgramCode || null,
              program: selectedProgram
                ? {
                    id: selectedProgram.code,
                    code: selectedProgram.code,
                    name: selectedProgram.title,
                  }
                : null,
            };
          }
          return c;
        })
      );

      showToast('success', `Đã chuyển khóa học "${courseTitle}" sang ${programName}!`);
    } else {
      showToast('error', res.error?.message || 'Không thể đổi chương trình học.');
    }
    setChangingProgramId(null);
  }

  // Lọc khóa học theo ô tìm kiếm
  const filteredCourses = useMemo(() => {
    if (!searchQuery.trim()) return courses;
    const q = searchQuery.toLowerCase().trim();
    return courses.filter(
      (c) =>
        c.title?.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q)
    );
  }, [courses, searchQuery]);

  // Phân chia khóa học theo từng chương trình đào tạo
  const categorizedCourses = useMemo(() => {
    const map: Record<string, any[]> = {
      CORE_MEMBER: [],
      CORE_LEADER: [],
      CORE_DNA: [],
      EXTENDED: [],
      UNCATEGORIZED: [],
    };

    for (const c of filteredCourses) {
      const pCode = c.programCode || c.program?.code;
      if (pCode && map[pCode]) {
        map[pCode].push(c);
      } else {
        map.UNCATEGORIZED.push(c);
      }
    }

    return map;
  }, [filteredCourses]);

  const uncategorizedCount = categorizedCourses.UNCATEGORIZED.length;

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* Header & Hành động */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Quản lý khóa học
          </h1>
          <p className="text-[#737686] mt-1 text-sm">
            Danh sách khóa học được tổ chức theo 4 chương trình đào tạo BBE. Tổng số: <strong>{courses.length}</strong> khóa học.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link href="/admin/courses/mandatory">
            <Button variant="outline" className="shadow-2xs">
              📊 Ma trận khóa học bắt buộc
            </Button>
          </Link>
          <Link href="/admin/courses/new">
            <Button className="shadow-sm">＋ Tạo khóa học mới</Button>
          </Link>
        </div>
      </div>

      {/* Thanh tìm kiếm */}
      <div className="mb-6 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-96">
          <input
            type="text"
            placeholder="🔍 Tìm kiếm tên khóa học..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2.5 pl-10 text-sm bg-white border border-[#e2e8f0] rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition shadow-2xs"
          />
          <span className="absolute left-3.5 top-2.5 text-slate-400 text-sm pointer-events-none">🔍</span>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3.5 top-2.5 text-slate-400 hover:text-slate-600 text-xs font-bold"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto text-xs font-medium text-slate-500">
          <button
            onClick={() =>
              setOpenAccordions({
                UNCATEGORIZED: true,
                CORE_MEMBER: true,
                CORE_LEADER: true,
                CORE_DNA: true,
                EXTENDED: true,
              })
            }
            className="hover:text-blue-600 underline"
          >
            Mở tất cả
          </button>
          <span>•</span>
          <button
            onClick={() =>
              setOpenAccordions({
                UNCATEGORIZED: false,
                CORE_MEMBER: false,
                CORE_LEADER: false,
                CORE_DNA: false,
                EXTENDED: false,
              })
            }
            className="hover:text-blue-600 underline"
          >
            Thu gọn tất cả
          </button>
        </div>
      </div>

      {/* Cảnh báo khóa chưa phân loại */}
      {uncategorizedCount > 0 && (
        <div className="mb-6 p-4.5 bg-gradient-to-r from-amber-500/10 via-amber-50 to-orange-50/50 border border-amber-300 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 bg-amber-500 text-white rounded-xl text-lg shadow-2xs shrink-0">⚠️</div>
            <div>
              <div className="font-bold text-amber-950 text-sm">
                Có {uncategorizedCount} khóa học chưa phân loại chương trình đào tạo
              </div>
              <p className="text-xs text-amber-800 mt-0.5">
                Các khóa này chưa được xếp vào 4 chương trình chuẩn. Hãy chọn chương trình tương ứng ở dropdown bên dưới để phân loại ngay!
              </p>
            </div>
          </div>
          <button
            onClick={() => setOpenAccordions((prev) => ({ ...prev, UNCATEGORIZED: true }))}
            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition shadow-xs self-start sm:self-auto whitespace-nowrap"
          >
            Xem và phân loại ⬇
          </button>
        </div>
      )}

      {!mounted || (loading && courses.length === 0) ? (
        <div className="space-y-4 animate-pulse">
          {[1, 2, 3, 4].map((n) => (
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
        <div className="space-y-6">
          {/* KHỐI 1: KHÓA HỌC CHƯA PHÂN LOẠI (NẾU CÓ) */}
          {uncategorizedCount > 0 && (
            <div className="border border-amber-300 bg-amber-50/30 rounded-3xl overflow-hidden shadow-xs transition">
              <button
                type="button"
                onClick={() => toggleAccordion('UNCATEGORIZED')}
                className="w-full px-6 py-4.5 bg-gradient-to-r from-amber-100/90 to-amber-50/70 border-b border-amber-200 flex items-center justify-between text-left transition hover:bg-amber-100"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">⚠️</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-amber-950">Khóa học chưa phân loại</h2>
                      <span className="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-amber-200 text-amber-900 border border-amber-300">
                        {uncategorizedCount} khóa
                      </span>
                    </div>
                    <p className="text-xs text-amber-800 mt-0.5">
                      Cần chọn chương trình đào tạo để hiển thị chính xác trên Lộ trình người học
                    </p>
                  </div>
                </div>
                <span className="text-amber-800 font-bold text-lg">
                  {openAccordions.UNCATEGORIZED ? '▲' : '▼'}
                </span>
              </button>

              {openAccordions.UNCATEGORIZED && (
                <div className="p-5 space-y-3.5">
                  {categorizedCourses.UNCATEGORIZED.map((course) => (
                    <CourseCardRow
                      key={course.courseId || course.id}
                      course={course}
                      actionLoadingId={actionLoadingId}
                      changingProgramId={changingProgramId}
                      onTogglePublish={handleTogglePublish}
                      onDeleteCourse={handleDeleteCourse}
                      onChangeProgram={handleChangeProgram}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 4 ACCORDION CHƯƠNG TRÌNH ĐÀO TẠO CHUẨN */}
          {TRAINING_PROGRAMS.map((program) => {
            const list = categorizedCourses[program.code] || [];
            const isOpen = openAccordions[program.code] ?? true;

            return (
              <div
                key={program.code}
                className={`border rounded-3xl overflow-hidden shadow-xs transition ${program.accentBorder} bg-white`}
              >
                {/* Accordion Header */}
                <button
                  type="button"
                  onClick={() => toggleAccordion(program.code)}
                  className={`w-full px-6 py-4.5 ${program.accentBg} border-b ${program.accentBorder} flex items-center justify-between text-left transition hover:brightness-95`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl p-2 bg-white rounded-2xl shadow-2xs border border-slate-100">
                      {program.icon}
                    </span>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-base font-bold text-[#172554]">{program.title}</h2>
                        <span
                          className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full border ${program.badgeColor}`}
                        >
                          {list.length} khóa học
                        </span>
                      </div>
                      <p className="text-xs text-[#737686] mt-0.5">{program.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400 font-bold text-sm">
                      {isOpen ? '▲ Thu gọn' : '▼ Mở rộng'}
                    </span>
                  </div>
                </button>

                {/* Accordion Content */}
                {isOpen && (
                  <div className="p-5 space-y-3.5">
                    {list.length === 0 ? (
                      <div className="py-8 text-center text-xs text-slate-400 border-2 border-dashed border-slate-100 rounded-2xl">
                        Chưa có khóa học nào thuộc {program.title}. Chọn chương trình từ dropdown của khóa học để xếp vào đây.
                      </div>
                    ) : (
                      list.map((course) => (
                        <CourseCardRow
                          key={course.courseId || course.id}
                          course={course}
                          actionLoadingId={actionLoadingId}
                          changingProgramId={changingProgramId}
                          onTogglePublish={handleTogglePublish}
                          onDeleteCourse={handleDeleteCourse}
                          onChangeProgram={handleChangeProgram}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * Hàng hiển thị Card Khóa học
 * Hoàn toàn ẩn chuỗi UUID, hỗ trợ Dropdown đổi chương trình trực tiếp
 */
function CourseCardRow({
  course,
  actionLoadingId,
  changingProgramId,
  onTogglePublish,
  onDeleteCourse,
  onChangeProgram,
}: {
  course: any;
  actionLoadingId: string | null;
  changingProgramId: string | null;
  onTogglePublish: (id: string, status: string) => void;
  onDeleteCourse: (id: string, title: string) => void;
  onChangeProgram: (id: string, programCode: string, title: string) => void;
}) {
  const cId = course.courseId || course.id;
  const isPublished = course.status === 'PUBLISHED';
  const isActionBusy = actionLoadingId === cId;
  const isProgramBusy = changingProgramId === cId;
  const currentProgramCode = course.programCode || course.program?.code || '';

  return (
    <Card className="p-5 border border-[#eff4ff] hover:border-blue-200 hover:shadow-md transition rounded-2xl bg-white">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Cột trái: Thông tin khóa học (Ẩn hoàn toàn UUID) */}
        <div className="space-y-2 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`whitespace-nowrap inline-flex items-center text-xs font-bold px-2.5 py-0.5 rounded-full ${
                isPublished ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-amber-100 text-amber-700 border border-amber-200'
              }`}
            >
              {isPublished ? '✓ Đã xuất bản (Published)' : '📝 Bản nháp (Draft)'}
            </span>
            <span
              className={`whitespace-nowrap inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${
                course.visibility === 'PUBLIC'
                  ? 'bg-blue-100 text-blue-700 border border-blue-200'
                  : 'bg-slate-100 text-slate-700 border border-slate-200'
              }`}
            >
              {course.visibility === 'PUBLIC' ? '🌐 Công khai' : '🔒 Nội bộ BBE'}
            </span>
          </div>

          <h3 className="text-base font-bold text-[#172554] truncate" title={course.title}>
            {course.title}
          </h3>

          <p className="text-xs text-[#737686] line-clamp-2 leading-relaxed">
            {course.description || 'Chưa có mô tả chi tiết cho khóa học này.'}
          </p>

          <div className="flex items-center gap-4 text-xs text-[#737686] pt-1">
            <span>📚 Buổi học: <strong>{course.sessionCount || 0}</strong></span>
            {course.publishedAt && (
              <span suppressHydrationWarning>
                📅 Ngày công khai: {new Date(course.publishedAt).toLocaleDateString('vi-VN')}
              </span>
            )}
          </div>
        </div>

        {/* Cột phải: Đổi chương trình trực tiếp + Thao tác quản trị */}
        <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-stretch sm:items-center gap-3 shrink-0 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100">
          {/* Dropdown Đổi chương trình học trực tiếp */}
          <div className="flex flex-col gap-1 min-w-[210px]">
            <label className="text-[11px] font-semibold text-slate-500 flex items-center justify-between">
              <span>Chương trình:</span>
              {isProgramBusy && <span className="text-[10px] text-blue-600 animate-pulse">Đang lưu...</span>}
            </label>
            <select
              value={currentProgramCode}
              disabled={isProgramBusy}
              onChange={(e) => onChangeProgram(cId, e.target.value, course.title)}
              className="px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 disabled:opacity-50 transition cursor-pointer shadow-2xs"
            >
              <option value="">⚠️ Chưa phân loại</option>
              {TRAINING_PROGRAMS.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.icon} {p.title}
                </option>
              ))}
            </select>
          </div>

          {/* Các nút hành động */}
          <div className="flex items-center gap-2 self-end sm:self-auto pt-1 sm:pt-4 lg:pt-0">
            <Link href={`/admin/courses/${cId}/edit`}>
              <Button variant="outline" size="sm" className="text-xs shadow-2xs">
                ✏️ Sửa nội dung
              </Button>
            </Link>

            <Button
              size="sm"
              variant={isPublished ? 'secondary' : 'primary'}
              loading={isActionBusy}
              onClick={() => onTogglePublish(cId, course.status)}
              className="text-xs whitespace-nowrap shadow-2xs"
            >
              {isPublished ? 'Hạ về nháp' : 'Công khai'}
            </Button>

            <button
              onClick={() => onDeleteCourse(cId, course.title)}
              disabled={isActionBusy}
              className="p-2 text-slate-400 hover:text-red-600 rounded-xl hover:bg-red-50 transition disabled:opacity-30"
              title="Xóa khóa học"
            >
              🗑️
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

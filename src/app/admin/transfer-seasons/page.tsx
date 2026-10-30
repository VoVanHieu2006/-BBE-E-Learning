'use client';

import { useEffect, useRef, useState } from 'react';
import Card from '@/components/ui/Card';
import { apiFetch, getCachedApiData } from '@/lib/api/client';

const PATH = '/api/v1/admin/transfer-seasons/progress';
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZES = [20, 50, 100];

type ChapterStatus = 'APPLIED' | 'SCHEDULED' | 'NONE';
type StatusFilter = ChapterStatus | 'OVERDUE';

type ChapterProgress = {
  id: string;
  name: string;
  active: boolean;
  status: ChapterStatus;
  statusLabel: string;
  effectiveAt: string | null;
  appliedAt: string | null;
  actualTransferAt: string | null;
  termNumber: number | null;
  batchCount: number;
  lateApplication: boolean;
  appliedDelayMinutes: number | null;
  pendingOverdue: boolean;
  overdueMinutes: number | null;
  applyAttempts: number;
  lastError: string | null;
  totalAppliedCount: number;
  lastAppliedAt: string | null;
};

type Counts = {
  chapters: number;
  transferred: number;
  scheduled: number;
  notTransferred: number;
  overdue: number;
};

type WindowSummary = {
  key: string;
  window: { startsAt: string; endsAt: string; anchor: string; name: string; label: string };
  term: { startsAt: string; endsAt: string; label: string };
  status: string;
  statusLabel: string;
  message: string | null;
  counts: Counts;
};

type Season = {
  id: string;
  code: string;
  startsAt: string;
  endsAt: string;
  rewardBoundaryAt: string | null;
  state: string;
  stateLabel: string;
};

type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

type SeasonWindow = WindowSummary & {
  seasons: Season[];
  pagination: Pagination;
  chapters: ChapterProgress[];
};

type ProgressPayload = {
  generatedAt: string;
  labels: Record<string, string>;
  selectedWindowKey: string | null;
  windowsTruncated: boolean;
  windows: WindowSummary[];
  items: SeasonWindow[];
};

type ChapterHistoryEntry = {
  id: string;
  status: string;
  statusLabel: string;
  windowKey: string;
  windowLabel: string;
  effectiveAt: string;
  appliedAt: string | null;
  actualTransferAt: string | null;
  termNumber: number | null;
  seasonCode: string | null;
  applyAttempts: number;
  lastError: string | null;
};

type ChapterHistoryPayload = {
  generatedAt: string;
  chapter: { id: string; name: string; active: boolean };
  summary: { appliedCount: number; scheduledCount: number; cancelledCount: number; lastAppliedAt: string | null };
  entries: ChapterHistoryEntry[];
  entriesTruncated: boolean;
};

type Filters = {
  windowKey: string | null;
  q: string;
  status: StatusFilter | null;
  page: number;
  pageSize: number;
};

const EMPTY_FILTERS: Filters = { windowKey: null, q: '', status: null, page: 1, pageSize: DEFAULT_PAGE_SIZE };

function buildPath(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.windowKey) params.set('window', filters.windowKey);
  if (filters.q) params.set('q', filters.q);
  if (filters.status) params.set('status', filters.status);
  if (filters.page > 1) params.set('page', String(filters.page));
  if (filters.pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(filters.pageSize));
  const query = params.toString();
  return query ? `${PATH}?${query}` : PATH;
}

function readCachedProgress(): ProgressPayload | null {
  const cached = getCachedApiData<ProgressPayload>(PATH);
  if (!cached || !Array.isArray(cached.windows) || !Array.isArray(cached.items)) return null;
  return cached;
}

function formatDate(value: string | Date | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}

function formatInclusiveEnd(value: string | Date | null): string {
  if (!value) return '—';
  return formatDate(new Date(new Date(value).getTime() - 1));
}

function formatDateTime(value: string | Date | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}

function windowStatusClasses(status: string): string {
  if (status === 'OK') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'SEASON_NOT_CONFIGURED') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-rose-50 text-rose-700 border-rose-200';
}

function chapterStatusClasses(status: string): string {
  if (status === 'APPLIED') return 'bg-emerald-50 text-emerald-700';
  if (status === 'SCHEDULED') return 'bg-amber-50 text-amber-800';
  if (status === 'CANCELLED') return 'bg-slate-200 text-slate-700';
  return 'bg-slate-100 text-slate-600';
}

function pageNumbers(current: number, total: number): number[] {
  return Array.from({ length: total }, (_, index) => index + 1)
    .filter((page) => page === 1 || page === total || Math.abs(page - current) <= 1);
}

export default function TransferSeasonsProgressPage() {
  const [data, setData] = useState<ProgressPayload | null>(() => readCachedProgress());
  const [loading, setLoading] = useState(() => readCachedProgress() === null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const requestRef = useRef(0);

  const [historyChapter, setHistoryChapter] = useState<ChapterProgress | null>(null);
  const [historyData, setHistoryData] = useState<ChapterHistoryPayload | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const historyRequestRef = useRef(0);

  useEffect(() => {
    const cached = readCachedProgress();
    if (cached) {
      setData(cached);
      setLoading(false);
    }
    void load(EMPTY_FILTERS, false);
    // The default view is tab-cached; navigating back renders the snapshot and
    // only the manual refresh button forces a new default-view request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!historyChapter) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeHistory();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyChapter]);

  async function load(next: Filters, noCache: boolean) {
    const requestId = ++requestRef.current;
    const path = buildPath(next);
    if (noCache) setRefreshing(true);
    else if (!data) setLoading(true);
    setBusy(true);
    setMessage('');
    const response = await apiFetch<ProgressPayload>(path, {
      noCache,
      // Only the unfiltered first page earns a tab snapshot; query variants use
      // the ordinary cache so the tab LRU is not flooded by every filter combo.
      tabCache: path === PATH,
    });
    if (requestId !== requestRef.current) return;
    if (response.ok && response.data) {
      if (!Array.isArray(response.data.windows) || !Array.isArray(response.data.items)) {
        // A pre-deploy snapshot may still be in sessionStorage; force one fresh read.
        if (!noCache) {
          void load(next, true);
          return;
        }
        setMessage('Dữ liệu trả về không hợp lệ. Hãy thử lại.');
      } else {
        setData(response.data);
        const pager = response.data.items[0]?.pagination;
        setFilters({ ...next, page: pager?.page ?? next.page });
      }
    } else {
      setMessage(response.error?.message || 'Không tải được tiến độ chuyển giao. Hãy thử lại.');
    }
    setLoading(false);
    setBusy(false);
    setRefreshing(false);
  }

  function applyFilters(patch: Partial<Filters>) {
    const next: Filters = { ...filters, ...patch };
    if (!('page' in patch)) next.page = 1;
    setFilters(next);
    void load(next, false);
  }

  function resetFilters() {
    setSearchInput('');
    const next: Filters = { ...EMPTY_FILTERS, windowKey: filters.windowKey };
    setFilters(next);
    void load(next, false);
  }

  async function openHistory(chapter: ChapterProgress) {
    setHistoryChapter(chapter);
    setHistoryData(null);
    setHistoryError('');
    setHistoryLoading(true);
    const requestId = ++historyRequestRef.current;
    const response = await apiFetch<ChapterHistoryPayload>(
      `/api/v1/admin/transfer-seasons/chapters/${chapter.id}`,
      { noCache: true },
    );
    if (requestId !== historyRequestRef.current) return;
    if (response.ok && response.data) setHistoryData(response.data);
    else setHistoryError(response.error?.message || 'Không tải được lịch sử chuyển giao của chapter này.');
    setHistoryLoading(false);
  }

  function closeHistory() {
    historyRequestRef.current += 1;
    setHistoryChapter(null);
    setHistoryData(null);
    setHistoryError('');
    setHistoryLoading(false);
  }

  const summaries = data?.windows || [];
  const selected = data?.items[0] || null;
  const pagination = selected?.pagination || null;
  const selectedWindowKey = selected?.key || data?.selectedWindowKey || '';
  const windowSelectValue = filters.windowKey || selectedWindowKey;
  const readyWindows = summaries.filter((item) => item.status === 'OK').length;
  const appliedTotal = summaries.reduce((sum, item) => sum + item.counts.transferred, 0);
  const scheduledTotal = summaries.reduce((sum, item) => sum + item.counts.scheduled, 0);
  const overdueTotal = summaries.reduce((sum, item) => sum + item.counts.overdue, 0);
  const firstRow = pagination ? (pagination.page - 1) * pagination.pageSize + 1 : 0;
  const lastRow = pagination ? Math.min(pagination.page * pagination.pageSize, pagination.total) : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Tiến độ chuyển giao nhiệm kỳ
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-[#737686]">
            Theo dõi từng giai đoạn chuyển giao, nhiệm kỳ tương ứng và chapter nào đã hoàn tất chuyển giao.
            Trang này chỉ để xem; việc đặt lịch, áp dụng hay hủy chuyển giao thuộc Chapter Quản lý, còn cấu hình mùa thuộc phần cấu hình học tập.
          </p>
        </div>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void load(filters, true)}
          className="flex items-center gap-2 rounded-xl border border-[#cbdbf5] bg-white px-4 py-2 text-sm font-semibold text-[#172554] shadow-xs transition hover:bg-[#eff4ff] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          title="Tải lại dữ liệu mới nhất từ hệ thống"
        >
          <span className={refreshing ? 'inline-block animate-spin' : ''}>🔄</span>
          <span>{refreshing ? 'Đang làm mới...' : 'Làm mới'}</span>
        </button>
      </div>

      {message && <p role="status" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{message}</p>}

      {overdueTotal > 0 && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
          Có {overdueTotal} chapter đã quá giờ hiệu lực nhưng chưa được áp dụng. Kiểm tra scheduler/cron và lỗi áp dụng bên dưới.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card shadow="md" className="border border-[#eff4ff] p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#737686]">Giai đoạn đang theo dõi</p>
          <p className="mt-2 text-2xl font-bold text-[#172554]">
            {loading && !data ? '...' : `${summaries.length}${data?.windowsTruncated ? '+' : ''}`}
          </p>
        </Card>
        <Card shadow="md" className="border border-[#eff4ff] p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#737686]">Giai đoạn đã đủ cấu hình</p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{loading && !data ? '...' : readyWindows}</p>
        </Card>
        <Card shadow="md" className="border border-[#eff4ff] p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#737686]">Lượt chuyển giao đã áp dụng</p>
          <p className="mt-2 text-2xl font-bold text-[#2563EB]">{loading && !data ? '...' : appliedTotal}</p>
        </Card>
        <Card shadow="md" className="border border-[#eff4ff] p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#737686]">Lượt đang chờ áp dụng</p>
          <p className="mt-2 text-2xl font-bold text-amber-700">{loading && !data ? '...' : scheduledTotal}</p>
          {overdueTotal > 0 && <p className="mt-1 text-xs font-semibold text-rose-700">{overdueTotal} quá hạn</p>}
        </Card>
      </div>

      {loading && !data ? (
        <Card className="border border-[#eff4ff] p-6 text-sm text-[#737686]">Đang tải tiến độ chuyển giao…</Card>
      ) : !summaries.length ? (
        <Card className="border border-[#eff4ff] p-6">
          <h2 className="font-semibold text-[#172554]">Chưa có giai đoạn chuyển giao nào</h2>
          <p className="mt-1 text-sm text-[#737686]">
            Khi Admin tạo mùa chuyển giao hoặc khi một chapter được lên lịch chuyển giao, giai đoạn tương ứng sẽ xuất hiện ở đây.
          </p>
        </Card>
      ) : (
        <>
          <Card shadow="md" className="border border-[#eff4ff] p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
              <label className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide text-[#737686]">
                Giai đoạn
                <select
                  value={windowSelectValue}
                  onChange={(event) => applyFilters({ windowKey: event.target.value || null })}
                  className="mt-1 w-full rounded-xl border border-[#cbdbf5] bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-[#172554] outline-none focus:border-[#2563EB]"
                >
                  {summaries.map((item) => (
                    <option key={item.key} value={item.key}>
                      {formatDate(item.window.startsAt)} – {formatInclusiveEnd(item.window.endsAt)}
                      {' · '}{item.statusLabel}
                      {' · '}{item.counts.transferred}/{item.counts.chapters} đã chuyển giao
                    </option>
                  ))}
                </select>
              </label>

              <form
                className="flex min-w-0 flex-1 items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  applyFilters({ q: searchInput.trim() });
                }}
              >
                <label className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide text-[#737686]">
                  Tìm chapter
                  <input
                    type="search"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="Nhập tên chapter"
                    className="mt-1 w-full rounded-xl border border-[#cbdbf5] bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-[#172554] outline-none focus:border-[#2563EB]"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1d4ed8] active:scale-95"
                >
                  Tìm
                </button>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded-xl border border-[#cbdbf5] bg-white px-4 py-2 text-sm font-semibold text-[#172554] transition hover:bg-[#eff4ff] active:scale-95"
                >
                  Xóa lọc
                </button>
              </form>

              <label className="text-xs font-semibold uppercase tracking-wide text-[#737686]">
                Trạng thái
                <select
                  value={filters.status || ''}
                  onChange={(event) => applyFilters({ status: (event.target.value || null) as StatusFilter | null })}
                  className="mt-1 w-full rounded-xl border border-[#cbdbf5] bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-[#172554] outline-none focus:border-[#2563EB] xl:w-44"
                >
                  <option value="">Tất cả</option>
                  <option value="APPLIED">Đã chuyển giao</option>
                  <option value="SCHEDULED">Đã lên lịch</option>
                  <option value="NONE">Chưa chuyển giao</option>
                  <option value="OVERDUE">Quá hạn áp dụng</option>
                </select>
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-[#737686]">
                Số dòng
                <select
                  value={filters.pageSize}
                  onChange={(event) => applyFilters({ pageSize: Number(event.target.value) })}
                  className="mt-1 w-full rounded-xl border border-[#cbdbf5] bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-[#172554] outline-none focus:border-[#2563EB] xl:w-28"
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </label>
            </div>
            {data?.windowsTruncated && (
              <p className="mt-2 text-xs text-[#737686]">
                Bộ chọn chỉ hiển thị {summaries.length} giai đoạn gần nhất; thống kê phía trên cũng chỉ tính trong các giai đoạn này.
              </p>
            )}
          </Card>

          {selected && (
            <Card shadow="md" className={`overflow-hidden border border-[#eff4ff] transition-opacity ${busy ? 'opacity-60' : ''}`}>
              <div className="border-b border-[#eff4ff] bg-gradient-to-r from-[#f8f9ff] via-white to-[#eff4ff] p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold text-[#172554]">Giai đoạn {selected.window.label}</h2>
                      <span className={`rounded-full border px-3 py-1 text-xs font-bold ${windowStatusClasses(selected.status)}`}>
                        {selected.statusLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[#737686]">
                      Mốc thưởng {formatDate(selected.window.anchor)} · Nhiệm kỳ {selected.term.label}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-semibold">
                    <span className="rounded-full bg-white px-3 py-1 text-[#172554] ring-1 ring-[#cbdbf5]">
                      {selected.counts.transferred}/{selected.counts.chapters} đã chuyển giao
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 text-amber-800 ring-1 ring-amber-200">
                      {selected.counts.scheduled} đang chờ
                    </span>
                    {selected.counts.overdue > 0 && (
                      <span className="rounded-full bg-white px-3 py-1 text-rose-700 ring-1 ring-rose-200">
                        {selected.counts.overdue} quá hạn
                      </span>
                    )}
                    <span className="rounded-full bg-white px-3 py-1 text-slate-600 ring-1 ring-slate-200">
                      {selected.counts.notTransferred} chưa chuyển giao
                    </span>
                  </div>
                </div>
                {selected.message && (
                  <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{selected.message}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-[#737686]">
                  {selected.seasons.length ? selected.seasons.map((season) => (
                    <span key={season.id} className="rounded-lg border border-[#cbdbf5] bg-white px-3 py-1.5">
                      {season.rewardBoundaryAt ? `Mùa thưởng ${formatDate(season.rewardBoundaryAt)}` : 'Mùa chuyển giao'} · {season.stateLabel} · {formatDate(season.startsAt)} – {formatInclusiveEnd(season.endsAt)}
                    </span>
                  )) : <span className="rounded-lg border border-[#cbdbf5] bg-white px-3 py-1.5">Chưa có mùa chuyển giao cho giai đoạn này</span>}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-4 py-3 font-bold">Chapter</th>
                      <th className="px-4 py-3 font-bold">Trạng thái</th>
                      <th className="px-4 py-3 font-bold">Có hiệu lực</th>
                      <th className="px-4 py-3 font-bold">Giờ hệ thống áp dụng</th>
                      <th className="px-4 py-3 font-bold">Thời gian chuyển giao thực tế</th>
                      <th className="px-4 py-3 font-bold">Nhiệm kỳ</th>
                      <th className="px-4 py-3 font-bold">Lịch sử</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selected.chapters.map((chapter) => (
                      <tr key={chapter.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3 align-top">
                          <p className="font-semibold text-[#172554]">
                            {chapter.name}
                            {!chapter.active && <span className="ml-2 text-[11px] font-normal text-slate-500">(đã ngừng hoạt động)</span>}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {chapter.totalAppliedCount > 0
                              ? `Đã chuyển giao tổng ${chapter.totalAppliedCount} lần · gần nhất ${formatDateTime(chapter.lastAppliedAt)}`
                              : 'Chưa từng chuyển giao'}
                          </p>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${chapterStatusClasses(chapter.status)}`}>
                            {chapter.statusLabel}
                          </span>
                          {chapter.lateApplication && (
                            <p className="mt-1 text-[11px] text-amber-700">
                              Hệ thống áp dụng trễ{chapter.appliedDelayMinutes ? ` ${chapter.appliedDelayMinutes} phút` : ''} so với giờ hẹn.
                            </p>
                          )}
                          {chapter.pendingOverdue && (
                            <p className="mt-1 text-[11px] font-semibold text-rose-700">
                              Quá hạn áp dụng{chapter.overdueMinutes ? ` ${chapter.overdueMinutes} phút` : ''}; scheduler chưa xử lý.
                            </p>
                          )}
                          {chapter.lastError && (
                            <p className="mt-1 text-[11px] text-rose-700">
                              Lỗi lần {chapter.applyAttempts || 1}: {chapter.lastError}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top text-slate-700">{formatDateTime(chapter.effectiveAt)}</td>
                        <td className="px-4 py-3 align-top text-slate-700">{formatDateTime(chapter.appliedAt)}</td>
                        <td className="px-4 py-3 align-top font-semibold text-[#172554]">{formatDateTime(chapter.actualTransferAt)}</td>
                        <td className="px-4 py-3 align-top text-slate-700">
                          {chapter.status !== 'NONE' && chapter.termNumber ? `Nhiệm kỳ ${chapter.termNumber}` : '—'}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <button
                            type="button"
                            onClick={() => void openHistory(chapter)}
                            className="rounded-lg border border-[#cbdbf5] bg-white px-3 py-1.5 text-xs font-semibold text-[#2563EB] transition hover:bg-[#eff4ff] active:scale-95"
                            aria-label={`Xem lịch sử chuyển giao của ${chapter.name}`}
                          >
                            Xem lịch sử
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!selected.chapters.length && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-sm text-[#737686]">
                          Không có chapter khớp bộ lọc hiện tại.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {pagination && pagination.total > 0 && (
                <div className="flex flex-col gap-3 border-t border-[#eff4ff] bg-[#f8f9ff] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-[#737686]">
                    Hiển thị {firstRow}–{lastRow} / {pagination.total} chapter · Trang {pagination.page}/{pagination.totalPages}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busy || pagination.page <= 1}
                      onClick={() => applyFilters({ page: pagination.page - 1 })}
                      className="rounded-lg border border-[#cbdbf5] bg-white px-3 py-1.5 text-xs font-semibold text-[#172554] transition hover:bg-[#eff4ff] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ← Trước
                    </button>
                    {pageNumbers(pagination.page, pagination.totalPages).map((page, index, list) => {
                      const previous = list[index - 1];
                      return (
                        <span key={page} className="flex items-center">
                          {previous && page - previous > 1 && <span className="px-1 text-[#737686]">...</span>}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => applyFilters({ page })}
                            aria-current={page === pagination.page ? 'page' : undefined}
                            className={`min-w-8 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                              page === pagination.page
                                ? 'bg-[#2563EB] text-white'
                                : 'border border-[#cbdbf5] bg-white text-[#172554] hover:bg-[#eff4ff]'
                            } disabled:cursor-not-allowed disabled:opacity-40`}
                          >
                            {page}
                          </button>
                        </span>
                      );
                    })}
                    <button
                      type="button"
                      disabled={busy || pagination.page >= pagination.totalPages}
                      onClick={() => applyFilters({ page: pagination.page + 1 })}
                      className="rounded-lg border border-[#cbdbf5] bg-white px-3 py-1.5 text-xs font-semibold text-[#172554] transition hover:bg-[#eff4ff] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Sau →
                    </button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {data?.generatedAt && (
        <p className="text-right text-xs text-[#737686]">Cập nhật lúc {formatDateTime(data.generatedAt)}</p>
      )}

      {historyChapter && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chapter-history-title"
          onClick={closeHistory}
        >
          <div
            className="w-full max-w-5xl rounded-2xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-3 border-b border-[#eff4ff] bg-gradient-to-r from-[#f8f9ff] via-white to-[#eff4ff] p-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 id="chapter-history-title" className="text-lg font-bold text-[#172554]">
                  Lịch sử chuyển giao · {historyChapter.name}
                </h2>
                <p className="mt-1 text-sm text-[#737686]">
                  Chỉ xem. Mọi thao tác đặt lịch, áp dụng hoặc hủy do Chapter Quản lý thực hiện.
                </p>
              </div>
              <button
                type="button"
                onClick={closeHistory}
                className="self-start rounded-xl border border-[#cbdbf5] bg-white px-3 py-1.5 text-sm font-semibold text-[#172554] transition hover:bg-[#eff4ff]"
                aria-label="Đóng lịch sử chuyển giao"
              >
                Đóng
              </button>
            </div>

            <div className="p-5">
              {historyLoading ? (
                <p className="text-sm text-[#737686]">Đang tải lịch sử chuyển giao…</p>
              ) : historyError ? (
                <div className="space-y-3">
                  <p role="status" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{historyError}</p>
                  <button
                    type="button"
                    onClick={() => void openHistory(historyChapter)}
                    className="rounded-xl border border-[#cbdbf5] bg-white px-4 py-2 text-sm font-semibold text-[#172554] transition hover:bg-[#eff4ff]"
                  >
                    Thử lại
                  </button>
                </div>
              ) : historyData ? (
                <>
                  <div className="flex flex-wrap gap-2 text-xs font-semibold">
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700 ring-1 ring-emerald-200">
                      Đã áp dụng {historyData.summary.appliedCount} lần
                    </span>
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800 ring-1 ring-amber-200">
                      Đang lên lịch {historyData.summary.scheduledCount}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600 ring-1 ring-slate-200">
                      Đã hủy {historyData.summary.cancelledCount}
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 text-[#172554] ring-1 ring-[#cbdbf5]">
                      Lần gần nhất {formatDateTime(historyData.summary.lastAppliedAt)}
                    </span>
                    {!historyData.chapter.active && (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600 ring-1 ring-slate-200">Chapter đã ngừng hoạt động</span>
                    )}
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[980px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                        <tr>
                          <th className="px-4 py-3 font-bold">Giai đoạn</th>
                          <th className="px-4 py-3 font-bold">Trạng thái</th>
                          <th className="px-4 py-3 font-bold">Có hiệu lực</th>
                          <th className="px-4 py-3 font-bold">Giờ hệ thống áp dụng</th>
                          <th className="px-4 py-3 font-bold">Thời gian chuyển giao thực tế</th>
                          <th className="px-4 py-3 font-bold">Nhiệm kỳ</th>
                          <th className="px-4 py-3 font-bold">Mùa</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {historyData.entries.map((entry) => (
                          <tr key={entry.id} className="hover:bg-slate-50/60">
                            <td className="px-4 py-3 align-top font-semibold text-[#172554]">{entry.windowLabel}</td>
                            <td className="px-4 py-3 align-top">
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${chapterStatusClasses(entry.status)}`}>
                                {entry.statusLabel}
                              </span>
                              {entry.lastError && (
                                <p className="mt-1 text-[11px] text-rose-700">
                                  Lỗi lần {entry.applyAttempts || 1}: {entry.lastError}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-3 align-top text-slate-700">{formatDateTime(entry.effectiveAt)}</td>
                            <td className="px-4 py-3 align-top text-slate-700">{formatDateTime(entry.appliedAt)}</td>
                            <td className="px-4 py-3 align-top font-semibold text-[#172554]">{formatDateTime(entry.actualTransferAt)}</td>
                            <td className="px-4 py-3 align-top text-slate-700">{entry.termNumber ? `Nhiệm kỳ ${entry.termNumber}` : '—'}</td>
                            <td className="px-4 py-3 align-top text-slate-700">{entry.seasonCode || '—'}</td>
                          </tr>
                        ))}
                        {!historyData.entries.length && (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center text-sm text-[#737686]">
                              Chapter này chưa có lần chuyển giao nào.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {historyData.entriesTruncated && (
                    <p className="mt-3 text-xs text-[#737686]">
                      Chỉ hiển thị 50 bản ghi gần nhất; số lần áp dụng ở trên là tổng toàn bộ lịch sử.
                    </p>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

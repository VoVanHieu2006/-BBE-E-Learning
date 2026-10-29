'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import { apiFetch, getCachedApiData } from '@/lib/api/client';

const PATH = '/api/v1/admin/transfer-seasons/progress';

type ChapterProgress = {
  id: string;
  name: string;
  active: boolean;
  status: 'APPLIED' | 'SCHEDULED' | 'NONE';
  statusLabel: string;
  effectiveAt: string | null;
  appliedAt: string | null;
  actualTransferAt: string | null;
  termNumber: number | null;
  batchCount: number;
  lateApplication: boolean;
};

type SeasonWindow = {
  key: string;
  window: { startsAt: string; endsAt: string; anchor: string; name: string; label: string };
  term: { startsAt: string; endsAt: string; label: string };
  status: string;
  statusLabel: string;
  message: string | null;
  seasons: Array<{
    id: string;
    code: string;
    startsAt: string;
    endsAt: string;
    rewardBoundaryAt: string | null;
    state: string;
    stateLabel: string;
  }>;
  counts: { chapters: number; transferred: number; scheduled: number; notTransferred: number };
  chapters: ChapterProgress[];
};

type ProgressPayload = {
  generatedAt: string;
  labels: Record<string, string>;
  items: SeasonWindow[];
};

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

function statusClasses(status: string): string {
  if (status === 'OK') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'SEASON_NOT_CONFIGURED') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-rose-50 text-rose-700 border-rose-200';
}

export default function TransferSeasonsProgressPage() {
  const [data, setData] = useState<ProgressPayload | null>(() => getCachedApiData<ProgressPayload>(PATH));
  const [loading, setLoading] = useState(!data);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const cached = getCachedApiData<ProgressPayload>(PATH);
    if (cached) setData(cached);
    void load(false);
    // The endpoint is tab-cached; a revisit renders the saved tab snapshot and
    // the manual refresh button is the only path that forces a new request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(noCache: boolean) {
    if (noCache) setRefreshing(true);
    else setLoading(!data);
    setMessage('');
    const response = await apiFetch<ProgressPayload>(PATH, { tabCache: true, noCache });
    if (response.ok && response.data) setData(response.data);
    else setMessage(response.error?.message || 'Không tải được tiến độ chuyển giao. Hãy thử lại.');
    setLoading(false);
    setRefreshing(false);
  }

  const items = data?.items || [];
  const readyWindows = items.filter((item) => item.status === 'OK').length;
  const transferred = items.reduce((sum, item) => sum + item.counts.transferred, 0);
  const scheduled = items.reduce((sum, item) => sum + item.counts.scheduled, 0);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Tiến độ chuyển giao nhiệm kỳ
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-[#737686]">
            Theo dõi từng giai đoạn chuyển giao, nhiệm kỳ tương ứng và chapter nào đã hoàn tất chuyển giao.
            Trang này chỉ để xem; mọi thay đổi cấu hình mùa vẫn thực hiện ở phần cấu hình học tập.
          </p>
        </div>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => load(true)}
          className="flex items-center gap-2 rounded-xl border border-[#cbdbf5] bg-white px-4 py-2 text-sm font-semibold text-[#172554] shadow-xs transition hover:bg-[#eff4ff] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          title="Tải lại dữ liệu mới nhất từ hệ thống"
        >
          <span className={refreshing ? 'inline-block animate-spin' : ''}>🔄</span>
          <span>{refreshing ? 'Đang làm mới...' : 'Làm mới'}</span>
        </button>
      </div>

      {message && <p role="status" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{message}</p>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card shadow="md" className="border border-[#eff4ff] p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#737686]">Giai đoạn đang theo dõi</p>
          <p className="mt-2 text-2xl font-bold text-[#172554]">{loading && !data ? '...' : items.length}</p>
        </Card>
        <Card shadow="md" className="border border-[#eff4ff] p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#737686]">Giai đoạn đã đủ cấu hình</p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{loading && !data ? '...' : readyWindows}</p>
        </Card>
        <Card shadow="md" className="border border-[#eff4ff] p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#737686]">Lượt chuyển giao đã áp dụng</p>
          <p className="mt-2 text-2xl font-bold text-[#2563EB]">{loading && !data ? '...' : transferred}</p>
        </Card>
        <Card shadow="md" className="border border-[#eff4ff] p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#737686]">Lượt đang chờ áp dụng</p>
          <p className="mt-2 text-2xl font-bold text-amber-700">{loading && !data ? '...' : scheduled}</p>
        </Card>
      </div>

      {loading && !data ? (
        <Card className="border border-[#eff4ff] p-6 text-sm text-[#737686]">Đang tải tiến độ chuyển giao…</Card>
      ) : !items.length ? (
        <Card className="border border-[#eff4ff] p-6">
          <h2 className="font-semibold text-[#172554]">Chưa có giai đoạn chuyển giao nào</h2>
          <p className="mt-1 text-sm text-[#737686]">
            Khi Admin tạo mùa chuyển giao hoặc khi một chapter được lên lịch chuyển giao, giai đoạn tương ứng sẽ xuất hiện ở đây.
          </p>
        </Card>
      ) : (
        <div className="space-y-5">
          {items.map((item) => (
            <Card key={item.key} shadow="md" className="overflow-hidden border border-[#eff4ff]">
              <div className="border-b border-[#eff4ff] bg-gradient-to-r from-[#f8f9ff] via-white to-[#eff4ff] p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold text-[#172554]">Giai đoạn {item.window.label}</h2>
                      <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusClasses(item.status)}`}>
                        {item.statusLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[#737686]">
                      Mốc thưởng {formatDate(item.window.anchor)} · Nhiệm kỳ {item.term.label}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-semibold">
                    <span className="rounded-full bg-white px-3 py-1 text-[#172554] ring-1 ring-[#cbdbf5]">
                      {item.counts.transferred}/{item.counts.chapters} đã chuyển giao
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 text-amber-800 ring-1 ring-amber-200">
                      {item.counts.scheduled} đang chờ
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 text-slate-600 ring-1 ring-slate-200">
                      {item.counts.notTransferred} chưa chuyển giao
                    </span>
                  </div>
                </div>
                {item.message && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{item.message}</p>}
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-[#737686]">
                  {item.seasons.length ? item.seasons.map((season) => (
                    <span key={season.id} className="rounded-lg border border-[#cbdbf5] bg-white px-3 py-1.5">
                      {season.rewardBoundaryAt ? `Mùa thưởng ${formatDate(season.rewardBoundaryAt)}` : 'Mùa chuyển giao'} · {season.stateLabel} · {formatDate(season.startsAt)} – {formatInclusiveEnd(season.endsAt)}
                    </span>
                  )) : <span className="rounded-lg border border-[#cbdbf5] bg-white px-3 py-1.5">Chưa có mùa chuyển giao cho giai đoạn này</span>}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-4 py-3 font-bold">Chapter</th>
                      <th className="px-4 py-3 font-bold">Trạng thái</th>
                      <th className="px-4 py-3 font-bold">Có hiệu lực</th>
                      <th className="px-4 py-3 font-bold">Giờ hệ thống áp dụng</th>
                      <th className="px-4 py-3 font-bold">Thời gian chuyển giao thực tế</th>
                      <th className="px-4 py-3 font-bold">Nhiệm kỳ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {item.chapters.map((chapter) => (
                      <tr key={chapter.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3 font-semibold text-[#172554]">
                          {chapter.name}
                          {!chapter.active && <span className="ml-2 text-[11px] font-normal text-slate-500">(đã ngừng hoạt động)</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            chapter.status === 'APPLIED'
                              ? 'bg-emerald-50 text-emerald-700'
                              : chapter.status === 'SCHEDULED'
                                ? 'bg-amber-50 text-amber-800'
                                : 'bg-slate-100 text-slate-600'
                          }`}>
                            {chapter.statusLabel}
                          </span>
                          {chapter.lateApplication && (
                            <p className="mt-1 text-[11px] text-amber-700">Hệ thống áp dụng trễ so với giờ hẹn.</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{formatDateTime(chapter.effectiveAt)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatDateTime(chapter.appliedAt)}</td>
                        <td className="px-4 py-3 font-semibold text-[#172554]">{formatDateTime(chapter.actualTransferAt)}</td>
                        <td className="px-4 py-3 text-slate-700">{chapter.status !== 'NONE' && chapter.termNumber ? `Nhiệm kỳ ${chapter.termNumber}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}

      {data?.generatedAt && (
        <p className="text-right text-xs text-[#737686]">Cập nhật lúc {formatDateTime(data.generatedAt)}</p>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import {
  STAR_SOURCE_FILTER_OPTIONS,
  buildAdminStarHistoryUrl,
  isStaleStarHistoryResponse,
  starHistoryEmptyMessage,
  type AdminStarSourceFilter,
  type StarHistoryRowInput,
} from '@/lib/admin-star-history-ui';
import StarHistoryRow from '@/components/learner/StarHistoryRow';

interface StarEntry extends StarHistoryRowInput {
  id: string;
  source_type: string;
}

interface AdminStarHistoryData {
  balance: number;
  ledgerTotal: number;
  filteredTotal: number;
  availableMonths: Array<{ key: string; label: string }>;
  items: StarEntry[];
  page: number;
  totalItems: number;
  totalPages: number;
}

const PAGE_SIZE = 20;
const fmt = (n: number) => n.toLocaleString('vi-VN');

export default function AdminStarHistoryPanel({
  userId,
  userDisplayName,
  active,
}: {
  userId: string;
  userDisplayName?: string;
  active: boolean;
}) {
  const [page, setPage] = useState(1);
  const [month, setMonth] = useState('');
  const [source, setSource] = useState<AdminStarSourceFilter>('ALL');
  const [data, setData] = useState<AdminStarHistoryData | null>(null);
  const [dataFilterKey, setDataFilterKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const requestSeqRef = useRef(0);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  useEffect(() => {
    requestSeqRef.current += 1;
    setPage(1);
    setMonth('');
    setSource('ALL');
    setData(null);
    setDataFilterKey('');
    setError('');
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!active || !userId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const seq = ++requestSeqRef.current;
    const requestedUserId = userId;
    const isStale = () => isStaleStarHistoryResponse(seq, requestSeqRef.current, requestedUserId, userIdRef.current);
    setLoading(true);
    setError('');
    apiFetch<AdminStarHistoryData>(
      buildAdminStarHistoryUrl(requestedUserId, { page, limit: PAGE_SIZE, month, source }),
      { noCache: true, signal: controller.signal },
    )
      .then((res) => {
        if (isStale()) return;
        if (!res.ok || !res.data) {
          setError(res.error?.message || 'Không thể tải lịch sử nhận sao lúc này.');
          return;
        }
        setData(res.data);
        setDataFilterKey(`${month}|${source}`);
      })
      .catch(() => {
        if (!isStale()) setError('Không thể kết nối để tải lịch sử nhận sao.');
      })
      .finally(() => {
        if (!isStale()) setLoading(false);
      });
    return () => {
      requestSeqRef.current += 1;
      controller.abort();
    };
  }, [active, userId, page, month, source, reloadTick]);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);
  const hasActiveFilter = month !== '' || source !== 'ALL';
  const clearFilters = () => {
    setMonth('');
    setSource('ALL');
    setPage(1);
  };

  const view = data && dataFilterKey === `${month}|${source}` ? data : null;
  const items = view?.items ?? [];
  const empty = starHistoryEmptyMessage(hasActiveFilter);
  const refreshing = loading && data !== null;

  return (
    <div className="p-5 space-y-4" aria-label={userDisplayName ? `Lịch sử nhận sao của ${userDisplayName}` : 'Lịch sử nhận sao'}>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-stretch">
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 px-4 py-3">
          <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider block">Số dư hiện tại</span>
          <div className="text-xl font-extrabold text-amber-600">
            {data ? fmt(data.balance) : '—'} <span className="text-sm font-semibold text-amber-700">sao</span>
          </div>
          {data && data.ledgerTotal !== data.balance && (
            <span className="text-[11px] text-slate-500">Tổng sổ cái lịch sử: {fmt(data.ledgerTotal)} sao</span>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <span className="text-[11px] font-bold text-[#6c6f7f] uppercase tracking-wider block">Tổng sao theo bộ lọc</span>
          <div className="text-xl font-extrabold text-[#172554]">
            {view ? fmt(view.filteredTotal) : '—'} <span className="text-sm font-semibold text-slate-500">sao</span>
          </div>
          {view && <span className="text-[11px] text-slate-500">{fmt(view.totalItems)} lượt nhận</span>}
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-blue-600 rounded-2xl bg-slate-100 hover:bg-slate-200 transition disabled:opacity-60 flex items-center justify-center gap-1.5"
        >
          <span className={refreshing ? 'inline-block animate-spin' : 'inline-block'}>🔄</span> Tải lại
        </button>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-end gap-3">
        <label className="block">
          <span className="text-[11px] font-bold text-[#6c6f7f] uppercase tracking-wider block mb-1">Tháng</span>
          <select
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setPage(1);
            }}
            className="w-full lg:w-52 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#172554] focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Tất cả các tháng</option>
            {(data?.availableMonths ?? []).map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </label>
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-bold text-[#6c6f7f] uppercase tracking-wider block mb-1">Nguồn nhận sao</span>
          <div className="flex flex-wrap gap-1.5">
            {STAR_SOURCE_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setSource(opt.value);
                  setPage(1);
                }}
                aria-pressed={source === opt.value}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                  source === opt.value
                    ? 'bg-blue-600 text-white font-bold shadow-2xs'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {hasActiveFilter && (
          <button type="button" onClick={clearFilters} className="text-xs font-bold text-blue-600 hover:underline self-start lg:self-end py-2">
            Xóa bộ lọc
          </button>
        )}
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-xs font-semibold text-red-700">{error}</p>
          <button type="button" onClick={reload} className="mt-3 px-4 py-1.5 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition">
            Thử tải lại
          </button>
        </div>
      ) : !view ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-2xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
          <p className="text-sm font-bold text-[#172554]">{empty.title}</p>
          <p className="text-xs text-slate-500 mt-1">{empty.subtitle}</p>
        </div>
      ) : (
        <ul className={`space-y-2 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          {items.map((entry) => (
            <StarHistoryRow key={entry.id} entry={entry} className="rounded-2xl border border-slate-200 bg-white px-4 py-3" />
          ))}
        </ul>
      )}

      {view && view.totalPages > 1 && !error && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-slate-500 font-medium">Trang {view.page} / {view.totalPages}</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={loading || view.page <= 1}
              onClick={() => setPage(Math.max(1, view.page - 1))}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Trước
            </button>
            <button
              type="button"
              disabled={loading || view.page >= view.totalPages}
              onClick={() => setPage(view.page + 1)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Tiếp
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

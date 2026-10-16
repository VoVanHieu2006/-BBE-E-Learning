'use client';

import { useState, useEffect, FormEvent } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { apiFetch } from '@/lib/api/client';

export default function ChapterManagerTermTransitionPage() {
  const [user, setUser] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [rosterUrl, setRosterUrl] = useState('');
  const [effectiveAt, setEffectiveAt] = useState('');
  const [rosterPreview, setRosterPreview] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      try {
        const u = JSON.parse(localStorage.getItem('user') || 'null');
        setUser(u);
      } catch {}
    }
  }, []);

  const chapterId = user?.chapterId;

  const previewRoster = async (event: FormEvent) => {
    event.preventDefault();
    if (!chapterId || !rosterUrl.trim()) return;
    setBusy(true);
    setMessage(null);

    const result = await apiFetch(`/api/v1/chapters/${chapterId}/reorganizations/parse-sheet`, {
      method: 'POST',
      noCache: true,
      body: JSON.stringify({ url: rosterUrl.trim() }),
    });

    setBusy(false);
    if (!result.ok) {
      setRosterPreview(null);
      setMessage({ type: 'error', text: result.error?.message || 'Không đọc được danh sách phân ban từ Google Sheet.' });
      return;
    }
    setRosterPreview(result.data);
  };

  const scheduleRoster = async () => {
    if (!chapterId || !rosterPreview?.valid || !effectiveAt) return;
    setBusy(true);
    setMessage(null);

    const result = await apiFetch(`/api/v1/chapters/${chapterId}/reorganizations`, {
      method: 'POST',
      noCache: true,
      body: JSON.stringify({
        sourceUrl: rosterUrl,
        effectiveAt: new Date(effectiveAt).toISOString(),
        items: rosterPreview.items.map((item: any) => ({
          userId: item.userId,
          displayName: item.displayName,
          departmentUnitId: item.departmentUnitId,
          positionId: item.positionId,
          isPrimary: item.isLead,
        })),
      }),
    });

    setBusy(false);
    if (!result.ok) {
      setMessage({ type: 'error', text: result.error?.message || 'Không thể lên lịch phân ban chuyển giao nhiệm kỳ.' });
      return;
    }

    setMessage({
      type: 'success',
      text: 'Đã lên lịch đổi Ban, LT và tên hiển thị thành công. Hệ thống sẽ áp dụng đúng ngày hiệu lực.',
    });
    setRosterPreview(null);
    setRosterUrl('');
    setEffectiveAt('');
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
          Chuyển giao nhiệm kỳ Chapter
        </h1>
        <p className="text-[#737686] mt-1 text-sm">
          Chapter: <span suppressHydrationWarning className="font-semibold text-[#172554]">{mounted && user?.chapterName ? user.chapterName : 'Chapter của bạn'}</span> • Phân Ban cuối nhiệm kỳ từ Google Sheet
        </p>
      </div>

      {message && (
        <div
          role="status"
          className={`rounded-2xl border px-5 py-4 text-sm font-medium ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-red-50 text-red-800 border-red-200'
          }`}
        >
          {message.type === 'success' ? '✓ ' : '⚠️ '}
          {message.text}
        </div>
      )}

      {/* Card: Nhập Google Sheet */}
      <Card shadow="md" className="space-y-5 border border-[#eff4ff] p-6">
        <div>
          <h2 className="text-lg font-bold text-[#172554]">Phân Ban cuối nhiệm kỳ từ Google Sheet</h2>
          <p className="mt-1 text-xs text-[#737686] leading-relaxed">
            Tên cột trong sheet phải trùng với tên Ban trong Chapter (ví dụ: Ban Chủ tịch, Ban Nội dung, Ban Khách mời...).
            Mỗi ô dùng định dạng <strong>Họ tên (email@domain.com)</strong>. Người đầu tiên trong mỗi cột được tự động gán vai trò LT (Trưởng ban).
            Hệ thống sẽ đối chiếu tài khoản qua email trước khi cho phép xác nhận.
          </p>
        </div>

        <form onSubmit={previewRoster} className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <input
            required
            type="url"
            value={rosterUrl}
            onChange={(event) => setRosterUrl(event.target.value)}
            placeholder="Dán link Google Sheet danh sách cuối nhiệm kỳ..."
            className="w-full rounded-xl border border-[#cbdbf5] px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          />
          <Button type="submit" loading={busy} loadingText="Đang đọc...">
            Đọc và kiểm tra
          </Button>
        </form>

        {rosterPreview && (
          <div className="space-y-4 pt-2">
            <div
              className={`rounded-xl px-4 py-3 text-sm font-semibold ${
                rosterPreview.valid
                  ? 'bg-green-50 text-green-800 border border-green-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}
            >
              {rosterPreview.valid
                ? `✓ Hợp lệ: ${rosterPreview.summary?.members || 0} thành viên, ${rosterPreview.summary?.leads || 0} LT.`
                : `⚠️ Cần sửa ${rosterPreview.errors?.length || 0} lỗi trước khi có thể xác nhận.`}
            </div>

            {rosterPreview.errors?.length > 0 && (
              <details className="rounded-xl border border-red-200 bg-red-50/50 p-4" open>
                <summary className="cursor-pointer text-sm font-bold text-red-700">
                  Xem danh sách {rosterPreview.errors.length} lỗi đối chiếu
                </summary>
                <ul className="mt-3 space-y-1.5 text-xs text-red-700 list-disc list-inside">
                  {rosterPreview.errors.map((error: any, index: number) => (
                    <li key={index}>
                      Dòng {error.row}, Cột {error.column}: <strong>{error.message}</strong> ({error.value})
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <details className="rounded-xl border border-[#eff4ff] bg-slate-50/50 p-4" open>
              <summary className="cursor-pointer text-sm font-bold text-[#172554]">
                Xem trước danh sách theo Ban ({rosterPreview.items?.length || 0} nhân sự)
              </summary>
              <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-[#eff4ff] bg-white rounded-xl border border-[#eff4ff]">
                {rosterPreview.items?.map((item: any, index: number) => (
                  <div key={index} className="flex justify-between items-center gap-3 px-4 py-2.5 text-xs">
                    <div>
                      <span className="font-semibold text-[#172554]">{item.displayName}</span>
                      <span className="text-[#737686] ml-2">({item.email})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                        {item.departmentName}
                      </span>
                      {item.isLead && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">
                          LT
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </details>

            <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 pt-2 border-t border-[#eff4ff]">
              <div>
                <label className="block text-xs font-semibold text-[#172554] mb-1">
                  Ngày giờ bắt đầu có hiệu lực nhiệm kỳ mới *
                </label>
                <input
                  required
                  type="datetime-local"
                  value={effectiveAt}
                  onChange={(event) => setEffectiveAt(event.target.value)}
                  className="rounded-xl border border-[#cbdbf5] px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              </div>
              <Button
                type="button"
                disabled={!rosterPreview.valid || !effectiveAt || busy}
                loading={busy}
                onClick={() => void scheduleRoster()}
              >
                Xác nhận và lên lịch
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

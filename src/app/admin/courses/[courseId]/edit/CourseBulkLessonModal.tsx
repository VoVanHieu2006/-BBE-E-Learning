'use client';
import { useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { apiFetch } from '@/lib/api/client';
import {
  MAX_BULK_LESSONS,
  lessonTitleFromVideo,
  parseBulkYoutubeLinks,
  type BulkLinkLine,
} from '@/lib/bulk-lesson-links';
import { normalizeDurationSeconds } from '@/lib/validation/duration';
import type { CourseEditorState } from './useCourseEditor';

type Props = Pick<CourseEditorState,
  'bulkLessonSessionId' |
  'bulkLessonSaving' |
  'closeBulkLessonModal' |
  'existingYoutubeVideoIds' |
  'handleBulkCreateLessons'
>;

type Lookup =
  | { state: 'loading' }
  | { state: 'ready'; title: string; durationSeconds: number }
  | { state: 'failed'; message: string };

type PreviewRow = BulkLinkLine & { lookup?: Lookup };

const CONCURRENCY = 3;

function formatSeconds(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

const SKIP_LABEL: Record<string, string> = {
  invalid: 'Không phải link/ID YouTube hợp lệ',
  duplicate_in_list: 'Trùng với dòng phía trên',
  duplicate_existing: 'Đã có trong khóa học',
};

export default function CourseBulkLessonModal({
  bulkLessonSessionId,
  bulkLessonSaving,
  closeBulkLessonModal,
  existingYoutubeVideoIds,
  handleBulkCreateLessons,
}: Props) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [inputError, setInputError] = useState('');
  const runRef = useRef(0);

  // Mở/đóng modal -> xóa sạch trạng thái và hủy mọi lượt kiểm tra đang chạy dở.
  useEffect(() => {
    runRef.current++;
    setText('');
    setRows(null);
    setChecking(false);
    setInputError('');
  }, [bulkLessonSessionId]);

  const handleTextChange = (value: string) => {
    runRef.current++;
    setText(value);
    setRows(null);
    setChecking(false);
    setInputError('');
  };

  const handleCheck = async () => {
    const parsed = parseBulkYoutubeLinks(text, existingYoutubeVideoIds);
    if (parsed.length === 0) { setInputError('Hãy dán ít nhất một link YouTube (mỗi link một dòng).'); return; }
    if (parsed.length > MAX_BULK_LESSONS) { setInputError(`Tối đa ${MAX_BULK_LESSONS} link mỗi lần (đang có ${parsed.length}).`); return; }

    const run = ++runRef.current;
    const initial: PreviewRow[] = parsed.map((r) => (r.status === 'ok' ? { ...r, lookup: { state: 'loading' } } : r));
    setRows(initial);
    setChecking(true);

    const update = (index: number, lookup: Lookup) => {
      if (runRef.current !== run) return;
      setRows((prev) => (prev ? prev.map((r, i) => (i === index ? { ...r, lookup } : r)) : prev));
    };

    const queue = initial.map((r, i) => ({ r, i })).filter(({ r }) => r.status === 'ok');
    const worker = async () => {
      while (queue.length > 0 && runRef.current === run) {
        const { r, i } = queue.shift()!;
        try {
          const res = await apiFetch(`/api/v1/youtube/info?videoId=${r.videoId}`, { noCache: true });
          if (!res.ok || !res.data) {
            update(i, { state: 'failed', message: res.error?.message || 'Không kiểm tra được video' });
            continue;
          }
          const duration = res.data.durationKnown === true ? normalizeDurationSeconds(res.data.durationSeconds) : null;
          if (duration === null) {
            update(i, { state: 'failed', message: 'Không xác định được thời lượng (livestream hoặc YouTube chặn) — thêm riêng bằng nút "Thêm bài học"' });
          } else {
            update(i, { state: 'ready', title: lessonTitleFromVideo(res.data.title), durationSeconds: duration });
          }
        } catch {
          update(i, { state: 'failed', message: 'Lỗi kết nối khi kiểm tra video' });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (runRef.current === run) setChecking(false);
  };

  const readyRows = (rows || []).filter((r) => r.lookup?.state === 'ready');
  const skippedCount = (rows || []).length - readyRows.length;

  const handleCreate = async () => {
    const items = readyRows.map((r) => {
      const l = r.lookup as Extract<Lookup, { state: 'ready' }>;
      return { youtubeVideoId: r.videoId, title: l.title, durationSeconds: l.durationSeconds };
    });
    await handleBulkCreateLessons(items);
  };

  return (
    <Modal isOpen={Boolean(bulkLessonSessionId)} onClose={closeBulkLessonModal} maxWidth="max-w-3xl">
      <div className="p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center border-b border-[#eff4ff] pb-3">
          <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Thêm bài học hàng loạt
          </h3>
          <button
            onClick={closeBulkLessonModal}
            disabled={bulkLessonSaving}
            className="text-[#737686] hover:text-[#172554] text-xl font-bold p-1 rounded-lg hover:bg-slate-100 transition disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <div>
          <label className="block text-sm font-semibold text-[#172554] mb-1">
            Dán các link YouTube — mỗi link một dòng
          </label>
          <textarea
            rows={7}
            value={text}
            disabled={bulkLessonSaving}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder={'https://www.youtube.com/watch?v=...\nhttps://youtu.be/...\ndQw4w9WgXcQ'}
            className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          />
          <p className="text-xs text-[#737686] mt-1">
            Bài học được tạo theo đúng thứ tự dòng, tên bài lấy từ tên video, nối tiếp cuối buổi học. Tối đa {MAX_BULK_LESSONS} link mỗi lần.
          </p>
          {inputError && <p className="text-xs text-red-600 mt-1.5 font-medium">⚠️ {inputError}</p>}
        </div>

        {rows && (
          <div className="border border-[#cbdbf5] rounded-2xl overflow-hidden">
            <div className="px-4 py-2.5 bg-[#f8f9ff] text-xs font-semibold text-[#172554] flex justify-between">
              <span>
                {checking
                  ? `Đang kiểm tra video... (${readyRows.length + (rows.filter((r) => r.lookup?.state === 'failed').length)}/${rows.filter((r) => r.status === 'ok').length})`
                  : `${readyRows.length} bài sẽ được tạo${skippedCount > 0 ? ` · ${skippedCount} dòng bị bỏ qua` : ''}`}
              </span>
            </div>
            <ul className="divide-y divide-[#eff4ff] max-h-80 overflow-y-auto">
              {rows.map((r, idx) => {
                const ready = r.lookup?.state === 'ready' ? r.lookup : null;
                const failed = r.lookup?.state === 'failed' ? r.lookup : null;
                const skipReason = r.status !== 'ok' ? SKIP_LABEL[r.status] : failed?.message;
                const order = ready ? readyRows.indexOf(r) + 1 : null;
                return (
                  <li key={`${r.line}-${idx}`} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                    <span className={`w-7 shrink-0 text-xs font-bold pt-0.5 ${ready ? 'text-[#2563EB]' : 'text-slate-300'}`}>
                      {order ?? '—'}
                    </span>
                    <div className="min-w-0 flex-1">
                      {ready ? (
                        <>
                          <p className="font-semibold text-[#172554] truncate">{ready.title}</p>
                          <p className="text-xs text-emerald-700">✓ {formatSeconds(ready.durationSeconds)}</p>
                        </>
                      ) : r.lookup?.state === 'loading' ? (
                        <p className="text-xs text-[#2563EB]">⏳ Đang kiểm tra… <span className="text-slate-400">{r.raw}</span></p>
                      ) : (
                        <>
                          <p className="text-xs text-slate-500 truncate">Dòng {r.line}: {r.raw}</p>
                          <p className="text-xs text-red-600 font-medium">Bỏ qua — {skipReason}</p>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-3 border-t border-[#eff4ff]">
          <Button variant="outline" onClick={closeBulkLessonModal} disabled={bulkLessonSaving}>
            Hủy
          </Button>
          {!rows || checking ? (
            <Button loading={checking} loadingText="Đang kiểm tra..." disabled={!text.trim()} onClick={handleCheck}>
              Kiểm tra link
            </Button>
          ) : (
            <Button
              loading={bulkLessonSaving}
              loadingText="Đang tạo..."
              disabled={readyRows.length === 0}
              onClick={handleCreate}
            >
              {`Tạo ${readyRows.length} bài học`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

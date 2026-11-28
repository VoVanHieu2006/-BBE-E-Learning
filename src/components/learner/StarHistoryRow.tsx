import { formatStarHistoryRow, type StarHistoryKind, type StarHistoryRowInput } from '@/lib/admin-star-history-ui';

const BADGE_CLASS: Record<StarHistoryKind, string> = {
  VIDEO: 'bg-sky-50 text-sky-800 border-sky-200',
  LESSON_QUIZ: 'bg-violet-50 text-violet-800 border-violet-200',
  COURSE_FINAL: 'bg-amber-50 text-amber-800 border-amber-200',
  OTHER: 'bg-slate-50 text-slate-600 border-slate-200',
};

const AMOUNT_CLASS = { positive: 'text-emerald-600', negative: 'text-rose-600', zero: 'text-slate-500' } as const;

/** One Star history entry: title on line 1; type badge, course, "X/Y câu" and VN time on line 2; amount on the right. */
export default function StarHistoryRow({ entry, className = '' }: { entry: StarHistoryRowInput; className?: string }) {
  const row = formatStarHistoryRow(entry);
  return (
    <li className={`flex items-center gap-3 ${className}`}>
      <span
        aria-hidden="true"
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base ${row.amountTone === 'positive' ? 'bg-amber-100' : 'bg-slate-100'}`}
      >
        {row.amountTone === 'negative' ? '↩' : '⭐'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-[#172554]" title={row.title}>{row.title}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden text-[11px] text-slate-500">
          <span className={`shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 font-bold ${BADGE_CLASS[row.kind]}`}>{row.badge}</span>
          {row.courseTitle && <span className="min-w-0 truncate font-medium text-slate-600" title={row.courseTitle}>{row.courseTitle}</span>}
          {row.scoreLabel && (
            <span className="shrink-0 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-bold tabular-nums text-emerald-800">{row.scoreLabel}</span>
          )}
          <span className="shrink-0 whitespace-nowrap tabular-nums">{row.timeLabel}</span>
        </div>
      </div>
      <span className={`shrink-0 text-sm font-extrabold tabular-nums ${AMOUNT_CLASS[row.amountTone]}`}>{row.amountLabel}</span>
    </li>
  );
}

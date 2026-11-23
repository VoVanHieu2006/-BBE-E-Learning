import type { ChapterEligibilityCondition } from '@/lib/competition-ranking-rules'

const labels = { MEMBER_COUNT: 'Quân số bình quân kỳ', CORE_COMPLETION: 'Thành viên đạt ≥70% bài lõi', KPI: 'KPI' }
const requirements = { MEMBER_COUNT: 'cần trên 20 người', CORE_COMPLETION: 'cần ít nhất 50%', KPI: 'cần Vàng hoặc Xanh' }
const marks = {
  PASS: { icon: '✓', label: 'Đạt', className: 'text-green-700' },
  FAIL: { icon: '✗', label: 'Chưa đạt', className: 'text-red-600' },
  MISSING_DATA: { icon: '•', label: 'Thiếu dữ liệu', className: 'text-slate-500' },
}
const missingReasons: Record<string, string> = {
  ROSTER_ZERO: 'Quân số kỳ bằng 0', CORE_LESSONS_ZERO: 'Chưa có mẫu số bài lõi đã xuất bản',
  WAITING_KPI: 'Chưa có KPI', SNAPSHOT_CONDITIONS_MISSING: 'Snapshot chưa lưu chỉ số điều kiện',
}
const kpiNames: Record<string, string> = { GREEN: 'Xanh', YELLOW: 'Vàng', RED: 'Đỏ', BLACK: 'Đen' }

function formatValue(condition: ChapterEligibilityCondition) {
  if (condition.value === null || condition.value === undefined) return null
  if (condition.kind === 'CORE_COMPLETION') return `${(Number(condition.value) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`
  if (condition.kind === 'KPI') return kpiNames[String(condition.value)] || String(condition.value)
  return Number(condition.value).toLocaleString('vi-VN', { maximumFractionDigits: 1 })
}

function formatTime(value: string | Date) {
  return new Date(value).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function ChapterConditions({ chapter }: { chapter: any }) {
  const conditions: ChapterEligibilityCondition[] = chapter.conditions || [
    { kind: 'MEMBER_COUNT', threshold: 20, operator: 'GT' },
    { kind: 'CORE_COMPLETION', threshold: 0.5, operator: 'GTE' },
    { kind: 'KPI', threshold: ['YELLOW', 'GREEN'], operator: 'IN' },
  ].map(c => ({ ...c, value: null, state: 'MISSING_DATA', reasonCode: 'SNAPSHOT_CONDITIONS_MISSING' })) as ChapterEligibilityCondition[]
  const asOf = chapter.dataAsOf || chapter.rosterAsOf
  return <div className="space-y-1 text-xs text-slate-600">
    <p>Học viên hiện tại: {chapter.currentRosterCount ?? 'Chưa có dữ liệu'}</p>
    <ul className="space-y-0.5">
      {conditions.map(condition => {
        const mark = marks[condition.state]
        const missing = condition.reasonCode ? missingReasons[condition.reasonCode] : null
        return <li key={condition.kind} className="flex gap-1.5">
          <span className={`font-bold ${mark.className}`} title={mark.label} aria-label={mark.label}>{mark.icon}</span>
          <span>
            {labels[condition.kind]}: <strong className={mark.className}>{missing || formatValue(condition) || '—'}</strong>
            {condition.state !== 'PASS' && <span className="text-slate-500"> ({requirements[condition.kind]})</span>}
          </span>
        </li>
      })}
    </ul>
    {asOf && <p className="text-[11px] text-slate-400">Số liệu lúc {formatTime(asOf)}</p>}
  </div>
}

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

const exclusionTexts: Record<string, string> = {
  ...missingReasons,
  MEMBER_COUNT_NOT_ABOVE_20: 'Quân số bình quân chưa trên 20 người', CORE_COMPLETION_BELOW_50_PERCENT: 'Dưới 50% thành viên đạt ≥70% bài lõi',
  KPI_NOT_ELIGIBLE: 'KPI chưa đạt Vàng hoặc Xanh', NO_ELIGIBLE_CLOSED_MONTH: 'Chưa có tháng đã chốt nào đủ điều kiện',
  SNAPSHOT_MISSING: 'Chưa có snapshot kết quả tháng', SNAPSHOT_DATA_MISSING: 'Snapshot thiếu dữ liệu',
  TERM_NOT_STARTED: 'Nhiệm kỳ chưa bắt đầu', SEASON_BOUNDARY_MISSING: 'Chưa cấu hình mốc nhiệm kỳ', MONTH_NOT_CONFIGURED: 'Tháng thi đua chưa được cấu hình',
}

// Round away from the threshold so the shown number never contradicts the PASS/FAIL decision.
function oneDecimal(value: number, mode: 'floor' | 'ceil' | 'round') {
  return (Math[mode](Math.round(value * 1e7) / 1e6) / 10).toLocaleString('vi-VN', { maximumFractionDigits: 1 })
}

function formatValue(condition: ChapterEligibilityCondition) {
  if (condition.value === null || condition.value === undefined) return null
  if (condition.kind === 'CORE_COMPLETION') return `${oneDecimal(Number(condition.value) * 100, condition.state === 'FAIL' ? 'floor' : 'round')}%`
  if (condition.kind === 'KPI') return kpiNames[String(condition.value)] || String(condition.value)
  return oneDecimal(Number(condition.value), condition.state === 'PASS' ? 'ceil' : 'round')
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
  const reasons: string[] = chapter.conditions ? [] : chapter.exclusionReasons || []
  if (reasons.length > 0) return <ul className="space-y-0.5 text-xs text-slate-600">
    {reasons.map(reason => <li key={reason} className="flex gap-1.5">
      <span className="font-bold text-red-600" aria-hidden="true">✗</span>
      <span>{exclusionTexts[reason] || 'Chưa đủ dữ liệu để xếp hạng'}</span>
    </li>)}
  </ul>
  return <div className="space-y-1 text-xs text-slate-600">
    {chapter.currentRosterCount != null && <p>Học viên hiện tại: {chapter.currentRosterCount}</p>}
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

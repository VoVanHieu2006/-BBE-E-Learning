import type { ChapterEligibilityCondition } from '@/lib/competition-ranking-rules'

const labels = { MEMBER_COUNT: 'Quân số bình quân kỳ', CORE_COMPLETION: 'Thành viên đạt ≥70% bài lõi', KPI: 'KPI' }
const states = { PASS: 'Đạt', FAIL: 'Chưa đạt', MISSING_DATA: 'Thiếu dữ liệu' }
const reasons: Record<string, string> = {
  ROSTER_ZERO: 'Quân số kỳ bằng 0', CORE_LESSONS_ZERO: 'Chưa có mẫu số bài lõi đã xuất bản',
  MEMBER_COUNT_NOT_ABOVE_20: 'Cần trên 20 người', CORE_COMPLETION_BELOW_50_PERCENT: 'Cần ít nhất 50%',
  WAITING_KPI: 'Chưa có KPI', KPI_NOT_ELIGIBLE: 'KPI phải Vàng/Xanh', SNAPSHOT_CONDITIONS_MISSING: 'Snapshot chưa lưu chỉ số điều kiện',
}

export default function ChapterConditions({ chapter }: { chapter: any }) {
  const conditions: ChapterEligibilityCondition[] = chapter.conditions || [
    { kind: 'MEMBER_COUNT', threshold: 20, operator: 'GT' },
    { kind: 'CORE_COMPLETION', threshold: 0.5, operator: 'GTE' },
    { kind: 'KPI', threshold: ['YELLOW', 'GREEN'], operator: 'IN' },
  ].map(c => ({ ...c, value: null, state: 'MISSING_DATA', reasonCode: 'SNAPSHOT_CONDITIONS_MISSING' })) as ChapterEligibilityCondition[]
  return <div className="space-y-1 text-xs text-slate-600">
    <p>Học viên hiện tại: {chapter.currentRosterCount ?? 'Chưa có dữ liệu'}{chapter.rosterAsOf ? ` · ${new Date(chapter.rosterAsOf).toLocaleString('vi-VN')}` : ''}</p>
    {chapter.dataAsOf && <p>Dữ liệu kỳ tại: {new Date(chapter.dataAsOf).toLocaleString('vi-VN')}</p>}
    {conditions.map(condition => <p key={condition.kind}>
      {labels[condition.kind]}: <strong>{condition.value === null ? '—' : condition.kind === 'CORE_COMPLETION' ? `${Number(condition.value) * 100}%` : condition.value}</strong>
      {' · '}{condition.kind === 'MEMBER_COUNT' ? '>20 người' : condition.kind === 'CORE_COMPLETION' ? '≥50%' : 'Vàng/Xanh'}
      {' · '}{states[condition.state]}{condition.reasonCode ? ` · ${reasons[condition.reasonCode] || condition.reasonCode}` : ''}
    </p>)}
  </div>
}

'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import { formatEmailQuotaLine } from '@/lib/email-quota-core'

export interface EmailQuotaState {
  limit: number
  used: number
  remaining: number
  resetsAt: string
}

/** Tải hạn mức email còn lại; tải lại mỗi khi `refreshKey` đổi (ví dụ sau khi gửi lời mời). Lỗi thì trả null. */
export function useEmailQuota(refreshKey: string | number = 0): EmailQuotaState | null {
  const [quota, setQuota] = useState<EmailQuotaState | null>(null)
  useEffect(() => {
    let cancelled = false
    apiFetch('/api/v1/invitations/email-quota', { noCache: true })
      .then((res) => {
        if (!cancelled && res.ok && typeof res.data?.remaining === 'number') setQuota(res.data as EmailQuotaState)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [refreshKey])
  return quota
}

/** Dòng "Còn X/90 email hôm nay, làm mới lúc 7h sáng ngày mai (giờ Việt Nam)." */
export default function EmailQuotaNotice({ quota, refreshKey, className = '', lowHint = ' Lời mời mới sẽ dùng link mời thay cho email.' }: { quota?: EmailQuotaState | null; refreshKey?: string | number; className?: string; lowHint?: string }) {
  const own = useEmailQuota(refreshKey)
  const info = quota === undefined ? own : quota
  if (!info) return null
  const low = info.remaining <= 0
  return (
    <p data-testid="email-quota-notice" className={`text-xs ${low ? 'text-amber-700' : 'text-[#434655]'} ${className}`} suppressHydrationWarning>
      {formatEmailQuotaLine(info)}
      {low && lowHint}
    </p>
  )
}

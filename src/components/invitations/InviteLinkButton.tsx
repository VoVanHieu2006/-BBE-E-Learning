'use client'
import { useState } from 'react'
import { apiFetch, clearApiCache } from '@/lib/api/client'
import { copyTextLater } from '@/lib/clipboard'

interface Props {
  invitationId: string
  email: string
  disabled?: boolean
  /** Báo kết quả cho trang (toast hoặc dòng thông báo). Không bao giờ chứa link. */
  onMessage: (type: 'success' | 'error' | 'info', text: string) => void
  className?: string
}

const DEFAULT_CLASS = 'text-xs font-semibold text-[#2563EB] hover:underline disabled:opacity-50 disabled:cursor-not-allowed text-left break-all'

/**
 * Nút cho lời mời đang chờ giao bằng link: tạo link mới (link cũ hết hiệu lực) và sao chép vào clipboard.
 * Lần đầu hiện "Link mời <email>"; sau khi đã lấy thì đổi thành "Đổi link". Link không bao giờ hiện trên màn hình.
 */
export default function InviteLinkButton({ invitationId, email, disabled, onMessage, className = DEFAULT_CLASS }: Props) {
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState(false)

  async function copyLink() {
    if (busy) return
    setBusy(true)
    let failure = ''
    // Chữ đã nhận chỉ đi từ phản hồi API vào clipboard, không qua state hay DOM.
    const link = apiFetch(`/api/v1/invitations/${invitationId}/link`, { method: 'POST', noCache: true })
      .then((res) => {
        if (res.ok && typeof res.data?.link === 'string') return res.data.link as string
        failure = res.error?.message || 'Không lấy được link mời.'
        return null
      })
      .catch(() => { failure = 'Không lấy được link mời.'; return null })
    try {
      const result = await copyTextLater(link)
      clearApiCache('/api/v1/invitations')
      if (result === 'copied') {
        setIssued(true)
        onMessage('success', `Đã sao chép link mời của ${email}. Link cũ (nếu có) không còn dùng được; gửi link này cho người được mời.`)
      } else if (result === 'no_text') {
        onMessage('error', failure || 'Không lấy được link mời.')
      } else {
        // Link đã được tạo nhưng trình duyệt chặn sao chép: bấm lại để tạo link mới và thử lại.
        onMessage('error', 'Trình duyệt không cho sao chép. Hãy cho phép truy cập bộ nhớ tạm rồi bấm lại (sẽ tạo link mới).')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={copyLink}
      disabled={disabled || busy}
      title="Tạo link mời mới và sao chép; link cũ sẽ hết hiệu lực"
      className={className}
    >
      {busy ? 'Đang tạo link...' : issued ? 'Đổi link' : `Link mời ${email}`}
    </button>
  )
}

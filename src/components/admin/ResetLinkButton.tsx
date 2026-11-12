'use client'
import { useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import { copyTextLater } from '@/lib/clipboard'

interface Props {
  userId: string
  email: string
  disabled?: boolean
  /** Báo kết quả cho trang (toast). Không bao giờ chứa link. */
  onMessage: (type: 'success' | 'error' | 'info', text: string) => void
  /** Gọi sau khi đã tạo link (để trang làm mới hạn mức, nếu cần). */
  onIssued?: () => void
  className?: string
}

const DEFAULT_CLASS = 'px-2.5 py-1 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition disabled:opacity-50 disabled:cursor-not-allowed text-left break-all max-w-full'

/**
 * Nút cho Admin khi email đặt lại mật khẩu không gửi được: tạo link mới (link cũ hết hiệu lực) và sao chép vào clipboard.
 * Lần đầu hiện "Link đặt lại mật khẩu <email>"; sau khi đã lấy thì đổi thành "Đổi link". Link không bao giờ hiện trên màn hình.
 */
export default function ResetLinkButton({ userId, email, disabled, onMessage, onIssued, className = DEFAULT_CLASS }: Props) {
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState(false)

  async function copyLink() {
    if (busy) return
    setBusy(true)
    let failure = ''
    // Chữ đã nhận chỉ đi từ phản hồi API vào clipboard, không qua state hay DOM.
    const link = apiFetch(`/api/v1/users/${userId}/password-reset/link`, { method: 'POST', noCache: true })
      .then((res) => {
        if (res.ok && typeof res.data?.link === 'string') return res.data.link as string
        failure = res.error?.message || 'Không lấy được link đặt lại mật khẩu.'
        return null
      })
      .catch(() => { failure = 'Không lấy được link đặt lại mật khẩu.'; return null })
    try {
      const result = await copyTextLater(link)
      if (result === 'copied') {
        setIssued(true)
        onIssued?.()
        onMessage('success', `Đã sao chép link đặt lại mật khẩu của ${email}. Link có hiệu lực 15 phút, dùng một lần; link cũ (nếu có) không còn dùng được. Hãy gửi link này trực tiếp cho người dùng.`)
      } else if (result === 'no_text') {
        onMessage('error', failure || 'Không lấy được link đặt lại mật khẩu.')
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
      title="Tạo link đặt lại mật khẩu mới và sao chép; link cũ sẽ hết hiệu lực"
      data-testid="reset-link-button"
      className={className}
    >
      {busy ? 'Đang tạo link...' : issued ? 'Đổi link' : `Link đặt lại mật khẩu ${email}`}
    </button>
  )
}

export type CopyResult = 'copied' | 'failed' | 'no_text'

/**
 * Sao chép một chuỗi sẽ có sau một lời gọi mạng vào clipboard mà không bao giờ hiển thị chuỗi đó.
 * Dùng ClipboardItem với Promise để giữ quyền "người dùng vừa bấm" (Safari/Chrome), rồi mới thử các cách cũ.
 * `getText` trả null khi không lấy được chuỗi (đã báo lỗi ở nơi khác).
 */
export async function copyTextLater(getText: Promise<string | null>): Promise<CopyResult> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
  if (clipboard && typeof ClipboardItem !== 'undefined' && typeof clipboard.write === 'function') {
    try {
      const blob = getText.then((text) => {
        if (text === null) throw new Error('no text')
        return new Blob([text], { type: 'text/plain' })
      })
      await clipboard.write([new ClipboardItem({ 'text/plain': blob })])
      return 'copied'
    } catch {
      // thử cách khác bên dưới
    }
  }
  const text = await getText.catch(() => null)
  if (text === null) return 'no_text'
  try {
    if (clipboard?.writeText) {
      await clipboard.writeText(text)
      return 'copied'
    }
  } catch {
    // thử execCommand
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok ? 'copied' : 'failed'
  } catch {
    return 'failed'
  }
}

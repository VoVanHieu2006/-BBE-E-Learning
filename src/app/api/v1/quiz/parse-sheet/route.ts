import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import {
  buildGoogleExportUrl,
  extractGoogleDocRef,
  parseQuizCsv,
  parseQuizText,
} from '@/lib/quiz/import'

/**
 * POST /api/v1/quiz/parse-sheet
 * Body: { url: string } — link Google Sheet/Doc đã chia sẻ "Bất kỳ ai có liên kết – Người xem".
 * Trả về danh sách câu hỏi đã parse + lỗi theo từng dòng. KHÔNG ghi DB.
 *
 * An toàn SSRF: chỉ chấp nhận host docs.google.com, URL export được dựng lại từ ID đã tách.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json(
      { error: { code: 'AccessDenied', message: 'Chỉ Admin mới có thể nhập câu hỏi từ Google Sheet' } },
      { status: 403 }
    )
  }

  const body = await request.json().catch(() => ({}))
  const ref = extractGoogleDocRef(String(body?.url || ''))

  if (!ref) {
    return NextResponse.json(
      {
        error: {
          code: 'ValidationError',
          message: 'Link không hợp lệ. Hãy dán link Google Sheet hoặc Google Doc (docs.google.com).',
        },
      },
      { status: 400 }
    )
  }

  const exportUrl = buildGoogleExportUrl(ref)

  let res: Response
  try {
    res = await fetch(exportUrl, { cache: 'no-store', redirect: 'follow' })
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'FetchError',
          message: 'Không tải được tài liệu từ Google. Vui lòng thử lại sau.',
        },
      },
      { status: 502 }
    )
  }

  const text = await res.text().catch(() => '')

  // Google trả trang đăng nhập khi tài liệu chưa chia sẻ công khai
  const redirectedToLogin = res.url.includes('accounts.google.com')
  const looksLikeLoginPage = /<html|DOCTYPE html/i.test(text) && /sign in|đăng nhập/i.test(text)

  if (!res.ok || redirectedToLogin || looksLikeLoginPage || /^<!DOCTYPE html/i.test(text)) {
    return NextResponse.json(
      {
        error: {
          code: 'DocumentNotPublic',
          message:
            'Không đọc được tài liệu. Hãy mở Google Sheet/Doc đó và đặt chia sẻ "Bất kỳ ai có liên kết – Người xem", sau đó thử lại.',
        },
      },
      { status: 400 }
    )
  }

  const parsed = ref.kind === 'doc' ? parseQuizText(text) : parseQuizCsv(text)

  if (parsed.questions.length === 0) {
    return NextResponse.json(
      {
        questions: [],
        errors: parsed.errors,
        error: {
          code: 'NoQuestionsParsed',
          message:
            'Không đọc được câu hỏi nào. Kiểm tra lại định dạng cột: Câu hỏi | A | B | C | D | Đáp án | Điểm | Giải thích.',
        },
      },
      { status: 400 }
    )
  }

  return NextResponse.json(
    {
      questions: parsed.questions,
      errors: parsed.errors,
      total: parsed.questions.length,
    },
    { status: 200 }
  )
}

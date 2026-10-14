import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { buildGoogleExportUrl, extractGoogleDocRef, parseQuizCsv, parseQuizText } from '@/lib/quiz/import'

async function fetchPublicText(url: string) {
  const response = await fetch(url, { cache: 'no-store', redirect: 'follow' })
  const text = await response.text().catch(() => '')
  const blocked = response.url.includes('accounts.google.com') ||
    (/^<!DOCTYPE html/i.test(text) && /sign in|đăng nhập/i.test(text))
  if (!response.ok || blocked) throw new Error('DocumentNotPublic')
  return text
}

/** Preview a public Sheet/Doc. Sheets named “Nhóm 1”…“Nhóm 20” become question pools. */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin được nhập ngân hàng đề.' } }, { status: 403 })
  }
  const body = await request.json().catch(() => ({}))
  const ref = extractGoogleDocRef(String(body?.url || ''))
  if (!ref) return NextResponse.json({ error: { code: 'ValidationError', message: 'Link Google Sheet/Doc không hợp lệ.' } }, { status: 400 })

  try {
    if (ref.kind === 'doc') {
      const parsed = parseQuizText(await fetchPublicText(buildGoogleExportUrl(ref)))
      return parsed.questions.length
        ? NextResponse.json({ ...parsed, total: parsed.questions.length, pools: [] })
        : NextResponse.json({ ...parsed, error: { code: 'NoQuestionsParsed', message: 'Không đọc được câu hỏi nào.' } }, { status: 400 })
    }

    const pools: string[] = []
    const questions: Array<Record<string, unknown>> = []
    const errors: Array<{ row: number; message: string; poolName?: string }> = []
    // The customer's bank uses contiguous tabs named Nhóm 1, Nhóm 2, …
    for (let index = 1; index <= 20; index++) {
      const poolName = `Nhóm ${index}`
      const url = buildGoogleExportUrl({ kind: 'sheet', id: ref.id, sheetName: poolName })
      let parsed
      try {
        parsed = parseQuizCsv(await fetchPublicText(url))
      } catch {
        if (index === 1) {
          // Preserve support for ordinary single-tab sheets and gid links.
          const fallback = parseQuizCsv(await fetchPublicText(buildGoogleExportUrl(ref)))
          if (!fallback.questions.length) throw new Error('NoQuestionsParsed')
          return NextResponse.json({ ...fallback, total: fallback.questions.length, pools: [] })
        }
        break
      }
      if (!parsed.questions.length) break
      const poolIndex = pools.length
      pools.push(poolName)
      questions.push(...parsed.questions.map((question) => ({ ...question, poolIndex, poolName })))
      errors.push(...parsed.errors.map((error) => ({ ...error, poolName })))
    }
    if (!questions.length) throw new Error('NoQuestionsParsed')
    return NextResponse.json({ questions, errors, pools, total: questions.length })
  } catch (error) {
    const noQuestions = error instanceof Error && error.message === 'NoQuestionsParsed'
    return NextResponse.json({
      error: {
        code: noQuestions ? 'NoQuestionsParsed' : 'DocumentNotPublic',
        message: noQuestions
          ? 'Không đọc được câu hỏi. Kiểm tra cấu trúc cột và tên tab Nhóm 1, Nhóm 2…'
          : 'Không đọc được tài liệu. Hãy bật “Bất kỳ ai có liên kết – Người xem”.',
      },
    }, { status: 400 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { buildGoogleExportUrl, extractGoogleDocRef, parseQuizCsv, parseQuizText } from '@/lib/quiz/import'

async function fetchPublicText(url: string) {
  const response = await fetch(url, { cache: 'no-store', redirect: 'follow' })
  if (!response.ok) throw new Error('DocumentNotPublic')
  const text = await response.text().catch(() => '')
  const isSignInUrl = response.url.includes('accounts.google.com') || response.url.includes('ServiceLogin')
  const isCsvBlocked = (url.includes('/export') || url.includes('gviz/tq')) && /^<!DOCTYPE html/i.test(text.trim())
  const isDocBlocked = /<title>[^<]*(sign[\s-]?in|đăng nhập)[^<]*<\/title>/i.test(text)
  if (isSignInUrl || isCsvBlocked || isDocBlocked) throw new Error('DocumentNotPublic')
  return text
}

function decodeSheetTitle(value: string) {
  try { return JSON.parse(`"${value}"`) as string } catch { return value }
}

async function fetchSheetTitles(spreadsheetId: string): Promise<string[]> {
  const html = await fetchPublicText(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`)
  const titles = new Set<string>()
  const captionPattern = /docs-sheet-tab-caption[^>]*>([^<]+)</g
  let captionMatch: RegExpExecArray | null
  while ((captionMatch = captionPattern.exec(html)) !== null) {
    const title = captionMatch[1]
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim()
    if (title) titles.add(title)
  }
  if (titles.size > 0) return Array.from(titles)

  const bootPattern = /\\?"([0-9]{1,15})\\?",\[\{\\?"1\\":\[\[0,0,\\?"([^"\\]+)\\?"/g
  let bootMatch: RegExpExecArray | null
  while ((bootMatch = bootPattern.exec(html)) !== null) {
    const title = decodeSheetTitle(bootMatch[2]).trim()
    if (title && title.length <= 100) titles.add(title)
  }
  return Array.from(titles)
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
    const discoveredTitles = await fetchSheetTitles(ref.id).catch(() => [])
    const sheetTitles = discoveredTitles.length ? discoveredTitles : (ref.sheetName ? [ref.sheetName] : [])
    if (!sheetTitles.length) {
      const fallback = parseQuizCsv(await fetchPublicText(buildGoogleExportUrl(ref)))
      if (!fallback.questions.length) throw new Error('NoQuestionsParsed')
      return NextResponse.json({ ...fallback, total: fallback.questions.length, pools: [] })
    }
    for (const poolName of sheetTitles) {
      const url = buildGoogleExportUrl({ kind: 'sheet', id: ref.id, sheetName: poolName })
      let parsed
      try {
        parsed = parseQuizCsv(await fetchPublicText(url))
      } catch { continue }
      if (!parsed.questions.length) continue
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
          ? 'Không đọc được câu hỏi. Hãy kiểm tra 7 cột yêu cầu và dữ liệu trong các tab của Sheet.'
          : 'Không đọc được tài liệu. Hãy bật “Bất kỳ ai có liên kết – Người xem”.',
      },
    }, { status: 400 })
  }
}

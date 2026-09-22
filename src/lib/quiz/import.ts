/**
 * Nhập câu hỏi quiz từ Google Sheet / Google Doc.
 *
 * Format cột (dòng đầu là tiêu đề, tự bỏ qua):
 *   Câu hỏi | A | B | C | D | Đáp án | Điểm | Giải thích
 * - Đáp án: "A" hoặc "A,C" (nhiều đáp án -> MULTIPLE_CHOICE)
 * - Điểm: tùy chọn, mặc định 1; Giải thích: tùy chọn
 * - Google Doc: mỗi câu một dòng, các trường tách bằng dấu "|" hoặc tab
 *
 * Module thuần TS (dùng được cả server route lẫn client) — KHÔNG thêm dependency.
 */

export type ImportedQuestionType = 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE'

export interface ImportedQuestion {
  questionText: string
  questionType: ImportedQuestionType
  points: number
  explanation: string
  options: { optionText: string; isCorrect: boolean; sortOrder: number }[]
  sortOrder: number
}

export interface ImportedRowError {
  row: number
  message: string
}

export interface ImportedQuiz {
  questions: ImportedQuestion[]
  errors: ImportedRowError[]
}

export interface GoogleDocRef {
  kind: 'sheet' | 'doc'
  id: string
  gid?: string
  sheetName?: string
}

const GOOGLE_HOSTS = ['docs.google.com']

/**
 * Tách ID tài liệu từ link Google Sheet/Doc. CHỈ nhận host docs.google.com
 * (server sẽ dựng lại URL export từ ID — không bao giờ fetch URL thô của người dùng, chống SSRF).
 */
export function extractGoogleDocRef(rawUrl: string): GoogleDocRef | null {
  let url: URL
  try {
    url = new URL((rawUrl || '').trim())
  } catch {
    return null
  }

  if (!GOOGLE_HOSTS.includes(url.hostname)) return null

  const idMatch = url.pathname.match(/\/(?:spreadsheets\/d|document\/d)\/([a-zA-Z0-9_-]+)/)
  if (!idMatch) return null

  const isSheet = url.pathname.includes('/spreadsheets/d/')
  const gid = url.searchParams.get('gid') || (url.hash.match(/gid=([0-9]+)/) || [])[1] || undefined
  const sheetName = url.searchParams.get('sheet') || undefined

  return { kind: isSheet ? 'sheet' : 'doc', id: idMatch[1], gid, sheetName }
}

/** Dựng URL export công khai từ ID đã xác thực (không dùng URL gốc của người dùng). */
export function buildGoogleExportUrl(ref: GoogleDocRef): string {
  if (ref.kind === 'doc') {
    return `https://docs.google.com/document/d/${ref.id}/export?format=txt`
  }
  if (ref.gid) {
    return `https://docs.google.com/spreadsheets/d/${ref.id}/export?format=csv&gid=${encodeURIComponent(ref.gid)}`
  }
  if (ref.sheetName) {
    return `https://docs.google.com/spreadsheets/d/${ref.id}/gviz/tqx=out:csv&sheet=${encodeURIComponent(ref.sheetName)}`
  }
  return `https://docs.google.com/spreadsheets/d/${ref.id}/export?format=csv`
}

/**
 * Parser CSV theo RFC4180: hỗ trợ ô có dấu ngoặc kép, dấu phẩy và xuống dòng bên trong ô.
 * Bỏ qua các dòng toàn ô rỗng.
 */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]

    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') {
      field += ch
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

function looksLikeHeader(row: string[]): boolean {
  const joined = row.join(' ').toLowerCase()
  return /câu hỏi|question|đáp án|answer|điểm|point|giải thích|explanation/.test(joined)
}

/** Chuẩn hoá độ rộng dòng về đủ số cột mong muốn. */
function normalizeRowWidth(row: string[], width: number): string[] {
  const out = row.slice(0, width).map((c) => (c || '').trim())
  while (out.length < width) out.push('')
  return out
}

/**
 * Đọc bảng câu hỏi từ các dòng đã tách. Trả về cả câu hỏi hợp lệ lẫn lỗi theo từng dòng
 * để UI hiển thị chính xác dòng nào sai, dòng nào bị bỏ qua.
 */
export function parseQuizRows(rows: string[][]): ImportedQuiz {
  const questions: ImportedQuestion[] = []
  const errors: ImportedRowError[] = []

  const bodyRows = rows.length > 0 && looksLikeHeader(rows[0]) ? rows.slice(1) : rows

  bodyRows.forEach((rawRow, index) => {
    // Cột: 0 Câu hỏi | 1-4 A-D | 5 Đáp án | 6 Điểm | 7 Giải thích
    const row = normalizeRowWidth(rawRow, 8)
    const rowNumber = index + (rows.length > 0 && looksLikeHeader(rows[0]) ? 2 : 1)
    const [questionText, a, b, c, d, answerRaw, pointsRaw, explanationRaw] = row

    if (!questionText) {
      errors.push({ row: rowNumber, message: 'Thiếu nội dung câu hỏi' })
      return
    }

    const optionTexts = [a, b, c, d].map((v) => (v || '').trim())
    const options = optionTexts
      .map((optionText, i) => ({ optionText, isCorrect: false, sortOrder: i }))
      .filter((o) => o.optionText !== '')

    if (options.length < 2) {
      errors.push({ row: rowNumber, message: 'Phải có ít nhất 2 lựa chọn (cột A và B)' })
      return
    }

    const answerLetters = (answerRaw || '')
      .toUpperCase()
      .split(/[,;/\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)

    if (answerLetters.length === 0) {
      errors.push({ row: rowNumber, message: 'Thiếu đáp án đúng (cột Đáp án)' })
      return
    }

    const invalidLetters = answerLetters.filter((l) => !LETTERS.slice(0, options.length).includes(l))
    if (invalidLetters.length > 0) {
      errors.push({
        row: rowNumber,
        message: `Đáp án "${invalidLetters.join(', ')}" không khớp các lựa chọn có sẵn (${LETTERS.slice(0, options.length).join(', ')})`,
      })
      return
    }

    const uniqueLetters = Array.from(new Set(answerLetters))
    uniqueLetters.forEach((letter) => {
      const idx = LETTERS.indexOf(letter)
      if (options[idx]) options[idx].isCorrect = true
    })

    let points = 1
    if (pointsRaw && pointsRaw.trim() !== '') {
      const parsed = Number(pointsRaw.trim())
      if (!Number.isFinite(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
        errors.push({ row: rowNumber, message: `Điểm "${pointsRaw}" không hợp lệ (số nguyên ≥ 1)` })
        return
      }
      points = parsed
    }

    questions.push({
      questionText: questionText.trim(),
      questionType: uniqueLetters.length > 1 ? 'MULTIPLE_CHOICE' : 'SINGLE_CHOICE',
      points,
      explanation: (explanationRaw || '').trim(),
      options,
      sortOrder: questions.length,
    })
  })

  return { questions, errors }
}

/** Đọc quiz từ nội dung CSV (Google Sheet export). */
export function parseQuizCsv(csvText: string): ImportedQuiz {
  return parseQuizRows(parseCsv(csvText))
}

/** Đọc quiz từ văn bản (Google Doc export .txt): mỗi câu một dòng, tách bằng "|" hoặc tab. */
export function parseQuizText(text: string): ImportedQuiz {
  const rows = text
    .replace(/^\uFEFF/, '')
    .split('\n')
    .map((line) => line.replace(/\r/g, '').trim())
    .filter((line) => line !== '')
    .map((line) => line.split(/\t|\|/).map((cell) => cell.trim()))

  return parseQuizRows(rows)
}

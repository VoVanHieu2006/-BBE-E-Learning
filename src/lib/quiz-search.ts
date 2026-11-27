export type QuizMatchField = 'question' | 'option' | 'explanation'
export interface QuizQuestionMatch { matched: boolean; matchedIn: QuizMatchField[]; matchedSnippet: string | null }
export interface HighlightSegment { text: string; match: boolean }
export interface SearchableQuizQuestion {
  questionText: string; explanation?: string | null; poolIndex?: number; poolId?: string | null; options: { optionText: string }[]
}
export interface SearchableCourseSession {
  id?: string; title: string
  lessons: {
    id?: string; title: string
    assessment?: { pools?: { id?: string; name: string }[]; questions: (SearchableQuizQuestion & { id?: string })[] } | null
  }[]
}
export interface CourseQuestionSearchResult {
  sessionId: string | null; sessionTitle: string; lessonId: string | null; lessonTitle: string
  poolName: string | null; poolIndex: number | null; questionId: string | null; questionIndex: number
  questionText: string; matchedIn: QuizMatchField[]; matchedSnippet: string | null
}

const SNIPPET_RADIUS = 40
const fold = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')

export function normalizeVietnameseSearch(value: string): string {
  return fold(value).replace(/\s+/g, ' ').trim()
}

function foldWithOffsets(text: string) {
  let folded = ''
  const starts: number[] = [], ends: number[] = []
  for (let i = 0; i < text.length;) {
    const code = text.charCodeAt(i), next = text.charCodeAt(i + 1)
    const end = i + (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? 2 : 1)
    const unit = text.slice(i, end)
    const piece = /\s/.test(unit) ? ' ' : fold(unit)
    if (piece === ' ' ? !folded || folded[folded.length - 1] === ' ' : !piece) {
      if (ends.length) ends[ends.length - 1] = end
    } else {
      for (let k = 0; k < piece.length; k++) { starts.push(i); ends.push(end) }
      folded += piece
    }
    i = end
  }
  if (folded[folded.length - 1] === ' ') { folded = folded.slice(0, -1); starts.pop(); ends.pop() }
  return { folded, starts, ends }
}

function matchRanges(text: string, query: string): [number, number][] {
  const needle = normalizeVietnameseSearch(query)
  const ranges: [number, number][] = []
  if (!needle) return ranges
  const { folded, starts, ends } = foldWithOffsets(text)
  for (let at = folded.indexOf(needle); at !== -1; at = folded.indexOf(needle, at + needle.length)) ranges.push([starts[at], ends[at + needle.length - 1]])
  return ranges
}

export function getHighlightSegments(text: string, query: string): HighlightSegment[] {
  const segments: HighlightSegment[] = []
  let cursor = 0
  for (const [start, end] of matchRanges(text, query)) {
    const from = Math.max(start, cursor)
    if (end <= from) continue
    if (from > cursor) segments.push({ text: text.slice(cursor, from), match: false })
    segments.push({ text: text.slice(from, end), match: true })
    cursor = end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false })
  return segments
}

function snippetAround(text: string, query: string): string | null {
  const range = matchRanges(text, query)[0]
  if (!range) return null
  const from = Math.max(0, range[0] - SNIPPET_RADIUS), to = Math.min(text.length, range[1] + SNIPPET_RADIUS)
  return (from > 0 ? '…' : '') + text.slice(from, to).replace(/\s+/g, ' ').trim() + (to < text.length ? '…' : '')
}

export function matchQuizQuestion(question: SearchableQuizQuestion, query: string, poolFilter?: number | string | null): QuizQuestionMatch {
  const outsidePool = typeof poolFilter === 'number' ? (question.poolIndex ?? 0) !== poolFilter : typeof poolFilter === 'string' && poolFilter !== '' && question.poolId !== poolFilter
  if (outsidePool) return { matched: false, matchedIn: [], matchedSnippet: null }
  const needle = normalizeVietnameseSearch(query)
  if (!needle) return { matched: true, matchedIn: [], matchedSnippet: null }
  const has = (value?: string | null) => !!value && normalizeVietnameseSearch(value).indexOf(needle) !== -1
  const hits: { field: QuizMatchField; text: string }[] = []
  if (has(question.questionText)) hits.push({ field: 'question', text: question.questionText })
  const option = question.options.find(row => has(row?.optionText))
  if (option) hits.push({ field: 'option', text: option.optionText })
  if (has(question.explanation)) hits.push({ field: 'explanation', text: question.explanation })
  if (!hits.length) return { matched: false, matchedIn: [], matchedSnippet: null }
  return { matched: true, matchedIn: hits.map(hit => hit.field), matchedSnippet: snippetAround(hits[0].text, needle) }
}

export function searchCourseQuestions(sessions: SearchableCourseSession[], query: string): CourseQuestionSearchResult[] {
  const results: CourseQuestionSearchResult[] = []
  if (!normalizeVietnameseSearch(query)) return results
  for (const session of sessions) for (const lesson of session.lessons) {
    const pools = lesson.assessment?.pools || []
    ;(lesson.assessment?.questions || []).forEach((question, questionIndex) => {
      const match = matchQuizQuestion(question, query)
      if (!match.matched) return
      const byId = question.poolId ? pools.findIndex(pool => pool.id === question.poolId) : -1
      const poolIndex = byId !== -1 ? byId : Number.isInteger(question.poolIndex) && pools[question.poolIndex] ? question.poolIndex : null
      results.push({
        sessionId: session.id ?? null, sessionTitle: session.title, lessonId: lesson.id ?? null, lessonTitle: lesson.title,
        poolName: poolIndex === null ? null : pools[poolIndex].name, poolIndex,
        questionId: question.id ?? null, questionIndex, questionText: question.questionText,
        matchedIn: match.matchedIn, matchedSnippet: match.matchedSnippet,
      })
    })
  }
  return results
}

import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const [months, terms, seasons, chapters] = await Promise.all([
    prisma.competitionMonth.findMany({ orderBy: { starts_at: 'desc' }, take: 60 }),
    prisma.chapterCompetitionTerm.findMany({ orderBy: { starts_at: 'desc' }, take: 200 }),
    prisma.transferSeason.findMany({ orderBy: { starts_at: 'desc' }, take: 30 }),
    prisma.chapter.findMany({ select: { id: true, name: true } }),
  ])
  return NextResponse.json({ months, terms: terms.map((term) => ({ ...term, chapterName: chapters.find((chapter) => chapter.id === term.chapter_id)?.name || 'Chapter' })), seasons })
}

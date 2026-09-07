import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/v1/streak
 * Personal activity streak — BR-08: watch at least 1 video or take at least 1 assessment per day
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const userId = (auth as any).context!.userId

  try {
    const progresses = await prisma.lessonProgress.findMany({
      where: { user_id: userId },
      select: { last_watched_at: true },
    })

    const attempts = await prisma.attempt.findMany({
      where: { user_id: userId },
      select: { started_at: true },
    })

    const daySet = new Set<string>()
    for (const p of progresses) {
      if (p.last_watched_at) {
        daySet.add(new Date(p.last_watched_at).toISOString().substring(0, 10))
      }
    }
    for (const a of attempts) {
      if (a.started_at) {
        daySet.add(new Date(a.started_at).toISOString().substring(0, 10))
      }
    }

    const days = Array.from(daySet).sort().reverse()
    if (days.length === 0) {
      return NextResponse.json({
        currentStreak: 0,
        longestStreak: 0,
        totalActiveDays: 0,
        lastActiveDay: null,
      }, { status: 200 })
    }

    const today = new Date().toISOString().substring(0, 10)
    const yesterday = new Date(Date.now() - 86400000).toISOString().substring(0, 10)
    let currentStreak = 0
    let cursor = new Date()

    if (daySet.has(today)) {
      cursor = new Date()
    } else if (daySet.has(yesterday)) {
      cursor = new Date(Date.now() - 86400000)
    } else {
      return NextResponse.json({
        currentStreak: 0,
        longestStreak: computeLongest(days),
        totalActiveDays: days.length,
        lastActiveDay: days[0],
      }, { status: 200 })
    }

    while (daySet.has(cursor.toISOString().substring(0, 10))) {
      currentStreak++
      cursor = new Date(cursor.getTime() - 86400000)
    }

    return NextResponse.json({
      currentStreak,
      longestStreak: computeLongest(days),
      totalActiveDays: days.length,
      lastActiveDay: days[0],
    }, { status: 200 })
  } catch (err: any) {
    console.error('[STREAK ERROR]:', err)
    return NextResponse.json({
      error: { code: 'INTERNAL_ERROR', message: err.message },
      currentStreak: 0,
      longestStreak: 0,
      totalActiveDays: 0,
    }, { status: 500 })
  }
}

function computeLongest(days: string[]): number {
  let longest = 1, current = 1
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1])
    const cur = new Date(days[i])
    const diffDays = Math.round((prev.getTime() - cur.getTime()) / 86400000)
    if (diffDays === 1) {
      current++
      longest = Math.max(longest, current)
    } else {
      current = 1
    }
  }
  return longest
}

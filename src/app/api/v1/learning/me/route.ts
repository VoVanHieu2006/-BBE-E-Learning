import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { chapterRewardState } from '@/lib/chapter-reward-gate'
import { reconcileLearnerReadThrough } from '@/lib/learning-outbox'

/** One read model keeps monthly rewards separate from training completion. */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const userId = auth.context!.userId

  // Đồng bộ read-through tức thì nếu người học có sự kiện outbox đang chờ
  await reconcileLearnerReadThrough(userId)

  const now = new Date()
  const rewardState = await chapterRewardState(prisma, userId, now)
  const [cycle, month, allStars, user, policy] = await Promise.all([
    prisma.learningCycle.findFirst({ where: { user_id: userId, ends_at: null } }),
    prisma.competitionMonth.findFirst({ where: { starts_at: { lte: now }, ends_at: { gt: now } } }),
    prisma.starLedger.aggregate({ where: { user_id: userId }, _sum: { amount: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true } }),
    prisma.learningPolicy.findUnique({ where: { id: 'default' } }),
  ])
  const [path, monthStars, cycleStars, replay, programs, notices, supplements, unfinished, cycleProgressData, rawProgressData] = await Promise.all([
    cycle ? prisma.learningPath.findUnique({ where: { learning_cycle_id: cycle.id } }) : null,
    month ? prisma.starLedger.aggregate({ where: { user_id: userId, competition_month_id: month.id }, _sum: { amount: true } }) : null,
    cycle ? prisma.starLedger.aggregate({ where: { user_id: userId, learning_cycle_id: cycle.id }, _sum: { amount: true } }) : null,
    month && cycle ? prisma.monthlyVideoReplay.findMany({ where: { user_id: userId, competition_month_id: month.id, learning_cycle_id: cycle.id }, select: { video_id: true, furthest_seconds: true, completed_at: true } }) : [],
    prisma.learningProgram.findMany({ orderBy: { sort_order: 'asc' }, include: { courses: { where: { status: 'PUBLISHED' }, select: { id: true, title: true, visibility: true, sessions: { orderBy: [{ sort_order: 'asc' }, { id: 'asc' }], select: { id: true, title: true, sort_order: true, lessons: { orderBy: [{ sort_order: 'asc' }, { id: 'asc' }], select: { id: true, title: true, sort_order: true } } } } } } } }),
    prisma.learningNotice.findMany({ where: { user_id: userId }, orderBy: { created_at: 'desc' }, take: 20 }),
    prisma.supplementalLearningRequirement.findMany({ where: { user_id: userId, completed_at: null, ended_at: null } }),
    prisma.userLearningAssignment.count({ where: { user_id: userId, mandatory: true, completed_at: null, ended_at: null } }),
    cycle ? prisma.cycleLessonProgress.findMany({ where: { user_id: userId, learning_cycle_id: cycle.id }, select: { lesson_id: true, completed_at: true } }) : Promise.resolve([]),
    prisma.lessonProgress.findMany({ where: { user_id: userId }, select: { lesson_id: true, completed: true, furthest_watched_position_seconds: true } }),
  ])

  const cycleProgressList = (cycleProgressData as any[]) || []
  const rawProgressList = (rawProgressData as any[]) || []

  const completedLessonIds = Array.from(new Set([
    ...cycleProgressList.filter((p) => p.completed_at != null).map((p) => p.lesson_id),
    ...(!cycle ? rawProgressList.filter((p) => p.completed).map((p) => p.lesson_id) : []),
  ]))

  const inProgressLessonIds = rawProgressList
    .filter((p) => !completedLessonIds.includes(p.lesson_id) && ((p.furthest_watched_position_seconds || 0) > 0))
    .map((p) => p.lesson_id)

  return NextResponse.json({
    cutoverAt: policy?.cutover_at || null, active: Boolean(cycle), cycle, month,
    stars: { history: allStars._sum.amount || 0, month: monthStars?._sum.amount || 0, cycle: cycleStars?._sum.amount || 0 },
    rewardsPaused: user?.status !== 'ACTIVE' || user?.role !== 'MEMBER' || rewardState.paused,
    rewardState,
    path: path ? { startsAt: path.starts_at, dueAt: unfinished ? path.due_at : null, importedDueAt: path.imported_due_at } : null,
    replay, programs, notices, supplements,
    completedLessonIds,
    inProgressLessonIds,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

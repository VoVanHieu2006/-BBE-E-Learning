import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readLessonLearningStates } from '@/lib/lesson-learning-state'
import { chapterRewardState } from '@/lib/chapter-reward-gate'

/** One read model keeps monthly rewards separate from training completion. */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const userId = auth.context!.userId
  const now = new Date()
  const rewardState = await chapterRewardState(prisma, userId, now)
  const [cycle, month, allStars, user, policy] = await Promise.all([
    prisma.learningCycle.findFirst({ where: { user_id: userId, ends_at: null } }),
    prisma.competitionMonth.findFirst({ where: { starts_at: { lte: now }, ends_at: { gt: now } } }),
    prisma.starLedger.aggregate({ where: { user_id: userId }, _sum: { amount: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true } }),
    prisma.learningPolicy.findUnique({ where: { id: 'default' } }),
  ])
  const [path, monthStars, cycleStars, replay, programs, notices, supplements, unfinished] = await Promise.all([
    cycle ? prisma.learningPath.findUnique({ where: { learning_cycle_id: cycle.id } }) : null,
    month ? prisma.starLedger.aggregate({ where: { user_id: userId, competition_month_id: month.id }, _sum: { amount: true } }) : null,
    cycle ? prisma.starLedger.aggregate({ where: { user_id: userId, learning_cycle_id: cycle.id }, _sum: { amount: true } }) : null,
    month && cycle ? prisma.monthlyVideoReplay.findMany({ where: { user_id: userId, competition_month_id: month.id, learning_cycle_id: cycle.id }, select: { video_id: true, furthest_seconds: true, completed_at: true } }) : [],
    prisma.learningProgram.findMany({ orderBy: { sort_order: 'asc' }, relationLoadStrategy: 'join', include: { courses: { where: { status: 'PUBLISHED' }, select: { id: true, title: true, visibility: true, sessions: { orderBy: [{ sort_order: 'asc' }, { id: 'asc' }], select: { id: true, title: true, sort_order: true, lessons: { orderBy: [{ sort_order: 'asc' }, { id: 'asc' }], select: { id: true, title: true, sort_order: true, video: { select: { duration_seconds: true } }, assessment: { select: { id: true } } } } } } } } } }),
    prisma.learningNotice.findMany({ where: { user_id: userId }, orderBy: { created_at: 'desc' }, take: 20 }),
    prisma.supplementalLearningRequirement.findMany({ where: { user_id: userId, completed_at: null, ended_at: null } }),
    prisma.userLearningAssignment.count({ where: { user_id: userId, mandatory: true, completed_at: null, ended_at: null } }),
  ])

  const lessonStates = await readLessonLearningStates(prisma, userId, programs.flatMap(p => p.courses.flatMap(c => c.sessions.flatMap(s => s.lessons.map(l => ({ ...l, courseId: c.id }))))))
  const completedLessonIds = Object.keys(lessonStates).filter(id => lessonStates[id].lessonCompleted)
  const inProgressLessonIds = Object.keys(lessonStates).filter(id => !lessonStates[id].lessonCompleted && lessonStates[id].furthestWatchedPositionSeconds > 0)
  const unlockedLessonIds = Object.keys(lessonStates).filter(id => lessonStates[id].unlocked)

  const payload = {
    cutoverAt: policy?.cutover_at || null, active: Boolean(cycle), cycle, month,
    stars: { history: allStars._sum.amount || 0, month: monthStars?._sum.amount || 0, cycle: cycleStars?._sum.amount || 0 },
    rewardsPaused: user?.status !== 'ACTIVE' || user?.role !== 'MEMBER' || rewardState.paused,
    rewardState,
    path: path ? { startsAt: path.starts_at, dueAt: unfinished ? path.due_at : null, importedDueAt: path.imported_due_at } : null,
    replay, programs, notices, supplements,
    learningCycleId: cycle?.id || null,
    lessonStates,
    completedLessonIds,
    inProgressLessonIds,
    unlockedLessonIds,
  }
  return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } })
}

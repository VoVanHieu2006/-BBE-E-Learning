import { prisma } from '@/lib/prisma'

export interface PublishedCourseInfo {
  id: string
  title: string
  lessonIds: string[]
  totalLessons: number
  hasAssessment: boolean
  assessmentId: string | null
}

export interface PublishedSystemData {
  courses: PublishedCourseInfo[]
  allLessonIdSet: Set<string>
  totalCourses: number
  totalLessons: number
}

export interface UserCourseProgressDetail {
  courseId: string
  title: string
  totalLessons: number
  completedLessons: number
  progressPercent: number
  allVideosDone: boolean
  hasAssessment: boolean
  assessmentId: string | null
  latestAttempt: {
    score: number | null
    passed: boolean
    submittedAt: Date | null
  } | null
  isCompleted: boolean
  state: 'COMPLETED' | 'IN_PROGRESS' | 'NOT_STARTED'
}

export interface UserProgressSummary {
  userId: string
  completedLessons: number
  totalLessons: number
  overallProgressPercent: number
  avgCourseProgressPercent: number
  completedCourses: number
  totalCourses: number
  avgQuizScore: number
  leaderboardPoint: number
  courses?: UserCourseProgressDetail[]
}

let cachedSystemData: { data: PublishedSystemData; timestamp: number } | null = null
const SYSTEM_DATA_TTL_MS = 30000 // 30 seconds in-memory cache

export function invalidateSystemDataCache() {
  cachedSystemData = null
}

/**
 * Fetch all published courses and their lessons once (cached in RAM for 30s).
 */
export async function getPublishedSystemData(forceFresh = false): Promise<PublishedSystemData> {
  if (!forceFresh && cachedSystemData && Date.now() - cachedSystemData.timestamp < SYSTEM_DATA_TTL_MS) {
    return cachedSystemData.data
  }

  const courses = await prisma.course.findMany({
    where: { status: 'PUBLISHED' },
    select: {
      id: true,
      title: true,
      sessions: {
        select: {
          lessons: { select: { id: true } },
        },
      },
      assessment: {
        select: { id: true },
      },
    },
    orderBy: { created_at: 'asc' },
  })

  const allLessonIdSet = new Set<string>()
  const formattedCourses: PublishedCourseInfo[] = courses.map((c) => {
    const lessonIds = c.sessions.flatMap((s) => s.lessons.map((l) => l.id))
    for (const lid of lessonIds) {
      allLessonIdSet.add(lid)
    }
    return {
      id: c.id,
      title: c.title,
      lessonIds,
      totalLessons: lessonIds.length,
      hasAssessment: !!c.assessment,
      assessmentId: c.assessment?.id || null,
    }
  })

  const result: PublishedSystemData = {
    courses: formattedCourses,
    allLessonIdSet,
    totalCourses: formattedCourses.length,
    totalLessons: allLessonIdSet.size,
  }

  cachedSystemData = { data: result, timestamp: Date.now() }
  return result
}

/**
 * Calculate full progress for a single user.
 */
export async function calculateUserProgress(
  userId: string,
  systemData?: PublishedSystemData
): Promise<UserProgressSummary> {
  const sys = systemData || (await getPublishedSystemData())

  const [progressRecords, attempts] = await Promise.all([
    prisma.lessonProgress.findMany({
      where: {
        user_id: userId,
        completed: true,
        lesson_id: { in: Array.from(sys.allLessonIdSet) },
      },
      select: { lesson_id: true },
    }),
    prisma.attempt.findMany({
      where: {
        user_id: userId,
        status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
      },
      select: {
        id: true,
        assessment_id: true,
        score: true,
        passed: true,
        submitted_at: true,
      },
      orderBy: { submitted_at: 'desc' },
    }),
  ])

  const userCompletedLessonsSet = new Set(progressRecords.map((p) => p.lesson_id))

  // Group latest attempt by assessment_id
  const latestAttemptMap = new Map<string, any>()
  let totalScoreSum = 0
  let attemptCount = 0

  for (const a of attempts) {
    if (!latestAttemptMap.has(a.assessment_id)) {
      latestAttemptMap.set(a.assessment_id, a)
    }
    if (a.score !== null) {
      totalScoreSum += Math.round(Number(a.score) * 100)
      attemptCount++
    }
  }

  const avgQuizScore = attemptCount > 0 ? Math.round(totalScoreSum / attemptCount) : 0

  let completedCoursesCount = 0
  let totalCoursePercentSum = 0

  const coursesDetail: UserCourseProgressDetail[] = sys.courses.map((c) => {
    let courseDoneCount = 0
    for (const lid of c.lessonIds) {
      if (userCompletedLessonsSet.has(lid)) {
        courseDoneCount++
      }
    }

    const progressPercent = c.totalLessons > 0 ? Math.round((courseDoneCount / c.totalLessons) * 100) : 0
    totalCoursePercentSum += progressPercent

    const allVideosDone = c.totalLessons > 0 && courseDoneCount >= c.totalLessons

    let latestAttempt: any = null
    let isPassed = false

    if (c.hasAssessment && c.assessmentId) {
      const att = latestAttemptMap.get(c.assessmentId)
      if (att) {
        latestAttempt = {
          score: att.score !== null ? Math.round(Number(att.score) * 100) : null,
          passed: Boolean(att.passed),
          submittedAt: att.submitted_at,
        }
        isPassed = Boolean(att.passed)
      }
    } else {
      isPassed = true
    }

    const isCompleted = allVideosDone && isPassed
    if (isCompleted) {
      completedCoursesCount++
    }

    const state: 'COMPLETED' | 'IN_PROGRESS' | 'NOT_STARTED' = isCompleted
      ? 'COMPLETED'
      : courseDoneCount > 0
      ? 'IN_PROGRESS'
      : 'NOT_STARTED'

    return {
      courseId: c.id,
      title: c.title,
      totalLessons: c.totalLessons,
      completedLessons: courseDoneCount,
      progressPercent,
      allVideosDone,
      hasAssessment: c.hasAssessment,
      assessmentId: c.assessmentId,
      latestAttempt,
      isCompleted,
      state,
    }
  })

  const completedLessons = userCompletedLessonsSet.size
  const overallProgressPercent =
    sys.totalLessons > 0 ? Math.round((completedLessons / sys.totalLessons) * 100) : 0
  const avgCourseProgressPercent =
    sys.totalCourses > 0 ? Math.round(totalCoursePercentSum / sys.totalCourses) : 0

  // Standard Leaderboard formula: 40% lesson progress + 60% average quiz score
  const leaderboardPoint = Math.round(overallProgressPercent * 0.4 + avgQuizScore * 0.6)

  return {
    userId,
    completedLessons,
    totalLessons: sys.totalLessons,
    overallProgressPercent,
    avgCourseProgressPercent,
    completedCourses: completedCoursesCount,
    totalCourses: sys.totalCourses,
    avgQuizScore,
    leaderboardPoint,
    courses: coursesDetail,
  }
}

/**
 * Calculate progress for multiple users in batch (optimized for Leaderboards & User lists).
 */
export async function calculateBatchUsersProgress(
  userIds: string[],
  systemData?: PublishedSystemData
): Promise<Map<string, UserProgressSummary>> {
  const sys = systemData || (await getPublishedSystemData())
  const resultMap = new Map<string, UserProgressSummary>()

  if (userIds.length === 0) return resultMap

  const [allProgress, allAttempts] = await Promise.all([
    prisma.lessonProgress.findMany({
      where: {
        user_id: { in: userIds },
        completed: true,
        lesson_id: { in: Array.from(sys.allLessonIdSet) },
      },
      select: { user_id: true, lesson_id: true },
    }),
    prisma.attempt.findMany({
      where: {
        user_id: { in: userIds },
        status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
      },
      select: {
        user_id: true,
        assessment_id: true,
        score: true,
        passed: true,
        submitted_at: true,
      },
      orderBy: { submitted_at: 'desc' },
    }),
  ])

  // Group progress by user
  const userProgressMap = new Map<string, Set<string>>()
  for (const p of allProgress) {
    let set = userProgressMap.get(p.user_id)
    if (!set) {
      set = new Set()
      userProgressMap.set(p.user_id, set)
    }
    set.add(p.lesson_id)
  }

  // Group attempts by user & assessment
  const userAttemptsMap = new Map<string, { latestByAssess: Map<string, any>; totalScore: number; count: number }>()
  for (const a of allAttempts) {
    let uEntry = userAttemptsMap.get(a.user_id)
    if (!uEntry) {
      uEntry = { latestByAssess: new Map(), totalScore: 0, count: 0 }
      userAttemptsMap.set(a.user_id, uEntry)
    }
    if (!uEntry.latestByAssess.has(a.assessment_id)) {
      uEntry.latestByAssess.set(a.assessment_id, a)
    }
    if (a.score !== null) {
      uEntry.totalScore += Math.round(Number(a.score) * 100)
      uEntry.count++
    }
  }

  for (const uid of userIds) {
    const userCompletedLessonsSet = userProgressMap.get(uid) || new Set()
    const uAttempts = userAttemptsMap.get(uid)
    const avgQuizScore = uAttempts && uAttempts.count > 0 ? Math.round(uAttempts.totalScore / uAttempts.count) : 0

    let completedCoursesCount = 0
    let totalCoursePercentSum = 0

    for (const c of sys.courses) {
      let courseDoneCount = 0
      for (const lid of c.lessonIds) {
        if (userCompletedLessonsSet.has(lid)) {
          courseDoneCount++
        }
      }

      const progressPercent = c.totalLessons > 0 ? Math.round((courseDoneCount / c.totalLessons) * 100) : 0
      totalCoursePercentSum += progressPercent

      const allVideosDone = c.totalLessons > 0 && courseDoneCount >= c.totalLessons

      let isPassed = false
      if (c.hasAssessment && c.assessmentId) {
        const att = uAttempts?.latestByAssess.get(c.assessmentId)
        isPassed = Boolean(att?.passed)
      } else {
        isPassed = true
      }

      if (allVideosDone && isPassed) {
        completedCoursesCount++
      }
    }

    const completedLessons = userCompletedLessonsSet.size
    const overallProgressPercent =
      sys.totalLessons > 0 ? Math.round((completedLessons / sys.totalLessons) * 100) : 0
    const avgCourseProgressPercent =
      sys.totalCourses > 0 ? Math.round(totalCoursePercentSum / sys.totalCourses) : 0
    const leaderboardPoint = Math.round(overallProgressPercent * 0.4 + avgQuizScore * 0.6)

    resultMap.set(uid, {
      userId: uid,
      completedLessons,
      totalLessons: sys.totalLessons,
      overallProgressPercent,
      avgCourseProgressPercent,
      completedCourses: completedCoursesCount,
      totalCourses: sys.totalCourses,
      avgQuizScore,
      leaderboardPoint,
    })
  }

  return resultMap
}

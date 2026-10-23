import { currentCycleAttemptFilter } from '@/lib/learning-periods'
import { prisma } from '@/lib/prisma'

export interface PublishedCourseInfo {
  id: string
  title: string
  lessonIds: string[]
  totalLessons: number
  hasAssessment: boolean
  assessmentId: string | null
  lessonAssessmentIds: string[]
  finalAssessmentId: string | null
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
  hasFinalAssessment: boolean
  hasLessonAssessments: boolean
  lessonAssessmentsPassed: boolean
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
    relationLoadStrategy: 'join',
    select: {
      id: true,
      title: true,
      final_assessment: { select: { id: true } },
      sessions: {
        select: {
          lessons: {
            select: {
              id: true,
              assessment: { select: { id: true } },
            },
          },
        },
      },
    },
    orderBy: { created_at: 'asc' },
  })

  const allLessonIdSet = new Set<string>()
  const formattedCourses: PublishedCourseInfo[] = courses.map((c) => {
    const lessonList = c.sessions.flatMap((s) => s.lessons)
    const lessonIds = lessonList.map((l) => l.id)
    for (const lid of lessonIds) {
      allLessonIdSet.add(lid)
    }
    const hasAnyAssessment = lessonList.some((lesson) => Boolean(lesson.assessment))
    return {
      id: c.id,
      title: c.title,
      lessonIds,
      totalLessons: lessonIds.length,
      hasAssessment: hasAnyAssessment || Boolean(c.final_assessment),
      assessmentId: c.final_assessment?.id || null,
      lessonAssessmentIds: lessonList.flatMap((lesson) => lesson.assessment ? [lesson.assessment.id] : []),
      finalAssessmentId: c.final_assessment?.id || null,
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
  const cycleFilter = await currentCycleAttemptFilter(prisma, userId)
  const cycle = await prisma.learningCycle.findFirst({ where: { user_id: userId, ends_at: null }, select: { id: true } })

  const [progressRecords, attempts] = await Promise.all([
    cycle
      ? prisma.cycleLessonProgress.findMany({
          where: {
            user_id: userId,
            learning_cycle_id: cycle.id,
            completed_at: { not: null },
            lesson_id: { in: Array.from(sys.allLessonIdSet) },
          },
          select: { lesson_id: true },
        })
      : prisma.lessonProgress.findMany({
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
        ...cycleFilter,
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
  const passedAssessmentIds = new Set(attempts.filter((attempt) => attempt.passed).map((attempt) => attempt.assessment_id))

  // Group latest attempt by assessment_id (attempts are sorted by submitted_at desc)
  const latestAttemptMap = new Map<string, any>()
  for (const a of attempts) {
    if (!latestAttemptMap.has(a.assessment_id)) {
      latestAttemptMap.set(a.assessment_id, a)
    }
  }

  let totalScoreSum = 0
  let attemptCount = 0
  latestAttemptMap.forEach((a) => {
    if (a.score !== null) {
      totalScoreSum += Math.round(Number(a.score) * 100)
      attemptCount++
    }
  })

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
    const lessonQuizzesPassed = c.lessonAssessmentIds.every((assessmentId) => passedAssessmentIds.has(assessmentId))
    const finalExamPassed = !c.finalAssessmentId || passedAssessmentIds.has(c.finalAssessmentId)
    const isCompleted = (allVideosDone && lessonQuizzesPassed && finalExamPassed)
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
      hasAssessment: Boolean(c.finalAssessmentId),
      hasFinalAssessment: Boolean(c.finalAssessmentId),
      hasLessonAssessments: c.lessonAssessmentIds.length > 0,
      lessonAssessmentsPassed: lessonQuizzesPassed,
      assessmentId: c.finalAssessmentId,
      latestAttempt: c.finalAssessmentId ? latestAttemptMap.get(c.finalAssessmentId) || null : null,
      isCompleted,
      state,
    }
  })

  const completedLessons = userCompletedLessonsSet.size
  const overallProgressPercent =
    sys.totalLessons > 0 ? Math.round((completedLessons / sys.totalLessons) * 100) : 0
  const avgCourseProgressPercent =
    sys.totalCourses > 0 ? Math.round(totalCoursePercentSum / sys.totalCourses) : 0

  return {
    userId,
    completedLessons,
    totalLessons: sys.totalLessons,
    overallProgressPercent,
    avgCourseProgressPercent,
    completedCourses: completedCoursesCount,
    totalCourses: sys.totalCourses,
    avgQuizScore,
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

  const assessmentIds = sys.courses.flatMap((course) => [...course.lessonAssessmentIds, ...(course.finalAssessmentId ? [course.finalAssessmentId] : [])])
  const cycles = await prisma.learningCycle.findMany({
    where: { user_id: { in: userIds }, ends_at: null },
    select: { id: true, user_id: true },
  })
  const cycleByUser = new Map(cycles.map((row) => [row.user_id, row.id]))
  const legacyUserIds = userIds.filter((id) => !cycleByUser.has(id))
  const cycleAttemptScope = cycles.length || legacyUserIds.length
    ? {
        OR: [
          ...(cycles.length ? [{ learning_cycle_id: { in: cycles.map((row) => row.id) } }] : []),
          ...(legacyUserIds.length ? [{ user_id: { in: legacyUserIds } }] : []),
        ],
      }
    : {}
  const [cycleProgress, legacyProgress, latestAttempts, passedAttempts] = await Promise.all([
    cycles.length
      ? prisma.cycleLessonProgress.findMany({
          where: {
            learning_cycle_id: { in: cycles.map((row) => row.id) },
            completed_at: { not: null },
            lesson_id: { in: Array.from(sys.allLessonIdSet) },
          },
          select: { user_id: true, lesson_id: true, learning_cycle_id: true },
        })
      : Promise.resolve([]),
    prisma.lessonProgress.findMany({
      where: {
        user_id: { in: userIds },
        completed: true,
        lesson_id: { in: Array.from(sys.allLessonIdSet) },
      },
      select: { user_id: true, lesson_id: true },
    }),
    assessmentIds.length ? prisma.attempt.findMany({
      where: {
        user_id: { in: userIds },
        assessment_id: { in: assessmentIds },
        status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
        ...cycleAttemptScope,
      },
      select: {
        user_id: true,
        assessment_id: true,
        score: true,
        passed: true,
        submitted_at: true,
      },
      orderBy: [{ user_id: 'asc' }, { assessment_id: 'asc' }, { submitted_at: 'desc' }],
      distinct: ['user_id', 'assessment_id'],
    }) : Promise.resolve([]),
    assessmentIds.length ? prisma.attempt.findMany({
      where: {
        user_id: { in: userIds },
        assessment_id: { in: assessmentIds },
        status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
        passed: true,
        ...cycleAttemptScope,
      },
      select: { user_id: true, assessment_id: true },
      distinct: ['user_id', 'assessment_id'],
    }) : Promise.resolve([]),
  ])

  // Group progress by user. The active cycle is authoritative; legacy rows are
  // only used for a user who has not been migrated to a cycle yet.
  const userProgressMap = new Map<string, Set<string>>()
  for (const p of cycleProgress) {
    if (cycleByUser.get(p.user_id) !== p.learning_cycle_id) continue
    let set = userProgressMap.get(p.user_id)
    if (!set) {
      set = new Set()
      userProgressMap.set(p.user_id, set)
    }
    set.add(p.lesson_id)
  }
  for (const p of legacyProgress) {
    if (cycleByUser.has(p.user_id)) continue
    let set = userProgressMap.get(p.user_id)
    if (!set) {
      set = new Set()
      userProgressMap.set(p.user_id, set)
    }
    set.add(p.lesson_id)
  }

  // Only the latest attempt and distinct passed assessments are loaded. This
  // keeps account and leaderboard pages fast as attempt history grows.
  const userAttemptsMap = new Map<string, Map<string, any>>()
  const userPassedAssessmentMap = new Map<string, Set<string>>()
  for (const a of latestAttempts) {
    let uAssessMap = userAttemptsMap.get(a.user_id)
    if (!uAssessMap) {
      uAssessMap = new Map()
      userAttemptsMap.set(a.user_id, uAssessMap)
    }
    if (!uAssessMap.has(a.assessment_id)) {
      uAssessMap.set(a.assessment_id, a)
    }
  }
  for (const a of passedAttempts) {
    let passed = userPassedAssessmentMap.get(a.user_id)
    if (!passed) {
      passed = new Set()
      userPassedAssessmentMap.set(a.user_id, passed)
    }
    passed.add(a.assessment_id)
  }

  for (const uid of userIds) {
    const userCompletedLessonsSet = userProgressMap.get(uid) || new Set()
    const uAssessMap = userAttemptsMap.get(uid)
    const passedAssessmentIds = userPassedAssessmentMap.get(uid) || new Set<string>()
    let totalScore = 0
    let count = 0
    if (uAssessMap) {
      uAssessMap.forEach((a) => {
        if (a.score !== null) {
          totalScore += Math.round(Number(a.score) * 100)
          count++
        }
      })
    }
    const avgQuizScore = count > 0 ? Math.round(totalScore / count) : 0

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
      const lessonQuizzesPassed = c.lessonAssessmentIds.every((assessmentId) => passedAssessmentIds.has(assessmentId))
      const finalExamPassed = !c.finalAssessmentId || passedAssessmentIds.has(c.finalAssessmentId)
      if ((allVideosDone && lessonQuizzesPassed && finalExamPassed)) {
        completedCoursesCount++
      }
    }

    const completedLessons = userCompletedLessonsSet.size
    const overallProgressPercent =
      sys.totalLessons > 0 ? Math.round((completedLessons / sys.totalLessons) * 100) : 0
    const avgCourseProgressPercent =
      sys.totalCourses > 0 ? Math.round(totalCoursePercentSum / sys.totalCourses) : 0
    resultMap.set(uid, {
      userId: uid,
      completedLessons,
      totalLessons: sys.totalLessons,
      overallProgressPercent,
      avgCourseProgressPercent,
      completedCourses: completedCoursesCount,
      totalCourses: sys.totalCourses,
      avgQuizScore,
    })
  }

  return resultMap
}

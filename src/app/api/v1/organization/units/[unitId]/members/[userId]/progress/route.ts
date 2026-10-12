import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessOrganizationUnitPermission } from '@/lib/authorization'
import { getOrganizationUnitTreeIds } from '@/lib/learning-assignments'
import { listChapterMembers } from '@/lib/chapter-members'
import { isOrganizationId } from '@/lib/organization-admin-rules'
import { calculateUserProgress } from '@/lib/progress/calculator'

/** Detailed course/module/video/quiz/Star progress within an authorized organization scope. */
export async function GET(_request: NextRequest, { params }: { params: { unitId: string; userId: string } }) {
  const auth = await authenticate(_request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (!isOrganizationId(params.unitId) || !isOrganizationId(params.userId)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
  if (!await canAccessOrganizationUnitPermission(auth.context!, params.unitId, 'VIEW_MEMBER_PROGRESS')) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }

  const unit = await prisma.organizationUnit.findUnique({ where: { id: params.unitId }, select: { id: true, chapter: { select: { id: true } } } })
  if (!unit) return NextResponse.json({ error: { code: 'OrganizationUnitNotFound' } }, { status: 404 })
  const target = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, email: true, status: true, role: true, created_at: true },
  })
  if (!target || target.role !== 'MEMBER') return NextResponse.json({ error: { code: 'MemberNotFound' } }, { status: 404 })

  const now = new Date()
  let joinedAt: Date | null = null
  if (unit.chapter) {
    const roster = await listChapterMembers(unit.chapter.id, { roles: ['MEMBER'], search: target.email })
    joinedAt = roster.find((member) => member.userId === target.id)?.joinedAt || null
  } else {
    const unitIds = await getOrganizationUnitTreeIds(unit.id)
    const membership = await prisma.organizationMembership.findFirst({
      where: { user_id: target.id, unit_id: { in: unitIds }, status: 'ACTIVE', starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
      orderBy: { starts_at: 'asc' },
      select: { starts_at: true },
    })
    joinedAt = membership?.starts_at || null
  }
  if (!joinedAt) return NextResponse.json({ error: { code: 'MemberNotFound' } }, { status: 404 })

  const [summary, courses, starEntries] = await Promise.all([
    calculateUserProgress(target.id),
    prisma.course.findMany({
      where: { status: 'PUBLISHED' },
      select: {
        id: true,
        title: true,
        final_assessment: {
          select: {
            id: true,
            title: true,
            attempts: {
              where: { user_id: target.id, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
              orderBy: { submitted_at: 'desc' },
              select: { id: true, attempt_number: true, score: true, passed: true, status: true, submitted_at: true },
            },
          },
        },
        sessions: {
          orderBy: { sort_order: 'asc' },
          select: {
            id: true,
            title: true,
            sort_order: true,
            lessons: {
              orderBy: { sort_order: 'asc' },
              select: {
                id: true,
                title: true,
                sort_order: true,
                video: { select: { id: true, title: true, duration_seconds: true } },
                progress: {
                  where: { user_id: target.id },
                  select: { completed: true, completed_at: true, furthest_watched_position_seconds: true, last_watched_at: true },
                  take: 1,
                },
                assessment: {
                  select: {
                    id: true,
                    title: true,
                    attempts: {
                      where: { user_id: target.id, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
                      orderBy: { submitted_at: 'desc' },
                      select: { id: true, attempt_number: true, score: true, passed: true, status: true, submitted_at: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { created_at: 'asc' },
    }),
    prisma.starLedger.findMany({ where: { user_id: target.id }, select: { amount: true, source_type: true, source_id: true } }),
  ])

  const starsBySource = new Map<string, number>()
  for (const entry of starEntries) {
    const key = `${entry.source_type}:${entry.source_id}`
    starsBySource.set(key, (starsBySource.get(key) || 0) + entry.amount)
  }
  const learningDetail = courses.map((course) => ({
    courseId: course.id,
    title: course.title,
    finalAssessment: course.final_assessment && {
      assessmentId: course.final_assessment.id,
      title: course.final_assessment.title,
      attemptCount: course.final_assessment.attempts.length,
      stars: starsBySource.get(`ASSESSMENT:${course.final_assessment.id}`) || 0,
      latestAttempt: course.final_assessment.attempts[0] && {
        attemptId: course.final_assessment.attempts[0].id,
        number: course.final_assessment.attempts[0].attempt_number,
        scorePercent: course.final_assessment.attempts[0].score === null ? null : Math.round(Number(course.final_assessment.attempts[0].score) * 100),
        passed: course.final_assessment.attempts[0].passed,
        status: course.final_assessment.attempts[0].status,
        submittedAt: course.final_assessment.attempts[0].submitted_at,
      },
    },
    modules: course.sessions.map((session) => ({
      moduleId: session.id,
      title: session.title,
      order: session.sort_order,
      lessons: session.lessons.map((lesson) => {
        const progress = lesson.progress[0]
        const duration = lesson.video?.duration_seconds || 0
        const watchedSeconds = progress?.furthest_watched_position_seconds || 0
        const latestAttempt = lesson.assessment?.attempts[0] || null
        return {
          lessonId: lesson.id,
          title: lesson.title,
          order: lesson.sort_order,
          video: lesson.video && {
            videoId: lesson.video.id,
            title: lesson.video.title,
            durationSeconds: duration,
            watchedSeconds,
            watchedPercent: duration > 0 ? Math.min(100, Math.floor((watchedSeconds / duration) * 100)) : 0,
            completed: duration > 0 ? watchedSeconds >= duration : Boolean(progress?.completed),
            stars: starsBySource.get(`VIDEO:${lesson.video.id}`) || 0,
            completedAt: progress?.completed_at || null,
            lastWatchedAt: progress?.last_watched_at || null,
          },
          quiz: lesson.assessment && {
            assessmentId: lesson.assessment.id,
            title: lesson.assessment.title,
            attemptCount: lesson.assessment.attempts.length,
            stars: starsBySource.get(`ASSESSMENT:${lesson.assessment.id}`) || 0,
            latestAttempt: latestAttempt && {
              attemptId: latestAttempt.id,
              number: latestAttempt.attempt_number,
              scorePercent: latestAttempt.score === null ? null : Math.round(Number(latestAttempt.score) * 100),
              passed: latestAttempt.passed,
              status: latestAttempt.status,
              submittedAt: latestAttempt.submitted_at,
            },
          },
        }
      }),
    })),
  }))

  return NextResponse.json({
    user: { userId: target.id, email: target.email, status: target.status, joinedAt },
    summary: {
      totalCourses: summary.totalCourses,
      completedCourses: summary.completedCourses,
      completedLessons: summary.completedLessons,
      totalLessons: summary.totalLessons,
      avgProgress: summary.overallProgressPercent,
      avgCourseProgress: summary.avgCourseProgressPercent,
      avgQuizScore: summary.avgQuizScore,
      stars: starEntries.reduce((total, entry) => total + entry.amount, 0),
    },
    courses: summary.courses || [],
    learningDetail,
  })
}

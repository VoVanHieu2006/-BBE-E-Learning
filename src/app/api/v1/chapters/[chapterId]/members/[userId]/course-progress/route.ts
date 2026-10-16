import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { calculateUserProgress } from '@/lib/progress/calculator'
import { hasChapterPermission, resolveSingleManagedChapter } from '@/lib/authorization'
import { getOrganizationUnitTreeIds } from '@/lib/learning-assignments'
import { canViewInactiveChapterMember } from '@/lib/inactive-member-access'
import { getActiveMetricChapterIds } from '@/lib/active-chapters'

/**
 * GET /api/v1/chapters/[chapterId]/members/[userId]/course-progress
 * Chi tiết tiến độ theo từng khóa học của một thành viên (trang chi tiết của BĐHU)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { chapterId: string; userId: string } }
) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  let chapterId = params.chapterId
  const isAdminAllScope = auth.context!.role === 'ADMIN' && chapterId === 'all'

  // Support "me" alias for chapter leader
  if (chapterId === 'me') {
    const resolved = await resolveSingleManagedChapter(auth.context!)
    if (!resolved) return NextResponse.json({ error: { code: 'ChapterScopeRequired', message: 'Không có Chapter duy nhất trong phạm vi; hãy gửi chapterId cụ thể.' } }, { status: 400 })
    chapterId = resolved
  }

  // Authorization check
  const isLeader = auth.context!.role === 'CHAPTER_LEADER' && auth.context!.chapterId === chapterId
  const isAdmin = auth.context!.role === 'ADMIN'
  if (!isAdmin && !(await getActiveMetricChapterIds()).includes(chapterId)) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }
  if (!isLeader && !isAdmin) {
    const hasPerm = await hasChapterPermission(auth.context!.userId, chapterId, 'VIEW_MEMBER_PROGRESS')
    if (!hasPerm) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền' } }, { status: 403 })
    }
  }

  const targetUserId = params.userId
  const chapter = isAdminAllScope
    ? { organization_unit_id: null }
    : await prisma.chapter.findUnique({ where: { id: chapterId }, select: { organization_unit_id: true } })
  if (!chapter) return NextResponse.json({ error: { code: 'NotFound', message: 'Chapter không tồn tại' } }, { status: 404 })

  // Thành viên phải thuộc chapter này (cho phép cả INACTIVE để BĐHU vẫn xem được thành viên bị khóa)
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      email: true,
      display_name: true,
      status: true,
      role: true,
      created_at: true,
      chapter_members: { select: { chapter_id: true, joined_at: true } },
    },
  })

  if (!target || target.role !== 'MEMBER') {
    return NextResponse.json({ error: { code: 'NotFound', message: 'Thành viên không thuộc chapter này' } }, { status: 404 })
  }
  if (target.status !== 'ACTIVE' && !await canViewInactiveChapterMember(auth.context!, chapterId)) {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Only Admin or this Chapter lead may view inactive accounts' } }, { status: 403 })
  }

  const legacyMembership = target.chapter_members.find((cm) => cm.chapter_id === chapterId)
  let joinedAt = legacyMembership?.joined_at || target.created_at
  if (!isAdminAllScope && !legacyMembership) {
    const unitIds = chapter.organization_unit_id ? await getOrganizationUnitTreeIds(chapter.organization_unit_id) : []
    const organizationMembership = unitIds.length
      ? await prisma.organizationMembership.findFirst({
          where: {
            user_id: targetUserId,
            unit_id: { in: unitIds },
            status: 'ACTIVE',
            starts_at: { lte: new Date() },
            OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }],
          },
          select: { starts_at: true },
        })
      : null
    if (!organizationMembership) {
      return NextResponse.json({ error: { code: 'NotFound', message: 'Thành viên không thuộc chapter này' } }, { status: 404 })
    }
    joinedAt = organizationMembership.starts_at
  }

  const userSummary = await calculateUserProgress(targetUserId)

  // This detail is deliberately built from the immutable progress/attempt records,
  // not from the client. It is used by Admin and BĐHU to audit every module/video.
  const [learningDetail, starEntries] = await Promise.all([
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
              where: { user_id: targetUserId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
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
                  where: { user_id: targetUserId },
                  select: {
                    completed: true,
                    completed_at: true,
                    furthest_watched_position_seconds: true,
                    last_watched_at: true,
                  },
                  take: 1,
                },
                assessment: {
                  select: {
                    id: true,
                    title: true,
                    attempts: {
                      where: { user_id: targetUserId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
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
    prisma.starLedger.findMany({
      where: { user_id: targetUserId },
      select: { amount: true, source_type: true, source_id: true },
    }),
  ])

  const starsBySource = new Map<string, number>()
  for (const entry of starEntries) {
    const key = `${entry.source_type}:${entry.source_id}`
    starsBySource.set(key, (starsBySource.get(key) || 0) + entry.amount)
  }

  const detailedCourses = learningDetail.map((course) => ({
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
            completed: duration > 0
              ? watchedSeconds >= duration
              : Boolean(progress?.completed),
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

  return NextResponse.json(
    {
      user: {
        userId: target.id,
        email: target.email,
        status: target.status,
        joinedAt,
        displayName: target.display_name,
        completedLessons: userSummary.completedLessons,
        totalLessons: userSummary.totalLessons,
        overallProgressPercent: userSummary.overallProgressPercent,
      },
      summary: {
        totalCourses: userSummary.totalCourses,
        completedCourses: userSummary.completedCourses,
        completedLessons: userSummary.completedLessons,
        totalLessons: userSummary.totalLessons,
        avgProgress: userSummary.overallProgressPercent,
        avgCourseProgress: userSummary.avgCourseProgressPercent,
        avgQuizScore: userSummary.avgQuizScore,
        stars: starEntries.reduce((total, entry) => total + entry.amount, 0),
      },
      courses: userSummary.courses || [],
      learningDetail: detailedCourses,
    },
    { status: 200 }
  )
}

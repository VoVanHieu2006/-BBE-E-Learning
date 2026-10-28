import { prisma } from '../../src/lib/prisma'
import { ensureChapterStandardDepartments } from '../../src/lib/chapter-departments'
import { learningContext } from '../../src/lib/learning-periods'
import { starsForVideoDuration } from '../../src/lib/reward-rules'
import { invalidateChapterLeaderboardCache } from '../../src/lib/chapter-leaderboard-cache'
import { invalidateMemberLeaderboardCache } from '../../src/lib/member-leaderboard-cache'
import { invalidateOrganizationViews } from '../../src/lib/organization-view-cache'
import { invalidateOrganizationServerCache } from '../../src/lib/server-cache'

export async function reconcileNewChapters() {
  console.log('=== RECONCILING NEW CHAPTERS & INITIAL TERMS ===')
  const now = new Date()

  // 1. Process all chapters
  const chapters = await prisma.chapter.findMany({
    include: {
      organization_unit: true,
    },
  })

  for (const chapter of chapters) {
    console.log(`Checking chapter: ${chapter.name} (${chapter.id})`)

    // Ensure current_term_number is at least 1
    if (!chapter.current_term_number || chapter.current_term_number < 1) {
      console.log(`  Setting current_term_number = 1 for ${chapter.name}`)
      await prisma.chapter.update({
        where: { id: chapter.id },
        data: { current_term_number: 1 },
      })
    }

    // Ensure ChapterCompetitionTerm (starts_at = created_at, ends_at = null) exists
    const terms = await prisma.chapterCompetitionTerm.findMany({
      where: { chapter_id: chapter.id },
    })

    if (terms.length === 0) {
      console.log(`  Creating initial ChapterCompetitionTerm for ${chapter.name}`)
      await prisma.chapterCompetitionTerm.create({
        data: {
          chapter_id: chapter.id,
          starts_at: chapter.created_at,
          ends_at: null,
          season_id: null,
        },
      })
    } else {
      console.log(`  ChapterCompetitionTerm already exists for ${chapter.name} (count: ${terms.length})`)
    }

    // Ensure 7 standard departments exist
    if (chapter.organization_unit_id) {
      console.log(`  Ensuring standard 7 departments for org unit ${chapter.organization_unit_id}`)
      await ensureChapterStandardDepartments(chapter.organization_unit_id, prisma)
    }
  }

  // 2. Reconcile stars for vobahoaan@gmail.com
  console.log('\n=== RECONCILING STARS FOR vobahoaan@gmail.com ===')
  const user = await prisma.user.findUnique({
    where: { email: 'vobahoaan@gmail.com' },
    include: {
      chapter_members: true,
      lessonProgress: {
        include: {
          lesson: {
            include: { video: true },
          },
        },
      },
      stars: true,
    },
  })

  if (!user) {
    console.log('User vobahoaan@gmail.com not found!')
    return
  }

  const chapterId = user.chapter_members[0]?.chapter_id ?? null
  console.log(`User ${user.email} (${user.id}), chapter: ${chapterId}`)

  const context = await learningContext(prisma, user.id, now)
  console.log(`Learning context active:`, context ? { month: context.month.id, cycle: context.cycle.id } : 'None (pre-cutover)')

  const completedProgressWithVideos = user.lessonProgress.filter(
    (lp) => lp.completed && lp.lesson?.video && Number(lp.lesson.video.duration_seconds) > 0
  )

  let totalReconciledStars = 0
  for (const lp of completedProgressWithVideos) {
    const video = lp.lesson.video!
    const duration = Number(video.duration_seconds)
    const stars = starsForVideoDuration(duration)

    // Check if star ledger already has video entry for this video
    const existingVideoStar = await prisma.starLedger.findFirst({
      where: {
        user_id: user.id,
        source_type: 'VIDEO',
        source_id: video.id,
      },
    })

    if (existingVideoStar) {
      console.log(`  Video ${video.title} (${duration}s) already rewarded with ${existingVideoStar.amount} stars.`)
      continue
    }

    const candidateKey = context
      ? `video:${user.id}:${video.id}:${context.month.id}:${context.cycle.id}`
      : `video:${user.id}:${video.id}`

    console.log(`  Awarding ${stars} stars for video "${video.title}" (${duration}s), key=${candidateKey}`)

    await prisma.starLedger.create({
      data: {
        user_id: user.id,
        amount: stars,
        reason: 'VIDEO_COMPLETION',
        reward_key: candidateKey,
        source_type: 'VIDEO',
        source_id: video.id,
        awarded_at: lp.completed_at || now,
        competition_month_id: context?.month.id ?? null,
        learning_cycle_id: context?.cycle.id ?? null,
        chapter_at_award_id: chapterId,
        provenance: 'NATIVE',
        metadata: {
          lessonId: lp.lesson_id,
          durationSeconds: duration,
          playbackRate: 1,
          reconciled: true,
        },
      },
    })

    if (context) {
      // Upsert monthly video replay and cycle lesson progress
      const replayKey = {
        user_id: user.id,
        video_id: video.id,
        competition_month_id: context.month.id,
        learning_cycle_id: context.cycle.id,
      }
      await prisma.monthlyVideoReplay.upsert({
        where: { user_id_video_id_competition_month_id_learning_cycle_id: replayKey },
        create: {
          ...replayKey,
          furthest_seconds: duration,
          last_heartbeat_at: lp.completed_at || now,
          completed_at: lp.completed_at || now,
          reward_suppressed_at: null,
        },
        update: {
          furthest_seconds: duration,
          completed_at: lp.completed_at || now,
          reward_suppressed_at: null,
        },
      })

      const cycleProgressKey = {
        user_id: user.id,
        lesson_id: lp.lesson_id,
        learning_cycle_id: context.cycle.id,
      }
      await prisma.cycleLessonProgress.upsert({
        where: { user_id_lesson_id_learning_cycle_id: cycleProgressKey },
        create: {
          ...cycleProgressKey,
          furthest_seconds: duration,
          completed_at: lp.completed_at || now,
        },
        update: {
          furthest_seconds: duration,
          completed_at: lp.completed_at || now,
        },
      })
    }

    totalReconciledStars += stars
  }

  console.log(`Total reconciled video stars awarded: ${totalReconciledStars}`)

  // Invalidate caches
  console.log('Invalidating leaderboard and organization caches...')
  invalidateChapterLeaderboardCache()
  invalidateMemberLeaderboardCache()
  invalidateOrganizationViews()
  invalidateOrganizationServerCache()

  console.log('=== RECONCILIATION COMPLETED SUCCESSFULLY ===')
}

if (require.main === module) {
  reconcileNewChapters()
    .catch((err) => {
      console.error('Reconciliation failed:', err)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}

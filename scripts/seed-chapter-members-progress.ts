import { PrismaClient, StarReason } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const lead = await prisma.user.findUnique({
    where: { email: 'chapter.lead.demo@bbe.vn' },
    include: { chapter_members: { include: { chapter: true } } },
  })

  if (!lead || !lead.chapter_members[0]?.chapter_id) {
    throw new Error('Could not find chapter.lead.demo@bbe.vn or chapter')
  }

  const chapterId = lead.chapter_members[0].chapter_id
  const chapterName = lead.chapter_members[0].chapter.name
  console.log(`Targeting Chapter "${chapterName}" (${chapterId})`)

  // Get all members in chapter
  const members = await prisma.chapterMember.findMany({
    where: { chapter_id: chapterId, user: { role: 'MEMBER', status: 'ACTIVE' } },
    include: { user: true },
    orderBy: { joined_at: 'asc' },
  })

  console.log(`Found ${members.length} active members in Chapter "${chapterName}"`)

  // Get all published courses with lessons & assessments
  const courses = await prisma.course.findMany({
    where: { status: 'PUBLISHED' },
    include: {
      sessions: {
        orderBy: { sort_order: 'asc' },
        include: {
          lessons: {
            orderBy: { sort_order: 'asc' },
            include: { video: true, assessment: true },
          },
        },
      },
      final_assessment: true,
    },
    orderBy: { created_at: 'asc' },
  })

  const allLessons = courses.flatMap((c) => c.sessions.flatMap((s) => s.lessons))
  console.log(`Found ${courses.length} published courses with total ${allLessons.length} lessons`)

  if (allLessons.length === 0) {
    console.log('No published lessons found to seed progress.')
    return
  }

  const lessonProgressData: any[] = []
  const attemptData: any[] = []
  const starLedgerData: any[] = []
  const seenRewardKeys = new Set<string>()

  let membersOver70Count = 0

  for (let idx = 0; idx < members.length; idx++) {
    const member = members[idx]
    const uid = member.user_id

    // Distribution tier:
    // 0-11 (12 members): High performers (75% - 100% lessons done)
    // 12-25 (14 members): Mid performers (40% - 70% lessons done)
    // 26-33 (8 members): Low performers (15% - 35% lessons done)
    // 34-36 (3 members): Beginners (0% - 10% lessons done)
    let completionRatio = 0
    if (idx < 12) {
      completionRatio = 0.75 + ((idx % 4) * 0.08)
      if (completionRatio > 1) completionRatio = 1
    } else if (idx < 26) {
      completionRatio = 0.40 + ((idx % 5) * 0.06)
    } else if (idx < 34) {
      completionRatio = 0.15 + ((idx % 4) * 0.05)
    } else {
      completionRatio = idx === 34 ? 0.08 : 0
    }

    if (completionRatio >= 0.7) {
      membersOver70Count++
    }

    const lessonsToCompleteCount = Math.round(allLessons.length * completionRatio)
    const lessonsForUser = allLessons.slice(0, lessonsToCompleteCount)

    for (let lIdx = 0; lIdx < lessonsForUser.length; lIdx++) {
      const lesson = lessonsForUser[lIdx]
      const dur = lesson.video?.duration_seconds || 180
      const date = new Date(Date.now() - (30 - lIdx) * 86400000)

      // 1. LessonProgress
      lessonProgressData.push({
        user_id: uid,
        lesson_id: lesson.id,
        completed: true,
        completed_at: date,
        last_position_seconds: dur,
        furthest_watched_position_seconds: dur,
        last_watched_at: date,
      })

      // 2. Video completion star
      const videoRewardKey = `video:${uid}:${lesson.id}`
      if (!seenRewardKeys.has(videoRewardKey)) {
        seenRewardKeys.add(videoRewardKey)
        const starAmount = Math.max(1, Math.floor(dur / 60))
        starLedgerData.push({
          user_id: uid,
          amount: starAmount,
          reason: StarReason.VIDEO_COMPLETION,
          reward_key: videoRewardKey,
          source_type: 'LESSON',
          source_id: lesson.id,
          awarded_at: date,
        })
      }

      // 3. Quiz attempt & star
      if (lesson.assessment) {
        const aId = lesson.assessment.id
        attemptData.push({
          user_id: uid,
          assessment_id: aId,
          attempt_number: 1,
          status: 'SUBMITTED',
          score: 0.9,
          passed: true,
          started_at: new Date(date.getTime() - 900000),
          expires_at: new Date(date.getTime() + 1800000),
          submitted_at: date,
        })

        const quizRewardKey = `quiz:${uid}:${aId}:pass`
        if (!seenRewardKeys.has(quizRewardKey)) {
          seenRewardKeys.add(quizRewardKey)
          starLedgerData.push({
            user_id: uid,
            amount: 2,
            reason: StarReason.MODULE_QUIZ_PASS,
            reward_key: quizRewardKey,
            source_type: 'ASSESSMENT',
            source_id: aId,
            awarded_at: date,
          })
        }
      }
    }

    // 4. Final Assessment
    if (completionRatio >= 0.9) {
      for (const course of courses) {
        if (course.final_assessment) {
          const fId = course.final_assessment.id
          attemptData.push({
            user_id: uid,
            assessment_id: fId,
            attempt_number: 1,
            status: 'SUBMITTED',
            score: 1.0,
            passed: true,
            started_at: new Date(Date.now() - 3600000),
            expires_at: new Date(Date.now() + 3600000),
            submitted_at: new Date(),
          })

          const finalRewardKey = `course_final:${uid}:${fId}:pass`
          if (!seenRewardKeys.has(finalRewardKey)) {
            seenRewardKeys.add(finalRewardKey)
            starLedgerData.push({
              user_id: uid,
              amount: 5,
              reason: StarReason.COURSE_FINAL_PASS,
              reward_key: finalRewardKey,
              source_type: 'ASSESSMENT',
              source_id: fId,
              awarded_at: new Date(),
            })
          }
        }
      }
    }
  }

  console.log(`Prepared in memory: ${lessonProgressData.length} lesson progresses, ${attemptData.length} attempts, ${starLedgerData.length} stars`)

  console.log('Writing batch lesson progress...')
  await prisma.lessonProgress.createMany({
    data: lessonProgressData,
    skipDuplicates: true,
  })

  console.log('Writing batch attempts...')
  await prisma.attempt.createMany({
    data: attemptData,
    skipDuplicates: true,
  })

  console.log('Writing batch star ledger...')
  await prisma.starLedger.createMany({
    data: starLedgerData,
    skipDuplicates: true,
  })

  const totalStarAmount = starLedgerData.reduce((s, r) => s + r.amount, 0)
  console.log(`Successfully batch-seeded data for ${members.length} members:`)
  console.log(`- Total Stars in batch: ${totalStarAmount}`)
  console.log(`- Members reaching >= 70% progress: ${membersOver70Count}/${members.length}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

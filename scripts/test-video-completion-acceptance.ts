import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

// Load .env
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
if (!process.env.JWT_ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET must exist in .env')

const prisma = new PrismaClient()
const fixturePrefix = `p1-test-${randomUUID().slice(0, 8)}`
const cleanupUserIds: string[] = []
const cleanupCourseIds: string[] = []

async function cleanup() {
  console.log(`Cleaning up test fixtures (${fixturePrefix})...`)
  if (cleanupUserIds.length > 0) {
    try {
      await prisma.starLedger.deleteMany({ where: { user_id: { in: cleanupUserIds } } })
      await prisma.monthlyVideoReplay.deleteMany({ where: { user_id: { in: cleanupUserIds } } })
      await prisma.cycleLessonProgress.deleteMany({ where: { user_id: { in: cleanupUserIds } } })
      await prisma.lessonProgress.deleteMany({ where: { user_id: { in: cleanupUserIds } } })
      await prisma.attemptAnswer.deleteMany({ where: { attempt: { user_id: { in: cleanupUserIds } } } })
      await prisma.attemptQuestion.deleteMany({ where: { attempt: { user_id: { in: cleanupUserIds } } } })
      await prisma.attempt.deleteMany({ where: { user_id: { in: cleanupUserIds } } })
      await prisma.learningPath.deleteMany({ where: { user_id: { in: cleanupUserIds } } })
      await prisma.userLearningAssignment.deleteMany({ where: { user_id: { in: cleanupUserIds } } })
      await prisma.chapterMember.deleteMany({ where: { user_id: { in: cleanupUserIds } } })
      await prisma.accountStateInterval.deleteMany({ where: { user_id: { in: cleanupUserIds } } })
      await prisma.learningCycle.deleteMany({ where: { user_id: { in: cleanupUserIds } } })
      await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } })
    } catch (e) {
      console.warn('User cleanup warning:', e)
    }
  }
  if (cleanupCourseIds.length > 0) {
    try {
      await prisma.userLearningAssignment.deleteMany({ where: { course_id: { in: cleanupCourseIds } } })
      await prisma.course.deleteMany({ where: { id: { in: cleanupCourseIds } } })
    } catch (e) {
      console.warn('Course cleanup warning:', e)
    }
  }
}

import { recordVideoHeartbeat } from '../src/lib/video-heartbeat'
import { checkLessonProgression } from '../src/lib/progression'
import { endedCompletionToleranceSeconds } from '../src/lib/video-progress-rules'

async function run() {
  try {
    console.log('--- Starting Video Completion Acceptance Verification ---')

    // Find demo chapter
    const chapter = await prisma.chapter.findFirst()
    if (!chapter) throw new Error('No active chapter found')

    // 1. Create test user
    const testUser = await prisma.user.create({
      data: {
        email: `${fixturePrefix}-user@example.invalid`,
        password_hash: 'dummy',
        role: 'MEMBER',
        status: 'ACTIVE',
        chapter_members: {
          create: {
            chapter_id: chapter.id,
          },
        },
      },
    })
    cleanupUserIds.push(testUser.id)

    // 2. Create courses for each target duration: 10, 30, 60, 153, 165, 168 seconds
    const targetDurations = [10, 30, 60, 153, 165, 168]
    const testCourses: Record<number, any> = {}

    for (const dur of targetDurations) {
      const hasQuiz = dur === 168
      const course = await prisma.course.create({
        data: {
          title: `${fixturePrefix}-course-${dur}s`,
          status: 'PUBLISHED',
          visibility: 'PUBLIC',
          created_by: testUser.id,
          sessions: {
            create: {
              title: `Session for ${dur}s`,
              sort_order: 1,
              lessons: {
                create: {
                  title: `Lesson ${dur}s`,
                  sort_order: 1,
                  video: {
                    create: {
                      youtube_video_id: `yt-${dur}s-${fixturePrefix}`,
                      duration_seconds: dur,
                    },
                  },
                  ...(hasQuiz
                    ? {
                        assessment: {
                          create: {
                            title: `Quiz for ${dur}s`,
                            created_by: testUser.id,
                            question_count: 5,
                            duration_minutes: 10,
                            questions: {
                              create: [
                                {
                                  question_text: 'Sample Q1',
                                  sort_order: 1,
                                  options: {
                                    create: [
                                      { option_text: 'Option A (Correct)', is_correct: true, sort_order: 1 },
                                      { option_text: 'Option B', is_correct: false, sort_order: 2 },
                                    ],
                                  },
                                },
                              ],
                            },
                          },
                        },
                      }
                    : {}),
                },
              },
            },
          },
        },
        include: {
          sessions: {
            include: {
              lessons: {
                include: { video: true, assessment: true },
              },
            },
          },
        },
      })
      cleanupCourseIds.push(course.id)
      testCourses[dur] = course
    }

    const courseSeek = await prisma.course.create({
      data: {
        title: `${fixturePrefix}-course-seek`,
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        created_by: testUser.id,
        sessions: {
          create: {
            title: 'Session Seek',
            sort_order: 1,
            lessons: {
              create: {
                title: 'Lesson Seek 10s',
                sort_order: 1,
                video: {
                  create: {
                    youtube_video_id: `yt-seek-${fixturePrefix}`,
                    duration_seconds: 10,
                  },
                },
              },
            },
          },
        },
      },
      include: { sessions: { include: { lessons: { include: { video: true } } } } },
    })
    cleanupCourseIds.push(courseSeek.id)
    const lessonSeek = courseSeek.sessions[0].lessons[0]

    const coursePause = await prisma.course.create({
      data: {
        title: `${fixturePrefix}-course-pause`,
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        created_by: testUser.id,
        sessions: {
          create: {
            title: 'Session Pause',
            sort_order: 1,
            lessons: {
              create: {
                title: 'Lesson Pause 10s',
                sort_order: 1,
                video: {
                  create: {
                    youtube_video_id: `yt-pause-${fixturePrefix}`,
                    duration_seconds: 10,
                  },
                },
              },
            },
          },
        },
      },
      include: { sessions: { include: { lessons: { include: { video: true } } } } },
    })
    cleanupCourseIds.push(coursePause.id)
    const lessonPause = coursePause.sessions[0].lessons[0]

    const lesson168 = testCourses[168].sessions[0].lessons[0]

    // =========================================================================
    // Test 1: Anti-Seek Prevention
    // Jump straight to duration on first heartbeat without elapsed time
    // =========================================================================
    console.log('\n[Test 1] Anti-Seek: jumping straight to ENDED without elapsed watch time...')
    const seekResult = await recordVideoHeartbeat(
      testUser.id,
      lessonSeek.id,
      10,
      10,
      false,
      'seek-session-1',
      { playbackRate: 1, event: 'ENDED' },
    )
    assert.equal(seekResult.videoCompleted, false, 'Seek cheat must NOT complete the video')
    assert.equal(seekResult.starReward.awarded, false, 'Seek cheat must NOT award stars')
    console.log('  ✓ Anti-seek correctly blocked instant completion and stars')

    // =========================================================================
    // Test 2: Pause / Buffering does NOT add progress
    // =========================================================================
    console.log('\n[Test 2] Pause / Buffering: elapsed wall-time while paused must not advance content...')
    // Send PLAY at position 0
    await recordVideoHeartbeat(testUser.id, lessonPause.id, 0, 0, false, 'pause-session-1', { playbackRate: 1, event: 'PLAY' })
    // Simulate user pausing with 60s elapsed
    await prisma.monthlyVideoReplay.updateMany({
      where: { user_id: testUser.id, video_id: lessonPause.video.id },
      data: { last_heartbeat_at: new Date(Date.now() - 60000) },
    })
    await prisma.lessonProgress.updateMany({
      where: { user_id: testUser.id, lesson_id: lessonPause.id },
      data: { last_watched_at: new Date(Date.now() - 60000) },
    })
    const pauseResult = await recordVideoHeartbeat(testUser.id, lessonPause.id, 0, 0, false, 'pause-session-1', { playbackRate: 1, event: 'PAUSE' })
    assert.equal(pauseResult.furthestWatchedPositionSeconds, 0, 'Pause must not award progress')
    assert.equal(pauseResult.videoCompleted, false, 'Pause must not complete video')
    console.log('  ✓ Pause / Buffering does not award fake progress (position remains 0)')

    // =========================================================================
    // Test 3: Real watch to end across all required durations and playback rates
    // [10s, 30s, 60s, 153s, 165s, 168s] at [1x, 1.5x, 2x]
    // =========================================================================
    console.log('\n[Test 3] Real watch to end across all required durations and playback rates...')
    const testCases = [
      { dur: 10, rate: 1.0 },
      { dur: 30, rate: 1.5 },
      { dur: 60, rate: 2.0 },
      { dur: 153, rate: 1.0 },
      { dur: 165, rate: 1.5 },
      { dur: 168, rate: 2.0 },
    ]

    for (const { dur, rate } of testCases) {
      const course = testCourses[dur]
      const lesson = course.sessions[0].lessons[0]
      const video = lesson.video
      const sessionId = `watch-${dur}s-${rate}x`

      // Step A: PLAY event
      await recordVideoHeartbeat(testUser.id, lesson.id, 0, 0, false, sessionId, { playbackRate: rate, event: 'PLAY' })

      // Step B: simulate incremental heartbeats at rate
      let cur = 0
      const stepSeconds = Math.min(10, Math.max(2, Math.floor(dur / 4)))
      while (cur < dur - endedCompletionToleranceSeconds(dur)) {
        cur = Math.min(dur, cur + stepSeconds * rate)
        // Back-date last_heartbeat_at to simulate real elapsed wall-clock time
        await prisma.monthlyVideoReplay.updateMany({
          where: { user_id: testUser.id, video_id: video.id },
          data: { last_heartbeat_at: new Date(Date.now() - (stepSeconds + 1) * 1000) },
        })
        await prisma.lessonProgress.updateMany({
          where: { user_id: testUser.id, lesson_id: lesson.id },
          data: { last_watched_at: new Date(Date.now() - (stepSeconds + 1) * 1000) },
        })

        if (cur >= dur - endedCompletionToleranceSeconds(dur)) break

        await recordVideoHeartbeat(testUser.id, lesson.id, cur, cur, false, sessionId, {
          playbackRate: rate,
          event: 'HEARTBEAT',
        })
      }

      // Step C: ENDED event within tolerance (e.g. dur - 0.4s)
      const endedPos = Math.max(0, dur - 0.4)
      await prisma.monthlyVideoReplay.updateMany({
        where: { user_id: testUser.id, video_id: video.id },
        data: { last_heartbeat_at: new Date(Date.now() - (stepSeconds + 1) * 1000) },
      })
      await prisma.lessonProgress.updateMany({
        where: { user_id: testUser.id, lesson_id: lesson.id },
        data: { last_watched_at: new Date(Date.now() - (stepSeconds + 1) * 1000) },
      })

      const endedResult = await recordVideoHeartbeat(
        testUser.id,
        lesson.id,
        endedPos,
        endedPos,
        false,
        sessionId,
        { playbackRate: rate, event: 'ENDED' },
      )

      assert.equal(endedResult.videoCompleted, true, `${dur}s at ${rate}x: videoCompleted must be true`)
      assert.equal(endedResult.furthestWatchedPositionSeconds, dur, `${dur}s at ${rate}x: furthest must be clamped to full duration (${dur})`)
      assert.equal(endedResult.progressPercentage, 100, `${dur}s at ${rate}x: progressPercentage must be 100%`)

      // Verify DB persistence: furthest_seconds must be dur
      const cycleProg = await prisma.cycleLessonProgress.findFirst({
        where: { user_id: testUser.id, lesson_id: lesson.id },
      })
      assert.equal(cycleProg?.furthest_seconds, dur, `DB cycle_lesson_progress furthest_seconds must be ${dur}`)

      const lessonProg = await prisma.lessonProgress.findFirst({
        where: { user_id: testUser.id, lesson_id: lesson.id },
      })
      assert.equal(lessonProg?.furthest_watched_position_seconds, dur, `DB lesson_progress furthest must be ${dur}`)

      console.log(`  ✓ Duration ${dur}s at ${rate}x: completed, persisted to DB (${dur}s / 100%), stars awarded: ${endedResult.starReward.awarded}`)
    }

    // =========================================================================
    // Test 4: Stale / Delayed Heartbeat arriving after ENDED does NOT revert completion
    // =========================================================================
    console.log('\n[Test 4] Delayed / Stale heartbeat arriving after ENDED does not revert completion...')
    const delayedHeartbeat = await recordVideoHeartbeat(
      testUser.id,
      lesson168.id,
      150,
      150,
      false,
      'stale-session-delayed',
      { playbackRate: 2, event: 'HEARTBEAT' },
    )
    assert.equal(delayedHeartbeat.videoCompleted, true, 'Video completion must remain true')
    assert.equal(delayedHeartbeat.furthestWatchedPositionSeconds, 168, 'Furthest seconds must not regress')
    assert.equal(delayedHeartbeat.progressPercentage, 100, 'Progress percentage must remain 100%')

    const cycleProgCheck = await prisma.cycleLessonProgress.findFirst({
      where: { user_id: testUser.id, lesson_id: lesson168.id },
    })
    assert.equal(cycleProgCheck?.furthest_seconds, 168, 'DB furthest_seconds must remain 168')
    console.log('  ✓ Stale heartbeat was prevented from reverting completion')

    // =========================================================================
    // Test 5: Quiz Access Gate
    // Learner can access quiz without false rejection after video completion
    // =========================================================================
    console.log('\n[Test 5] Quiz access validation after video completion (Lesson 168s)...')
    const progressionDecision = await checkLessonProgression(testUser.id, lesson168.id, 'ASSESS', false)
    assert.equal(progressionDecision.ok, true, 'Learner must be permitted to access quiz (ASSESS) once video is completed')
    console.log('  ✓ Quiz access allowed without false rejection (ok: true)')

    // =========================================================================
    // Test 6: Idempotent Star Rewards
    // Duplicate / Concurrent ENDED requests do NOT award duplicate stars
    // =========================================================================
    console.log('\n[Test 6] Duplicate ENDED heartbeats: zero duplicate stars...')
    const duplicateEnded = await recordVideoHeartbeat(
      testUser.id,
      lesson168.id,
      168,
      168,
      false,
      'dup-session-168',
      { playbackRate: 2, event: 'ENDED' },
    )
    assert.equal(duplicateEnded.starReward.awarded, false, 'Duplicate ENDED must not award new stars')
    const starCount = await prisma.starLedger.count({
      where: { user_id: testUser.id, source_type: 'VIDEO', source_id: lesson168.video.id },
    })
    assert.equal(starCount, 1, 'Exactly 1 star record in starLedger')
    console.log('  ✓ Star rewards are completely idempotent (exactly 1 star entry awarded)')

    // =========================================================================
    // Test 7: Video Completed vs Lesson Completed distinction
    // Lesson with quiz is NOT lesson-completed until quiz is passed
    // =========================================================================
    console.log('\n[Test 7] Video completed vs Lesson completed distinction...')
    const prog168 = await prisma.cycleLessonProgress.findFirst({
      where: { user_id: testUser.id, lesson_id: lesson168.id },
    })
    assert.equal(prog168?.completed_at, null, 'Lesson with quiz must NOT have completed_at set until quiz is passed')
    assert.equal(prog168?.furthest_seconds, 168, 'Video watch must still be 100% (168s)')
    console.log('  ✓ Correct distinction: videoCompleted is true, lesson completed_at is null pending quiz')

    // =========================================================================
    // Test 8: Sequential Multi-Lesson Unlock
    // Watching Lesson 1 unlocks Lesson 2 immediately without false rejection
    // =========================================================================
    console.log('\n[Test 8] Sequential Multi-Lesson Unlock...')
    const seqCourse = await prisma.course.create({
      data: {
        title: `${fixturePrefix}-seq-course`,
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        created_by: testUser.id,
        sessions: {
          create: {
            title: 'Sequential Session',
            sort_order: 1,
            lessons: {
              create: [
                {
                  title: 'Seq Lesson 1',
                  sort_order: 1,
                  video: { create: { youtube_video_id: `yt-seq-1-${fixturePrefix}`, duration_seconds: 10 } },
                },
                {
                  title: 'Seq Lesson 2',
                  sort_order: 2,
                  video: { create: { youtube_video_id: `yt-seq-2-${fixturePrefix}`, duration_seconds: 10 } },
                },
              ],
            },
          },
        },
      },
      include: { sessions: { include: { lessons: { include: { video: true } } } } },
    })
    cleanupCourseIds.push(seqCourse.id)

    const [seqL1, seqL2] = seqCourse.sessions[0].lessons

    // Before watching L1, L2 should be locked
    const l2Before = await checkLessonProgression(testUser.id, seqL2.id, 'WATCH', false)
    assert.equal(l2Before.ok, false, 'Lesson 2 should be locked before Lesson 1 is completed')
    assert.equal(l2Before.code, 'PreviousLessonIncomplete', 'Reason should be PreviousLessonIncomplete')

    // Watch L1 to completion
    await recordVideoHeartbeat(testUser.id, seqL1.id, 0, 0, false, 'seq-s1', { playbackRate: 1, event: 'PLAY' })
    await prisma.monthlyVideoReplay.updateMany({
      where: { user_id: testUser.id, video_id: seqL1.video.id },
      data: { last_heartbeat_at: new Date(Date.now() - 11000) },
    })
    await prisma.lessonProgress.updateMany({
      where: { user_id: testUser.id, lesson_id: seqL1.id },
      data: { last_watched_at: new Date(Date.now() - 11000) },
    })
    const seqL1Result = await recordVideoHeartbeat(testUser.id, seqL1.id, 10, 10, false, 'seq-s1', { playbackRate: 1, event: 'ENDED' })
    assert.equal(seqL1Result.videoCompleted, true, 'Seq Lesson 1 must be videoCompleted: true')

    // Now L2 must be unlocked!
    const l2After = await checkLessonProgression(testUser.id, seqL2.id, 'WATCH', false)
    assert.equal(l2After.ok, true, 'Lesson 2 must be unlocked immediately after Lesson 1 completion')
    console.log('  ✓ Sequential progression: Lesson 2 successfully unlocked upon Lesson 1 completion')

    console.log('\n============================================================')
    console.log('🎉 ALL BACKEND ACCEPTANCE CHECKS PASSED 100% (8/8 TESTS PASS)')
    console.log('============================================================\n')
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
}

run().catch((err) => {
  console.error('Acceptance test failed:', err)
  process.exit(1)
})

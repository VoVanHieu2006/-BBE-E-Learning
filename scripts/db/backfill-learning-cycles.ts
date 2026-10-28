/**
 * One-time, idempotent compatibility backfill for the current development/test
 * database. It activates the cycle model and imports legacy progress/stars so
 * monthly replay, quiz high-water marks and Chapter rankings stop reading an
 * empty cycle table.
 *
 * Run with:
 *   npx ts-node -P scripts/tsconfig.json --transpile-only scripts/db/backfill-learning-cycles.ts --apply
 *
 * Without --apply it only prints the planned counts.
 */
import { PrismaClient } from '@prisma/client'
import 'dotenv/config'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const CUTOVER = new Date('2026-09-01T00:00:00.000Z')
const VN_OFFSET_MS = 7 * 60 * 60 * 1000

function monthKey(value: Date): string {
  const local = new Date(value.getTime() + VN_OFFSET_MS)
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthBounds(key: string) {
  const [year, month] = key.split('-').map(Number)
  return {
    startsAt: new Date(Date.UTC(year, month - 1, 1) - VN_OFFSET_MS),
    endsAt: new Date(Date.UTC(year, month, 1) - VN_OFFSET_MS),
  }
}

async function main() {
  const now = new Date()
  const users = await prisma.user.findMany({
    where: { role: { in: ['MEMBER', 'CHAPTER_LEADER'] }, status: 'ACTIVE' },
    select: { id: true, role: true, created_at: true },
    orderBy: { id: 'asc' },
  })
  const cycles = await prisma.learningCycle.findMany({ where: { ends_at: null }, select: { id: true, user_id: true, starts_at: true } })
  const cycleByUser = new Map(cycles.map((row) => [row.user_id, row]))
  const chapterByUser = new Map(
    (await prisma.chapterMember.findMany({ select: { user_id: true, chapter_id: true } })).map((row) => [row.user_id, row.chapter_id]),
  )
  const intervals = await prisma.chapterAffiliationInterval.findMany({
    select: { user_id: true, chapter_id: true, starts_at: true, ends_at: true },
  })
  const progress = await prisma.lessonProgress.findMany({
    select: {
      user_id: true,
      lesson_id: true,
      completed: true,
      completed_at: true,
      furthest_watched_position_seconds: true,
    },
  })
  const attempts = await prisma.attempt.findMany({
    where: { learning_cycle_id: null, started_at: { gte: CUTOVER } },
    select: { id: true, user_id: true },
  })
  const assignments = await prisma.userLearningAssignment.findMany({
    where: { learning_cycle_id: null, ended_at: null },
    select: { id: true, user_id: true },
  })
  const stars = await prisma.starLedger.findMany({
    where: { competition_month_id: null },
    select: { id: true, user_id: true, awarded_at: true, chapter_at_award_id: true, learning_cycle_id: true },
  })

  const monthKeys = Array.from(new Set(stars.map((row) => monthKey(row.awarded_at))))
  const existingMonths = await prisma.competitionMonth.findMany({ where: { key: { in: monthKeys } }, select: { id: true, key: true } })
  const monthByKey = new Map(existingMonths.map((row) => [row.key, row.id]))

  console.log(JSON.stringify({
    apply: APPLY,
    users: users.length,
    existingActiveCycles: cycles.length,
    progressRows: progress.length,
    attemptsToAttach: attempts.length,
    assignmentsToAttach: assignments.length,
    starsToMonth: stars.length,
    monthsNeeded: monthKeys.sort(),
  }, null, 2))
  if (!APPLY) return

  await prisma.learningPolicy.upsert({
    where: { id: 'default' },
    update: { cutover_at: CUTOVER, mapping_approved_at: now },
    create: { id: 'default', cutover_at: CUTOVER, mapping_approved_at: now },
  })

  for (const key of monthKeys.sort()) {
    if (monthByKey.has(key)) continue
    const bounds = monthBounds(key)
    const row = await prisma.competitionMonth.upsert({
      where: { key },
      update: {},
      create: { key, starts_at: bounds.startsAt, ends_at: bounds.endsAt, state: bounds.endsAt <= now ? 'CLOSED' : 'OPEN' },
      select: { id: true },
    })
    monthByKey.set(key, row.id)
  }

  let createdCycles = 0
  let createdProgress = 0
  let attachedAttempts = 0
  let attachedAssignments = 0
  for (const user of users) {
    let cycle = cycleByUser.get(user.id)
    if (!cycle) {
      cycle = await prisma.learningCycle.create({
        data: {
          user_id: user.id,
          chapter_id: chapterByUser.get(user.id) || null,
          trigger_key: `backfill:${user.id}`,
          starts_at: CUTOVER,
          provenance: 'LEGACY',
        },
        select: { id: true, user_id: true, starts_at: true },
      })
      cycleByUser.set(user.id, cycle)
      createdCycles++
      await prisma.learningPath.create({
        data: { user_id: user.id, learning_cycle_id: cycle.id, starts_at: CUTOVER },
      }).catch(() => null)
    }
    const userProgress = progress.filter((row) => row.user_id === user.id)
    if (userProgress.length) {
      const result = await prisma.cycleLessonProgress.createMany({
        data: userProgress.map((row) => ({
          user_id: user.id,
          lesson_id: row.lesson_id,
          learning_cycle_id: cycle!.id,
          furthest_seconds: row.furthest_watched_position_seconds || 0,
          completed_at: row.completed ? row.completed_at || CUTOVER : null,
          unlocked_at: row.completed ? row.completed_at || CUTOVER : null,
          provenance: 'LEGACY',
        })),
        skipDuplicates: true,
      })
      createdProgress += result.count
    }
  }

  for (const attempt of attempts) {
    const cycle = cycleByUser.get(attempt.user_id)
    if (!cycle) continue
    await prisma.attempt.update({ where: { id: attempt.id }, data: { learning_cycle_id: cycle.id } })
    attachedAttempts++
  }
  for (const assignment of assignments) {
    const cycle = cycleByUser.get(assignment.user_id)
    if (!cycle) continue
    await prisma.userLearningAssignment.update({ where: { id: assignment.id }, data: { learning_cycle_id: cycle.id } })
    attachedAssignments++
  }

  let assignedStarMonths = 0
  let assignedStarChapters = 0
  for (const star of stars) {
    const key = monthKey(star.awarded_at)
    const monthId = monthByKey.get(key)
    let chapterId = star.chapter_at_award_id
    if (!chapterId) {
      const at = star.awarded_at
      const interval = intervals.find((row) =>
        row.user_id === star.user_id
        && row.starts_at <= at
        && (!row.ends_at || row.ends_at > at),
      )
      chapterId = interval?.chapter_id || chapterByUser.get(star.user_id) || null
      if (chapterId) assignedStarChapters++
    }
    const cycle = cycleByUser.get(star.user_id)
    const cycleId = star.learning_cycle_id || (cycle && star.awarded_at >= cycle.starts_at ? cycle.id : null)
    await prisma.starLedger.update({
      where: { id: star.id },
      data: { competition_month_id: monthId || null, chapter_at_award_id: chapterId, learning_cycle_id: cycleId },
    })
    if (monthId) assignedStarMonths++
  }

  console.log(JSON.stringify({
    createdCycles,
    createdProgress,
    attachedAttempts,
    attachedAssignments,
    assignedStarMonths,
    assignedStarChapters,
    cutover: CUTOVER.toISOString(),
  }, null, 2))
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())

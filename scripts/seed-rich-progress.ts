/**
 * Second, batched phase of the rich demo seed. Organization/membership/cycle
 * setup is completed by the bulk setup script; this phase writes real lesson
 * progress and StarLedger evidence in batches.
 */
import { PrismaClient, StarReason } from '@prisma/client'
import 'dotenv/config'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const CUTOVER = new Date('2026-09-01T00:00:00.000Z')

const SPECS = [
  { name: 'BBE Seed Nhỏ Chapter', qualified: 0, sepStars: 100, octStars: 100 },
  { name: 'BBE Seed Đang học Chapter', qualified: 8, sepStars: 300, octStars: 220 },
  { name: 'BBE Seed KPI Đỏ Chapter', qualified: 24, sepStars: 700, octStars: 900 },
  { name: 'BBE Seed Cân bằng Chapter', qualified: 28, sepStars: 700, octStars: 800 },
  { name: 'BBE Seed Xuất sắc Chapter', qualified: 46, sepStars: 1200, octStars: 1275 },
  { name: 'BBE Seed Đúng 50 Chapter', qualified: 12, sepStars: 400, octStars: 504 },
  { name: 'BBE Seed Đúng 20 Chapter', qualified: 20, sepStars: 300, octStars: 400 },
  { name: 'BBE Seed Checkpoint 70 Chapter', qualified: 35, sepStars: 900, octStars: 1100 },
] as const

const OVERRIDES: Record<string, number> = {
  'member.zero@bbe.vn': 0,
  'member.below70@bbe.vn': 34,
  'member.exact70@bbe.vn': 35,
  'member.above70@bbe.vn': 40,
}

function distribute(total: number, count: number): number[] {
  const base = Math.floor(total / count)
  const extra = total % count
  return Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0))
}

function rebalance(amounts: number[], target: number) {
  let difference = target - amounts.reduce((sum, amount) => sum + amount, 0)
  let index = 0
  while (difference !== 0 && index < amounts.length * 6) {
    const at = index % amounts.length
    if (difference > 0) { amounts[at] += 1; difference-- }
    else if (amounts[at] > 0) { amounts[at] -= 1; difference++ }
    index++
  }
}

async function main() {
  const chapters = await prisma.chapter.findMany({ where: { name: { in: SPECS.map((spec) => spec.name) } }, select: { id: true, name: true } })
  const chapterByName = new Map(chapters.map((chapter) => [chapter.name, chapter]))
  const coreCourses = await prisma.course.findMany({
    where: { status: 'PUBLISHED', program: { code: { in: ['CORE_MEMBER', 'CORE_LEADER', 'CORE_DNA'] } } },
    include: { sessions: { include: { lessons: { include: { video: true }, orderBy: { sort_order: 'asc' } } }, orderBy: { sort_order: 'asc' } } },
    orderBy: { created_at: 'asc' },
  })
  const coreLessons = coreCourses.flatMap((course) => course.sessions.flatMap((session) => session.lessons))
  if (coreLessons.length !== 50) throw new Error(`Expected 50 core lessons, found ${coreLessons.length}`)
  const firstVideoId = coreLessons.find((lesson) => lesson.video)?.video?.id
  if (!firstVideoId) throw new Error('Missing core video')
  const sep = await prisma.competitionMonth.findUniqueOrThrow({ where: { key: '2026-09' } })
  const oct = await prisma.competitionMonth.findUniqueOrThrow({ where: { key: '2026-10' } })

  const participants: Array<{ id: string; email: string; chapterId: string | null; chapterName: string | null; counts: number; sepStars: number; octStars: number }> = []
  for (const spec of SPECS) {
    const chapter = chapterByName.get(spec.name)
    if (!chapter) throw new Error(`Missing chapter ${spec.name}`)
    const rows = await prisma.chapterMember.findMany({ where: { chapter_id: chapter.id }, include: { user: { select: { id: true, email: true, role: true } } } })
    const members = rows.filter((row) => row.user.role === 'MEMBER').sort((a, b) => a.user.email.localeCompare(b.user.email))
    const counts = members.map(() => 10)
    for (let index = 0; index < spec.qualified && index < counts.length; index++) counts[index] = 36
    for (let index = 0; index < members.length; index++) {
      const override = OVERRIDES[members[index].user.email]
      if (override !== undefined) counts[index] = override
    }
    let qualified = counts.filter((count) => count >= 35).length
    for (let index = 0; index < counts.length && qualified > spec.qualified; index++) {
      if (counts[index] >= 35) { counts[index] = 34; qualified-- }
    }
    for (let index = 0; index < counts.length && qualified < spec.qualified; index++) {
      if (counts[index] < 35) { counts[index] = 36; qualified++ }
    }
    const octStars = distribute(spec.octStars, members.length)
    const sepStars = distribute(spec.sepStars, members.length)
    members.forEach((row, index) => {
      const override = OVERRIDES[row.user.email]
      if (override !== undefined) { sepStars[index] = override === 0 ? 0 : Math.max(1, Math.round(override / 10)); octStars[index] = override === 0 ? 0 : override }
    })
    rebalance(octStars, spec.octStars)
    rebalance(sepStars, spec.sepStars)
    // Keep the explicit zero-Star demo accounts at zero while preserving the
    // Chapter's target total by moving the accidental amount to a neighbour.
    for (const email of ['member.zero@bbe.vn', 'member.below70@bbe.vn']) {
      const index = members.findIndex((row) => row.user.email === email)
      if (index < 0) continue
      for (const amounts of [octStars, sepStars]) {
        if (amounts[index] !== 0) {
          const moved = amounts[index]
          amounts[index] = 0
          const neighbour = (index + 1) % amounts.length
          if (neighbour !== index) amounts[neighbour] += moved
        }
      }
    }
    members.forEach((row, index) => participants.push({
      id: row.user.id, email: row.user.email, chapterId: chapter.id, chapterName: chapter.name,
      counts: counts[index], sepStars: sepStars[index], octStars: octStars[index],
    }))
  }

  // LT/President and DNA participants: 50/50 progress and a small Star history.
  const extraEmails = ['leader.dna@bbe.vn', 'dna.sgdc@bbe.vn', 'dna.ldc@bbe.vn', 'dna.tt@bbe.vn']
  const extras = await prisma.user.findMany({ where: { email: { in: extraEmails } }, include: { chapter_members: { select: { chapter_id: true } } } })
  for (const user of extras) {
    participants.push({
      id: user.id, email: user.email, chapterId: user.chapter_members[0]?.chapter_id || null,
      chapterName: null, counts: 50, sepStars: 50, octStars: 60,
    })
  }

  const ids = participants.map((row) => row.id)
  const cycles = await prisma.learningCycle.findMany({ where: { user_id: { in: ids }, ends_at: null }, select: { id: true, user_id: true } })
  const cycleByUser = new Map(cycles.map((cycle) => [cycle.user_id, cycle.id]))
  if (cycleByUser.size !== ids.length) throw new Error(`Missing active cycles: ${ids.length - cycleByUser.size}`)

  const lessonProgress: any[] = []
  const cycleProgress: any[] = []
  const stars: any[] = []
  for (const person of participants) {
    const cycleId = cycleByUser.get(person.id)!
    for (let index = 0; index < person.counts; index++) {
      const lesson = coreLessons[index]
      const completedAt = new Date(Date.UTC(2026, 8, 10 + (index % 12), 5, 0, 0))
      const duration = lesson.video?.duration_seconds || 180
      lessonProgress.push({
        user_id: person.id, lesson_id: lesson.id, completed: true, completed_at: completedAt,
        furthest_watched_position_seconds: duration, last_position_seconds: duration, last_watched_at: completedAt,
      })
      cycleProgress.push({
        user_id: person.id, lesson_id: lesson.id, learning_cycle_id: cycleId,
        furthest_seconds: duration, completed_at: completedAt, unlocked_at: completedAt, provenance: 'NATIVE',
      })
    }
    const addStars = (total: number, monthId: string, month: 'SEP' | 'OCT') => {
      let left = total
      let part = 0
      while (left > 0) {
        const amount = Math.min(5, left)
        stars.push({
          user_id: person.id, amount, reason: StarReason.VIDEO_COMPLETION,
          reward_key: `rich-seed:${month}:${person.id}:${part}`,
          source_type: 'VIDEO', source_id: firstVideoId,
          awarded_at: month === 'SEP' ? new Date(Date.UTC(2026, 8, 20 + part, 12, 0, 0)) : new Date(Date.UTC(2026, 9, 5 + part, 12, 0, 0)),
          competition_month_id: monthId, learning_cycle_id: cycleId,
          chapter_at_award_id: person.chapterId, provenance: 'NATIVE',
          metadata: { seed: true, chapter: person.chapterName, month: month === 'SEP' ? '2026-09' : '2026-10' },
        })
        left -= amount
        part++
      }
    }
    addStars(person.sepStars, sep.id, 'SEP')
    addStars(person.octStars, oct.id, 'OCT')
  }

  console.log(JSON.stringify({ apply: APPLY, participants: participants.length, lessonProgress: lessonProgress.length, cycleProgress: cycleProgress.length, stars: stars.length }, null, 2))
  if (!APPLY) return

  const lessonIds = coreLessons.map((lesson) => lesson.id)
  await prisma.cycleLessonProgress.deleteMany({ where: { user_id: { in: ids }, lesson_id: { in: lessonIds } } })
  await prisma.lessonProgress.deleteMany({ where: { user_id: { in: ids }, lesson_id: { in: lessonIds } } })
  await prisma.starLedger.deleteMany({ where: { user_id: { in: ids }, reward_key: { startsWith: 'rich-seed:' } } })
  for (let index = 0; index < lessonProgress.length; index += 1000) await prisma.lessonProgress.createMany({ data: lessonProgress.slice(index, index + 1000), skipDuplicates: true })
  for (let index = 0; index < cycleProgress.length; index += 1000) await prisma.cycleLessonProgress.createMany({ data: cycleProgress.slice(index, index + 1000), skipDuplicates: true })
  for (let index = 0; index < stars.length; index += 1000) await prisma.starLedger.createMany({ data: stars.slice(index, index + 1000), skipDuplicates: true })

  console.log((await prisma.chapterMember.groupBy({ by: ['chapter_id'], _count: true })).length, 'chapters with members written')
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())

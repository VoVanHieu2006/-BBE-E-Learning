/**
 * Rich, reproducible development/test seed for BBE E-Learning.
 *
 * It creates real organizations, Chapter memberships, learning cycles, lesson
 * progress, attempts' prerequisite progress and StarLedger evidence instead of
 * writing aggregate leaderboard numbers. The official Chapter formula is then
 * computed by the application from these facts.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json --transpile-only scripts/seed-rich-demo.ts --apply
 *
 * The script is idempotent for its own `rich-seed:` records. It intentionally
 * does not touch the Admin's real/admin-created courses.
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import 'dotenv/config'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const PASSWORD = 'Bbe@123456'
const CUTOVER = new Date('2026-09-01T00:00:00.000Z')
const SEP_START = new Date('2026-09-01T00:00:00.000Z')
const OCT_START = new Date('2026-10-01T00:00:00.000Z')
const VN_BOUNDARY_APR = new Date('2026-03-31T17:00:00.000Z')
const VN_BOUNDARY_OCT = new Date('2026-09-30T17:00:00.000Z')

type ChapterSpec = {
  name: string
  slug: string
  size: number
  qualified: number
  kpi: 'GREEN' | 'YELLOW' | 'RED' | 'BLACK'
  sepStars: number
  octStars: number
  create: boolean
  demo?: string[]
}

const CHAPTERS: ChapterSpec[] = [
  { name: 'BBE Seed Nhỏ Chapter', slug: 'seed-small', size: 15, qualified: 0, kpi: 'GREEN', sepStars: 100, octStars: 100, create: false, demo: ['member.zero@bbe.vn'] },
  { name: 'BBE Seed Đang học Chapter', slug: 'seed-learning', size: 22, qualified: 8, kpi: 'YELLOW', sepStars: 300, octStars: 220, create: false },
  { name: 'BBE Seed KPI Đỏ Chapter', slug: 'seed-red', size: 30, qualified: 24, kpi: 'RED', sepStars: 700, octStars: 900, create: false },
  { name: 'BBE Seed Cân bằng Chapter', slug: 'seed-balanced', size: 40, qualified: 28, kpi: 'YELLOW', sepStars: 700, octStars: 800, create: false },
  { name: 'BBE Seed Xuất sắc Chapter', slug: 'seed-green', size: 51, qualified: 46, kpi: 'GREEN', sepStars: 1200, octStars: 1275, create: false },
  { name: 'BBE Seed Đúng 50 Chapter', slug: 'seed-exact50', size: 24, qualified: 12, kpi: 'GREEN', sepStars: 400, octStars: 504, create: true },
  { name: 'BBE Seed Đúng 20 Chapter', slug: 'seed-exact20', size: 20, qualified: 20, kpi: 'GREEN', sepStars: 300, octStars: 400, create: true },
  {
    name: 'BBE Seed Checkpoint 70 Chapter', slug: 'seed-checkpoint', size: 50, qualified: 35, kpi: 'YELLOW', sepStars: 900, octStars: 1100, create: true,
    demo: ['member.below70@bbe.vn', 'member.exact70@bbe.vn', 'member.above70@bbe.vn'],
  },
]

const CORE_COURSE_TITLE = 'BBE Seed Core Practicum'

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function createManyBatched<T>(model: any, data: T[], batchSize = 1000) {
  for (const part of chunk(data, batchSize)) {
    if (part.length) await model.createMany({ data: part, skipDuplicates: true })
  }
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } })
  if (!admin) throw new Error('An active ADMIN account is required to own seeded records.')
  const root = await prisma.organizationUnit.findFirst({ where: { type: 'ROOT' }, select: { id: true } })
  const dnaUnit = await prisma.organizationUnit.findFirst({ where: { type: 'DNA' }, select: { id: true } })
  if (!root || !dnaUnit) throw new Error('ROOT and DNA organization units are required.')

  const coreProgram = await prisma.learningProgram.findUnique({ where: { code: 'CORE_MEMBER' }, select: { id: true } })
  if (!coreProgram) throw new Error('CORE_MEMBER program is required.')

  const hash = await bcrypt.hash(PASSWORD, 10)
  const plannedUsers = new Map<string, { email: string; display_name: string; role: 'MEMBER' | 'CHAPTER_LEADER' | 'ADMIN'; chapter?: string; dnaGroup?: 'TT' | 'SGDC' | 'LDC'; position?: string; unit?: string }>()

  // ---------- Core curriculum: 42 existing lessons + 8 practicum lessons = 50 ----------
  let coreCourse = await prisma.course.findFirst({ where: { title: CORE_COURSE_TITLE }, include: { sessions: { include: { lessons: { include: { video: true } } } } } })
  if (!coreCourse) {
    coreCourse = await prisma.course.create({
      data: {
        title: CORE_COURSE_TITLE,
        description: 'Khóa thực hành bổ sung dùng để kiểm thử chính xác mốc 70% trên 50 bài lõi.',
        status: 'PUBLISHED',
        visibility: 'PRIVATE',
        program_id: coreProgram.id,
        created_by: admin.id,
        published_at: SEP_START,
        cover_url: '/images/course-covers/organization-culture.png',
      },
      include: { sessions: { include: { lessons: { include: { video: true } } } } },
    })
    const session = await prisma.session.create({ data: { course_id: coreCourse.id, title: 'Thực hành lõi', sort_order: 1 } })
    for (let index = 1; index <= 8; index++) {
      const lesson = await prisma.lesson.create({ data: { session_id: session.id, title: `Bài thực hành lõi ${index}`, sort_order: index } })
      await prisma.video.create({ data: { lesson_id: lesson.id, provider: 'YOUTUBE', youtube_video_id: 'S-QqTDbsuBA', duration_seconds: 180, title: lesson.title } })
    }
    coreCourse = await prisma.course.findUniqueOrThrow({ where: { id: coreCourse.id }, include: { sessions: { include: { lessons: { include: { video: true } } } } } })
  }
  const existingCoreEvent = await prisma.coursePublicationEvent.findFirst({ where: { course_id: coreCourse.id, effective_at: { lte: SEP_START } } })
  if (!existingCoreEvent) {
    await prisma.coursePublicationEvent.create({ data: { course_id: coreCourse.id, status: 'PUBLISHED', effective_at: SEP_START } })
  }

  const coreCourses = await prisma.course.findMany({
    where: { status: 'PUBLISHED', program: { code: { in: ['CORE_MEMBER', 'CORE_LEADER', 'CORE_DNA'] } } },
    include: { sessions: { include: { lessons: { include: { video: true } } }, orderBy: { sort_order: 'asc' } } },
    orderBy: { created_at: 'asc' },
  })
  const coreLessons = coreCourses.flatMap((course) => course.sessions.flatMap((session) => session.lessons))
  if (coreLessons.length !== 50) throw new Error(`Expected 50 published core lessons, found ${coreLessons.length}.`)
  const firstVideoId = coreLessons.find((lesson) => lesson.video)?.video?.id
  if (!firstVideoId) throw new Error('A core video is required.')
  // Historical demo snapshots need the core curriculum to have been published
  // at the start of the first seeded month. This is demo metadata only.
  for (const course of coreCourses) {
    const earlier = await prisma.coursePublicationEvent.findFirst({ where: { course_id: course.id, effective_at: { lte: SEP_START } } })
    if (!earlier) await prisma.coursePublicationEvent.create({ data: { course_id: course.id, status: 'PUBLISHED', effective_at: SEP_START } })
  }

  // ---------- Chapter / department structure ----------
  const chapters = new Map<string, { id: string; unitId: string; departments: string[] }>()
  for (const spec of CHAPTERS) {
    let chapter = await prisma.chapter.findUnique({ where: { name: spec.name }, select: { id: true, organization_unit_id: true } })
    let unitId = chapter?.organization_unit_id || null
    if (!unitId) {
      const unit = await prisma.organizationUnit.create({ data: { name: spec.name, type: 'CHAPTER', parent_id: root.id } })
      unitId = unit.id
    }
    if (!chapter) chapter = await prisma.chapter.create({ data: { name: spec.name, status: 'ACTIVE', organization_unit_id: unitId }, select: { id: true, organization_unit_id: true } })
    else if (chapter.organization_unit_id !== unitId) await prisma.chapter.update({ where: { id: chapter.id }, data: { organization_unit_id: unitId, status: 'ACTIVE' } })
    const departmentNames = ['Ban Thành viên', 'Ban Nội dung', 'Ban Thư ký', 'Chủ tịch']
    const departments: string[] = []
    for (const name of departmentNames) {
      const department = await prisma.organizationUnit.findFirst({ where: { name, type: 'DEPARTMENT', parent_id: unitId } })
        || await prisma.organizationUnit.create({ data: { name, type: 'DEPARTMENT', parent_id: unitId } })
      departments.push(department.id)
    }
    chapters.set(spec.slug, { id: chapter.id, unitId, departments })
  }

  // ---------- Users ----------
  for (const spec of CHAPTERS) {
    const prefix = spec.slug.replace('seed-', '')
    if (spec.create) {
      for (let i = 1; i <= spec.size - (spec.demo?.length || 0); i++) {
        const email = `${spec.slug}-${String(i).padStart(2, '0')}@demo.bbe.vn`
        plannedUsers.set(email, { email, display_name: `${spec.name} ${i}`, role: 'MEMBER', chapter: spec.slug })
      }
    }
    for (const email of spec.demo || []) {
      plannedUsers.set(email, { email, display_name: email.split('@')[0], role: 'MEMBER', chapter: spec.slug })
    }
    plannedUsers.set(`leader.${spec.slug}@demo.bbe.vn`, {
      email: `leader.${spec.slug}@demo.bbe.vn`, display_name: `Lead ${spec.name}`, role: 'CHAPTER_LEADER', chapter: spec.slug,
    })
  }
  plannedUsers.set('admin.rich@bbe.vn', { email: 'admin.rich@bbe.vn', display_name: 'Quản trị viên Demo', role: 'ADMIN' })
  plannedUsers.set('leader.dna@bbe.vn', { email: 'leader.dna@bbe.vn', display_name: 'Lead DNA Demo', role: 'MEMBER', dnaGroup: 'SGDC', position: 'DNA_LEAD' })
  plannedUsers.set('dna.sgdc@bbe.vn', { email: 'dna.sgdc@bbe.vn', display_name: 'DNA SGDC Demo', role: 'MEMBER', dnaGroup: 'SGDC' })
  plannedUsers.set('dna.ldc@bbe.vn', { email: 'dna.ldc@bbe.vn', display_name: 'DNA LDC Demo', role: 'MEMBER', dnaGroup: 'LDC' })
  plannedUsers.set('dna.tt@bbe.vn', { email: 'dna.tt@bbe.vn', display_name: 'DNA TT Demo', role: 'MEMBER', dnaGroup: 'TT' })
  plannedUsers.set('president.green@bbe.vn', { email: 'president.green@bbe.vn', display_name: 'Chủ tịch Green Demo', role: 'MEMBER', chapter: 'seed-green', position: 'CHAPTER_PRESIDENT' })
  plannedUsers.set('lt.green@bbe.vn', { email: 'lt.green@bbe.vn', display_name: 'LT Green Demo', role: 'MEMBER', chapter: 'seed-green', position: 'DEPARTMENT_LEAD' })

  const userRows = Array.from(plannedUsers.values()).map((user) => ({
    id: randomUUID(), email: user.email, display_name: user.display_name, role: user.role,
    status: 'ACTIVE' as const, password_hash: hash,
  }))
  if (!APPLY) {
    console.log(JSON.stringify({ apply: false, coreLessons: coreLessons.length, chapters: CHAPTERS.length, plannedUsers: userRows.length }, null, 2))
    return
  }
  await createManyBatched(prisma.user, userRows)
  const allDemoUsers = await prisma.user.findMany({ where: { email: { in: Array.from(plannedUsers.keys()) } }, select: { id: true, email: true, role: true } })
  const userByEmail = new Map(allDemoUsers.map((user) => [user.email, user]))
  for (const user of allDemoUsers) {
    const plan = plannedUsers.get(user.email)
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE', password_hash: hash, ...(plan ? { display_name: plan.display_name, role: plan.role } : {}) },
    })
  }

  // Positions and DNA groups
  const positionRows = [
    ['CHAPTER_LEAD', 'Lead Chapter', 'CHAPTER', true],
    ['CHAPTER_PRESIDENT', 'Chủ tịch Chapter', 'CHAPTER', false],
    ['DEPARTMENT_LEAD', 'LT Ban', 'DEPARTMENT', true],
    ['DNA_LEAD', 'Lead DNA', 'DNA', true],
    ['MEMBER', 'Thành viên', 'DEPARTMENT', false],
  ] as const
  const positions = new Map<string, string>()
  for (const [code, name, scope, isManager] of positionRows) {
    const position = await prisma.position.upsert({ where: { code }, update: { name, scope, is_manager: isManager }, create: { code, name, scope, is_manager: isManager } })
    positions.set(code, position.id)
  }
  const dnaGroups = new Map<string, string>()
  for (const code of ['TT', 'SGDC', 'LDC']) {
    const group = await prisma.organizationUnit.findFirst({ where: { type: 'DNA_GROUP', code } })
      || await prisma.organizationUnit.create({ data: { name: code, code, type: 'DNA_GROUP', parent_id: dnaUnit.id } })
    dnaGroups.set(code, group.id)
  }

  // Chapter leaders + demo memberships
  for (const spec of CHAPTERS) {
    const chapter = chapters.get(spec.slug)!
    const leader = userByEmail.get(`leader.${spec.slug}@demo.bbe.vn`)
    if (leader) {
      await prisma.chapterMember.upsert({
        where: { chapter_id_user_id: { chapter_id: chapter.id, user_id: leader.id } },
        update: {}, create: { chapter_id: chapter.id, user_id: leader.id },
      }).catch(async () => {
        const existing = await prisma.chapterMember.findUnique({ where: { user_id: leader.id } })
        if (existing) await prisma.chapterMember.update({ where: { id: existing.id }, data: { chapter_id: chapter.id } })
      })
      await ensureOrgMembership(leader.id, chapter.departments[0])
      await ensurePosition(leader.id, positions.get('CHAPTER_LEAD')!, chapter.unitId, admin.id)
      await ensureAccountInterval(leader.id, 'CHAPTER_LEADER')
      await ensureAffiliation(leader.id, chapter.id)
    }
  }

  for (const [email, plan] of Array.from(plannedUsers.entries())) {
    const user = userByEmail.get(email)
    if (!user) continue
    if (plan.role === 'ADMIN') {
      await ensureAccountInterval(user.id, 'ADMIN')
      continue
    }
    if (plan.chapter) {
      const chapter = chapters.get(plan.chapter)!
      const existingChapterLink = await prisma.chapterMember.findUnique({ where: { user_id: user.id } })
      if (!existingChapterLink) await prisma.chapterMember.create({ data: { chapter_id: chapter.id, user_id: user.id } })
      else if (existingChapterLink.chapter_id !== chapter.id) await prisma.chapterMember.update({ where: { id: existingChapterLink.id }, data: { chapter_id: chapter.id } })
      await ensureOrgMembership(user.id, chapter.departments[plan.position === 'CHAPTER_PRESIDENT' ? 3 : 0])
      if (plan.position) await ensurePosition(user.id, positions.get(plan.position)!, plan.position === 'DEPARTMENT_LEAD' ? chapter.departments[0] : chapter.unitId, admin.id)
      await ensureAccountInterval(user.id, plan.role)
      await ensureAffiliation(user.id, chapter.id)
    }
    if (plan.dnaGroup) {
      const groupId = dnaGroups.get(plan.dnaGroup)!
      await ensureOrgMembership(user.id, groupId)
      await prisma.chapterMember.deleteMany({ where: { user_id: user.id } })
      await prisma.chapterAffiliationInterval.deleteMany({ where: { user_id: user.id } })
      if (plan.position) await ensurePosition(user.id, positions.get(plan.position)!, dnaUnit.id, admin.id)
      await ensureAccountInterval(user.id, plan.role)
    }
  }

  // Existing seed users must be active in September for historical snapshots.
  const seedChapterIds = Array.from(chapters.values()).map((chapter) => chapter.id)
  const existingMembers = await prisma.chapterMember.findMany({ where: { chapter_id: { in: seedChapterIds } }, select: { user_id: true, chapter_id: true } })
  const allChapterMemberIds = Array.from(new Set(existingMembers.map((row) => row.user_id)))
  await prisma.accountStateInterval.updateMany({
    where: { user_id: { in: allChapterMemberIds }, ends_at: null, starts_at: { gt: CUTOVER } },
    data: { starts_at: CUTOVER },
  })
  await prisma.chapterAffiliationInterval.updateMany({
    where: { user_id: { in: allChapterMemberIds }, ends_at: null, starts_at: { gt: CUTOVER } },
    data: { starts_at: CUTOVER },
  })

  // ---------- Cycles, curriculum progress, stars ----------
  const coreLessonIds = coreLessons.map((lesson) => lesson.id)
  const durationByLesson = new Map(coreLessons.map((lesson) => [lesson.id, lesson.video?.duration_seconds || 180]))
  const memberIdsByChapter = new Map<string, string[]>()
  for (const [slug, chapter] of Array.from(chapters.entries())) {
    const rows = await prisma.chapterMember.findMany({ where: { chapter_id: chapter.id }, include: { user: { select: { id: true, email: true, role: true } } } })
    memberIdsByChapter.set(slug, rows.filter((row) => row.user.role === 'MEMBER').map((row) => row.user.id))
  }

  const planByUser = new Map<string, { chapterSlug?: string; counts: number; starsSep: number; starsOct: number }>()
  for (const spec of CHAPTERS) {
    const memberIds = memberIdsByChapter.get(spec.slug) || []
    const sorted = [...memberIds].sort((a, b) => {
      const ea = allDemoUsers.find((u) => u.id === a)?.email || ''
      const eb = allDemoUsers.find((u) => u.id === b)?.email || ''
      return ea.localeCompare(eb)
    })
    if (sorted.length < spec.size && spec.create) throw new Error(`${spec.name}: expected ${spec.size} members, found ${sorted.length}`)
    const counts = sorted.map(() => 10)
    for (let index = 0; index < spec.qualified && index < counts.length; index++) counts[index] = 36
    const emailOf = (id: string) => allDemoUsers.find((u) => u.id === id)?.email
    const overrides: Record<string, number> = {
      'member.zero@bbe.vn': 0,
      'member.below70@bbe.vn': 34,
      'member.exact70@bbe.vn': 35,
      'member.above70@bbe.vn': 40,
    }
    sorted.forEach((id, index) => {
      const email = emailOf(id)
      if (email && overrides[email] !== undefined) counts[index] = overrides[email]
    })
    // Correct the qualified count after explicit demo overrides.
    let qualified = counts.filter((count) => count >= 35).length
    for (let index = 0; index < counts.length && qualified > spec.qualified; index++) {
      if (counts[index] >= 35 && !(emailOf(sorted[index]) || '').startsWith('member.')) { counts[index] = 34; qualified-- }
    }
    for (let index = 0; index < counts.length && qualified < spec.qualified; index++) {
      if (counts[index] < 35) { counts[index] = 36; qualified++ }
    }

    const starAmounts = distributeStars(spec.octStars, sorted.length)
    const sepStarAmounts = distributeStars(spec.sepStars, sorted.length)
    sorted.forEach((id, index) => {
      const email = emailOf(id)
      if (email === 'member.zero@bbe.vn') { starAmounts[index] = 0; sepStarAmounts[index] = 0 }
      if (email === 'member.below70@bbe.vn') { starAmounts[index] = 0; sepStarAmounts[index] = 0 }
      if (email === 'member.exact70@bbe.vn') { starAmounts[index] = 5; sepStarAmounts[index] = 3 }
      if (email === 'member.above70@bbe.vn') { starAmounts[index] = 50; sepStarAmounts[index] = 40 }
    })
    rebalance(starAmounts, spec.octStars)
    rebalance(sepStarAmounts, spec.sepStars)
    sorted.forEach((id, index) => planByUser.set(id, {
      chapterSlug: spec.slug,
      counts: counts[index],
      starsSep: sepStarAmounts[index],
      starsOct: starAmounts[index],
    }))
  }
  // LT / President demo accounts in Chapter Demo: learning and Star data, plus DNA members.
  for (const email of ['president.green@bbe.vn', 'lt.green@bbe.vn']) {
    const user = userByEmail.get(email)
    if (user) planByUser.set(user.id, { chapterSlug: 'seed-green', counts: 50, starsSep: 50, starsOct: 60 })
  }
  for (const email of ['dna.sgdc@bbe.vn', 'dna.ldc@bbe.vn', 'dna.tt@bbe.vn', 'leader.dna@bbe.vn']) {
    const user = userByEmail.get(email)
    if (user) planByUser.set(user.id, { counts: 50, starsSep: 50, starsOct: 60 })
  }

  // Replace only this seed's progress and stars, never other users' records.
  const plannedIds = Array.from(planByUser.keys())
  await prisma.cycleLessonProgress.deleteMany({ where: { user_id: { in: plannedIds }, lesson_id: { in: coreLessonIds } } })
  await prisma.lessonProgress.deleteMany({ where: { user_id: { in: plannedIds }, lesson_id: { in: coreLessonIds } } })
  await prisma.starLedger.deleteMany({ where: { user_id: { in: plannedIds }, reward_key: { startsWith: 'rich-seed:' } } })

  const lessonProgressRows: any[] = []
  const cycleProgressRows: any[] = []
  const starRows: any[] = []
  for (const [userId, plan] of Array.from(planByUser.entries())) {
    const chapter = plan.chapterSlug ? chapters.get(plan.chapterSlug) : null
    const cycle = await ensureCycle(userId, chapter?.id || null)
    for (let index = 0; index < plan.counts; index++) {
      const lesson = coreLessons[index]
      const completedAt = new Date(Date.UTC(2026, 8, 10 + (index % 12), 5, 0, 0))
      const duration = durationByLesson.get(lesson.id) || 180
      lessonProgressRows.push({
        user_id: userId, lesson_id: lesson.id, completed: true, completed_at: completedAt,
        furthest_watched_position_seconds: duration, last_position_seconds: duration, last_watched_at: completedAt,
      })
      cycleProgressRows.push({
        user_id: userId, lesson_id: lesson.id, learning_cycle_id: cycle.id,
        furthest_seconds: duration, completed_at: completedAt, unlocked_at: completedAt, provenance: 'NATIVE',
      })
    }
    const makeStars = (total: number, monthId: string, month: 'SEP' | 'OCT') => {
      let left = total
      let part = 0
      while (left > 0) {
        const amount = Math.min(5, left)
        const awardedAt = month === 'SEP'
          ? new Date(Date.UTC(2026, 8, 20 + part, 12, 0, 0))
          : new Date(Date.UTC(2026, 9, 5 + part, 12, 0, 0))
        starRows.push({
          user_id: userId, amount, reason: 'VIDEO_COMPLETION',
          reward_key: `rich-seed:${month}:${userId}:${part}`,
          source_type: 'VIDEO', source_id: firstVideoId,
          awarded_at: awardedAt, competition_month_id: monthId,
          learning_cycle_id: cycle.id, chapter_at_award_id: chapter?.id || null,
          provenance: 'NATIVE', metadata: { seed: true, chapter: plan.chapterSlug || null, month: month === 'SEP' ? '2026-09' : '2026-10' },
        })
        left -= amount
        part++
      }
    }
    const sep = await ensureMonth('2026-09')
    const oct = await ensureMonth('2026-10')
    makeStars(plan.starsSep, sep.id, 'SEP')
    makeStars(plan.starsOct, oct.id, 'OCT')
  }
  await createManyBatched(prisma.lessonProgress, lessonProgressRows, 800)
  await createManyBatched(prisma.cycleLessonProgress, cycleProgressRows, 800)
  await createManyBatched(prisma.starLedger, starRows, 800)

  // KPI rows
  for (const spec of CHAPTERS) {
    const chapter = chapters.get(spec.slug)!
    for (const [month, status] of [['2026-09', spec.kpi], ['2026-10', spec.kpi]] as const) {
      await prisma.chapterMonthlyKpi.upsert({
        where: { chapter_id_month_start: { chapter_id: chapter.id, month_start: new Date(`${month}-01T00:00:00.000Z`) } },
        update: { status, note: 'Dữ liệu mô phỏng có kiểm chứng', configured_by_user_id: admin.id },
        create: { chapter_id: chapter.id, month_start: new Date(`${month}-01T00:00:00.000Z`), status, note: 'Dữ liệu mô phỏng có kiểm chứng', configured_by_user_id: admin.id },
      })
    }
  }

  // ---------- Transfer seasons, terms, and applied reorganizations ----------
  const aprSeason = await prisma.transferSeason.upsert({
    where: { code: '2026-APR' },
    update: {},
    create: { code: '2026-APR', starts_at: new Date('2026-04-01T00:00:00+07:00'), ends_at: new Date('2026-10-01T00:00:00+07:00'), reward_boundary_at: VN_BOUNDARY_APR },
  })
  const octSeason = await prisma.transferSeason.upsert({
    where: { code: '2026-OCT' },
    update: {},
    create: { code: '2026-OCT', starts_at: new Date('2026-10-01T00:00:00+07:00'), ends_at: new Date('2027-04-01T00:00:00+07:00'), reward_boundary_at: VN_BOUNDARY_OCT },
  })
  for (const chapter of Array.from(chapters.values())) {
    for (const [season, startsAt, endsAt] of [
      [aprSeason, new Date('2026-04-01T00:00:00+07:00'), new Date('2026-10-01T00:00:00+07:00')],
      [octSeason, new Date('2026-10-01T00:00:00+07:00'), new Date('2027-04-01T00:00:00+07:00')],
    ] as const) {
      const existingTerm = await prisma.chapterCompetitionTerm.findFirst({ where: { chapter_id: chapter.id, season_id: season.id } })
      if (!existingTerm) await prisma.chapterCompetitionTerm.create({ data: { chapter_id: chapter.id, season_id: season.id, starts_at: startsAt, ends_at: endsAt } })
      const existingReorganization = await prisma.chapterReorganization.findFirst({ where: { chapter_id: chapter.id, transfer_season_id: season.id, status: 'APPLIED' } })
      if (!existingReorganization) {
        await prisma.chapterReorganization.create({
          data: {
            chapter_id: chapter.id, transfer_season_id: season.id, effective_at: startsAt,
            applied_at: new Date(startsAt.getTime() - 86_400_000), status: 'APPLIED',
            created_by_user_id: admin.id, confirmed_at: new Date(startsAt.getTime() - 2 * 86_400_000), term_number: season.code === '2026-OCT' ? 2 : 1,
          },
        })
      }
    }
  }

  console.log(JSON.stringify({
    apply: true,
    coreLessons: coreLessons.length,
    chapters: CHAPTERS.length,
    membersSeeded: plannedIds.length,
    lessonProgressRows: lessonProgressRows.length,
    cycleProgressRows: cycleProgressRows.length,
    starRows: starRows.length,
    demoPassword: PASSWORD,
  }, null, 2))
}

function distributeStars(total: number, count: number): number[] {
  const base = Math.floor(total / count)
  const extra = total % count
  return Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0))
}

function rebalance(amounts: number[], target: number) {
  let difference = target - amounts.reduce((sum, amount) => sum + amount, 0)
  let index = 0
  while (difference !== 0 && index < amounts.length * 4) {
    const targetIndex = index % amounts.length
    if (difference > 0) { amounts[targetIndex] += 1; difference-- }
    else if (amounts[targetIndex] > 0) { amounts[targetIndex] -= 1; difference++ }
    index++
  }
}

async function ensureOrgMembership(userId: string, unitId: string) {
  const existing = await prisma.organizationMembership.findFirst({ where: { user_id: userId, status: 'ACTIVE', ends_at: null } })
  if (!existing) await prisma.organizationMembership.create({ data: { user_id: userId, unit_id: unitId, starts_at: CUTOVER } })
  else if (existing.unit_id !== unitId) await prisma.organizationMembership.update({ where: { id: existing.id }, data: { unit_id: unitId } })
}

async function ensurePosition(userId: string, positionId: string, unitId: string, appointedBy: string) {
  const existing = await prisma.positionAssignment.findFirst({ where: { user_id: userId, position_id: positionId, unit_id: unitId, ends_at: null } })
  if (!existing) await prisma.positionAssignment.create({ data: { user_id: userId, position_id: positionId, unit_id: unitId, is_primary: true, starts_at: CUTOVER, appointed_by: appointedBy } })
}

async function ensureAccountInterval(userId: string, role: string) {
  const existing = await prisma.accountStateInterval.findFirst({ where: { user_id: userId, ends_at: null } })
  if (!existing) await prisma.accountStateInterval.create({ data: { user_id: userId, role, status: 'ACTIVE', starts_at: CUTOVER } })
  else await prisma.accountStateInterval.update({ where: { id: existing.id }, data: { role, status: 'ACTIVE', starts_at: CUTOVER } })
}

async function ensureAffiliation(userId: string, chapterId: string) {
  const existing = await prisma.chapterAffiliationInterval.findFirst({ where: { user_id: userId, ends_at: null } })
  if (!existing) await prisma.chapterAffiliationInterval.create({ data: { user_id: userId, chapter_id: chapterId, starts_at: CUTOVER } })
  else await prisma.chapterAffiliationInterval.update({ where: { id: existing.id }, data: { chapter_id: chapterId, starts_at: CUTOVER } })
}

async function ensureCycle(userId: string, chapterId: string | null) {
  const existing = await prisma.learningCycle.findFirst({ where: { user_id: userId, ends_at: null } })
  if (existing) {
    if (existing.chapter_id !== chapterId) {
      await prisma.learningCycle.update({ where: { id: existing.id }, data: { chapter_id: chapterId } })
    }
    return existing
  }
  const cycle = await prisma.learningCycle.create({
    data: { user_id: userId, chapter_id: chapterId, trigger_key: `rich-seed:${userId}`, starts_at: CUTOVER, provenance: 'LEGACY' },
  })
  await prisma.learningPath.create({ data: { user_id: userId, learning_cycle_id: cycle.id, starts_at: CUTOVER } }).catch(() => null)
  return cycle
}

async function ensureMonth(key: string) {
  const [year, month] = key.split('-').map(Number)
  const startsAt = new Date(Date.UTC(year, month - 1, 1) - 7 * 3_600_000)
  const endsAt = new Date(Date.UTC(year, month, 1) - 7 * 3_600_000)
  return prisma.competitionMonth.upsert({ where: { key }, update: {}, create: { key, starts_at: startsAt, ends_at: endsAt, state: endsAt <= new Date() ? 'CLOSED' : 'OPEN' } })
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())


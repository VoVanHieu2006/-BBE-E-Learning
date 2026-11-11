import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import 'dotenv/config'
import { LEARNING_PROGRAMS, LEARNING_TARGETS, STANDARD_DEPARTMENTS } from '../../src/lib/learning-catalog'

const prisma = new PrismaClient()
const password = 'Demo@123456'
const courseSpecs = [
  ['Văn hóa tổ chức và hành trình BBE', 'Giá trị cốt lõi và cách phối hợp trong tổ chức.', 'PUBLIC', '/images/course-covers/organization-culture.png'],
  ['Kỹ năng thuyết trình hiệu quả', 'Chuẩn bị và trình bày một thông điệp thuyết phục.', 'PUBLIC', '/images/course-covers/communication-leadership.png'],
  ['Tin học văn phòng thực chiến', 'Làm việc hiệu quả với tài liệu, bảng tính và slide.', 'PUBLIC', '/images/course-covers/digital-productivity.png'],
  ['An toàn thông tin cơ bản', 'Bảo vệ tài khoản và nhận diện lừa đảo trực tuyến.', 'PUBLIC', '/images/course-covers/digital-productivity.png'],
  ['Tư duy phản biện', 'Kiểm chứng giả định và giải quyết vấn đề có cấu trúc.', 'PUBLIC', '/images/course-covers/organization-culture.png'],
  ['Làm việc nhóm và phản hồi', 'Phối hợp, giao việc và phản hồi giúp đội ngũ tiến bộ.', 'PRIVATE', '/images/course-covers/communication-leadership.png'],
  ['Quản lý dự án dành cho thành viên', 'Lập kế hoạch và theo dõi cam kết trong dự án Chapter.', 'PRIVATE', '/images/course-covers/organization-culture.png'],
  ['Tiếng Anh giao tiếp trong công việc', 'Mẫu câu cho họp, email và trao đổi với đồng nghiệp.', 'PRIVATE', '/images/course-covers/communication-leadership.png'],
  ['Quản lý tài chính cá nhân', 'Ngân sách, quỹ dự phòng và đầu tư cơ bản.', 'PUBLIC', '/images/course-covers/digital-productivity.png'],
  ['Nền tảng lãnh đạo đội nhóm', 'Coaching, giao việc và xây dựng động lực.', 'PRIVATE', '/images/course-covers/communication-leadership.png'],
] as const

const POSITIONS = [
  { code: 'CHAPTER_LEAD', name: 'Lead Chapter', scope: 'CHAPTER', is_manager: true },
  { code: 'DNA_LEAD', name: 'Lead DNA', scope: 'DNA', is_manager: true },
  { code: 'PRESIDENT', name: 'Chủ tịch Chapter', scope: 'CHAPTER', is_manager: false },
  { code: 'DEPARTMENT_LEAD', name: 'Trưởng ban', scope: 'DEPARTMENT', is_manager: false },
  { code: 'DEPARTMENT_MEMBER', name: 'Thành viên ban', scope: 'DEPARTMENT', is_manager: false },
  { code: 'DNA_MEMBER', name: 'Thành viên DNA', scope: 'DNA', is_manager: false },
] as const
type PositionCode = (typeof POSITIONS)[number]['code']
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim()

async function ensureUnit(name: string, type: 'ROOT' | 'DNA' | 'DNA_GROUP' | 'CHAPTER' | 'DEPARTMENT', parentId: string | null, code?: string) {
  const existing = await prisma.organizationUnit.findFirst({ where: code ? { type, parent_id: parentId, code } : { name, type, parent_id: parentId } })
  if (existing) return existing
  return prisma.organizationUnit.create({ data: { name, type, parent_id: parentId, code } })
}

async function ensureDepartment(chapterUnitId: string, code: string, name: string) {
  const byCode = await prisma.organizationUnit.findFirst({ where: { type: 'DEPARTMENT', parent_id: chapterUnitId, code } })
  if (byCode) return byCode
  const aliases = [normalize(name), normalize(name.replace(/^Ban /, ''))]
  const legacy = (await prisma.organizationUnit.findMany({ where: { type: 'DEPARTMENT', parent_id: chapterUnitId, code: null } }))
    .find((unit) => aliases.includes(normalize(unit.name)))
  if (legacy) return prisma.organizationUnit.update({ where: { id: legacy.id }, data: { code } })
  return prisma.organizationUnit.create({ data: { name, code, type: 'DEPARTMENT', parent_id: chapterUnitId } })
}

async function main() {
  const hash = await bcrypt.hash(password, 12)
  const users = [
    ['admin.demo@bbe.vn', 'Quản trị viên Demo', 'ADMIN'],
    ['dna.lead.demo@bbe.vn', 'Lead DNA Demo', 'LEAD'],
    ['chapter.lead.demo@bbe.vn', 'Lead Chapter Demo', 'LEAD'],
    ['department.lead.demo@bbe.vn', 'LT Ban Demo', 'MEMBER'],
    ['member.demo@bbe.vn', 'Thành viên Demo', 'MEMBER'],
    ['president.demo@bbe.vn', 'Chủ tịch Chapter Demo', 'MEMBER'],
    ['dna.member.demo@bbe.vn', 'Thành viên DNA Demo', 'MEMBER'],
  ] as const
  const created: Record<string, { id: string; role: string }> = {}
  for (const [email, displayName, role] of users) {
    // The role is never changed on an existing account: MEMBER -> LEAD is forbidden.
    created[email] = await prisma.user.upsert({
      where: { email }, update: { display_name: displayName, status: 'ACTIVE' },
      create: { email, display_name: displayName, role, status: 'ACTIVE', password_hash: hash },
      select: { id: true, role: true },
    })
  }
  const adminId = created['admin.demo@bbe.vn'].id
  const positions = {} as Record<PositionCode, { id: string }>
  for (const spec of POSITIONS) positions[spec.code] = await prisma.position.upsert({ where: { code: spec.code }, update: {}, create: spec })
  await prisma.learningProgram.createMany({ data: LEARNING_PROGRAMS.map((program) => ({ ...program })), skipDuplicates: true })
  await prisma.learningTarget.createMany({ data: LEARNING_TARGETS, skipDuplicates: true })
  const root = (await prisma.organizationUnit.findFirst({ where: { type: 'ROOT' }, orderBy: { created_at: 'asc' } })) || await ensureUnit('BBE Việt Nam', 'ROOT', null)
  const dna = (await prisma.organizationUnit.findFirst({ where: { type: 'DNA', parent_id: root.id }, orderBy: { created_at: 'asc' } })) || await ensureUnit('DNA Điều hành', 'DNA', root.id)
  const dnaGroups: Record<string, string> = {}
  for (const code of ['TT', 'LDC', 'SGDC']) {
    const group = (await prisma.organizationUnit.findFirst({ where: { type: 'DNA_GROUP', parent_id: dna.id, OR: [{ code }, { name: code }] } }))
      || await prisma.organizationUnit.create({ data: { name: code, code, type: 'DNA_GROUP', parent_id: dna.id } })
    if (group.code !== code) await prisma.organizationUnit.update({ where: { id: group.id }, data: { code } })
    dnaGroups[code] = group.id
  }
  const chapterUnit = await ensureUnit('Chapter Demo', 'CHAPTER', root.id)
  const departments: Record<string, string> = {}
  for (const [code, name] of STANDARD_DEPARTMENTS) departments[code] = (await ensureDepartment(chapterUnit.id, code, name)).id
  const chapter = await prisma.chapter.upsert({
    where: { name: 'Chapter Demo' }, update: { organization_unit_id: chapterUnit.id, status: 'ACTIVE' },
    create: { name: 'Chapter Demo', description: 'Chapter mẫu để kiểm tra phân quyền.', organization_unit_id: chapterUnit.id },
  })
  // One placement per account: Chapter (one position) or DNA, never both.
  const placements: [string, 'LEAD' | 'MEMBER', string, PositionCode, boolean][] = [
    ['dna.lead.demo@bbe.vn', 'LEAD', dna.id, 'DNA_LEAD', false],
    ['chapter.lead.demo@bbe.vn', 'LEAD', chapterUnit.id, 'CHAPTER_LEAD', true],
    ['department.lead.demo@bbe.vn', 'MEMBER', departments.BND, 'DEPARTMENT_LEAD', true],
    ['member.demo@bbe.vn', 'MEMBER', departments.BTV, 'DEPARTMENT_MEMBER', true],
    ['president.demo@bbe.vn', 'MEMBER', chapterUnit.id, 'PRESIDENT', true],
    ['dna.member.demo@bbe.vn', 'MEMBER', dnaGroups.TT, 'DNA_MEMBER', false],
  ]
  for (const [email, role, unitId, positionCode, inChapter] of placements) {
    const user = created[email]
    const placed = await prisma.positionAssignment.count({ where: { user_id: user.id, OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }] } })
      + await prisma.chapterMember.count({ where: { user_id: user.id } })
      + await prisma.organizationMembership.count({ where: { user_id: user.id, status: 'ACTIVE', OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }] } })
    if (placed) continue
    if (user.role !== role) { console.warn(`Skipping ${email}: existing role ${user.role} cannot hold ${positionCode}.`); continue }
    if (inChapter) await prisma.chapterMember.create({ data: { chapter_id: chapter.id, user_id: user.id } })
    await prisma.organizationMembership.create({ data: { user_id: user.id, unit_id: unitId } })
    await prisma.positionAssignment.create({ data: { user_id: user.id, unit_id: unitId, position_id: positions[positionCode].id, is_primary: true, appointed_by: adminId } })
  }
  const viewProgress = await prisma.permission.upsert({ where: { code: 'VIEW_MEMBER_PROGRESS' }, update: {}, create: { code: 'VIEW_MEMBER_PROGRESS', description: 'Xem tiến độ thành viên trong phạm vi.' } })
  const manageMembers = await prisma.permission.upsert({ where: { code: 'MANAGE_CHAPTER_MEMBERS' }, update: {}, create: { code: 'MANAGE_CHAPTER_MEMBERS', description: 'Quản lý thành viên Chapter.' } })
  const manageDnaMembers = await prisma.permission.upsert({ where: { code: 'MANAGE_DNA_MEMBERS' }, update: {}, create: { code: 'MANAGE_DNA_MEMBERS', description: 'Quản lý thành viên trong DNA.' } })
  for (const [position, permission] of [[positions.DNA_LEAD, viewProgress], [positions.DNA_LEAD, manageDnaMembers], [positions.CHAPTER_LEAD, viewProgress], [positions.CHAPTER_LEAD, manageMembers]] as const) {
    await prisma.positionPermission.upsert({ where: { position_id_permission_id: { position_id: position.id, permission_id: permission.id } }, update: {}, create: { position_id: position.id, permission_id: permission.id } })
  }
  for (let index = 0; index < courseSpecs.length; index++) {
    const [title, description, visibility, coverUrl] = courseSpecs[index]
    let course = await prisma.course.findFirst({ where: { title }, select: { id: true } })
    if (!course) course = await prisma.course.create({ data: { title, description, visibility, cover_url: coverUrl, status: 'PUBLISHED', published_at: new Date(), created_by: adminId }, select: { id: true } })
    else await prisma.course.update({ where: { id: course.id }, data: { cover_url: coverUrl, description } })
    const session = await prisma.session.findFirst({ where: { course_id: course.id }, select: { id: true } }) ||
      await prisma.session.create({ data: { course_id: course.id, title: 'Buổi học 1', description: 'Nội dung mẫu có thể xóa sau.', sort_order: 1 }, select: { id: true } })
    const lesson = await prisma.lesson.findFirst({ where: { session_id: session.id }, select: { id: true } }) ||
      await prisma.lesson.create({ data: { session_id: session.id, title: 'Bài học khởi động', description: 'Video giới thiệu nội dung khóa học.', sort_order: 1 }, select: { id: true } })
    await prisma.video.upsert({ where: { lesson_id: lesson.id }, update: {}, create: { lesson_id: lesson.id, youtube_video_id: 'S-QqTDbsuBA', duration_seconds: 180, title: 'Video mẫu' } })
  }
  console.table(users.map(([email, , role]) => ({ role, email, password })))
  console.log(`Courses currently available: ${await prisma.course.count()}`)
}
main().catch((error) => { console.error(error); process.exit(1) }).finally(() => prisma.$disconnect())

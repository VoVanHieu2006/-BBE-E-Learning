import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import 'dotenv/config'

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

async function ensureUnit(name: string, type: 'ROOT' | 'DNA' | 'DNA_GROUP' | 'CHAPTER' | 'DEPARTMENT', parentId: string | null) {
  return (await prisma.organizationUnit.findFirst({ where: { name, type, parent_id: parentId } })) ||
    prisma.organizationUnit.create({ data: { name, type, parent_id: parentId } })
}

async function main() {
  const hash = await bcrypt.hash(password, 12)
  const users = [
    ['admin.demo@bbe.vn', 'Quản trị viên Demo', 'ADMIN'],
    ['dna.lead.demo@bbe.vn', 'Lead DNA Demo', 'MEMBER'],
    ['chapter.lead.demo@bbe.vn', 'Lead Chapter Demo', 'CHAPTER_LEADER'],
    ['department.lead.demo@bbe.vn', 'LT Ban Demo', 'MEMBER'],
    ['member.demo@bbe.vn', 'Thành viên Demo', 'MEMBER'],
    ['dna.member.demo@bbe.vn', 'Thành viên DNA Demo', 'MEMBER'],
  ] as const
  const created: Record<string, { id: string }> = {}
  for (const [email, displayName, role] of users) {
    created[email] = await prisma.user.upsert({
      where: { email }, update: { display_name: displayName, role, status: 'ACTIVE' },
      create: { email, display_name: displayName, role, status: 'ACTIVE', password_hash: hash },
      select: { id: true },
    })
  }
  const adminId = created['admin.demo@bbe.vn'].id
  const root = await ensureUnit('BBE Việt Nam', 'ROOT', null)
  const dna = await ensureUnit('DNA Điều hành', 'DNA', root.id)
  const dnaGroups = await Promise.all(['TT', 'LDC', 'SGDC'].map((name) => ensureUnit(name, 'DNA_GROUP', dna.id)))
  const chapterUnit = await ensureUnit('Chapter Demo', 'CHAPTER', root.id)
  const department = await ensureUnit('Ban Nội dung', 'DEPARTMENT', chapterUnit.id)
  const chapter = await prisma.chapter.upsert({
    where: { name: 'Chapter Demo' }, update: { organization_unit_id: chapterUnit.id, status: 'ACTIVE' },
    create: { name: 'Chapter Demo', description: 'Chapter mẫu để kiểm tra phân quyền.', organization_unit_id: chapterUnit.id },
  })
  for (const email of users.slice(1).map((item) => item[0])) {
    await prisma.chapterMember.upsert({ where: { chapter_id_user_id: { chapter_id: chapter.id, user_id: created[email].id } }, update: {}, create: { chapter_id: chapter.id, user_id: created[email].id } })
  }
  const positions = await Promise.all([
    prisma.position.upsert({ where: { code: 'DNA_LEAD' }, update: { name: 'Lead DNA', scope: 'DNA', is_manager: true }, create: { code: 'DNA_LEAD', name: 'Lead DNA', scope: 'DNA', is_manager: true } }),
    prisma.position.upsert({ where: { code: 'CHAPTER_LEAD' }, update: { name: 'Trưởng Chapter', scope: 'CHAPTER', is_manager: true }, create: { code: 'CHAPTER_LEAD', name: 'Trưởng Chapter', scope: 'CHAPTER', is_manager: true } }),
    prisma.position.upsert({ where: { code: 'DEPARTMENT_LEAD' }, update: { name: 'LT Ban', scope: 'DEPARTMENT', is_manager: true }, create: { code: 'DEPARTMENT_LEAD', name: 'LT Ban', scope: 'DEPARTMENT', is_manager: true } }),
    prisma.position.upsert({ where: { code: 'MEMBER' }, update: { name: 'Thành viên', scope: 'DEPARTMENT', is_manager: false }, create: { code: 'MEMBER', name: 'Thành viên', scope: 'DEPARTMENT', is_manager: false } }),
  ])
  const assignments = [
    ['dna.lead.demo@bbe.vn', dna.id, positions[0].id],
    ['chapter.lead.demo@bbe.vn', chapterUnit.id, positions[1].id],
    ['department.lead.demo@bbe.vn', department.id, positions[2].id],
    ['member.demo@bbe.vn', department.id, positions[3].id],
    ['dna.member.demo@bbe.vn', department.id, positions[3].id],
  ] as const
  for (const [email, unitId, positionId] of assignments) {
    const userId = created[email].id
    if (!await prisma.organizationMembership.findFirst({ where: { user_id: userId, unit_id: unitId, status: 'ACTIVE', ends_at: null } })) await prisma.organizationMembership.create({ data: { user_id: userId, unit_id: unitId } })
    if (!await prisma.positionAssignment.findFirst({ where: { user_id: userId, unit_id: unitId, position_id: positionId, ends_at: null } })) await prisma.positionAssignment.create({ data: { user_id: userId, unit_id: unitId, position_id: positionId, is_primary: true, appointed_by: adminId } })
  }
  const dnaMemberId = created['dna.member.demo@bbe.vn'].id
  if (!await prisma.organizationMembership.findFirst({ where: { user_id: dnaMemberId, unit_id: dnaGroups[0].id, status: 'ACTIVE', ends_at: null } })) {
    await prisma.organizationMembership.create({ data: { user_id: dnaMemberId, unit_id: dnaGroups[0].id } })
  }
  const viewProgress = await prisma.permission.upsert({ where: { code: 'VIEW_MEMBER_PROGRESS' }, update: {}, create: { code: 'VIEW_MEMBER_PROGRESS', description: 'Xem tiến độ thành viên trong phạm vi.' } })
  const manageMembers = await prisma.permission.upsert({ where: { code: 'MANAGE_CHAPTER_MEMBERS' }, update: {}, create: { code: 'MANAGE_CHAPTER_MEMBERS', description: 'Quản lý thành viên Chapter.' } })
  const manageDnaMembers = await prisma.permission.upsert({ where: { code: 'MANAGE_DNA_MEMBERS' }, update: {}, create: { code: 'MANAGE_DNA_MEMBERS', description: 'Quản lý thành viên trong DNA.' } })
  for (const [position, permission] of [[positions[0], viewProgress], [positions[0], manageDnaMembers], [positions[1], viewProgress], [positions[1], manageMembers], [positions[2], viewProgress]] as const) {
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

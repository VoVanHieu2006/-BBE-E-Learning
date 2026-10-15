import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const removedEmails = ['vovanhieu03102006@gmail.com', 'vobahoaan@gmail.com']

async function main() {
  const targets = await prisma.user.findMany({
    where: { email: { in: removedEmails } },
    select: { id: true, email: true, chapter_members: { select: { chapter_id: true } } },
  })
  const chapterIds = Array.from(new Set(targets.flatMap((user) => user.chapter_members.map((membership) => membership.chapter_id))))
  await prisma.user.deleteMany({ where: { id: { in: targets.map((user) => user.id) } } })
  for (const chapterId of chapterIds) {
    const chapter = await prisma.chapter.findUnique({ where: { id: chapterId }, select: { id: true, organization_unit_id: true } })
    if (chapter) {
      await prisma.chapter.delete({ where: { id: chapter.id } })
      if (chapter.organization_unit_id) await prisma.organizationUnit.delete({ where: { id: chapter.organization_unit_id } }).catch(() => undefined)
    }
  }

  const hash = await bcrypt.hash('Demo@123456', 12)
  const chapter = await prisma.chapter.findFirst({ where: { status: 'ACTIVE' }, orderBy: { created_at: 'asc' } })
  if (!chapter) throw new Error('No active Chapter available for demo members')
  const chapterUnit = chapter.organization_unit_id ? await prisma.organizationUnit.findUnique({ where: { id: chapter.organization_unit_id } }) : null
  if (!chapterUnit) throw new Error('Demo Chapter has no organization unit')
  const departmentNames = ['Ban Chủ tịch', 'Ban Nội dung', 'Ban Truyền thông', 'Ban Nhân sự', 'Ban Đối ngoại', 'Ban Sự kiện', 'Ban Tài chính']
  const departments = []
  for (const name of departmentNames) {
    const unit = await prisma.organizationUnit.findFirst({ where: { name, type: 'DEPARTMENT', parent_id: chapterUnit.id } }) || await prisma.organizationUnit.create({ data: { name, type: 'DEPARTMENT', parent_id: chapterUnit.id } })
    departments.push(unit)
  }
  const memberPosition = await prisma.position.upsert({ where: { code: 'MEMBER' }, update: {}, create: { code: 'MEMBER', name: 'Thành viên', scope: 'DEPARTMENT' } })
  const leadPosition = await prisma.position.upsert({ where: { code: 'DEPARTMENT_LEAD' }, update: {}, create: { code: 'DEPARTMENT_LEAD', name: 'LT', scope: 'DEPARTMENT', is_manager: true } })
  for (let index = 1; index <= 35; index++) {
    const email = `member${String(index).padStart(2, '0')}.demo@bbe.vn`
    const user = await prisma.user.upsert({ where: { email }, update: { status: 'ACTIVE' }, create: { email, display_name: `Thành viên Demo ${index}`, password_hash: hash, role: 'MEMBER', status: 'ACTIVE' } })
    await prisma.chapterMember.upsert({ where: { chapter_id_user_id: { chapter_id: chapter.id, user_id: user.id } }, update: {}, create: { chapter_id: chapter.id, user_id: user.id } })
    const department = departments[(index - 1) % departments.length]
    if (!await prisma.organizationMembership.findFirst({ where: { user_id: user.id, unit_id: department.id, status: 'ACTIVE', ends_at: null } })) await prisma.organizationMembership.create({ data: { user_id: user.id, unit_id: department.id } })
    const position = index <= departments.length ? leadPosition : memberPosition
    if (!await prisma.positionAssignment.findFirst({ where: { user_id: user.id, unit_id: department.id, position_id: position.id, ends_at: null } })) await prisma.positionAssignment.create({ data: { user_id: user.id, unit_id: department.id, position_id: position.id, starts_at: new Date() } })
  }
  console.log({ removedEmails, checkedChapterIds: chapterIds, seededMembers: 35, chapter: chapter.name })
}

main().finally(() => prisma.$disconnect())

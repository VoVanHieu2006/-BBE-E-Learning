import { PrismaClient } from '@prisma/client'
import 'dotenv/config'
const prisma = new PrismaClient()
async function main() {
  const chapters = await prisma.chapter.findMany({ where: { organization_unit_id: { not: null } }, select: { id: true, organization_unit_id: true, chapter_members: { where: { user: { role: 'MEMBER' } }, select: { user_id: true } } } })
  for (const chapter of chapters) {
    const departments = await prisma.organizationUnit.findMany({ where: { parent_id: chapter.organization_unit_id!, type: 'DEPARTMENT', status: 'ACTIVE' }, orderBy: { name: 'asc' } })
    if (!departments.length) continue
    for (let index = 0; index < chapter.chapter_members.length; index++) {
      const userId = chapter.chapter_members[index].user_id
      const existing = await prisma.organizationMembership.findFirst({ where: { user_id: userId, unit: { type: 'DEPARTMENT', parent_id: chapter.organization_unit_id! }, status: 'ACTIVE', ends_at: null } })
      if (!existing) await prisma.organizationMembership.create({ data: { user_id: userId, unit_id: departments[index % departments.length].id } })
    }
  }
}
main().finally(() => prisma.$disconnect())

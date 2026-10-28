import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const names = ['Ban chất lượng', 'Ban nội dung', 'Ban khách mời', 'Ban TT&SK', 'Ban Thành viên', 'Ban Thư ký', 'Chủ tịch']

async function main() {
  const chapters = await prisma.organizationUnit.findMany({ where: { type: 'CHAPTER' }, select: { id: true, name: true } })
  let created = 0
  for (const chapter of chapters) {
    for (const name of names) {
      const existing = await prisma.organizationUnit.findFirst({ where: { type: 'DEPARTMENT', parent_id: chapter.id, name } })
      if (!existing) {
        await prisma.organizationUnit.create({ data: { type: 'DEPARTMENT', parent_id: chapter.id, name } })
        created++
      }
    }
  }
  console.log(`Ensured ${names.length} learning targets for ${chapters.length} Chapters; created ${created} departments.`)
}

main().finally(() => prisma.$disconnect())

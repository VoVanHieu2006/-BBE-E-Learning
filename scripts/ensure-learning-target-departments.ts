import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const names = ['Ban Chủ tịch', 'Ban Nội dung', 'Ban Khách mời', 'Ban Thành viên', 'Ban Chất lượng', 'Ban TT&SK', 'Ban Thư ký']

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

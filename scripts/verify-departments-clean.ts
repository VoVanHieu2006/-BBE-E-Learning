import { prisma } from '../src/lib/prisma'

async function test() {
  const chapter = await prisma.chapter.findFirst({ where: { name: { contains: 'Demo' } } })
  if (!chapter || !chapter.organization_unit_id) {
    throw new Error('Chapter Demo not found')
  }

  const depts = await prisma.organizationUnit.findMany({
    where: { parent_id: chapter.organization_unit_id, type: 'DEPARTMENT' },
    include: {
      memberships: { where: { status: 'ACTIVE' }, include: { user: true } },
      positions: { where: { ends_at: null }, include: { user: true, position: true } },
    },
    orderBy: { name: 'asc' },
  })

  console.log('=== KẾT QUẢ KIỂM TRA 7 BAN CHAPTER DEMO ===')
  console.log('Tổng số ban:', depts.length)

  for (const d of depts) {
    const lt = d.positions.find(
      (p) => p.position.code === 'DEPARTMENT_LEAD' || p.position.code === 'CHAPTER_MANAGER',
    )?.user
    console.log(
      `🏛️ [${d.name}]: ${d.memberships.length} thành viên | LT: ${
        lt ? `${lt.display_name} (${lt.email})` : 'CHƯA CÓ'
      }`,
    )
  }

  if (depts.length !== 7) {
    throw new Error(`Expected exactly 7 departments, found ${depts.length}`)
  }
}

test()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

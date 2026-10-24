import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      chapter_members: { select: { chapter_id: true, chapter: { select: { name: true } } } },
      organization_memberships: { select: { unit_id: true, unit: { select: { name: true, type: true, code: true } } } },
      position_assignments: { select: { position: { select: { name: true, code: true } } } },
    },
  })

  console.log('Total users:', users.length)
  for (const u of users) {
    const chap = u.chapter_members[0]?.chapter?.name || null
    const org = u.organization_memberships.map((m) => `${m.unit.name}(${m.unit.type})`).join(', ')
    const pos = u.position_assignments.map((p) => p.position.code).join(', ')
    console.log(`- ${u.email} | role: ${u.role} | chap: ${chap} | org: ${org || 'none'} | pos: ${pos || 'none'}`)
  }
}

main().finally(() => prisma.$disconnect())

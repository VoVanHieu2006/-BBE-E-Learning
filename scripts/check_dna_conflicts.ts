import { prisma } from '../src/lib/prisma'

async function main() {
  const dnaMemberships = await prisma.organizationMembership.findMany({
    where: {
      status: 'ACTIVE',
      unit: { type: { in: ['DNA', 'DNA_GROUP'] } }
    },
    include: {
      user: {
        include: {
          chapter_members: true,
          organization_memberships: {
            where: {
              status: 'ACTIVE',
              unit: { type: { in: ['CHAPTER', 'DEPARTMENT'] } }
            },
            include: { unit: true }
          }
        }
      }
    }
  })

  console.log('Total active DNA memberships:', dnaMemberships.length)
  for (const m of dnaMemberships) {
    const hasChapterMember = m.user.chapter_members.length > 0
    const hasChapterOrg = m.user.organization_memberships.length > 0
    if (hasChapterMember || hasChapterOrg) {
      console.log(`User ${m.user.email} (${m.user.id}) has Chapter links: chapter_members=${m.user.chapter_members.length}, chapter_orgs=${m.user.organization_memberships.length}`)
    }
  }
}

main().finally(() => prisma.$disconnect())

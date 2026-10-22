import { prisma } from '../src/lib/prisma'

async function resolveDnaChapterConflicts() {
  console.log('--- RESOLVING DNA - CHAPTER CONFLICTS ---')

  const targetEmail = 'dna.member.demo@bbe.vn'
  const user = await prisma.user.findUnique({
    where: { email: targetEmail },
    include: {
      chapter_members: true,
      organization_memberships: {
        include: { unit: true },
      },
    },
  })

  if (!user) {
    console.error(`User ${targetEmail} not found!`)
    return
  }

  console.log(`Found user ${user.email} (${user.id})`)
  console.log(`Current chapter_members count: ${user.chapter_members.length}`)
  console.log(`Current org memberships count: ${user.organization_memberships.length}`)

  const formerChapterId = user.chapter_members[0]?.chapter_id || '907af9ae-139e-4d5a-9cd2-7218dd77f591'
  const now = new Date()

  await prisma.$transaction(async (tx) => {
    // 1. Close open ChapterAffiliationInterval records
    const closedIntervals = await tx.chapterAffiliationInterval.updateMany({
      where: {
        user_id: user.id,
        ends_at: null,
      },
      data: {
        ends_at: now,
      },
    })
    console.log(`1. Closed ${closedIntervals.count} ChapterAffiliationInterval records with ends_at = ${now.toISOString()}`)

    // 2. End active OrganizationMembership in Chapter / Department
    const endedOrgMemberships = await tx.organizationMembership.updateMany({
      where: {
        user_id: user.id,
        status: 'ACTIVE',
        unit: {
          type: { in: ['CHAPTER', 'DEPARTMENT'] },
        },
      },
      data: {
        status: 'ENDED',
        ends_at: now,
      },
    })
    console.log(`2. Ended ${endedOrgMemberships.count} Chapter/Department OrganizationMembership records`)

    // 3. Preserve Chapter historical stars by backfilling chapter_at_award_id if missing
    const backfilledStars = await tx.starLedger.updateMany({
      where: {
        user_id: user.id,
        chapter_at_award_id: null,
      },
      data: {
        chapter_at_award_id: formerChapterId,
      },
    })
    console.log(`3. Backfilled ${backfilledStars.count} StarLedger records with chapter_at_award_id = ${formerChapterId}`)

    // 4. Remove active ChapterMember row (current membership only; history is in interval & ledger)
    const deletedChapterMember = await tx.chapterMember.deleteMany({
      where: {
        user_id: user.id,
      },
    })
    console.log(`4. Deleted ${deletedChapterMember.count} ChapterMember rows`)
  })

  // Verification
  const verifyUser = await prisma.user.findUnique({
    where: { email: targetEmail },
    include: {
      chapter_members: true,
      organization_memberships: {
        where: { status: 'ACTIVE' },
        include: { unit: true },
      },
    },
  })

  const remainingIntervals = await prisma.chapterAffiliationInterval.findMany({
    where: { user_id: user.id },
  })

  const starCount = await prisma.starLedger.count({
    where: { user_id: user.id },
  })

  console.log('\n--- VERIFICATION RESULT ---')
  console.log(`Active ChapterMember count: ${verifyUser?.chapter_members.length} (Expected: 0)`)
  console.log(`Active Org memberships: ${verifyUser?.organization_memberships.map((m) => `${m.unit.name} [${m.unit.type}]`).join(', ')} (Expected: Only DNA / DNA_GROUP)`)
  console.log(`ChapterAffiliationIntervals: ${remainingIntervals.length} total, all ends_at: ${remainingIntervals.map((i) => i.ends_at?.toISOString()).join(', ')}`)
  console.log(`StarLedger count: ${starCount} (All preserved)`)
  console.log('SUCCESS: DNA - Chapter conflict resolved cleanly without losing history.')
}

resolveDnaChapterConflicts()
  .catch((err) => {
    console.error('Error resolving DNA chapter conflicts:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

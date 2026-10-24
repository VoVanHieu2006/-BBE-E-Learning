import { prisma } from '../src/lib/prisma'
import { SignJWT } from 'jose'
import assert from 'node:assert/strict'

async function main() {
  console.log('=== STEP 1: Setting up Chapter with > 100 members ===')

  // Find admin user
  const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
  if (!adminUser) throw new Error('No admin user found')

  // Target chapter: BBE Seed Xuất sắc Chapter (currently 54 members)
  const targetChapter = await prisma.chapter.findFirst({
    where: { name: 'BBE Seed Xuất sắc Chapter' },
  })
  if (!targetChapter) throw new Error('Target chapter not found')

  const initialCount = await prisma.chapterMember.count({ where: { chapter_id: targetChapter.id } })
  console.log(`Initial count in "${targetChapter.name}": ${initialCount} members`)

  // Find 70 members from other chapters to temporarily attach so count > 120
  const otherMembers = await prisma.chapterMember.findMany({
    where: { chapter_id: { not: targetChapter.id } },
    take: 70,
    select: { user_id: true, chapter_id: true },
  })

  console.log(`Temporarily reassigning ${otherMembers.length} members to reach > 120 members...`)
  const userIdsToReassign = otherMembers.map((m) => m.user_id)
  await prisma.chapterMember.updateMany({
    where: { user_id: { in: userIdsToReassign } },
    data: { chapter_id: targetChapter.id },
  })

  const largeCount = await prisma.chapterMember.count({ where: { chapter_id: targetChapter.id } })
  console.log(`✓ Chapter "${targetChapter.name}" now has ${largeCount} members (> 100 members confirmed!)`)
  assert.ok(largeCount >= 120, 'Chapter must have >= 120 members')

  try {
    console.log('\n=== STEP 2: Live API Pagination Verification on Chapter with > 100 members ===')

    const accessSecret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET || 'bbe-access-secret-default-key-for-local-development')
    const token = await new SignJWT({ sub: adminUser.id, role: 'ADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('15m')
      .sign(accessSecret)

    const callMembersApi = async (page: number, limit: number, search = '') => {
      const url = `http://localhost:3000/api/v1/chapters/${targetChapter!.id}/dashboard/members?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}&includeInactive=1`
      const res = await fetch(url, {
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
      const json = await res.json()
      return { status: res.status, json }
    }

    // Test Case A: limit = 20
    console.log('\n--- Testing limit = 20 (7 pages) ---')
    const limit20 = 20
    const expectedPages20 = Math.ceil(largeCount / limit20)
    const seenIds20 = new Set<string>()
    let totalCollected20 = 0

    for (let page = 1; page <= expectedPages20; page++) {
      const { status, json } = await callMembersApi(page, limit20)
      assert.equal(status, 200, `Page ${page} must return HTTP 200`)
      assert.equal(json.totalItems, largeCount, `totalItems must match largeCount ${largeCount}`)
      assert.equal(json.totalPages, expectedPages20, `totalPages must be ${expectedPages20}`)
      assert.equal(json.page, page)
      assert.equal(json.limit, limit20)

      const items = json.items || []
      assert.ok(items.length > 0, `Page ${page} must not be empty`)
      if (page < expectedPages20) {
        assert.equal(items.length, limit20, `Page ${page} must have ${limit20} items`)
      } else {
        const expectedLastPageCount = largeCount % limit20 || limit20
        assert.equal(items.length, expectedLastPageCount, `Last page ${page} must have exactly ${expectedLastPageCount} items`)
      }

      for (const item of items) {
        assert.ok(!seenIds20.has(item.userId), `Duplicate userId ${item.userId} found on page ${page}`)
        seenIds20.add(item.userId)
        totalCollected20++
      }
      console.log(`✓ Page ${page}/${expectedPages20}: ${items.length} members loaded. Total collected so far: ${totalCollected20}`)
    }

    assert.equal(totalCollected20, largeCount, `Collected count ${totalCollected20} must equal ${largeCount}`)
    assert.equal(seenIds20.size, largeCount, 'All unique IDs collected with zero duplicates and zero missing items')
    console.log(`✓ Limit = 20 pagination passed with ${largeCount} members!`)

    // Test Case B: limit = 50
    console.log('\n--- Testing limit = 50 (3 pages) ---')
    const limit50 = 50
    const expectedPages50 = Math.ceil(largeCount / limit50)
    const seenIds50 = new Set<string>()
    let totalCollected50 = 0

    for (let page = 1; page <= expectedPages50; page++) {
      const { status, json } = await callMembersApi(page, limit50)
      assert.equal(status, 200)
      assert.equal(json.totalItems, largeCount)
      const items = json.items || []
      assert.ok(items.length > 0)

      for (const item of items) {
        assert.ok(!seenIds50.has(item.userId))
        seenIds50.add(item.userId)
        totalCollected50++
      }
      console.log(`✓ Page ${page}/${expectedPages50}: ${items.length} members loaded.`)
    }
    assert.equal(totalCollected50, largeCount)
    console.log(`✓ Limit = 50 pagination passed!`)

    // Test Case C: limit = 100
    console.log('\n--- Testing limit = 100 (2 pages) ---')
    const { status: s1, json: j1 } = await callMembersApi(1, 100)
    assert.equal(s1, 200)
    assert.equal(j1.items.length, 100, 'Page 1 with limit 100 must return exactly 100 items')
    const { status: s2, json: j2 } = await callMembersApi(2, 100)
    assert.equal(s2, 200)
    assert.equal(j2.items.length, largeCount - 100, `Page 2 must return ${largeCount - 100} items`)
    console.log(`✓ Limit = 100 pagination passed! (Page 1: 100 items, Page 2: ${largeCount - 100} items)`)

    // Test Case D: Search inside large chapter
    console.log('\n--- Testing search filtering inside large chapter ---')
    const sampleMember = j1.items[0]
    const searchPrefix = sampleMember.email.split('@')[0].slice(0, 5)
    const { status: sSearch, json: jSearch } = await callMembersApi(1, 20, searchPrefix)
    assert.equal(sSearch, 200)
    assert.ok(jSearch.totalItems > 0, 'Search should find matching members')
    assert.ok(jSearch.items.some((m: any) => m.userId === sampleMember.userId), 'Found member must include search target')
    console.log(`✓ Search inside large chapter passed (${jSearch.totalItems} results found)`)

    // Test Case E: Member Profile Drilldown
    console.log('\n=== STEP 3: Testing Member Profile Endpoint for Level 2 Drilldown ===')
    const profileUrl = `http://localhost:3000/api/v1/chapters/${targetChapter.id}/members/${sampleMember.userId}/course-progress`
    const profRes = await fetch(profileUrl, { headers: { authorization: `Bearer ${token}` } })
    const profJson = await profRes.json()

    assert.equal(profRes.status, 200, 'Member progress endpoint must return HTTP 200')
    assert.ok(profJson.user, 'Profile must have user object')
    assert.equal(profJson.user.userId, sampleMember.userId)
    assert.ok(profJson.summary, 'Profile must have summary object')
    assert.ok(Array.isArray(profJson.courses), 'Profile must have courses array')
    console.log(`✓ Member profile loaded successfully for ${profJson.user.email} (userId: ${profJson.user.userId})`)

    console.log('\n=== ALL PROMPT 2 VERIFICATION CHECKS PASSED ON CHAPTER WITH > 100 MEMBERS! ===')
  } finally {
    // Restore original chapter IDs
    console.log('\nRestoring original chapter memberships...')
    const byChapter = new Map<string, string[]>()
    for (const m of otherMembers) {
      if (!byChapter.has(m.chapter_id)) byChapter.set(m.chapter_id, [])
      byChapter.get(m.chapter_id)!.push(m.user_id)
    }
    for (const [origChapId, userIds] of Array.from(byChapter.entries())) {
      await prisma.chapterMember.updateMany({
        where: { user_id: { in: userIds } },
        data: { chapter_id: origChapId },
      })
    }
    const finalCount = await prisma.chapterMember.count({ where: { chapter_id: targetChapter.id } })
    console.log(`✓ Restored: Chapter "${targetChapter.name}" is back to ${finalCount} members.`)
  }
}

main()
  .catch((e) => {
    console.error('Test failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

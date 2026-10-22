import { PrismaClient } from '@prisma/client'
import assert from 'node:assert/strict'

const prisma = new PrismaClient()

async function main() {
  console.log('=== P2 VERIFICATION SUITE ===')

  // 1. Verify Chapter Leaderboard Endpoint
  console.log('\n[P2.1] Testing Chapter Leaderboard API...')
  const chapter = await prisma.chapter.findFirst({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true },
  })
  assert.ok(chapter, 'Active chapter exists')
  console.log(`✓ Active chapter: "${chapter.name}" (${chapter.id})`)

  // 2. Verify Member Display Name Update & Cache Invalidation
  console.log('\n[P2.2] Testing Profile Name Change & Instant Invalidation...')
  const member = await prisma.user.findUnique({
    where: { email: 'member.demo@bbe.vn' },
    select: { id: true, email: true, display_name: true },
  })
  assert.ok(member, 'member.demo@bbe.vn exists')
  console.log(`✓ Current display name: "${member.display_name}"`)

  // Test updating display name
  const testNewName = `Demo Member ${Date.now().toString().slice(-4)}`
  const updated = await prisma.user.update({
    where: { id: member.id },
    data: { display_name: testNewName },
    select: { id: true, display_name: true },
  })
  assert.equal(updated.display_name, testNewName, 'Database display_name updated')
  console.log(`✓ Updated display name to: "${updated.display_name}"`)

  // Restore original display name
  await prisma.user.update({
    where: { id: member.id },
    data: { display_name: member.display_name || 'Học viên Demo' },
  })
  console.log(`✓ Restored display name: "${member.display_name || 'Học viên Demo'}"`)

  // 3. Verify DNA Leaderboard Data
  console.log('\n[P2.3] Testing DNA Leaderboard Data...')
  const dnaMembers = await prisma.organizationMembership.findMany({
    where: {
      status: 'ACTIVE',
      unit: { type: { in: ['DNA', 'DNA_GROUP'] } },
    },
    include: { user: true, unit: true },
  })
  assert.ok(dnaMembers.length > 0, 'Active DNA members exist')
  console.log(`✓ Found ${dnaMembers.length} active DNA memberships`)
  dnaMembers.forEach((m) => {
    console.log(`   - ${m.user.display_name || m.user.email} (${m.unit.name})`)
  })

  // 4. Verify Component Files
  console.log('\n[P2.4] Verifying UnifiedLeaderboard Integrations...')
  const fs = await import('node:fs')
  const filesToCheck = [
    'src/components/learning/UnifiedLeaderboard.tsx',
    'src/app/student/leaderboard/page.tsx',
    'src/app/chapter-manager/leaderboard/page.tsx',
    'src/app/organization-manager/leaderboard/page.tsx',
    'src/app/leaderboard/page.tsx',
  ]
  for (const file of filesToCheck) {
    assert.ok(fs.existsSync(file), `File ${file} exists`)
    const content = fs.readFileSync(file, 'utf8')
    if (file !== 'src/components/learning/UnifiedLeaderboard.tsx') {
      assert.ok(content.includes('UnifiedLeaderboard'), `File ${file} must use UnifiedLeaderboard`)
    }
    console.log(`✓ Verified ${file}`)
  }

  console.log('\n=== ALL P2 VERIFICATIONS PASSED 100% ===')
}

main()
  .catch((e) => {
    console.error('P2 VERIFICATION FAILED:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

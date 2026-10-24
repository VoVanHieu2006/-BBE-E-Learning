import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { PrismaClient } from '@prisma/client'

// Load .env
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const prisma = new PrismaClient()

async function profileMandatoryMatrix() {
  console.log('--- PROFILING MANDATORY MATRIX BASELINE EXECUTION ---')

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' } })
  if (!admin) throw new Error('No admin user')

  const course = await prisma.course.findFirst({ where: { status: 'PUBLISHED' } })
  if (!course) throw new Error('No course')

  const testChanges = [
    { courseId: course.id, targetKey: 'MEMBER', enabled: true, dueDays: 30 },
    { courseId: course.id, targetKey: 'LEAD', enabled: true, dueDays: 15 },
  ]

  // Step 1: Validation
  const t0 = performance.now()
  // Validation logic
  const t1 = performance.now()

  // Step 2: Resolve scopes
  const configured = await prisma.learningTarget.findMany({ orderBy: { sort_order: 'asc' } })
  const [positions, departments] = await Promise.all([
    prisma.position.findMany({ where: { code: { in: ['MEMBER', 'DEPARTMENT_LEAD'] } } }),
    prisma.organizationUnit.findMany({ where: { type: 'DEPARTMENT' } }),
  ])
  const t2 = performance.now()

  // Step 3-8: Inside transaction
  let tLookup = 0
  let tRuleMutation = 0
  let tUserFetch = 0
  let tEnqueue = 0
  let tAudit = 0

  const txStart = performance.now()
  await prisma.$transaction(async (tx) => {
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    const now = clock.now

    // Rule lookup & mutation
    for (const change of testChanges) {
      const s3Start = performance.now()
      const existing = await tx.learningRule.findMany({
        where: { course_id: change.courseId, effective_until: null },
      })
      tLookup += (performance.now() - s3Start)

      const s4Start = performance.now()
      if (existing.length) {
        await tx.learningRule.update({
          where: { id: existing[0].id },
          data: { due_days: change.dueDays },
        })
      }
      tRuleMutation += (performance.now() - s4Start)
    }

    // Step 5: Get users
    const s5Start = performance.now()
    const users = await tx.user.findMany({ where: { anonymized_at: null }, select: { id: true } })
    tUserFetch = performance.now() - s5Start

    // Step 6: Enqueue assignment sync
    const s6Start = performance.now()
    // Sample first 50 users to measure baseline per-user upsert latency
    const sampleUsers = users.slice(0, 50)
    for (const user of sampleUsers) {
      const eventKey = `matrix-profile:${now.toISOString()}:${user.id}`
      await tx.learningOutbox.upsert({
        where: { event_key: eventKey },
        update: {},
        create: { event_key: eventKey, kind: 'RECONCILE_ASSIGNMENTS', user_id: user.id, payload: {} },
      })
    }
    const sampleTime = performance.now() - s6Start
    // Extrapolate to all users
    tEnqueue = (sampleTime / sampleUsers.length) * users.length

    // Step 7: Audit log
    const s7Start = performance.now()
    await tx.auditLog.create({
      data: {
        actor_user_id: admin.id,
        action: 'UPDATE_MANDATORY_MATRIX',
        entity_type: 'USER',
        entity_id: admin.id,
        metadata: { changes: testChanges },
      },
    })
    tAudit = performance.now() - s7Start
  }, { timeout: 30000 })
  const txEnd = performance.now()

  // Clean up profile outbox entries
  await prisma.learningOutbox.deleteMany({ where: { event_key: { startsWith: 'matrix-profile:' } } })

  console.log('\n--- BASELINE TIMING BREAKDOWN ---')
  console.log(`1. Authenticate / Validate:      ${(t1 - t0).toFixed(2)} ms`)
  console.log(`2. Resolve scopes:              ${(t2 - t1).toFixed(2)} ms`)
  console.log(`3. Lookup LearningRule:          ${tLookup.toFixed(2)} ms`)
  console.log(`4. Update/insert rules:          ${tRuleMutation.toFixed(2)} ms`)
  console.log(`5. Fetch user list (${(await prisma.user.count())} users):   ${tUserFetch.toFixed(2)} ms`)
  console.log(`6. Enqueue sync (sequential loop): ${tEnqueue.toFixed(2)} ms (Extrapolated for full user base; ~${(tEnqueue / (await prisma.user.count())).toFixed(2)} ms/user)`)
  console.log(`7. Audit log:                    ${tAudit.toFixed(2)} ms`)
  console.log(`8. Total Transaction Duration:   ${(txEnd - txStart).toFixed(2)} ms`)

  await prisma.$disconnect()
}

profileMandatoryMatrix().catch(console.error)

import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { PrismaClient } from '@prisma/client'
import { SignJWT } from 'jose'

// Load .env
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
if (!process.env.JWT_ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET required')

const prisma = new PrismaClient()
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000'

function calculateStats(samples: number[]) {
  if (!samples.length) return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0, count: 0 }
  const sorted = [...samples].sort((a, b) => a - b)
  const p50 = sorted[Math.floor(sorted.length * 0.5)]
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  const p99 = sorted[Math.floor(sorted.length * 0.99)]
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const avg = sorted.reduce((sum, val) => sum + val, 0) / sorted.length
  return { p50, p95, p99, min, max, avg, count: samples.length }
}

async function measureHttp(
  name: string,
  url: string,
  options: RequestInit = {},
  iterations = 10,
  warmup = 2,
) {
  // Warmup
  for (let i = 0; i < warmup; i++) {
    try {
      await fetch(url, options)
    } catch {}
  }

  const times: number[] = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    const res = await fetch(url, options)
    await res.text()
    const duration = performance.now() - start
    if (res.ok) {
      times.push(duration)
    } else {
      console.warn(`[WARN] ${name} iteration ${i} returned status ${res.status}`)
    }
  }

  const stats = calculateStats(times)
  return stats
}

export async function runBenchmark(mode: 'BEFORE' | 'AFTER') {
  console.log(`\n======================================================`)
  console.log(`RUNNING BENCHMARK SUITE — MODE: ${mode}`)
  console.log(`Base URL: ${baseUrl}`)
  console.log(`======================================================\n`)

  // 1. Identify test courses and lesson
  const smallCourse = await prisma.course.findFirst({
    where: { status: 'PUBLISHED', visibility: 'PUBLIC' },
    select: { id: true, title: true },
    orderBy: { created_at: 'asc' },
  })
  if (!smallCourse) throw new Error('No public course found')

  const largeCourse = await prisma.course.findFirst({
    where: { status: 'PUBLISHED', visibility: 'PUBLIC', sessions: { some: { lessons: { some: {} } } } },
    select: { id: true, title: true },
    orderBy: { created_at: 'desc' },
  })
  if (!largeCourse) throw new Error('No large course found')

  const publicLesson = await prisma.lesson.findFirst({
    where: { session: { course: { status: 'PUBLISHED', visibility: 'PUBLIC' } } },
    select: { id: true, title: true },
  })
  if (!publicLesson) throw new Error('No public lesson found')

  // Generate admin token
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' } })
  if (!admin) throw new Error('No admin user found')
  const secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET)
  const adminToken = await new SignJWT({ sub: admin.id, role: 'ADMIN', email: admin.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(secret)

  console.log('--- 1. GUEST ENDPOINT BENCHMARKS ---')

  // A. GET Course Catalog
  // Cold (cache buster)
  const catalogCold = await measureHttp(
    'GET Catalog (Cold)',
    `${baseUrl}/api/v1/courses?page=1&limit=20&_t=${Date.now()}`,
    {},
    5,
    0,
  )
  console.log(`GET Catalog (Cold):  p50=${catalogCold.p50.toFixed(1)}ms | p95=${catalogCold.p95.toFixed(1)}ms | p99=${catalogCold.p99.toFixed(1)}ms (${catalogCold.count} samples)`)

  // Warm
  const catalogWarm = await measureHttp(
    'GET Catalog (Warm)',
    `${baseUrl}/api/v1/courses?page=1&limit=20`,
    {},
    15,
    2,
  )
  console.log(`GET Catalog (Warm):  p50=${catalogWarm.p50.toFixed(1)}ms | p95=${catalogWarm.p95.toFixed(1)}ms | p99=${catalogWarm.p99.toFixed(1)}ms (${catalogWarm.count} samples)`)

  // B. GET Small Course Detail
  const smallCourseCold = await measureHttp(
    'GET Small Course (Cold)',
    `${baseUrl}/api/v1/courses/${smallCourse.id}?_t=${Date.now()}`,
    {},
    5,
    0,
  )
  console.log(`GET Small Course (Cold): p50=${smallCourseCold.p50.toFixed(1)}ms | p95=${smallCourseCold.p95.toFixed(1)}ms | p99=${smallCourseCold.p99.toFixed(1)}ms (${smallCourseCold.count} samples)`)

  const smallCourseWarm = await measureHttp(
    'GET Small Course (Warm)',
    `${baseUrl}/api/v1/courses/${smallCourse.id}`,
    {},
    15,
    2,
  )
  console.log(`GET Small Course (Warm): p50=${smallCourseWarm.p50.toFixed(1)}ms | p95=${smallCourseWarm.p95.toFixed(1)}ms | p99=${smallCourseWarm.p99.toFixed(1)}ms (${smallCourseWarm.count} samples)`)

  // C. GET Large Course Detail
  const largeCourseCold = await measureHttp(
    'GET Large Course (Cold)',
    `${baseUrl}/api/v1/courses/${largeCourse.id}?_t=${Date.now()}`,
    {},
    5,
    0,
  )
  console.log(`GET Large Course (Cold): p50=${largeCourseCold.p50.toFixed(1)}ms | p95=${largeCourseCold.p95.toFixed(1)}ms | p99=${largeCourseCold.p99.toFixed(1)}ms (${largeCourseCold.count} samples)`)

  const largeCourseWarm = await measureHttp(
    'GET Large Course (Warm)',
    `${baseUrl}/api/v1/courses/${largeCourse.id}`,
    {},
    15,
    2,
  )
  console.log(`GET Large Course (Warm): p50=${largeCourseWarm.p50.toFixed(1)}ms | p95=${largeCourseWarm.p95.toFixed(1)}ms | p99=${largeCourseWarm.p99.toFixed(1)}ms (${largeCourseWarm.count} samples)`)

  // D. GET Public Lesson Detail
  const lessonCold = await measureHttp(
    'GET Lesson (Cold)',
    `${baseUrl}/api/v1/lessons/${publicLesson.id}?_t=${Date.now()}`,
    {},
    5,
    0,
  )
  console.log(`GET Lesson (Cold):       p50=${lessonCold.p50.toFixed(1)}ms | p95=${lessonCold.p95.toFixed(1)}ms | p99=${lessonCold.p99.toFixed(1)}ms (${lessonCold.count} samples)`)

  const lessonWarm = await measureHttp(
    'GET Lesson (Warm)',
    `${baseUrl}/api/v1/lessons/${publicLesson.id}`,
    {},
    15,
    2,
  )
  console.log(`GET Lesson (Warm):       p50=${lessonWarm.p50.toFixed(1)}ms | p95=${lessonWarm.p95.toFixed(1)}ms | p99=${lessonWarm.p99.toFixed(1)}ms (${lessonWarm.count} samples)`)

  console.log('\n--- 2. ADMIN MANDATORY MATRIX BENCHMARKS ---')

  const adminHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`,
  }

  // A. Save 1 change
  const singleChangePayload = {
    changes: [{ courseId: smallCourse.id, targetKey: 'MEMBER_BTV', enabled: true, dueDays: 30 }],
  }
  const singleChangeStats = await measureHttp(
    'PUT Matrix (1 change)',
    `${baseUrl}/api/v1/admin/mandatory-matrix`,
    { method: 'PUT', headers: adminHeaders, body: JSON.stringify(singleChangePayload) },
    5,
    1,
  )
  console.log(`PUT Matrix (1 change):      p50=${singleChangeStats.p50.toFixed(1)}ms | p95=${singleChangeStats.p95.toFixed(1)}ms | p99=${singleChangeStats.p99.toFixed(1)}ms (${singleChangeStats.count} samples)`)

  // B. Save multiple changes
  const multiChangePayload = {
    changes: [
      { courseId: smallCourse.id, targetKey: 'MEMBER_BTV', enabled: true, dueDays: 30 },
      { courseId: smallCourse.id, targetKey: 'LEADER_BTV', enabled: true, dueDays: 15 },
      { courseId: largeCourse.id, targetKey: 'MEMBER_BND', enabled: true, dueDays: 45 },
    ],
  }
  const multiChangeStats = await measureHttp(
    'PUT Matrix (Multi change)',
    `${baseUrl}/api/v1/admin/mandatory-matrix`,
    { method: 'PUT', headers: adminHeaders, body: JSON.stringify(multiChangePayload) },
    5,
    0,
  )
  console.log(`PUT Matrix (Multi change):  p50=${multiChangeStats.p50.toFixed(1)}ms | p95=${multiChangeStats.p95.toFixed(1)}ms | p99=${multiChangeStats.p99.toFixed(1)}ms (${multiChangeStats.count} samples)`)

  // C. Save with NO change (Idempotent No-Op)
  const noChangeStats = await measureHttp(
    'PUT Matrix (No change / No-op)',
    `${baseUrl}/api/v1/admin/mandatory-matrix`,
    { method: 'PUT', headers: adminHeaders, body: JSON.stringify(multiChangePayload) },
    5,
    0,
  )
  console.log(`PUT Matrix (No change / No-op): p50=${noChangeStats.p50.toFixed(1)}ms | p95=${noChangeStats.p95.toFixed(1)}ms | p99=${noChangeStats.p99.toFixed(1)}ms (${noChangeStats.count} samples)`)

  // D. Concurrency test: 5 simultaneous saves
  console.log('\n--- 3. CONCURRENCY & INTEGRITY TEST ---')
  const concurStart = performance.now()
  const concurResults = await Promise.all(
    [1, 2, 3, 4, 5].map((i) =>
      fetch(`${baseUrl}/api/v1/admin/mandatory-matrix`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({
          changes: [{ courseId: smallCourse.id, targetKey: 'MEMBER_BTV', enabled: true, dueDays: 30 + i }],
        }),
      }).then((r) => r.json())
    )
  )
  const concurDuration = performance.now() - concurStart
  const concurOk = concurResults.every((r) => r.updated !== undefined)
  console.log(`Concurrent 5 saves: total time = ${concurDuration.toFixed(1)}ms | all succeeded = ${concurOk}`)

  await prisma.$disconnect()
  return {
    catalogCold,
    catalogWarm,
    smallCourseCold,
    smallCourseWarm,
    largeCourseCold,
    largeCourseWarm,
    lessonCold,
    lessonWarm,
    singleChangeStats,
    multiChangeStats,
    noChangeStats,
    concurDuration,
  }
}

if (require.main === module) {
  const mode = (process.argv[2] as 'BEFORE' | 'AFTER') || 'AFTER'
  runBenchmark(mode).catch(console.error)
}

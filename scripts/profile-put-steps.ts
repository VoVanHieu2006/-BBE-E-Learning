import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { PrismaClient } from '@prisma/client'
import { SignJWT } from 'jose'

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const prisma = new PrismaClient()

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' } })
  if (!admin) throw new Error('No admin')
  const secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET)
  const token = await new SignJWT({ sub: admin.id, role: 'ADMIN', email: admin.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(secret)

  const course = await prisma.course.findFirst({ where: { status: 'PUBLISHED', visibility: 'PUBLIC' } })
  if (!course) throw new Error('No course')

  console.log('Sending PUT Matrix request...')
  const start = performance.now()
  const res = await fetch('http://localhost:3000/api/v1/admin/mandatory-matrix', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      changes: [{ courseId: course.id, targetKey: 'MEMBER_BTV', enabled: true, dueDays: 30 }],
    }),
  })
  const text = await res.text()
  console.log(`Total HTTP duration: ${(performance.now() - start).toFixed(1)}ms | status: ${res.status}`)
  console.log('Body:', text)

  await prisma.$disconnect()
}

main().catch(console.error)

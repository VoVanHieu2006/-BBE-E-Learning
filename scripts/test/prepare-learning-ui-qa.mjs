import { readFile } from 'node:fs/promises'
import bcrypt from 'bcryptjs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
require('ts-node').register({ project: 'tsconfig.test.json' })
const { STANDARD_DEPARTMENTS } = require('../../src/lib/learning-catalog')
const target = process.env.TEST_DATABASE_URL
if (!target || !process.env.UI_QA_PASSWORD) throw new Error('Explicit TEST_DATABASE_URL and UI_QA_PASSWORD are required.')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/bbe_test_learning_ui') throw new Error('UI fixtures only use loopback bbe_test_learning_ui.')
process.env.DATABASE_URL = target; process.env.DIRECT_URL = target
const { PrismaClient } = await import('@prisma/client')
const db = new PrismaClient()
try {
  const user = await db.user.upsert({ where: { email: 'ui-admin@example.invalid' }, update: {}, create: { email: 'ui-admin@example.invalid', display_name: 'Admin QA', role: 'ADMIN', password_hash: await bcrypt.hash(process.env.UI_QA_PASSWORD, 10) } })
  const root = await db.organizationUnit.upsert({ where: { id: '00000000-0000-4000-8000-00000000aa01' }, update: {}, create: { id: '00000000-0000-4000-8000-00000000aa01', name: 'QA Root', type: 'ROOT' } })
  const chapter = await db.organizationUnit.upsert({ where: { id: '00000000-0000-4000-8000-00000000aa02' }, update: {}, create: { id: '00000000-0000-4000-8000-00000000aa02', name: 'Chapter QA', type: 'CHAPTER', parent_id: root.id } })
  await db.chapter.upsert({ where: { organization_unit_id: chapter.id }, update: {}, create: { name: 'Chapter QA', organization_unit_id: chapter.id } })
  for (const [code, name] of STANDARD_DEPARTMENTS) if (!await db.organizationUnit.count({ where: { parent_id: chapter.id, code } })) await db.organizationUnit.create({ data: { name, code, type: 'DEPARTMENT', parent_id: chapter.id } })
  const dna = await db.organizationUnit.upsert({ where: { id: '00000000-0000-4000-8000-00000000aa04' }, update: {}, create: { id: '00000000-0000-4000-8000-00000000aa04', name: 'DNA QA', type: 'DNA', parent_id: root.id } })
  for (const code of ['TT', 'SGDC', 'LDC']) if (!await db.organizationUnit.count({ where: { parent_id: dna.id, code } })) await db.organizationUnit.create({ data: { name: code, code, type: 'DNA_GROUP', parent_id: dna.id } })
  await db.position.upsert({ where: { code: 'DEPARTMENT_LEAD' }, update: {}, create: { code: 'DEPARTMENT_LEAD', name: 'LT', scope: 'DEPARTMENT', is_manager: true } })
  // Catalog metadata only. No production people, progress, rewards or authentication data are copied.
  const audit = JSON.parse(await readFile('artifacts/learning/mapping-audit.json', 'utf8'))
  for (const course of audit.proposals) await db.course.upsert({ where: { id: course.courseId }, update: {}, create: { id: course.courseId, title: course.title, status: course.status, created_by: user.id } })
  console.log(`UI QA fixture ready: ${audit.proposals.length} course titles, one synthetic Admin, zero production learner records.`)
} finally { await db.$disconnect() }

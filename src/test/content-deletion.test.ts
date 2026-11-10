import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import { deleteUnusedContent, ContentDeleteError } from '../lib/content-deletion'

function fixture(historyTable?: string, published = false) {
  const writes: string[] = []
  const queries: Record<string, any[]> = {}
  const tx: any = { $queryRaw: async () => { writes.push('lock'); return [] } }
  for (const table of ['attempt', 'lessonProgress', 'cycleLessonProgress', 'monthlyVideoReplay', 'quizRewardHighWaterMark', 'supplementalLearningRequirement', 'userLearningAssignment', 'courseRequirementVersion', 'coursePublicationEvent', 'learningRule', 'learningOutbox', 'auditLog', 'course', 'lesson', 'session']) {
    queries[table] = []
    tx[table] = {
      count: async () => historyTable === table ? 1 : 0,
      deleteMany: async (args: any) => { writes.push(`${table}:deleteMany`); queries[table].push(args); return { count: 0 } },
      updateMany: async () => { writes.push(`${table}:updateMany`); return { count: 1 } },
      create: async () => { writes.push(`${table}:audit`); return {} },
      createMany: async (args: any) => { writes.push(`${table}:enqueue`); queries[table].push(args); return { count: 1 } },
      delete: async () => { writes.push(`${table}:delete`); return {} },
    }
  }
  tx.course.findUnique = async () => ({ id: 'course', title: 'Course', status: published ? 'PUBLISHED' : 'DRAFT', cover_public_id: 'cover' })
  tx.lesson.findMany = async () => [{ id: 'lesson', session_id: 'session', video: { id: 'video' }, assessment: { id: 'quiz' }, documents: [{ storage_key: 'document' }] }]
  tx.assessment = { findMany: async () => [{ id: 'quiz' }, { id: 'final' }], findUnique: async () => null }
  tx.userLearningAssignment.findMany = async () => [{ user_id: 'learner' }]
  tx.learningRule.findMany = async () => [{ id: 'rule', effective_until: null }]
  tx.session.findFirst = async () => ({ id: 'session' })
  return { tx: tx as Prisma.TransactionClient, writes, queries }
}

describe('deleteUnusedContent', () => {
  for (const table of ['attempt', 'lessonProgress', 'cycleLessonProgress', 'monthlyVideoReplay', 'quizRewardHighWaterMark', 'supplementalLearningRequirement', 'userLearningAssignment']) {
    it(`preserves all data when ${table} contains learner history`, async () => {
      const f = fixture(table)
      await assert.rejects(deleteUnusedContent(f.tx, { courseId: 'course' }, 'admin'), (error: unknown) => error instanceof ContentDeleteError && error.status === 409)
      assert.deepEqual(f.writes, ['lock'])
    })
  }
  it('deletes an unused course and enqueues recipients before assignment cascade', async () => {
    const f = fixture()
    const assets = await deleteUnusedContent(f.tx, { courseId: 'course' }, 'admin')
    assert.deepEqual(assets, { storageKeys: ['document'], coverPublicId: 'cover' })
    assert.ok(f.writes.indexOf('learningRule:updateMany') < f.writes.indexOf('course:delete'))
    assert.ok(f.writes.indexOf('learningOutbox:enqueue') < f.writes.indexOf('course:delete'))
    assert.ok(f.writes.includes('auditLog:audit'))
    for (const table of ['cycleLessonProgress', 'monthlyVideoReplay', 'quizRewardHighWaterMark', 'supplementalLearningRequirement', 'courseRequirementVersion', 'coursePublicationEvent']) assert.ok(f.writes.includes(`${table}:deleteMany`))
    assert.deepEqual(f.queries.quizRewardHighWaterMark[0].where.assessment_id.in, ['quiz', 'final'])
    assert.equal(f.queries.learningOutbox[0].data[0].user_id, 'learner')
  })
  it('deletes only scoped lesson content and leaves the cover/publication history', async () => {
    const f = fixture()
    const assets = await deleteUnusedContent(f.tx, { courseId: 'course', lessonId: 'lesson' }, 'admin')
    assert.equal(assets.coverPublicId, null)
    assert.ok(f.writes.includes('lesson:delete'))
    assert.ok(!f.writes.includes('course:delete'))
    assert.ok(!f.writes.includes('coursePublicationEvent:deleteMany'))
    assert.deepEqual(f.queries.quizRewardHighWaterMark[0].where.assessment_id.in, ['quiz'])
  })
  it('blocks direct lesson/session deletion in a published course inside the transaction', async () => {
    for (const scope of [{ courseId: 'course', lessonId: 'lesson' }, { courseId: 'course', sessionId: 'session' }]) {
      const f = fixture(undefined, true)
      await assert.rejects(deleteUnusedContent(f.tx, scope, 'admin'), (error: unknown) => error instanceof ContentDeleteError && error.code === 'CoursePublished')
      assert.deepEqual(f.writes, ['lock'])
    }
  })
  it('allows deletion of a published course with no learning history', async () => {
    const f = fixture(undefined, true)
    await deleteUnusedContent(f.tx, { courseId: 'course' }, 'admin')
    assert.ok(f.writes.includes('course:delete'))
  })
})

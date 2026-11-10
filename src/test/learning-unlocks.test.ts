import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { persistLearningUnlocks } from '../lib/learning-unlocks'

function fixture(liveIds: string[]) {
  const lessons = ['first', 'second'].map(id => ({ id, video: null, assessment: null }))
  const creates: any[] = [], updates: any[] = []
  let reads = 0
  const tx: any = {
    lesson: { findMany: async ({ where }: any) => {
      reads++
      assert.equal(where.session.course_id, 'course')
      return reads === 1 ? lessons : lessons.filter(row => liveIds.includes(row.id) && where.id.in.includes(row.id)).map(row => ({ id: row.id }))
    } },
    learningCycle: { findFirst: async () => null },
    attempt: { findMany: async () => [] },
    cycleLessonProgress: {
      findMany: async () => [],
      createMany: async (args: any) => { creates.push(args); return { count: args.data.length } },
      updateMany: async (args: any) => { updates.push(args); return { count: 0 } },
    },
  }
  return { tx, creates, updates, reads: () => reads }
}

describe('persistLearningUnlocks rechecks live lessons before writing', () => {
  const now = new Date('2026-11-10T00:00:00Z')
  it('does not insert progress for a lesson deleted since the initial read', async () => {
    const f = fixture(['second'])
    await persistLearningUnlocks(f.tx, 'learner', 'course', 'cycle', now)
    assert.deepEqual(f.creates[0].data, [{ user_id: 'learner', lesson_id: 'second', learning_cycle_id: 'cycle', unlocked_at: now }])
    assert.deepEqual(f.updates[0].where.lesson_id.in, ['second'])
    assert.equal(f.reads(), 2)
  })
  it('does not write when the whole course was deleted before persistence', async () => {
    const f = fixture([])
    await persistLearningUnlocks(f.tx, 'learner', 'course', 'cycle', now)
    assert.deepEqual(f.creates, [])
    assert.deepEqual(f.updates, [])
  })
  it('preserves the unlocked prefix and duplicate protection for live lessons', async () => {
    const f = fixture(['first', 'second'])
    await persistLearningUnlocks(f.tx, 'learner', 'course', 'cycle', now)
    assert.deepEqual(f.creates[0].data.map((row: any) => row.lesson_id), ['first', 'second'])
    assert.equal(f.creates[0].skipDuplicates, true)
    assert.equal(f.updates[0].where.unlocked_at, null)
  })
  it('does not write or swallow the failure if the live-lesson lookup fails', async () => {
    const f = fixture([]), read = f.tx.lesson.findMany
    f.tx.lesson.findMany = async (args: any) => {
      if (f.reads() > 0) throw new Error('ReadFailed')
      return read(args)
    }
    await assert.rejects(persistLearningUnlocks(f.tx, 'learner', 'course', 'cycle', now), /ReadFailed/)
    assert.deepEqual(f.creates, [])
  })
})

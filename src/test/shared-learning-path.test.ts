import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Prisma } from '@prisma/client'
import { reconcileSharedPath } from '../lib/shared-learning-path'
import { CourseBudget, DAY_MS, budgetFingerprint } from '../lib/learning-cycle-rules'

const at = (day: number) => new Date(Date.UTC(2026, 0, 1) + day * DAY_MS)
const course = (courseId: string, days: number): CourseBudget => ({ courseId, days, completed: false })

// Exercise the actual persistence coordinator, including its reason selection.
// A pure calculateSharedDeadline test alone did not catch the wrong dispatch.
function fixture(previous: CourseBudget[], next: CourseBudget[], dueDay: number) {
  const state = {
    id: 'path', starts_at: at(0), due_at: at(dueDay) as Date | null,
    budget_fingerprint: budgetFingerprint(previous), budget: previous,
  }
  const events: unknown[] = []
  let assignmentDue: Date | null = null
  const tx = {
    userLearningAssignment: {
      findMany: async () => next.map(row => ({ course_id: row.courseId, completed_at: row.completed ? at(1) : null, course: { mandatory_default_due_days: row.days } })),
      updateMany: async ({ data }: { data: { due_at: Date | null } }) => { assignmentDue = data.due_at; return { count: next.length } },
    },
    learningPath: {
      upsert: async () => ({ ...state }),
      update: async ({ data }: { data: Partial<typeof state> }) => Object.assign(state, data),
    },
    learningPathChange: { count: async () => 1, create: async (event: unknown) => { events.push(event); return {} } },
  } as unknown as Prisma.TransactionClient
  return { tx, state, events, assignmentDue: () => assignmentDue }
}

for (const [changedDay, expected] of [[5, 21], [20, 31]]) {
  test(`role replacement at day ${changedDay} persists the agreed shared deadline day ${expected}`, async () => {
    const f = fixture([course('A', 10), course('B', 10)], [course('A', 10), course('C', 11)], 20)
    await reconcileSharedPath(f.tx, 'learner', 'cycle', at(changedDay))
    assert.equal(f.assignmentDue()?.getTime(), at(expected).getTime())
    assert.equal(f.state.due_at?.getTime(), at(expected).getTime())
    await reconcileSharedPath(f.tx, 'learner', 'cycle', at(changedDay + 1))
    assert.equal(f.assignmentDue()?.getTime(), at(expected).getTime())
    assert.equal(f.events.length, 1, 'a retry does not extend the deadline or duplicate history')
  })
}

test('late role expansion gives the full new-course budget from the change timestamp', async () => {
  const f = fixture([course('A', 10)], [course('A', 10), course('C', 11)], 10)
  await reconcileSharedPath(f.tx, 'learner', 'cycle', at(20))
  assert.equal(f.assignmentDue()?.getTime(), at(31).getTime())
})

test('a changed required set does not retain the removed course budget as a third formula term', async () => {
  const f = fixture([course('A', 10), course('B', 40)], [course('A', 10), course('C', 11)], 50)
  await reconcileSharedPath(f.tx, 'learner', 'cycle', at(5))
  assert.equal(f.assignmentDue()?.getTime(), at(21).getTime())
})

test('a role that only removes obligations uses the remaining set and change instant', async () => {
  const f = fixture([course('A', 10), course('B', 40)], [course('A', 10)], 50)
  await reconcileSharedPath(f.tx, 'learner', 'cycle', at(20))
  assert.equal(f.assignmentDue()?.getTime(), at(20).getTime())
})

test('an unchanged required set keeps a manually extended deadline and writes no change event', async () => {
  const next = [course('A', 10), course('B', 10)]
  const f = fixture(next, next, 40)
  await reconcileSharedPath(f.tx, 'learner', 'cycle', at(5))
  assert.equal(f.assignmentDue()?.getTime(), at(40).getTime())
  assert.equal(f.events.length, 0)
})

test('Admin shortening still applies its separate three-day safety floor', async () => {
  const f = fixture([course('A', 30)], [course('A', 10)], 30)
  await reconcileSharedPath(f.tx, 'learner', 'cycle', at(20))
  assert.equal(f.assignmentDue()?.getTime(), at(23).getTime())
})

test('an empty or completed required set enforces no deadline', async () => {
  for (const next of [[], [{ ...course('A', 10), completed: true }]]) {
    const f = fixture([course('A', 10), course('B', 10)], next, 20)
    await reconcileSharedPath(f.tx, 'learner', 'cycle', at(5))
    assert.equal(f.assignmentDue(), null)
  }
})

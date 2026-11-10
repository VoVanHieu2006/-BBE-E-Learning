import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Prisma } from '@prisma/client'
import { reconcileSharedPath, type RevivedAssignment } from '../lib/shared-learning-path'
import { CourseBudget, DAY_MS, budgetFingerprint } from '../lib/learning-cycle-rules'

const at = (day: number) => new Date(Date.UTC(2026, 0, 1) + Math.round(day * DAY_MS))
const course = (courseId: string, days: number, assignedAt?: Date): CourseBudget => ({ courseId, days, completed: false, assignedAt })
const done = (budget: CourseBudget): CourseBudget => ({ ...budget, completed: true })

type ChangeRow = { changed_at: Date; due_at: Date | null; reason: string }

// Exercise the actual persistence coordinator, including its reason selection.
// A pure calculateSharedDeadline test alone did not catch the wrong dispatch.
// `history` mirrors learning_path_changes (oldest first); `setNext` lets a test replay several reconciliations.
function fixture(previous: CourseBudget[], initialNext: CourseBudget[], dueDay: number, history: ChangeRow[] = []) {
  let next = initialNext
  const state = {
    id: 'path', starts_at: at(0), due_at: at(dueDay) as Date | null,
    budget_fingerprint: budgetFingerprint(previous), budget: previous,
  }
  const events: unknown[] = []
  const changes: ChangeRow[] = [...history]
  let assignmentDue: Date | null = null
  const tx = {
    userLearningAssignment: {
      findMany: async () => next.map(row => ({ course_id: row.courseId, assigned_at: row.assignedAt ?? at(0), completed_at: row.completed ? at(1) : null, course: { mandatory_default_due_days: row.days } })),
      updateMany: async ({ data }: { data: { due_at: Date | null } }) => { assignmentDue = data.due_at; return { count: next.length } },
    },
    learningPath: {
      upsert: async () => ({ ...state }),
      update: async ({ data }: { data: Partial<typeof state> }) => Object.assign(state, data),
    },
    learningPathChange: {
      count: async () => 1,
      create: async ({ data }: { data: { changed_at: Date; due_at: Date | null; reason: string } }) => {
        events.push({ data })
        changes.push({ changed_at: data.changed_at, due_at: data.due_at, reason: data.reason })
        return {}
      },
      findFirst: async ({ where }: { where: { reason?: string; changed_at?: { lt: Date } } }) => {
        const rows = changes
          .filter((row) => (where.reason ? row.reason === where.reason : true) && (where.changed_at ? row.changed_at < where.changed_at.lt : true))
          .sort((a, b) => b.changed_at.getTime() - a.changed_at.getTime())
        return rows[0] ?? null
      },
    },
  } as unknown as Prisma.TransactionClient
  return {
    tx, state, events, assignmentDue: () => assignmentDue,
    setNext: (value: CourseBudget[]) => { next = value },
    run: (now: Date, revived: RevivedAssignment[] = []) => reconcileSharedPath(tx, 'learner', 'cycle', now, revived),
  }
}

for (const [changedDay, expected] of [[5, 21], [20, 31]]) {
  test(`role replacement at day ${changedDay} persists the agreed shared deadline day ${expected}`, async () => {
    const f = fixture([course('A', 10), course('B', 10)], [course('A', 10), course('C', 11)], 20)
    await f.run(at(changedDay))
    assert.equal(f.assignmentDue()?.getTime(), at(expected).getTime())
    assert.equal(f.state.due_at?.getTime(), at(expected).getTime())
    await f.run(at(changedDay + 1))
    assert.equal(f.assignmentDue()?.getTime(), at(expected).getTime())
    assert.equal(f.events.length, 1, 'a retry does not extend the deadline or duplicate history')
  })
}

test('first mandatory course added to an existing path gets its full budget from the change instant', async () => {
  const f = fixture([], [course('A', 5)], 100)
  await f.run(at(10))
  assert.equal(f.assignmentDue()?.getTime(), at(15).getTime())
})

test('late role expansion gives the full new-course budget from the change timestamp', async () => {
  const f = fixture([course('A', 10)], [course('A', 10), course('C', 11)], 10)
  await f.run(at(20))
  assert.equal(f.assignmentDue()?.getTime(), at(31).getTime())
})

test('a changed required set does not retain the removed course budget as a third formula term', async () => {
  const f = fixture([course('A', 10), course('B', 40)], [course('A', 10), course('C', 11)], 50)
  await f.run(at(5))
  assert.equal(f.assignmentDue()?.getTime(), at(21).getTime())
})

test('a role that only removes obligations keeps the three-day floor from the change instant (KHBB 5.4)', async () => {
  const f = fixture([course('A', 10), course('B', 40)], [course('A', 10)], 50)
  await f.run(at(20))
  // max(0 + 10, 20 + 3) = day 23: never the removal instant itself.
  assert.equal(f.assignmentDue()?.getTime(), at(23).getTime())
})

test('an unchanged required set keeps a manually extended deadline and writes no change event', async () => {
  const next = [course('A', 10), course('B', 10)]
  const f = fixture(next, next, 40)
  await f.run(at(5))
  assert.equal(f.assignmentDue()?.getTime(), at(40).getTime())
  assert.equal(f.events.length, 0)
})

test('Admin shortening still applies its separate three-day safety floor', async () => {
  const f = fixture([course('A', 30)], [course('A', 10)], 30)
  await f.run(at(20))
  assert.equal(f.assignmentDue()?.getTime(), at(23).getTime())
})

test('Admin shortening a course assigned later keeps that course full new budget', async () => {
  const f = fixture(
    [course('A', 10), course('B', 30)],
    [course('A', 10, at(0)), course('B', 10, at(25))],
    90,
  )
  await f.run(at(30))
  // B was assigned on day 25 and still gets 10 new days; the three-day Admin
  // floor is day 33, so the later assignment deadline wins.
  assert.equal(f.assignmentDue()?.getTime(), at(35).getTime())
})

test('an empty or completed required set enforces no deadline', async () => {
  for (const next of [[], [{ ...course('A', 10), completed: true }]]) {
    const f = fixture([course('A', 10), course('B', 10)], next, 20)
    await f.run(at(5))
    assert.equal(f.assignmentDue(), null)
  }
})

// --- KHBB 5.2 - 5.4: only unfinished courses count ---
test('KHBB 5.3: A10+B5 at day 12 with A done, switching to A+C10 -> day 22', async () => {
  const f = fixture([course('A', 10), course('B', 5)], [done(course('A', 10)), course('C', 10)], 15)
  await f.run(at(12))
  assert.equal(f.assignmentDue()?.getTime(), at(22).getTime())
})

test('KHBB 5.3: the same switch at day 2 with nothing done -> day 20', async () => {
  const f = fixture([course('A', 10), course('B', 5)], [course('A', 10), course('C', 10)], 15)
  await f.run(at(2))
  assert.equal(f.assignmentDue()?.getTime(), at(20).getTime())
})

test('KHBB 5.3: a finished 100-day course does not stretch the deadline when C10 is added at day 5 -> day 15', async () => {
  const f = fixture([done(course('A', 100))], [done(course('A', 100)), course('C', 10)], 100)
  await f.run(at(5))
  assert.equal(f.assignmentDue()?.getTime(), at(15).getTime())
})

test('KHBB 5.4: removing the last unfinished course leaves no deadline', async () => {
  const f = fixture([course('A', 10), course('B', 40)], [done(course('A', 10))], 50)
  await f.run(at(20))
  assert.equal(f.assignmentDue(), null)
})

test('KHBB 5.4: shortening counts only unfinished courses and keeps the C+3 floor', async () => {
  // B (30 -> 10) is finished, so only A counts: max(0 + 10, 20 + 3) = 23.
  const f = fixture([course('A', 10), course('B', 30)], [course('A', 10), done(course('B', 10))], 40)
  await f.run(at(20))
  assert.equal(f.assignmentDue()?.getTime(), at(23).getTime())
})

// --- KHBB 5.5: manual extension is never shortened ---
test('KHBB 5.5: a manual extension to day 30 is never shortened by a recalculation that gives day 25', async () => {
  const manual: ChangeRow = { changed_at: at(1), due_at: at(30), reason: 'ADMIN_MANUAL_EXTENSION' }
  // A10 + B10 -> A10 + C15 at day 3: max(0 + 25, 3 + 15) = 25, protected up to day 30.
  const f = fixture([course('A', 10), course('B', 10)], [course('A', 10), course('C', 15)], 30, [manual])
  await f.run(at(3))
  assert.equal(f.assignmentDue()?.getTime(), at(30).getTime())
  assert.equal(f.state.due_at?.getTime(), at(30).getTime())
})

test('KHBB 5.5: a manual extension that already expired no longer protects the deadline', async () => {
  const manual: ChangeRow = { changed_at: at(1), due_at: at(5), reason: 'ADMIN_MANUAL_EXTENSION' }
  const f = fixture([course('A', 10), course('B', 10)], [course('A', 10), course('C', 15)], 30, [manual])
  await f.run(at(8))
  // max(0 + 25, 8 + 15) = 25
  assert.equal(f.assignmentDue()?.getTime(), at(25).getTime())
})

// --- KHBB 5.7: window of three days against "refreshing" a deadline by removing and re-adding a course ---
const oldHistory = (): ChangeRow[] => [{ changed_at: at(0), due_at: at(20), reason: 'REQUIRED_SET_CHANGED' }]
const AX = [course('A', 10), course('X', 10)]

test('KHBB 5.7: removing X then re-adding it the same day returns to the old day 20, not day 28', async () => {
  const f = fixture(AX, AX, 20, oldHistory())
  f.setNext([course('A', 10)])
  await f.run(at(18))
  assert.equal(f.assignmentDue()?.getTime(), at(21).getTime(), 'removal gets the C+3 floor')
  f.setNext(AX)
  await f.run(at(18.5), [{ courseId: 'X', endedAt: at(18) }])
  assert.equal(f.assignmentDue()?.getTime(), at(20).getTime())
  assert.equal(f.state.due_at?.getTime(), at(20).getTime())
})

test('KHBB 5.7: three remove / re-add rounds never increase the deadline', async () => {
  const f = fixture(AX, AX, 20, oldHistory())
  for (const [removeDay, addDay] of [[18, 18.5], [19, 19.4], [19.6, 19.9]]) {
    f.setNext([course('A', 10)])
    await f.run(at(removeDay))
    f.setNext(AX)
    await f.run(at(addDay), [{ courseId: 'X', endedAt: at(removeDay) }])
    assert.equal(f.assignmentDue()?.getTime(), at(20).getTime(), `after the round ending day ${addDay}`)
  }
})

test('KHBB 5.7: re-adding X after more than three days counts it as a new course (A not done -> day 35)', async () => {
  const f = fixture(AX, AX, 20, oldHistory())
  f.setNext([course('A', 10)])
  await f.run(at(18))
  f.setNext(AX)
  await f.run(at(25), [{ courseId: 'X', endedAt: at(18) }])
  // max(0 + 20, 25 + 10) = 35
  assert.equal(f.assignmentDue()?.getTime(), at(35).getTime())
})

test('KHBB 5.7: re-adding X after more than three days with A done -> day 35', async () => {
  const f = fixture(AX, AX, 20, oldHistory())
  f.setNext([done(course('A', 10))])
  await f.run(at(18))
  assert.equal(f.assignmentDue(), null, 'only finished courses left: no deadline')
  f.setNext([done(course('A', 10)), course('X', 10)])
  await f.run(at(25), [{ courseId: 'X', endedAt: at(18) }])
  assert.equal(f.assignmentDue()?.getTime(), at(35).getTime())
})

test('KHBB 5.7: exactly three days still counts as inside the window', async () => {
  const f = fixture(AX, AX, 20, oldHistory())
  f.setNext([course('A', 10)])
  await f.run(at(18))
  f.setNext(AX)
  await f.run(at(21), [{ courseId: 'X', endedAt: at(18) }])
  assert.equal(f.assignmentDue()?.getTime(), at(20).getTime())
})

test('KHBB 6.3: a course revived by an unpublish / publish cycle is treated like any re-added course', async () => {
  const f = fixture(AX, AX, 20, oldHistory())
  f.setNext([course('A', 10)]) // unpublished at day 10: leaves the set
  await f.run(at(10))
  f.setNext(AX) // published again at day 11, inside the window
  await f.run(at(11), [{ courseId: 'X', endedAt: at(10) }])
  assert.equal(f.assignmentDue()?.getTime(), at(20).getTime())
})

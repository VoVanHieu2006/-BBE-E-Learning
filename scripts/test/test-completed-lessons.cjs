// No database client is constructed: exercise the real gate against deterministic reads.
const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
require('ts-node').register({ project: 'tsconfig.test.json' })
const Module = require('node:module'), resolve = Module._resolveFilename
Module._resolveFilename = function (name, ...args) { return resolve.call(this, name.startsWith('@/') ? path.resolve('src', name.slice(2)) : name, ...args) }
const lessons = ['A', 'B', 'C', 'D'].map(id => ({ id, session_id: 's', session: { course_id: 'course', course: { status: 'PUBLISHED' } }, video: { duration_seconds: 100 }, assessment: null }))
let rows, cycle, passed = [], legacyRows = []
global.prisma = {
  lesson: { findUnique: async ({ where }) => lessons.find(l => l.id === where.id), findFirst: async () => lessons[0], findMany: async () => lessons },
  learningCycle: { findFirst: async () => cycle },
  cycleLessonProgress: { findUnique: async ({ where }) => rows.find(r => r.lesson_id === where.user_id_lesson_id_learning_cycle_id.lesson_id), findMany: async () => rows },
  lessonProgress: { findMany: async () => legacyRows, findUnique: async () => null },
  attempt: { findMany: async () => passed },
}
const { checkLessonProgression } = require('../../src/lib/progression')
test('completed C without unlock remains viewable when B is incomplete', async () => {
  cycle = { id: 'current', provenance: 'NATIVE' }
  rows = [{ lesson_id: 'A', furthest_seconds: 100, completed_at: new Date() }, { lesson_id: 'C', furthest_seconds: 100, completed_at: new Date(), unlocked_at: null }]
  assert.equal((await checkLessonProgression('member', 'C', 'VIEW')).ok, true)
})
const { readLessonLearningStates } = require('../../src/lib/lesson-learning-state')
const reset = () => { cycle = { id: 'current', provenance: 'NATIVE' }; rows = []; passed = []; legacyRows = []; lessons.forEach(l => { l.assessment = null; l.video = { duration_seconds: 100 } }) }
for (const [name, prepare, check] of [
  ['first unopened lesson is available', () => {}, s => assert.equal(s.A.canView, true)],
  ['unopened C remains sequentially locked', () => {}, s => assert.equal(s.C.canView, false)],
  ['unlock survives earlier incomplete content', () => rows.push({ lesson_id: 'C', unlocked_at: new Date() }), s => assert.equal(s.C.canView, true)],
  ['completed C can be watched again', () => rows.push({ lesson_id: 'C', completed_at: new Date(), furthest_seconds: 100 }), s => assert.equal(s.C.videoCompleted, true)],
  ['video complete without passed quiz can be viewed', () => { lessons[2].assessment = { id: 'quizC' }; rows.push({ lesson_id: 'C', furthest_seconds: 100 }) }, s => { assert.equal(s.C.canView, true); assert.equal(s.C.lessonCompleted, false); assert.equal(s.C.canAssess, true) }],
  ['video complete does not unlock following quiz checkpoint', () => { lessons[0].assessment = { id: 'quizA' }; rows.push({ lesson_id: 'A', furthest_seconds: 100 }) }, s => assert.equal(s.B.lockReason, 'LessonAssessmentRequired')],
  ['passed quiz and video unlock next lesson', () => { lessons[0].assessment = { id: 'quizA' }; rows.push({ lesson_id: 'A', furthest_seconds: 100 }); passed.push({ assessment_id: 'quizA' }) }, s => assert.equal(s.B.canView, true)],
  ['unlocked video still cannot be assessed before watching', () => rows.push({ lesson_id: 'C', unlocked_at: new Date() }), s => assert.equal(s.C.canAssess, false)],
  ['new cycle ignores legacy completed projection', () => legacyRows.push({ lesson_id: 'C', completed: true, furthest_watched_position_seconds: 100 }), s => { assert.equal(s.C.canView, false); assert.equal(s.C.lessonCompleted, false) }],
  ['no cycle retains legacy completion', () => { cycle = null; rows = []; legacyRows.push({ lesson_id: 'A', completed: true, furthest_watched_position_seconds: 100 }) }, s => { assert.equal(s.A.lessonCompleted, true); assert.equal(s.B.canView, true); assert.equal(s.A.learningCycleId, null) }],
  ['zero-duration uncompleted video is not complete', () => { lessons[0].video.duration_seconds = 0 }, s => assert.equal(s.A.videoCompleted, false)],
  ['lesson without video can assess when sequential gate is met', () => { lessons[0].video = null }, s => assert.equal(s.A.canAssess, true)],
  ['completed evidence permits review without watched projection', () => rows.push({ lesson_id: 'C', completed_at: new Date() }), s => assert.equal(s.C.canView, true)],
]) test(name, async () => { reset(); prepare(); check(await readLessonLearningStates(global.prisma, 'member', lessons)) })

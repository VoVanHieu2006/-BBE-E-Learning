const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
require('ts-node').register({ project: 'tsconfig.test.json', transpileOnly: true })
const Module = require('node:module'), resolve = Module._resolveFilename
Module._resolveFilename = function (name, ...args) { return resolve.call(this, name.startsWith('@/') ? path.resolve('src', name.slice(2)) : name, ...args) }
const stub = (file, exports) => { const id = require.resolve(file); require.cache[id] = { id, filename: id, loaded: true, exports } }
stub('../../src/lib/chapter-actual-terms', { captureChapterActualTerm: async () => {} })
stub('../../src/lib/learning-periods', { learningContext: async () => {}, lockLearningUser: async () => new Date(), enqueueAssignmentSync: async () => {} })

let lastUpdate = null
let transactionError = null
const db = {
  chapterReorganization: {
    findMany: async () => [{ id: 'batch', chapter_id: 'chapter', effective_at: new Date(), transfer_season_id: 'season', created_by_user_id: 'leader', term_number: 2, items: [] }],
    updateMany: async (args) => { lastUpdate = args; return { count: 1 } },
  },
  $transaction: async () => { throw transactionError },
}
stub('../../src/lib/prisma', { prisma: db })
const { applyDueChapterReorganizations } = require('../../src/lib/chapter-reorganizations')

test('DB unique guard conflict keeps the batch scheduled with an actionable message', async () => {
  transactionError = Object.assign(
    new Error('Unique constraint failed on the fields: (`chapter_id`,`transfer_season_id`)'),
    { code: 'P2002', meta: { target: ['chapter_id', 'transfer_season_id'] } },
  )
  assert.equal(await applyDueChapterReorganizations(new Date()), 0)
  assert.equal(lastUpdate.where.status, 'SCHEDULED')
  assert.match(lastUpdate.data.last_error, /đã có một lần chuyển giao/)
  assert.doesNotMatch(lastUpdate.data.last_error, /Unique constraint/)
  assert.deepEqual(lastUpdate.data.apply_attempts, { increment: 1 })
})

test('other apply errors keep their original message', async () => {
  transactionError = new Error('TransferMemberNoLongerInChapter')
  assert.equal(await applyDueChapterReorganizations(new Date()), 0)
  assert.equal(lastUpdate.data.last_error, 'TransferMemberNoLongerInChapter')
  assert.deepEqual(lastUpdate.data.apply_attempts, { increment: 1 })
})

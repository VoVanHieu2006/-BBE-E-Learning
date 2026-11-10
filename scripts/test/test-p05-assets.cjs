const assert = require('node:assert/strict'), { test } = require('node:test'), crypto = require('node:crypto')
require('ts-node').register({ project: 'tsconfig.test.json' })
let documents = [], covers = [], drafts = [], referenceReadFails = false
global.prisma = {
  document: { findFirst: async ({ where }) => {
    if (referenceReadFails) throw new Error('Private database response')
    return documents.find(doc => doc.storage_key === where.storage_key) || null
  } },
  course: { findMany: async () => covers },
  courseDraft: { findMany: async () => drafts },
}
const Module = require('node:module'), load = Module._load
const keys = []; let storageFails = false
Module._load = function (name, ...args) {
  if (name === '@aws-sdk/client-s3') return {
    S3Client: class { async send(command) { keys.push(command.input.Key); if (storageFails) throw new Error('Private provider response') } },
    DeleteObjectCommand: class { constructor(input) { this.input = input } },
  }
  return load.call(this, name, ...args)
}
const { cleanupDeletedContentAssets } = require('../../src/lib/deleted-content-assets')
test('empty asset list makes no storage calls', async () => {
  await cleanupDeletedContentAssets({ storageKeys: [], coverPublicId: null })
  assert.deepEqual(keys, [])
})
test('R2 cleanup deletes collected keys only once', async () => {
  keys.length = 0
  await cleanupDeletedContentAssets({ storageKeys: ['lesson/a.pdf', 'lesson/a.pdf', 'lesson/b.pdf'], coverPublicId: null })
  assert.deepEqual(keys, ['lesson/a.pdf', 'lesson/b.pdf'])
})
test('R2 failure logs safely, continues other objects, and does not reject', async () => {
  keys.length = 0; storageFails = true
  const log = console.error, messages = []
  console.error = message => messages.push(message)
  try {
    await cleanupDeletedContentAssets({ storageKeys: ['a', 'b'], coverPublicId: null })
    assert.deepEqual(keys, ['a', 'b']); assert.equal(messages.length, 2)
    assert.ok(messages.every(message => !message.includes('Private provider response')))
  } finally { console.error = log; storageFails = false }
})
test('Cloudinary deletes by stored public ID using a signed server request', async () => {
  const vars = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']
  const original = vars.map(key => process.env[key]), fetch = global.fetch
  vars.forEach((key, i) => { process.env[key] = ['unit-cloud', 'unit-key', 'unit-secret'][i] })
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.cloudinary.com/v1_1/unit-cloud/image/destroy')
    assert.equal(options.method, 'POST')
    assert.equal(options.body.get('public_id'), 'course-covers/course')
    const expected = crypto.createHash('sha1').update(`public_id=course-covers/course&timestamp=${options.body.get('timestamp')}unit-secret`).digest('hex')
    assert.equal(options.body.get('signature'), expected)
    return { ok: true, json: async () => ({ result: 'not found' }) }
  }
  try { await cleanupDeletedContentAssets({ storageKeys: [], coverPublicId: 'course-covers/course' }) }
  finally { global.fetch = fetch; vars.forEach((key, i) => { if (original[i] === undefined) delete process.env[key]; else process.env[key] = original[i] }) }
})

for (const lesson of ['another-lesson-in-same-course', 'lesson-in-other-course']) test(`R2 preserves a file still used by ${lesson}`, async () => {
  keys.length = 0
  documents = [{ lesson_id: lesson, storage_key: 'shared.pdf' }]
  try {
    await cleanupDeletedContentAssets({ storageKeys: ['shared.pdf', 'unused.pdf'], coverPublicId: null })
    assert.deepEqual(keys, ['unused.pdf'])
    documents = []
    await cleanupDeletedContentAssets({ storageKeys: ['shared.pdf'], coverPublicId: null })
    assert.deepEqual(keys, ['unused.pdf', 'shared.pdf'])
  } finally { documents = [] }
})

for (const field of ['storageKey', 'storage_key']) test(`R2 preserves a file referenced only in a nested draft ${field}`, async () => {
  keys.length = 0
  drafts = [{ content: { sessions: [{ lessons: [{ documents: [{ [field]: 'draft.pdf' }] }] }] } }]
  try {
    await cleanupDeletedContentAssets({ storageKeys: ['draft.pdf', 'unrelated.pdf'], coverPublicId: null })
    assert.deepEqual(keys, ['unrelated.pdf'])
  } finally { drafts = [] }
})

for (const reference of [
  { cover_public_id: 'course-covers/shared' },
  { cover_public_id: null, cover_url: 'https://res.cloudinary.com/unit/image/upload/v123/course-covers/shared.jpg' },
  { cover_public_id: null, cover_url: 'https://res.cloudinary.com/unit/image/upload/course-covers%2Fshared.webp' },
]) test(`Cloudinary preserves a cover used by another course: ${JSON.stringify(reference)}`, async () => {
  covers = [reference]
  const originalFetch = global.fetch; let calls = 0
  global.fetch = async () => { calls++; return { ok: true, json: async () => ({ result: 'ok' }) } }
  const vars = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'], original = vars.map(key => process.env[key])
  vars.forEach(key => { process.env[key] = 'unit' })
  try {
    await cleanupDeletedContentAssets({ storageKeys: [], coverPublicId: 'course-covers/shared' })
    assert.equal(calls, 0)
    covers = []
    await cleanupDeletedContentAssets({ storageKeys: [], coverPublicId: 'course-covers/shared' })
    assert.equal(calls, 1)
  } finally {
    covers = []; global.fetch = originalFetch
    vars.forEach((key, i) => { if (original[i] === undefined) delete process.env[key]; else process.env[key] = original[i] })
  }
})

for (const content of [
  { coverPublicId: 'course-covers/shared' },
  { course: { cover_public_id: 'course-covers/shared' } },
  { coverUrl: 'https://res.cloudinary.com/unit/image/upload/v123/course-covers/shared.jpg' },
]) test(`Cloudinary preserves a cover referenced only by a draft: ${JSON.stringify(content)}`, async () => {
  drafts = [{ content }]
  const originalFetch = global.fetch; let calls = 0
  global.fetch = async () => { calls++; return { ok: true, json: async () => ({ result: 'ok' }) } }
  const vars = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'], original = vars.map(key => process.env[key])
  vars.forEach(key => { process.env[key] = 'unit' })
  try {
    await cleanupDeletedContentAssets({ storageKeys: [], coverPublicId: 'course-covers/shared' })
    assert.equal(calls, 0)
  } finally {
    drafts = []; global.fetch = originalFetch
    vars.forEach((key, i) => { if (original[i] === undefined) delete process.env[key]; else process.env[key] = original[i] })
  }
})

test('a reference lookup failure keeps the object and logs no private error', async () => {
  keys.length = 0; referenceReadFails = true
  const log = console.error, messages = []
  console.error = message => messages.push(message)
  try {
    await cleanupDeletedContentAssets({ storageKeys: ['keep.pdf'], coverPublicId: null })
    assert.deepEqual(keys, [])
    assert.equal(messages.length, 1)
    assert.ok(messages.every(message => !message.includes('Private database response')))
  } finally { console.error = log; referenceReadFails = false }
})

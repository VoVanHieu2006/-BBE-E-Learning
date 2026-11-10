const assert = require('node:assert/strict'), { test } = require('node:test'), crypto = require('node:crypto')
require('ts-node').register({ project: 'tsconfig.test.json' })
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

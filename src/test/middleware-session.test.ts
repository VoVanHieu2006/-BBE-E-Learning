import { it } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
process.env.JWT_ACCESS_SECRET = 'unit-test-only'
const filename = require.resolve('jose')
require.cache[filename] = { id: filename, filename, loaded: true, exports: { jwtVerify: async () => ({ payload: { sub: 'lead', role: 'LEAD', managerKind: 'LEAD_DNA', authVersion: 1 } }) } } as NodeJS.Module
const { middleware } = require('../middleware')
it('lets a rejected, unexpired LEAD session reach login and clears all session cookies', async () => {
  const original = global.fetch
  global.fetch = async () => new Response('{}', { status: 401 })
  try {
    const response = await middleware(new NextRequest('http://localhost/login', { headers: { cookie: 'accessToken=stale; refreshToken=revoked; userRole=LEAD' } }))
    assert.equal(response.status, 200)
    for (const cookie of ['accessToken', 'refreshToken', 'userRole']) assert.equal(response.cookies.get(cookie)?.value, '')
    assert.equal(response.headers.get('location'), null)
  } finally { global.fetch = original }
})
it('keeps the normal redirect for a server-validated DNA LEAD', async () => {
  const original = global.fetch
  global.fetch = async () => new Response('{}', { status: 200 })
  try {
    const response = await middleware(new NextRequest('http://localhost/login', { headers: { cookie: 'accessToken=valid' } }))
    assert.equal(response.headers.get('location'), 'http://localhost/organization-manager')
  } finally { global.fetch = original }
})

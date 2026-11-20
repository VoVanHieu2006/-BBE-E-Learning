import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isAllowedCoverUrl } from '../lib/validation/cover-url'

describe('isAllowedCoverUrl', () => {
  it('accepts HTTPS URLs and bundled /images/ paths', () => {
    assert.equal(isAllowedCoverUrl('https://res.cloudinary.com/demo/image/upload/v1/cover.png'), true)
    assert.equal(isAllowedCoverUrl('/images/course-covers/organization-culture.png'), true)
  })
  it('rejects scripts, other schemes, protocol-relative and traversal paths', () => {
    for (const value of [
      'javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://example.com/x.png', '//evil.com/x.png',
      '/images/../secret.png', '/images//evil.com/x.png', '/images\\..\\x.png', '/images/a\nb.png',
      '/images/a b.png', '/static/x.png', 'images/x.png', '/images/javascript:x', '',
      '   ', `https://${'a'.repeat(1000)}`,
    ]) assert.equal(isAllowedCoverUrl(value), false, value)
  })
  it('rejects non-string values', () => {
    for (const value of [null, undefined, 1, {}, ['https://x']]) assert.equal(isAllowedCoverUrl(value), false)
  })
})

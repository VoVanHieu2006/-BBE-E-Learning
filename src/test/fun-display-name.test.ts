import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  FUN_NAME_COMBINATIONS,
  funDisplayName,
  publicDisplayName,
  publicRankingRow,
  RETIRED_ACCOUNT_NAME,
} from '../lib/fun-display-name'

describe('funDisplayName', () => {
  it('is stable for the same user id', () => {
    assert.equal(funDisplayName('user-1'), funDisplayName('user-1'))
  })

  it('offers more than 1000 combinations', () => {
    assert.ok(FUN_NAME_COMBINATIONS > 1000)
  })

  it('spreads ids over many different names', () => {
    const names = new Set<string>()
    for (let i = 0; i < 5000; i++) names.add(funDisplayName(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`))
    assert.ok(names.size > 500, `only ${names.size} distinct names`)
  })

  it('is never empty and never looks like an email', () => {
    for (const id of ['', 'a', 'user@example.com', '123']) {
      const name = funDisplayName(id)
      assert.ok(name.trim().length > 3)
      assert.ok(!name.includes('@'))
    }
  })
})

describe('publicDisplayName', () => {
  it('prefers the chosen display name', () => {
    assert.equal(publicDisplayName('u1', { display_name: '  Lan  ' }), 'Lan')
  })

  it('falls back to the playful name, never the email prefix', () => {
    const name = publicDisplayName('u1', { display_name: null })
    assert.equal(name, funDisplayName('u1'))
  })

  it('hides retired accounts', () => {
    assert.equal(publicDisplayName('u1', { display_name: 'Lan', anonymized_at: new Date() }), RETIRED_ACCOUNT_NAME)
  })
})

describe('publicRankingRow', () => {
  it('drops the email and always sets a complete displayName', () => {
    const row = publicRankingRow({ userId: 'u1', email: 'lan@example.com', displayName: 'lan', stars: 5 }, { display_name: null })
    assert.ok(!('email' in row))
    assert.equal(row.displayName, funDisplayName('u1'))
    assert.equal(row.stars, 5)
  })
})

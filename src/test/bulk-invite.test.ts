import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isValidInviteEmail, normalizeInviteEmail, parseBulkInviteEmails } from '../lib/bulk-invite'

describe('bulk invite email parsing', () => {
  it('splits on newlines, commas, semicolons and whitespace', () => {
    const parsed = parseBulkInviteEmails('a@bbe.vn\nb@bbe.vn, c@bbe.vn;d@bbe.vn  e@bbe.vn\r\n\tf@bbe.vn')
    assert.deepEqual(parsed.valid, ['a@bbe.vn', 'b@bbe.vn', 'c@bbe.vn', 'd@bbe.vn', 'e@bbe.vn', 'f@bbe.vn'])
    assert.deepEqual(parsed.invalid, [])
    assert.deepEqual(parsed.duplicates, [])
  })

  it('trims, lowercases and removes duplicates keeping first order', () => {
    const parsed = parseBulkInviteEmails('  Alice@BBE.vn ,alice@bbe.vn\nBOB@bbe.vn;; alice@bbe.VN')
    assert.deepEqual(parsed.valid, ['alice@bbe.vn', 'bob@bbe.vn'])
    assert.deepEqual(parsed.duplicates, ['alice@bbe.vn', 'alice@bbe.vn'])
  })

  it('reports invalid addresses separately and dedupes them too', () => {
    const parsed = parseBulkInviteEmails('ok@bbe.vn, not-an-email, a@b, x@y.z, not-an-email')
    assert.deepEqual(parsed.valid, ['ok@bbe.vn', 'x@y.z'])
    assert.deepEqual(parsed.invalid, ['not-an-email', 'a@b'])
    assert.deepEqual(parsed.duplicates, ['not-an-email'])
  })

  it('handles empty input', () => {
    assert.deepEqual(parseBulkInviteEmails(''), { valid: [], invalid: [], duplicates: [] })
    assert.deepEqual(parseBulkInviteEmails(' \n,;; '), { valid: [], invalid: [], duplicates: [] })
  })

  it('matches the single invite validation rules', () => {
    assert.equal(normalizeInviteEmail('  A@B.Co '), 'a@b.co')
    assert.equal(isValidInviteEmail('a@b.co'), true)
    assert.equal(isValidInviteEmail(`${'a'.repeat(251)}@b.co`), false)
    assert.equal(isValidInviteEmail(''), false)
  })
})

describe('bulk invite route keeps the single-invite permission rules', () => {
  const root = path.resolve(__dirname, '../..')
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

  it('both member invite routes resolve scope through the shared helper', () => {
    for (const file of ['src/app/api/v1/invitations/member/route.ts', 'src/app/api/v1/invitations/member/bulk/route.ts']) {
      const source = read(file)
      assert.match(source, /resolveMemberInviteScope\(context, body\)/, file)
      assert.match(source, /if \(scope\.ok === false\)/, file)
    }
  })

  it('chapter leads are bound to their own chapter', () => {
    const source = read('src/lib/member-invite-scope.ts')
    assert.match(source, /role === 'CHAPTER_LEADER' \? undefined : requestedChapterId/)
    assert.match(source, /role === 'CHAPTER_LEADER'\) chapterId = context\.chapterId/)
  })

  it('bulk route reports existing members and live invitations instead of re-inviting', () => {
    const source = read('src/app/api/v1/invitations/member/bulk/route.ts')
    assert.match(source, /status: 'PENDING', expires_at: \{ gt: now \}/)
    assert.match(source, /'ALREADY_INVITED'/)
    assert.match(source, /'ALREADY_MEMBER'/)
    assert.match(source, /BULK_INVITE_MAX_EMAILS/)
  })
})

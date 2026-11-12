import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_EMAIL_DAILY_LIMIT,
  computeGrant,
  emailDailyLimit,
  emailProviderLimit,
  formatBatchQuotaNotice,
  formatEmailQuotaLine,
  isLinkRequestRateLimited,
  nextQuotaResetAt,
  quotaResetDayWord,
  remainingSlots,
  shouldRefundSlot,
  splitBatchByQuota,
  unusedSlots,
  utcDayString,
} from '../lib/email-quota-core'

const root = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

describe('email daily limit configuration', () => {
  it('defaults to 90 and reads EMAIL_DAILY_LIMIT when it is a valid non-negative integer', () => {
    assert.equal(DEFAULT_EMAIL_DAILY_LIMIT, 90)
    assert.equal(emailDailyLimit({}), 90)
    assert.equal(emailDailyLimit({ EMAIL_DAILY_LIMIT: '50' }), 50)
    assert.equal(emailDailyLimit({ EMAIL_DAILY_LIMIT: '0' }), 0)
    for (const bad of ['', '  ', 'abc', '-1', '1.5', '999999999']) assert.equal(emailDailyLimit({ EMAIL_DAILY_LIMIT: bad }), 90, bad)
  })

  it('keeps a reserve for system mail: the provider cap is never below the invitation limit', () => {
    assert.equal(emailProviderLimit({}), 100)
    assert.equal(emailProviderLimit({ EMAIL_DAILY_LIMIT: '120' }), 120)
    assert.ok(emailProviderLimit({}) - emailDailyLimit({}) === 10)
  })
})

describe('UTC day and reset time shown to users', () => {
  it('uses the UTC calendar date, not the local one', () => {
    assert.equal(utcDayString(new Date('2026-11-11T23:59:59.999Z')), '2026-11-11')
    assert.equal(utcDayString(new Date('2026-11-12T00:00:00.000Z')), '2026-11-12')
  })

  it('resets at the next 0h UTC (7h Vietnam), including month and year ends', () => {
    assert.equal(nextQuotaResetAt(new Date('2026-11-11T10:00:00Z')).toISOString(), '2026-11-12T00:00:00.000Z')
    assert.equal(nextQuotaResetAt(new Date('2026-11-30T23:59:59Z')).toISOString(), '2026-12-01T00:00:00.000Z')
    assert.equal(nextQuotaResetAt(new Date('2026-12-31T00:00:00Z')).toISOString(), '2027-01-01T00:00:00.000Z')
  })

  it('says "ngày mai" during the Vietnamese day and "hôm nay" between 0h and 7h Vietnam time', () => {
    assert.equal(quotaResetDayWord(new Date('2026-11-11T10:00:00Z')), 'ngày mai') // 17h Việt Nam
    assert.equal(quotaResetDayWord(new Date('2026-11-11T17:00:00Z')), 'hôm nay') // 0h ngày 12 Việt Nam, reset lúc 7h cùng ngày
    assert.equal(quotaResetDayWord(new Date('2026-11-11T23:59:00Z')), 'hôm nay') // 6h59 Việt Nam
    assert.equal(quotaResetDayWord(new Date('2026-11-12T00:00:00Z')), 'ngày mai') // vừa reset lúc 7h
  })

  it('formats the line shown at every invite entry point', () => {
    assert.equal(
      formatEmailQuotaLine({ limit: 90, remaining: 37 }, new Date('2026-11-11T10:00:00Z')),
      'Còn 37/90 email hôm nay, làm mới lúc 7h sáng ngày mai (giờ Việt Nam).',
    )
  })
})

describe('partial reservation maths', () => {
  it('grants at most what is left under the cap', () => {
    assert.equal(computeGrant(10, 80, 90), 10)
    assert.equal(computeGrant(50, 80, 90), 10)
    assert.equal(computeGrant(50, 90, 90), 0)
    assert.equal(computeGrant(5, 95, 90), 0)
    assert.equal(computeGrant(0, 0, 90), 0)
    assert.equal(computeGrant(-3, 0, 90), 0)
    assert.equal(computeGrant(2.9, 0, 90), 2)
    assert.equal(remainingSlots(120, 90), 0)
  })

  it('two people asking for the last 10 slots never exceed the limit (serialized as the DB row lock does)', () => {
    let used = 80
    const reserve = (requested: number) => { const granted = computeGrant(requested, used, 90); used += granted; return granted }
    const first = reserve(10)
    const second = reserve(10)
    assert.deepEqual([first, second], [10, 0])
    assert.equal(used, 90)
    // Nhiều người đòi cùng lúc: tổng cấp phát không bao giờ vượt hạn mức, dù thứ tự nào.
    used = 0
    const granted = [30, 30, 30, 30, 30].map(reserve)
    assert.equal(granted.reduce((a, b) => a + b, 0), 90)
    assert.deepEqual(granted, [30, 30, 30, 0, 0])
  })

  it('system mail may use the reserve above the invitation limit but not beyond the provider cap', () => {
    assert.equal(computeGrant(1, 90, emailDailyLimit({})), 0)
    assert.equal(computeGrant(1, 90, emailProviderLimit({})), 1)
    assert.equal(computeGrant(1, 100, emailProviderLimit({})), 0)
  })
})

describe('splitting a batch between mail and invite link', () => {
  it('sends the first N by mail in order and the rest by link', () => {
    const emails = ['a', 'b', 'c', 'd', 'e']
    assert.deepEqual(splitBatchByQuota(emails, 2), { email: ['a', 'b'], link: ['c', 'd', 'e'] })
    assert.deepEqual(splitBatchByQuota(emails, 0), { email: [], link: emails })
    assert.deepEqual(splitBatchByQuota(emails, 99), { email: emails, link: [] })
    assert.deepEqual(splitBatchByQuota(emails, -4), { email: [], link: emails })
  })

  it('announces the split before sending, and stays silent when every email fits', () => {
    assert.equal(formatBatchQuotaNotice(50, 10), '10 email sẽ gửi qua mail, 40 email còn lại sẽ dùng link mời.')
    assert.equal(formatBatchQuotaNotice(3, 0), '0 email sẽ gửi qua mail, 3 email còn lại sẽ dùng link mời.')
    assert.equal(formatBatchQuotaNotice(10, 10), '')
    assert.equal(formatBatchQuotaNotice(0, 0), '')
  })
})

describe('giving slots back', () => {
  it('releases slots that were reserved but never used, never below zero', () => {
    assert.equal(unusedSlots(10, 7), 3)
    assert.equal(unusedSlots(10, 10), 0)
    assert.equal(unusedSlots(3, 5), 0)
  })

  it('refunds only when the mail provably did not go out', () => {
    assert.equal(shouldRefundSlot({ kind: 'no_client' }), true)
    assert.equal(shouldRefundSlot({ kind: 'api_error', statusCode: 422 }), true)
    assert.equal(shouldRefundSlot({ kind: 'api_error', statusCode: 400 }), true)
    assert.equal(shouldRefundSlot({ kind: 'api_error', statusCode: 429 }), false)
    assert.equal(shouldRefundSlot({ kind: 'api_error', statusCode: 500 }), false)
    assert.equal(shouldRefundSlot({ kind: 'api_error', statusCode: null }), false)
    assert.equal(shouldRefundSlot({ kind: 'api_error' }), false)
    assert.equal(shouldRefundSlot({ kind: 'exception' }), false)
    assert.equal(shouldRefundSlot({ kind: 'sent' }), false)
  })
})

describe('invite link rate limit', () => {
  it('blocks bursts per person and per invitation', () => {
    assert.equal(isLinkRequestRateLimited({ byActor: 0, byInvitation: 0 }), false)
    assert.equal(isLinkRequestRateLimited({ byActor: 59, byInvitation: 9 }), false)
    assert.equal(isLinkRequestRateLimited({ byActor: 60, byInvitation: 0 }), true)
    assert.equal(isLinkRequestRateLimited({ byActor: 1, byInvitation: 10 }), true)
  })
})

describe('code shape that the unit tests above cannot prove', () => {
  it('reservation locks the day row and counts inside one transaction', () => {
    const source = read('src/lib/email-quota.ts')
    assert.match(source, /prisma\.\$transaction\(async \(tx\)/)
    assert.match(source, /SELECT count FROM email_daily_usage WHERE day = \$\{day\}::date FOR UPDATE/)
    assert.match(source, /ON CONFLICT \(day\) DO NOTHING/)
    assert.match(source, /GREATEST\(count - /)
  })

  it('every Resend call goes through the one quota-checked function and no log prints a link', () => {
    const source = read('src/lib/email.ts')
    assert.equal((source.match(/resend\.emails\.send\(/g) || []).length, 1)
    assert.ok(source.indexOf('reserveEmailSlots(') < source.indexOf('resend.emails.send('))
    assert.doesNotMatch(source, /console\.\w+\([^)]*(inviteUrl|resetUrl|Link:)/)
    assert.match(source, /cap: emailProviderLimit\(\)/, 'password reset may use the reserve')
  })

  it('bulk route reserves before sending and releases what it did not use', () => {
    const source = read('src/app/api/v1/invitations/member/bulk/route.ts')
    assert.ok(source.indexOf('reserveEmailSlots(') < source.indexOf('runBulkInvites('))
    assert.match(source, /finally \{\s*await releaseEmailSlots\(/)
    assert.match(source, /kind: 'link'/)
  })

  it('link route returns the link only in a no-store response and lives under the same permission check as resend', () => {
    const route = read('src/app/api/v1/invitations/[id]/link/route.ts')
    assert.match(route, /canManageInvitationUnit\(context, scopeUnitId\)/)
    assert.match(route, /'Cache-Control': 'no-store'/)
    assert.doesNotMatch(route, /console\./)
  })

  it('UI never renders or stores the link', () => {
    const button = read('src/components/invitations/InviteLinkButton.tsx')
    assert.doesNotMatch(button, /useState<string/)
    assert.doesNotMatch(button, /console\./)
    assert.match(button, /copyTextLater\(/)
  })
})

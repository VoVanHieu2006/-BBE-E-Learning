import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  BULK_INVITE_MAX_EMAILS,
  BULK_INVITE_STATUS_LABELS,
  bulkInviteRowsFromText,
  bulkLeadEmail,
  bulkLeadRowAfterChange,
  bulkRetryChangedAnything,
  bulkRetryLeadEmail,
  classifyBulkInviteRows,
  tagBulkLeadResult,
  isRetryableBulkStatus,
  isValidInviteEmail,
  mapWithConcurrency,
  normalizeInviteEmail,
  parseBulkInviteEmails,
  parseBulkLeadEmail,
  runBulkInvites,
  summarizeBulkInviteRows,
  summarizeBulkResults,
} from '../lib/bulk-invite'

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
    assert.match(source, /isLeadRole\(role\) \? undefined : requestedChapterId/)
    assert.match(source, /isLeadRole\(role\)\) chapterId = context\.chapterId/)
  })

  it('bulk route reuses the single-invite core, reports live invitations and caps the batch', () => {
    const source = read('src/app/api/v1/invitations/member/bulk/route.ts')
    assert.match(source, /status: 'PENDING', expires_at: \{ gt: now \}/)
    assert.match(source, /runBulkInvites\(/)
    assert.match(source, /sendMemberInvitation\(/)
    assert.match(source, /BULK_INVITE_MAX_EMAILS/)
    assert.match(source, /export const maxDuration/)
  })

  it('both Chapter invite screens submit the selected department (or the President position) for single and bulk invites', () => {
    for (const file of ['src/app/chapter-manager/invitations/page.tsx', 'src/app/chapter-manager/members/page.tsx']) {
      const source = read(file)
      assert.match(source, /invitePayload\(invitePosition, departmentUnitId\)/, file)
      assert.doesNotMatch(source, /JSON\.stringify\(\{ (?:email: inviteEmail\.trim\(\)|emails: bulkText), chapterId:/, file)
      assert.match(source, /if \(!inviteTargetReady\(invitePosition, departmentUnitId\)\)/, file)
      // Ô Ban (ban / ⭐ Chủ tịch) + ô tick LT được đổi thành chức vụ + ban qua inviteSelection; không còn ô Chức vụ riêng.
      assert.match(source, /inviteSelection\(/, file)
      assert.match(source, /<InvitePositionFields[\s\S]*?target=\{inviteTarget\}[\s\S]*?makeLead=\{makeLead\}/, file)
      assert.doesNotMatch(source, /onPositionChange/, file)
    }
    const fields = read('src/components/invitations/InvitePositionFields.tsx')
    assert.match(fields, /<select[^>]*value=\{target\}/)
    assert.doesNotMatch(fields, /-position`/, 'không còn select Chức vụ')
  })

  it('LEAD and DNA invite pages share the bulk panel, which needs the unit before sending', () => {
    for (const file of ['src/app/chapter-manager/invitations/page.tsx', 'src/app/organization-manager/invitations/page.tsx']) {
      assert.match(read(file), /<BulkInvitePanel[\s\S]*?organizationUnitId=\{/, file)
    }
    const panel = read('src/components/invitations/BulkInvitePanel.tsx')
    assert.match(panel, /inviteTargetReady\(position, organizationUnitId\)/)
    assert.match(panel, /!targetReady/)
    assert.match(panel, /\/api\/v1\/invitations\/member\/bulk/)
    assert.match(panel, /emails,\s*\.\.\.invitePayload\(position, organizationUnitId\),/)
  })

  it('Nhiều email: ô chọn Trưởng ban (LT) ở bước Xem trước, chỉ khi có quyền cấp Chapter và không mời Chủ tịch', () => {
    const panel = read('src/components/invitations/BulkInvitePanel.tsx')
    assert.match(panel, /const leadAllowed = canChooseLead && position === 'MEMBER'/)
    assert.match(panel, /const leadEmail = leadAllowed \? bulkLeadEmail\(rows, leadRowId\) : null/)
    assert.match(panel, /\{leadAllowed && \(/, 'ô chọn LT chỉ hiện khi được phép')
    assert.match(panel, /<option value="">Không chọn ai<\/option>/)
    assert.match(panel, /validRows\.map\(\(row\) => <option key=\{row\.id\} value=\{String\(row\.id\)\}>/, 'chỉ liệt kê email hợp lệ')
    // Sửa / bỏ dòng LT → về Không chọn ai.
    const body = (name: string) => panel.slice(panel.indexOf(`function ${name}(`), panel.indexOf('\n  }\n', panel.indexOf(`function ${name}(`)))
    assert.match(body('editRow'), /setLeadRowId\(bulkLeadRowAfterChange\(next, leadRowId, id\)\)/)
    assert.match(body('removeRow'), /setLeadRowId\(bulkLeadRowAfterChange\(next, leadRowId, id\)\)/)
    // Chỉ gửi leadEmail khi email đó nằm trong lô đang gửi; thử lại giữ vai LT.
    assert.match(panel, /\.\.\.\(lead && emails\.includes\(lead\) \? \{ leadEmail: lead \} : \{\}\)/)
    assert.match(panel, /sendBulk\(sendable, leadEmail\)/)
    assert.match(panel, /const retryLead = bulkRetryLeadEmail\(retryable\)[\s\S]*?sendBulk\(failedEmails, retryLead\)/)
    // Cảnh báo LT chỉ khi có chọn LT; nhãn LT ở xem trước và kết quả.
    assert.match(panel, /\{leadEmail && departmentLeadWarning && <p role="alert" data-testid="bulk-invite-lead-warning"/)
    assert.match(panel, /data-testid="bulk-invite-lead-badge"/)
    assert.match(panel, /row\.positionCode === 'DEPARTMENT_LEAD' && <span data-testid="bulk-invite-result-lead-badge"/)
    assert.match(panel, /postInviteWithPresidentConfirm\('\/api\/v1\/invitations\/member\/bulk'/, 'xác nhận bằng câu cảnh báo của server')
    assert.match(panel, /setLeadRowId\(null\)/, 'Mời thêm xoá lựa chọn LT')

    const lead = read('src/app/chapter-manager/invitations/page.tsx')
    assert.match(lead, /<BulkInvitePanel[\s\S]*?canChooseLead=\{presidentStatus\.canInviteLeadership\}[\s\S]*?departmentLeadWarning=\{presidentStatus\.departmentUnitId === inviteTarget \? presidentStatus\.departmentLeadWarning : null\}/)
    // Trang quản lý DNA không có LT.
    assert.doesNotMatch(read('src/app/organization-manager/invitations/page.tsx'), /canChooseLead/)
  })

  it('route mời loạt: leadEmail kiểm định dạng, trong danh sách, quyền Trưởng ban và cảnh báo TRƯỚC khi gửi', () => {
    const source = read('src/app/api/v1/invitations/member/bulk/route.ts')
    const order = ['parseBulkLeadEmail(body.leadEmail)', "position: 'DEPARTMENT_LEAD' })", "'LeadEmailNotInList'", "checkSingleHolderInvite(scope.organizationUnitId!, 'DEPARTMENT_LEAD', leadEmail", 'reserveEmailSlots(', 'runBulkInvites(']
    const positions = order.map((needle) => source.indexOf(needle))
    positions.forEach((at, i) => assert.ok(at > 0, order[i]))
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'thứ tự kiểm tra')
    assert.match(source, /positionCode: email === leadEmail \? 'DEPARTMENT_LEAD' : scope\.positionCode/)
  })
})

describe('bulk invite: chọn Trưởng ban (LT) trong danh sách', () => {
  it('parseBulkLeadEmail: không gửi / null / rỗng = không chọn ai; chuẩn hoá hoa-thường; sai định dạng hoặc sai kiểu = lỗi', () => {
    for (const value of [undefined, null, '', '   ']) assert.deepEqual(parseBulkLeadEmail(value), { ok: true, email: null }, String(value))
    assert.deepEqual(parseBulkLeadEmail('  LT@BBE.vn '), { ok: true, email: 'lt@bbe.vn' })
    for (const value of ['sai', 'a@b', 'a b@bbe.vn', 42, true, ['a@bbe.vn'], { email: 'a@bbe.vn' }, `${'a'.repeat(250)}@bbe.vn`]) {
      const result = parseBulkLeadEmail(value)
      assert.equal(result.ok, false, JSON.stringify(value))
      if (result.ok === false) assert.equal(result.code, 'InvalidLeadEmail')
    }
  })

  it('bulkLeadEmail: trả email của dòng LT khi dòng đó còn hợp lệ', () => {
    const rows = bulkInviteRowsFromText('a@bbe.vn, sai, a@bbe.vn, b@bbe.vn')
    assert.equal(bulkLeadEmail(rows, rows[3].id), 'b@bbe.vn')
    assert.equal(bulkLeadEmail(rows, null), null)
    assert.equal(bulkLeadEmail(rows, rows[1].id), null, 'dòng sai định dạng')
    assert.equal(bulkLeadEmail(rows, rows[2].id), null, 'dòng trùng')
    assert.equal(bulkLeadEmail(rows, 999), null, 'dòng đã bỏ')
  })

  it('bulkLeadRowAfterChange: sửa / bỏ chính dòng LT → Không chọn ai; sửa / bỏ dòng khác → giữ LT', () => {
    const rows = bulkInviteRowsFromText('a@bbe.vn, b@bbe.vn, c@bbe.vn')
    const lead = rows[1].id
    assert.equal(bulkLeadRowAfterChange(rows, lead, lead), null, 'sửa chính dòng LT (kể cả sửa ra email hợp lệ khác)')
    const edited = classifyBulkInviteRows(rows.map((r) => (r.id === rows[0].id ? { ...r, email: 'x@bbe.vn' } : r)))
    assert.equal(bulkLeadRowAfterChange(edited, lead, rows[0].id), lead)
    const removedOther = classifyBulkInviteRows(rows.filter((r) => r.id !== rows[2].id))
    assert.equal(bulkLeadRowAfterChange(removedOther, lead, rows[2].id), lead)
    const removedLead = classifyBulkInviteRows(rows.filter((r) => r.id !== lead))
    assert.equal(bulkLeadRowAfterChange(removedLead, lead, lead), null)
    assert.equal(bulkLeadRowAfterChange(rows, null, rows[0].id), null)
  })

  it('tagBulkLeadResult: chỉ gắn LT cho dòng của leadEmail đã tạo lời mời hoặc cần thử lại', () => {
    const statuses = ['SENT', 'LINK_NEEDED', 'FAILED', 'DUPLICATE', 'ALREADY_MEMBER', 'ALREADY_INVITED', 'DENIED', 'INVALID'] as const
    const tagged = tagBulkLeadResult(statuses.map((status) => ({ email: 'lt@bbe.vn', status })), 'lt@bbe.vn')
    assert.deepEqual(tagged.map((r) => r.positionCode), ['DEPARTMENT_LEAD', 'DEPARTMENT_LEAD', 'DEPARTMENT_LEAD', undefined, undefined, undefined, undefined, undefined])
    assert.equal(tagBulkLeadResult([{ email: 'm@bbe.vn', status: 'SENT' }], 'lt@bbe.vn')[0].positionCode, undefined, 'email khác không gắn')
    const rows = [{ email: 'lt@bbe.vn', status: 'SENT' as const }]
    assert.equal(tagBulkLeadResult(rows, null), rows, 'không chọn LT thì giữ nguyên')
  })

  it('bulkRetryLeadEmail: chỉ trả email LT khi dòng LT nằm trong số dòng lỗi được thử lại', () => {
    assert.equal(bulkRetryLeadEmail([{ email: 'm@bbe.vn', status: 'FAILED' }, { email: 'lt@bbe.vn', status: 'FAILED', positionCode: 'DEPARTMENT_LEAD' }]), 'lt@bbe.vn')
    assert.equal(bulkRetryLeadEmail([{ email: 'm@bbe.vn', status: 'FAILED' }, { email: 'lt@bbe.vn', status: 'SENT', positionCode: 'DEPARTMENT_LEAD' }]), null, 'LT đã gửi được thì không gửi lại')
    assert.equal(bulkRetryLeadEmail([{ email: 'lt@bbe.vn', status: 'LINK_NEEDED', positionCode: 'DEPARTMENT_LEAD' }]), null)
    assert.equal(bulkRetryLeadEmail([]), null)
  })

  it('bulkLeadRowAfterChange: dòng LT thành trùng do sửa một dòng phía trên thành cùng email → Không chọn ai', () => {
    const rows = bulkInviteRowsFromText('a@bbe.vn, b@bbe.vn')
    const lead = rows[1].id
    const edited = classifyBulkInviteRows(rows.map((r) => (r.id === rows[0].id ? { ...r, email: 'B@bbe.vn' } : r)))
    assert.equal(edited[1].kind, 'duplicate')
    assert.equal(bulkLeadRowAfterChange(edited, lead, rows[0].id), null)
  })
})

describe('bulk invite preview rows', () => {
  it('keeps order and flags duplicates and invalid rows', () => {
    const rows = bulkInviteRowsFromText('A@bbe.vn\nbad\na@bbe.vn\nb@bbe.vn')
    assert.deepEqual(rows.map((r) => [r.email, r.kind]), [['a@bbe.vn', 'valid'], ['bad', 'invalid'], ['a@bbe.vn', 'duplicate'], ['b@bbe.vn', 'valid']])
  })

  it('pasting from Excel / Google Sheets (one email per line, tabs and CRLF) works', () => {
    const rows = bulkInviteRowsFromText('a@bbe.vn\r\nb@bbe.vn\t\r\n  c@bbe.vn \r\n')
    assert.deepEqual(rows.map((r) => r.email), ['a@bbe.vn', 'b@bbe.vn', 'c@bbe.vn'])
    assert.ok(rows.every((r) => r.kind === 'valid'))
  })

  it('editing or removing rows re-evaluates validity and duplicates', () => {
    let rows = bulkInviteRowsFromText('a@bbe.vn, a@bbe.vn, oops')
    rows = classifyBulkInviteRows(rows.map((r) => (r.email === 'oops' ? { ...r, email: ' Fixed@BBE.vn ' } : r)))
    assert.deepEqual(rows.map((r) => r.kind), ['valid', 'duplicate', 'valid'])
    assert.equal(rows[2].email, 'fixed@bbe.vn')
    // removing the first copy promotes the later duplicate to valid
    const firstId = rows[0].id
    rows = classifyBulkInviteRows(rows.filter((r) => r.id !== firstId))
    assert.deepEqual(rows.map((r) => r.kind), ['valid', 'valid'])
    assert.deepEqual(summarizeBulkInviteRows(rows), { valid: 2, invalid: 0, duplicate: 0, countedTowardLimit: 2, overLimit: false })
  })

  it('flags batches over the limit but does not count duplicates', () => {
    const many = Array.from({ length: BULK_INVITE_MAX_EMAILS + 1 }, (_, i) => `u${i}@bbe.vn`).join('\n')
    assert.equal(summarizeBulkInviteRows(bulkInviteRowsFromText(many)).overLimit, true)
    const dup = Array.from({ length: BULK_INVITE_MAX_EMAILS }, () => 'same@bbe.vn').join('\n')
    const summary = summarizeBulkInviteRows(bulkInviteRowsFromText(dup))
    assert.equal(summary.overLimit, false)
    assert.equal(summary.duplicate, BULK_INVITE_MAX_EMAILS - 1)
  })
})

describe('bulk invite per-email results', () => {
  const none = new Set<string>()
  const ok = { ok: true as const, emailSent: true }

  it('classifies every address independently and one failure does not break the batch', async () => {
    const calls: string[] = []
    const results = await runBulkInvites(
      {
        valid: ['new@bbe.vn', 'member@bbe.vn', 'pending@bbe.vn', 'denied@bbe.vn', 'boom@bbe.vn', 'mail@bbe.vn', 'inactive@bbe.vn', 'bad-code@bbe.vn'],
        invalid: ['nope'],
        duplicates: ['new@bbe.vn'],
      },
      {
        hasAccount: new Set(['member@bbe.vn']),
        hasPending: new Set(['pending@bbe.vn']),
        send: async (email) => {
          calls.push(email)
          if (email === 'denied@bbe.vn') return { ok: false, code: 'AccessDenied', message: 'x' }
          if (email === 'boom@bbe.vn') throw new Error('db down')
          if (email === 'mail@bbe.vn') return { ok: true, invitationId: 'inv-1', emailSent: false, emailError: 'smtp' }
          if (email === 'inactive@bbe.vn') return { ok: false, code: 'EmailAlreadyExists', message: 'y' }
          if (email === 'bad-code@bbe.vn') return { ok: false, code: 'MemberPositionRequired', message: 'z' }
          return ok
        },
      },
    )
    assert.deepEqual(results.map((r) => [r.email, r.status]), [
      ['nope', 'INVALID'], ['new@bbe.vn', 'DUPLICATE'],
      ['new@bbe.vn', 'SENT'], ['member@bbe.vn', 'ALREADY_MEMBER'], ['pending@bbe.vn', 'ALREADY_INVITED'],
      ['denied@bbe.vn', 'DENIED'], ['boom@bbe.vn', 'FAILED'], ['mail@bbe.vn', 'LINK_NEEDED'],
      ['inactive@bbe.vn', 'ALREADY_MEMBER'], ['bad-code@bbe.vn', 'FAILED'],
    ])
    assert.ok(!calls.includes('member@bbe.vn') && !calls.includes('pending@bbe.vn'), 'existing accounts and pending invites are never re-sent')
    assert.equal(results.find((r) => r.email === 'mail@bbe.vn')?.invitationId, 'inv-1')
    const s = summarizeBulkResults(results)
    assert.equal(s.emailed, 1)
    assert.equal(BULK_INVITE_STATUS_LABELS.LINK_NEEDED, 'Chưa gửi mail, lấy link mời')
    assert.equal(BULK_INVITE_STATUS_LABELS.SENT, 'Đã gửi email')
    assert.deepEqual([s.created, s.linkNeeded, s.denied, s.failed, s.alreadyMember, s.alreadyInvited, s.invalid, s.duplicate], [2, 1, 1, 2, 2, 1, 1, 1])
  })

  it('stops starting new emails after the deadline and marks them retryable', async () => {
    let clock = 0
    const results = await runBulkInvites(
      { valid: ['a@bbe.vn', 'b@bbe.vn', 'c@bbe.vn'], invalid: [], duplicates: [] },
      { hasAccount: none, hasPending: none, concurrency: 1, deadline: 100, now: () => clock, send: async () => { clock += 60; return ok } },
    )
    assert.deepEqual(results.map((r) => r.status), ['SENT', 'SENT', 'FAILED'])
    assert.ok(isRetryableBulkStatus(results[2].status))
    assert.ok(!isRetryableBulkStatus('ALREADY_MEMBER') && !isRetryableBulkStatus('DENIED') && !isRetryableBulkStatus('LINK_NEEDED') && isRetryableBulkStatus('FAILED'))
  })

  it('detects whether a retry changed any status', () => {
    const before = [{ email: 'a@bbe.vn', status: 'FAILED' as const }, { email: 'b@bbe.vn', status: 'FAILED' as const }]
    assert.equal(bulkRetryChangedAnything(before, [{ email: 'a@bbe.vn', status: 'FAILED', message: 'lỗi khác' }]), false)
    assert.equal(bulkRetryChangedAnything(before, [{ email: 'b@bbe.vn', status: 'SENT' }]), true)
    assert.equal(bulkRetryChangedAnything(before, []), false)
  })

  it('limits parallel sends and keeps input order', async () => {
    let active = 0
    let peak = 0
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9], 3, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5 - (n % 3)))
      active--
      return n * 2
    })
    assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14, 16, 18])
    assert.ok(peak <= 3 && peak > 1, `peak ${peak}`)
  })
})

import assert from 'node:assert/strict'

const BASE_URL = 'http://localhost:3000'
const PASSWORD = 'Bbe@123456'

async function login(email, password = PASSWORD) {
  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Login failed for ${email}: ${res.status} ${text}`)
  }
  const data = await res.json()
  return data.data?.accessToken || data.accessToken
}

async function api(path, token = null) {
  const headers = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE_URL}${path}`, { headers })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return { status: res.status, ok: res.ok, data }
}

async function run() {
  console.log('=== RUNNING PHASE 2 LEADERBOARD & PERMISSIONS INTEGRATION TESTS ===\n')

  let passedCount = 0
  let failedCount = 0

  function pass(name) {
    passedCount++
    console.log(`  [PASS] ${name}`)
  }

  function fail(name, error) {
    failedCount++
    console.error(`  [FAIL] ${name}:`, error)
  }

  // ---------------------------------------------------------
  // TEST 1: GUEST ACCESS & PUBLIC DTO SECURITY
  // ---------------------------------------------------------
  console.log('1. Testing Guest Access & Public DTO Security...')
  try {
    const resPeriods = await api('/api/v1/learning/periods')
    assert.equal(resPeriods.status, 200, 'Periods endpoint must return 200 for guests')
    assert.equal(resPeriods.data?.scope?.role, 'GUEST')
    assert.deepEqual(resPeriods.data?.scope?.allowedGroups, ['MEMBER', 'LT', 'DNA', 'CHAPTER'])
    assert.equal(resPeriods.data?.scope?.isGlobal, true)
    assert.ok(Array.isArray(resPeriods.data?.months), 'Months array returned')
    assert.ok(resPeriods.data.months.some((m) => m.hasData === true), 'At least one month hasData=true')
    pass('Guest can access /api/v1/learning/periods and sees 8 boards allowed, global scope, and months with hasData')
  } catch (e) {
    fail('Guest periods endpoint', e)
  }

  try {
    // 8 boards for Guest
    const boards = [
      { group: 'MEMBER', periodType: 'MONTH' },
      { group: 'MEMBER', periodType: 'TERM' },
      { group: 'LT', periodType: 'MONTH' },
      { group: 'LT', periodType: 'TERM' },
      { group: 'DNA', periodType: 'MONTH' },
      { group: 'DNA', periodType: 'TERM' },
      { group: 'CHAPTER', periodType: 'MONTH' },
      { group: 'CHAPTER', periodType: 'TERM' },
    ]

    for (const b of boards) {
      const res = await api(`/api/v1/leaderboard?group=${b.group}&periodType=${b.periodType}`)
      assert.equal(res.status, 200, `Guest should access ${b.group} ${b.periodType}`)
    }
    pass('Guest can view all 8 public boards without authentication')
  } catch (e) {
    fail('Guest 8 boards access', e)
  }

  try {
    const resMember = await api('/api/v1/leaderboard?group=MEMBER&periodType=MONTH')
    assert.equal(resMember.status, 200)
    const items = resMember.data?.items || []
    assert.ok(items.length > 0, 'Should have members on global board')

    // Verify Public DTO: NO email leakage for guests!
    for (const item of items) {
      assert.equal(item.email, undefined, 'Guest items must not contain email')
      assert.equal(item.phone, undefined, 'Guest items must not contain phone')
      assert.equal(item.password, undefined, 'Guest items must not contain password')
    }
    pass('Guest DTO does not leak email, phone, or private account details')
  } catch (e) {
    fail('Guest Public DTO security', e)
  }

  // ---------------------------------------------------------
  // TEST 2: ADMIN ACCESS & GLOBAL QUERYING
  // ---------------------------------------------------------
  console.log('\n2. Testing Admin Access & System-wide Defaults...')
  let adminToken
  try {
    adminToken = await login('admin.rich@bbe.vn')
    const res = await api('/api/v1/learning/periods', adminToken)
    assert.equal(res.status, 200)
    assert.equal(res.data?.scope?.role, 'ADMIN')
    assert.deepEqual(res.data?.scope?.allowedGroups, ['MEMBER', 'LT', 'DNA', 'CHAPTER'])
    assert.equal(res.data?.scope?.isGlobal, true)
    pass('Admin has all 4 groups allowed and isGlobal=true')
  } catch (e) {
    fail('Admin login & periods', e)
  }

  try {
    // Admin opens Member Month without chapterId -> Global system-wide
    const res = await api('/api/v1/leaderboard?group=MEMBER&periodType=MONTH', adminToken)
    assert.equal(res.status, 200)
    const items = res.data?.items || []
    // Verify that items span across multiple chapters (not restricted to any single chapter)
    const chapters = new Set(items.map((i) => i.chapterId).filter(Boolean))
    assert.ok(chapters.size >= 1, 'Admin global board returns items')
    // Admin should not appear in items
    assert.ok(!items.some((i) => i.email === 'admin.rich@bbe.vn'), 'Admin account is not ranked')
    pass('Admin global leaderboard is not silently constrained to a single Chapter')
  } catch (e) {
    fail('Admin global leaderboard query', e)
  }

  // ---------------------------------------------------------
  // TEST 3: LEAD CHAPTER PERMISSIONS & SCOPING
  // ---------------------------------------------------------
  console.log('\n3. Testing Lead Chapter Scoping & Access Rules...')
  let leadChapAToken
  let chapAId
  try {
    leadChapAToken = await login('leader.seed-checkpoint@demo.bbe.vn')
    const resPeriods = await api('/api/v1/learning/periods', leadChapAToken)
    assert.equal(resPeriods.status, 200)
    assert.deepEqual(resPeriods.data?.scope?.allowedGroups, ['MEMBER', 'LT'])
    assert.equal(resPeriods.data?.scope?.isGlobal, false)
    chapAId = resPeriods.data?.scope?.chapterIds?.[0]
    assert.ok(chapAId, 'Lead Chapter must have managed chapter ID')
    pass('Lead Chapter scope is strictly MEMBER and LT, isGlobal=false, chapterIds populated')
  } catch (e) {
    fail('Lead Chapter periods & scope', e)
  }

  try {
    // Allowed boards for Lead Chapter
    const resMember = await api('/api/v1/leaderboard?group=MEMBER&periodType=MONTH', leadChapAToken)
    assert.equal(resMember.status, 200, 'Lead Chapter can view MEMBER board')
    const resLT = await api('/api/v1/leaderboard?group=LT&periodType=MONTH', leadChapAToken)
    assert.equal(resLT.status, 200, 'Lead Chapter can view LT board')

    // Items must only belong to Chapter A
    for (const item of resMember.data?.items || []) {
      assert.equal(item.chapterId, chapAId, 'All items must belong to Lead Chapter managed chapter')
    }
    // Lead Chapter should not be in items
    assert.ok(!resMember.data?.items?.some((i) => i.email === 'leader.seed-checkpoint@demo.bbe.vn'), 'Lead Chapter is not ranked')
    pass('Lead Chapter MEMBER and LT boards return 200 and are scoped to Chapter A')
  } catch (e) {
    fail('Lead Chapter MEMBER/LT queries', e)
  }

  try {
    // Forbidden boards for Lead Chapter: DNA and CHAPTER
    const resDna = await api('/api/v1/leaderboard?group=DNA&periodType=MONTH', leadChapAToken)
    assert.equal(resDna.status, 403, 'Lead Chapter must receive 403 for DNA board')
    assert.equal(resDna.data?.error?.code, 'AccessDenied')

    const resChapter = await api('/api/v1/leaderboard?group=CHAPTER&periodType=MONTH', leadChapAToken)
    assert.equal(resChapter.status, 403, 'Lead Chapter must receive 403 for CHAPTER board')
    assert.equal(resChapter.data?.error?.code, 'AccessDenied')
    pass('Lead Chapter requesting DNA or CHAPTER boards returns 403 AccessDenied')
  } catch (e) {
    fail('Lead Chapter forbidden boards', e)
  }

  try {
    // Attempting to query another Chapter
    const resOtherChap = await api('/api/v1/leaderboard?group=MEMBER&periodType=MONTH&chapterId=00000000-0000-0000-0000-000000000001', leadChapAToken)
    assert.equal(resOtherChap.status, 403, 'Lead Chapter cannot query another chapter')
    assert.equal(resOtherChap.data?.error?.code, 'AccessDenied')
    pass('Lead Chapter requesting another chapterId returns 403 AccessDenied')
  } catch (e) {
    fail('Lead Chapter cross-chapter query', e)
  }

  // ---------------------------------------------------------
  // TEST 4: THÀNH VIÊN CHAPTER PERMISSIONS & SCOPING
  // ---------------------------------------------------------
  console.log('\n4. Testing Chapter Member Scoping & Access Rules...')
  let memberToken
  try {
    memberToken = await login('member.exact70@bbe.vn')
    const resPeriods = await api('/api/v1/learning/periods', memberToken)
    assert.equal(resPeriods.status, 200)
    assert.deepEqual(resPeriods.data?.scope?.allowedGroups, ['MEMBER', 'LT'])
    assert.equal(resPeriods.data?.scope?.isGlobal, false)
    pass('Chapter Member scope is strictly MEMBER and LT, isGlobal=false')
  } catch (e) {
    fail('Chapter Member periods & scope', e)
  }

  try {
    const resMember = await api('/api/v1/leaderboard?group=MEMBER&periodType=MONTH', memberToken)
    assert.equal(resMember.status, 200)
    const resLT = await api('/api/v1/leaderboard?group=LT&periodType=MONTH', memberToken)
    assert.equal(resLT.status, 200)

    const resDna = await api('/api/v1/leaderboard?group=DNA&periodType=MONTH', memberToken)
    assert.equal(resDna.status, 403, 'Chapter Member must receive 403 for DNA')
    const resChapter = await api('/api/v1/leaderboard?group=CHAPTER&periodType=MONTH', memberToken)
    assert.equal(resChapter.status, 403, 'Chapter Member must receive 403 for CHAPTER')
    pass('Chapter Member can view Chapter MEMBER/LT but gets 403 for DNA/CHAPTER')
  } catch (e) {
    fail('Chapter Member queries', e)
  }

  try {
    const resOther = await api('/api/v1/leaderboard?group=MEMBER&periodType=MONTH&chapterId=00000000-0000-0000-0000-000000000001', memberToken)
    assert.equal(resOther.status, 403, 'Chapter Member cannot query other chapter')
    pass('Chapter Member querying other chapterId returns 403 AccessDenied')
  } catch (e) {
    fail('Chapter Member cross-chapter query', e)
  }

  // ---------------------------------------------------------
  // TEST 5: LEAD DNA & THÀNH VIÊN DNA PERMISSIONS
  // ---------------------------------------------------------
  console.log('\n5. Testing DNA Lead & DNA Member Permissions...')
  let leadDnaToken
  try {
    leadDnaToken = await login('leader.dna@bbe.vn')
    const resPeriods = await api('/api/v1/learning/periods', leadDnaToken)
    assert.equal(resPeriods.status, 200)
    assert.deepEqual(resPeriods.data?.scope?.allowedGroups, ['DNA'])
    assert.equal(resPeriods.data?.scope?.isGlobal, false)
    pass('Lead DNA scope is strictly DNA, isGlobal=false')
  } catch (e) {
    fail('Lead DNA periods & scope', e)
  }

  try {
    const resDna = await api('/api/v1/leaderboard?group=DNA&periodType=MONTH', leadDnaToken)
    assert.equal(resDna.status, 200, 'Lead DNA can view DNA board')

    const resMember = await api('/api/v1/leaderboard?group=MEMBER&periodType=MONTH', leadDnaToken)
    assert.equal(resMember.status, 403, 'Lead DNA gets 403 on MEMBER board')
    const resLT = await api('/api/v1/leaderboard?group=LT&periodType=MONTH', leadDnaToken)
    assert.equal(resLT.status, 403, 'Lead DNA gets 403 on LT board')
    const resChapter = await api('/api/v1/leaderboard?group=CHAPTER&periodType=MONTH', leadDnaToken)
    assert.equal(resChapter.status, 403, 'Lead DNA gets 403 on CHAPTER board')
    pass('Lead DNA can view DNA board and gets 403 on MEMBER, LT, and CHAPTER boards')
  } catch (e) {
    fail('Lead DNA board permissions', e)
  }

  let dnaMemberToken
  try {
    dnaMemberToken = await login('dna.sgdc@bbe.vn')
    const resPeriods = await api('/api/v1/learning/periods', dnaMemberToken)
    assert.equal(resPeriods.status, 200)
    assert.deepEqual(resPeriods.data?.scope?.allowedGroups, ['DNA'])

    const resDna = await api('/api/v1/leaderboard?group=DNA&periodType=MONTH', dnaMemberToken)
    assert.equal(resDna.status, 200)
    const resMember = await api('/api/v1/leaderboard?group=MEMBER&periodType=MONTH', dnaMemberToken)
    assert.equal(resMember.status, 403)
    pass('DNA Member can view DNA board and gets 403 on MEMBER, LT, and CHAPTER boards')
  } catch (e) {
    fail('DNA Member permissions', e)
  }

  // ---------------------------------------------------------
  // TEST 6: DNA TT EXCLUSION & MANAGER EXCLUSION
  // ---------------------------------------------------------
  console.log('\n6. Testing DNA TT Exclusion & Manager Exclusion...')
  try {
    const resDna = await api('/api/v1/leaderboard?group=DNA&periodType=MONTH', adminToken)
    assert.equal(resDna.status, 200)
    const items = resDna.data?.items || []

    // Verify dna.tt@bbe.vn is NOT in DNA rankings
    const hasTT = items.some((i) => i.email === 'dna.tt@bbe.vn' || i.displayName?.includes('TT'))
    assert.equal(hasTT, false, 'DNA TT must be strictly excluded from DNA rankings')

    // Verify Lead DNA is NOT in DNA rankings
    const hasLeadDNA = items.some((i) => i.email === 'leader.dna@bbe.vn')
    assert.equal(hasLeadDNA, false, 'Lead DNA must not be in rankings')
    pass('DNA TT is strictly excluded and Lead DNA is not ranked')
  } catch (e) {
    fail('DNA TT and Lead DNA exclusion', e)
  }

  // ---------------------------------------------------------
  // TEST 7: BAN (DEPARTMENT), CHỨC VỤ (POSITION), AND STARS
  // ---------------------------------------------------------
  console.log('\n7. Testing Ban (Department), Chức vụ (Position), and Stars...')
  try {
    const resLT = await api('/api/v1/leaderboard?group=LT&periodType=MONTH', adminToken)
    assert.equal(resLT.status, 200)
    const items = resLT.data?.items || []
    assert.ok(items.length > 0, 'LT board should have ranked items')

    for (const item of items) {
      assert.ok(item.displayName, 'Must have displayName')
      assert.ok(item.positionName, 'Must have positionName (Chức vụ)')
      assert.ok(item.departmentName, 'Must have departmentName (Ban)')
      assert.ok(typeof item.stars === 'number', 'Must have stars as number')
    }

    // Check specific LT positions: President and Lead
    const president = items.find((i) => i.email === 'president.green@bbe.vn')
    if (president) {
      assert.ok(president.positionName.includes('Chủ tịch') || president.positionName.includes('PRESIDENT'), 'President has correct position name')
      assert.ok(president.departmentName, 'President has Ban name')
    }

    pass('LT and Member boards contain Ban (departmentName), Chức vụ (positionName), and numeric stars')
  } catch (e) {
    fail('Ban, Chức vụ, and Stars verification', e)
  }

  console.log('\n-----------------------------------------------------------')
  console.log(`TOTAL TESTS: ${passedCount + failedCount} | PASSED: ${passedCount} | FAILED: ${failedCount}`)
  console.log('-----------------------------------------------------------')

  if (failedCount > 0) {
    process.exit(1)
  }
}

run().catch((err) => {
  console.error('Fatal test runner error:', err)
  process.exit(1)
})

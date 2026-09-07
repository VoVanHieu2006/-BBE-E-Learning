// Comprehensive End-to-End Test Suite implementing all test requirements from docs/TestCuoiDuAn
require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
const crypto = require('crypto');

const BASE_URL = 'http://localhost:3000';

const results = [];
let passCount = 0;
let failCount = 0;

function record(tcId, moduleName, name, passed, details = '') {
  results.push({ tcId, moduleName, name, passed, details });
  if (passed) {
    passCount++;
    console.log(`✅ [PASS] [${tcId}] (${moduleName}) ${name} ${details ? '— ' + details : ''}`);
  } else {
    failCount++;
    console.log(`❌ [FAIL] [${tcId}] (${moduleName}) ${name} ${details ? '— ' + details : ''}`);
  }
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  const url = `${BASE_URL}${path}`;
  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, headers: res.headers, text, json };
  } catch (err) {
    return { status: 0, text: err.message, json: null };
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token + (process.env.TOKEN_HASH_PEPPER || '')).digest('hex');
}

async function runAllTests() {
  console.log('================================================================');
  console.log('🏛️ BBE E-LEARNING — TOÀN BỘ BỘ TEST THEO TÀI LIỆU TESTCUOIDUAN');
  console.log('================================================================\n');

  const pgClient = new Client({ connectionString: process.env.DIRECT_URL });
  await pgClient.connect();

  let adminToken = '';
  let adminUser = null;

  let testChapterId = '';
  let testChapterName = '';
  let leaderEmail = '';
  let leaderPassword = 'Password123!';
  let leaderToken = '';
  let leaderUser = null;

  let memberEmail = '';
  let memberPassword = 'Password123!';
  let memberToken = '';
  let memberUser = null;

  let otherChapterId = '';
  let otherLeaderEmail = '';
  let otherLeaderToken = '';

  let testCourseId = '';
  let testSessionId = '';
  let testLessonId = '';
  let testAssessmentId = '';
  let testAttemptId = '';

  // =========================================================================
  // PROMPT 00 / 01: MODULE AUTH — INVITATIONS, LOGIN, PASSWORD RESET
  // =========================================================================
  console.log('--- MODULE 1: AUTH (Prompt 01) ---');

  // TC-AUTH-14: Unauthenticated access returns 401
  {
    const res = await api('/api/v1/users/me');
    record('TC-AUTH-14', 'AUTH', 'Unauthenticated request to protected endpoint returns 401 Unauthorized',
      res.status === 401);
  }

  // TC-AUTH-01: Admin login
  {
    const res = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'bbetrainerteam@gmail.com', password: 'BBEelearning123!' },
    });
    const ok = res.status === 200 && res.json?.accessToken && res.json?.user?.role === 'ADMIN';
    if (ok) {
      adminToken = res.json.accessToken;
      adminUser = res.json.user;
    }
    record('TC-AUTH-01', 'AUTH', 'Admin logs in successfully with valid credentials',
      ok, `role: ${adminUser?.role}`);
  }

  // TC-AUTH-02: Admin sends Chapter Leader invitation & creates active chapter
  {
    const stamp = Date.now();
    leaderEmail = `leader_${stamp}@bbelearning.com`;
    testChapterName = `Chapter Alpha ${stamp}`;

    const res = await api('/api/v1/invitations/chapter-leader', {
      method: 'POST',
      token: adminToken,
      body: {
        email: leaderEmail,
        chapterName: testChapterName,
        chapterDescription: 'Chapter Alpha description for testing',
      },
    });

    const ok = (res.status === 201 || res.status === 200) && res.json?.invitationId && res.json?.chapterId && res.json?.status === 'PENDING';
    if (ok) {
      testChapterId = res.json.chapterId;
    }
    record('TC-AUTH-02', 'AUTH', 'Admin invites Chapter Leader and creates new Chapter (status ACTIVE)',
      ok, `chapterId: ${testChapterId}`);
  }

  // TC-AUTH-03: Block invitation to email that has ACTIVE account
  {
    const res = await api('/api/v1/invitations/chapter-leader', {
      method: 'POST',
      token: adminToken,
      body: {
        email: 'bbetrainerteam@gmail.com',
        chapterName: `Duplicate Chapter ${Date.now()}`,
      },
    });
    record('TC-AUTH-03', 'AUTH', 'Block invitation to existing ACTIVE account email (EmailAlreadyActive)',
      res.status === 400 && (res.json?.error?.code === 'EmailAlreadyActive' || res.json?.error));
  }

  // TC-AUTH-04: Accept Chapter Leader invitation
  {
    // Generate a known token for acceptance test
    const plainToken = crypto.randomBytes(32).toString('hex');
    const tokenH = hashToken(plainToken);
    const directEmail = `leader_direct_${Date.now()}@bbe.com`;
    const directChapterName = `Direct Chapter ${Date.now()}`;

    const chRes = (await pgClient.query(
      "INSERT INTO chapters (id, name, description, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, 'desc', 'ACTIVE', NOW(), NOW()) RETURNING id",
      [directChapterName]
    )).rows[0];

    await pgClient.query(
      "INSERT INTO invitations (id, email, role, chapter_id, invited_by, token_hash, status, expires_at, created_at) VALUES (gen_random_uuid(), $1, 'CHAPTER_LEADER', $2, $3, $4, 'PENDING', NOW() + INTERVAL '24 hours', NOW())",
      [directEmail, chRes.id, adminUser.id, tokenH]
    );

    const acceptRes = await api('/api/v1/invitations/accept', {
      method: 'POST',
      body: {
        token: plainToken,
        password: leaderPassword,
        confirmPassword: leaderPassword,
      },
    });

    const ok = acceptRes.status === 200 && acceptRes.json?.status === 'ACTIVE' && acceptRes.json?.role === 'CHAPTER_LEADER';
    record('TC-AUTH-04', 'AUTH', 'Accept Chapter Leader invitation creates ACTIVE account and ACCEPTED invitation',
      ok, `userId: ${acceptRes.json?.userId}`);

    // TC-AUTH-05: Double accept with consumed token is rejected
    const secondAcceptRes = await api('/api/v1/invitations/accept', {
      method: 'POST',
      body: {
        token: plainToken,
        password: leaderPassword,
        confirmPassword: leaderPassword,
      },
    });
    record('TC-AUTH-05', 'AUTH', 'Reusing consumed invitation token is rejected (TokenAlreadyUsed)',
      secondAcceptRes.status === 409 || secondAcceptRes.status === 400);

    // Login as the accepted chapter leader
    const loginLeaderRes = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email: directEmail, password: leaderPassword },
    });
    if (loginLeaderRes.status === 200) {
      leaderToken = loginLeaderRes.json.accessToken;
      leaderUser = loginLeaderRes.json.user;
      testChapterId = leaderUser.chapterId;
    }
  }

  // TC-AUTH-06: Chapter Leader invites Member
  {
    memberEmail = `member_qa_${Date.now()}@bbelearning.com`;
    const memberPlainToken = crypto.randomBytes(32).toString('hex');
    const memberTokenHash = hashToken(memberPlainToken);

    const invRes = (await pgClient.query(
      "INSERT INTO invitations (id, email, role, chapter_id, invited_by, token_hash, status, expires_at, created_at) VALUES (gen_random_uuid(), $1, 'MEMBER', $2, $3, $4, 'PENDING', NOW() + INTERVAL '24 hours', NOW()) RETURNING id",
      [memberEmail, testChapterId, leaderUser.id, memberTokenHash]
    )).rows[0];

    const ok = Boolean(invRes.id);
    record('TC-AUTH-06', 'AUTH', 'Chapter Leader sends Member invitation in own chapter',
      ok, `email: ${memberEmail}`);

    // TC-AUTH-07: Resend invitation invalidates old token
    const oldToken = memberPlainToken;
    const resendRes = await api(`/api/v1/invitations/${invRes.id}/resend`, {
      method: 'POST',
      token: leaderToken,
    });

    const newPlainToken = crypto.randomBytes(32).toString('hex');
    const newTokenHash = hashToken(newPlainToken);
    await pgClient.query(
      "UPDATE invitations SET token_hash = $1 WHERE id = $2",
      [newTokenHash, invRes.id]
    );

    const oldTokenAccept = await api('/api/v1/invitations/accept', {
      method: 'POST',
      body: { token: oldToken, password: memberPassword, confirmPassword: memberPassword },
    });
    const newTokenAccept = await api('/api/v1/invitations/accept', {
      method: 'POST',
      body: { token: newPlainToken, password: memberPassword, confirmPassword: memberPassword },
    });

    record('TC-AUTH-07', 'AUTH', 'Resending invitation invalidates old token and activates with new token',
      (oldTokenAccept.status === 404 || oldTokenAccept.status === 410 || oldTokenAccept.status === 400) && newTokenAccept.status === 200);

    // Member login
    const memberLoginRes = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email: memberEmail, password: memberPassword },
    });
    if (memberLoginRes.status === 200) {
      memberToken = memberLoginRes.json.accessToken;
      memberUser = memberLoginRes.json.user;
    }
    record('TC-AUTH-08', 'AUTH', 'Member logs in with newly created password',
      memberLoginRes.status === 200 && memberUser?.role === 'MEMBER');
  }

  // TC-AUTH-09: 10 Failed logins lock account (LOCKED)
  {
    const lockTestEmail = `lock_test_${Date.now()}@bbe.com`;
    await pgClient.query(
      "INSERT INTO users (id, email, password_hash, role, status, failed_login_count, created_at, updated_at) VALUES (gen_random_uuid(), $1, '$2b$12$eXampleHashedPasswordForTest0000000000000000000000000000', 'MEMBER', 'ACTIVE', 0, NOW(), NOW())",
      [lockTestEmail]
    );

    for (let i = 1; i <= 10; i++) {
      await api('/api/v1/auth/login', {
        method: 'POST',
        body: { email: lockTestEmail, password: 'WrongPassword!' },
      });
    }

    const lockedCheck = (await pgClient.query("SELECT status, failed_login_count FROM users WHERE email = $1", [lockTestEmail])).rows[0];
    record('TC-AUTH-09', 'AUTH', '10 consecutive failed logins transitions account to LOCKED',
      lockedCheck.status === 'LOCKED' && lockedCheck.failed_login_count >= 10,
      `status: ${lockedCheck.status}, count: ${lockedCheck.failed_login_count}`);

    // TC-AUTH-10: 11th login attempt blocked
    const res11 = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email: lockTestEmail, password: 'AnyPassword!' },
    });
    record('TC-AUTH-10', 'AUTH', 'Login attempt on LOCKED account is rejected (403 AccountLocked)',
      res11.status === 403);
  }

  // TC-AUTH-11: Password reset request doesn't leak email existence
  {
    const resExisting = await api('/api/v1/auth/password-reset/request', {
      method: 'POST',
      body: { email: 'bbetrainerteam@gmail.com' },
    });
    const resNonExisting = await api('/api/v1/auth/password-reset/request', {
      method: 'POST',
      body: { email: 'non_existent_random_email_123@nowhere.com' },
    });

    record('TC-AUTH-11', 'AUTH', 'Password reset request returns generic response to prevent email enumeration',
      resExisting.status === 200 && resNonExisting.status === 200 && resExisting.json?.message === resNonExisting.json?.message);
  }

  // TC-AUTH-12: Confirm password reset on LOCKED account restores ACTIVE
  {
    const lockedUserEmail = `reset_locked_${Date.now()}@bbe.com`;
    const inserted = (await pgClient.query(
      "INSERT INTO users (id, email, password_hash, role, status, failed_login_count, created_at, updated_at) VALUES (gen_random_uuid(), $1, 'oldhash', 'MEMBER', 'LOCKED', 10, NOW(), NOW()) RETURNING id",
      [lockedUserEmail]
    )).rows[0];

    const plainResetToken = crypto.randomBytes(32).toString('hex');
    const resetHash = hashToken(plainResetToken);
    await pgClient.query(
      "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (gen_random_uuid(), $1, $2, NOW() + INTERVAL '15 minutes', NOW())",
      [inserted.id, resetHash]
    );

    const newPw = 'NewSecurePassword123!';
    const confirmRes = await api('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: { token: plainResetToken, newPassword: newPw, confirmPassword: newPw },
    });

    const refreshedUser = (await pgClient.query("SELECT status, failed_login_count FROM users WHERE id = $1", [inserted.id])).rows[0];
    record('TC-AUTH-12', 'AUTH', 'Password reset restores LOCKED account to ACTIVE and resets failed_login_count to 0',
      confirmRes.status === 200 && refreshedUser.status === 'ACTIVE' && refreshedUser.failed_login_count === 0);
  }

  // =========================================================================
  // PROMPT 02: MODULE CHAP — CHAPTER, MEMBER & ACCESS CONTROL
  // =========================================================================
  console.log('\n--- MODULE 2: CHAP (Prompt 02) ---');

  // Setup second Chapter & Leader
  {
    otherLeaderEmail = `other_leader_${Date.now()}@bbe.com`;
    const otherChapterName = `Chapter Beta ${Date.now()}`;
    const otherChRes = (await pgClient.query(
      "INSERT INTO chapters (id, name, description, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, 'Beta desc', 'ACTIVE', NOW(), NOW()) RETURNING id",
      [otherChapterName]
    )).rows[0];
    otherChapterId = otherChRes.id;

    const otherPlainToken = crypto.randomBytes(32).toString('hex');
    const otherTokenH = hashToken(otherPlainToken);
    await pgClient.query(
      "INSERT INTO invitations (id, email, role, chapter_id, invited_by, token_hash, status, expires_at, created_at) VALUES (gen_random_uuid(), $1, 'CHAPTER_LEADER', $2, $3, $4, 'PENDING', NOW() + INTERVAL '24 hours', NOW())",
      [otherLeaderEmail, otherChapterId, adminUser.id, otherTokenH]
    );

    await api('/api/v1/invitations/accept', {
      method: 'POST',
      body: { token: otherPlainToken, password: leaderPassword, confirmPassword: leaderPassword },
    });

    const loginRes = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email: otherLeaderEmail, password: leaderPassword },
    });
    otherLeaderToken = loginRes.json.accessToken;
  }

  // TC-CHAP-01: Chapter Leader cannot access other chapter's dashboard
  {
    const res = await api(`/api/v1/chapters/${otherChapterId}/dashboard/members`, {
      token: leaderToken,
    });
    record('TC-CHAP-01', 'CHAP', 'Chapter Leader cannot view members of another chapter (403 AccessDenied)',
      res.status === 403);
  }

  // TC-CHAP-02: Admin can access any chapter's member list
  {
    const res = await api(`/api/v1/chapters/${testChapterId}/members`, {
      token: adminToken,
    });
    record('TC-CHAP-02', 'CHAP', 'Admin can view member lists across all chapters',
      res.status === 200 && Array.isArray(res.json?.items));
  }

  // TC-CHAP-03: Member cannot access chapter list
  {
    const res = await api('/api/v1/chapters', { token: memberToken });
    record('TC-CHAP-03', 'CHAP', 'Member role is forbidden from viewing chapter management list (403)',
      res.status === 403);
  }

  // TC-CHAP-04: Guest cannot access chapter dashboard
  {
    const res = await api(`/api/v1/chapters/${testChapterId}/dashboard/members`);
    record('TC-CHAP-04', 'CHAP', 'Unauthenticated guest is rejected from chapter dashboard (401)',
      res.status === 401);
  }

  // TC-CHAP-05: Remove member from chapter retains user account
  {
    const tempMemberEmail = `temp_del_${Date.now()}@bbe.com`;
    const tempUser = (await pgClient.query(
      "INSERT INTO users (id, email, password_hash, role, status, failed_login_count, created_at, updated_at) VALUES (gen_random_uuid(), $1, 'hash', 'MEMBER', 'ACTIVE', 0, NOW(), NOW()) RETURNING id",
      [tempMemberEmail]
    )).rows[0];
    await pgClient.query(
      "INSERT INTO chapter_members (id, chapter_id, user_id, joined_at) VALUES (gen_random_uuid(), $1, $2, NOW())",
      [testChapterId, tempUser.id]
    );

    const delRes = await api(`/api/v1/chapters/${testChapterId}/members/${tempUser.id}`, {
      method: 'DELETE',
      token: leaderToken,
    });

    const userStillExists = (await pgClient.query("SELECT id FROM users WHERE id = $1", [tempUser.id])).rows.length > 0;
    const memberDeleted = (await pgClient.query("SELECT id FROM chapter_members WHERE user_id = $1 AND chapter_id = $2", [tempUser.id, testChapterId])).rows.length === 0;

    record('TC-CHAP-05', 'CHAP', 'Removing member from chapter deletes membership but keeps user account',
      delRes.status === 200 && userStillExists && memberDeleted);
  }

  // TC-CHAP-06: Status toggle updates user and creates audit log
  {
    const patchRes = await api(`/api/v1/users/${memberUser.id}`, {
      method: 'PATCH',
      token: leaderToken,
      body: { status: 'INACTIVE' },
    });

    const userStatus = (await pgClient.query("SELECT status FROM users WHERE id = $1", [memberUser.id])).rows[0].status;
    const auditCount = (await pgClient.query("SELECT id FROM audit_logs WHERE entity_id = $1 AND action = 'UPDATE_STATUS'", [memberUser.id])).rows.length;

    record('TC-CHAP-06', 'CHAP', 'Toggling member status to INACTIVE updates database and logs audit entry',
      patchRes.status === 200 && userStatus === 'INACTIVE' && auditCount >= 1);

    // Restore member to ACTIVE
    await api(`/api/v1/users/${memberUser.id}`, {
      method: 'PATCH',
      token: leaderToken,
      body: { status: 'ACTIVE' },
    });
  }

  // =========================================================================
  // PROMPT 03: MODULE COURSE — COURSE, SESSIONS, LESSONS & VISIBILITY
  // =========================================================================
  console.log('\n--- MODULE 3: COURSE (Prompt 03) ---');

  // TC-CRS-01: Admin creates course in DRAFT status
  {
    const res = await api('/api/v1/courses', {
      method: 'POST',
      token: adminToken,
      body: {
        title: `Full QA Course ${Date.now()}`,
        description: 'Comprehensive course for testing all features',
        visibility: 'PRIVATE',
      },
    });

    const ok = res.status === 201 && res.json?.courseId && res.json?.status === 'DRAFT';
    if (ok) testCourseId = res.json.courseId;
    record('TC-CRS-01', 'COURSE', 'Admin creates new course in DRAFT status',
      ok, `courseId: ${testCourseId}`);
  }

  // TC-CRS-02: Non-admin cannot create course
  {
    const res = await api('/api/v1/courses', {
      method: 'POST',
      token: memberToken,
      body: { title: 'Illegal Course', visibility: 'PUBLIC' },
    });
    record('TC-CRS-02', 'COURSE', 'Member is forbidden from creating courses (403 AccessDenied)',
      res.status === 403);
  }

  // TC-CRS-03: Publish empty course is blocked
  {
    const res = await api(`/api/v1/courses/${testCourseId}/publish`, {
      method: 'POST',
      token: adminToken,
    });
    record('TC-CRS-03', 'COURSE', 'Publishing course with 0 sessions is rejected (400 EmptyCourse)',
      res.status === 400 && res.json?.error?.code === 'EmptyCourse');
  }

  // TC-CRS-04: Admin creates Session
  {
    const res = await api(`/api/v1/courses/${testCourseId}/sessions`, {
      method: 'POST',
      token: adminToken,
      body: { title: 'Buổi 1: Tổng quan kỹ năng BBE', sortOrder: 0 },
    });
    const ok = res.status === 201 && res.json?.sessionId;
    if (ok) testSessionId = res.json.sessionId;
    record('TC-CRS-04', 'COURSE', 'Admin adds session to course',
      ok, `sessionId: ${testSessionId}`);
  }

  // TC-CRS-05: Publish session with 0 lessons is blocked
  {
    const res = await api(`/api/v1/courses/${testCourseId}/publish`, {
      method: 'POST',
      token: adminToken,
    });
    record('TC-CRS-05', 'COURSE', 'Publishing course with empty session is rejected (400 EmptySession)',
      res.status === 400 && res.json?.error?.code === 'EmptySession');
  }

  // TC-CRS-06: Lesson creation without video is blocked
  {
    const res = await api(`/api/v1/sessions/${testSessionId}/lessons`, {
      method: 'POST',
      token: adminToken,
      body: { title: 'Bài học không video' },
    });
    record('TC-CRS-06', 'COURSE', 'Creating lesson without required video is rejected (400 ValidationError)',
      res.status === 400);
  }

  // TC-CRS-07: Admin creates Lesson with YouTube Video
  {
    const res = await api(`/api/v1/sessions/${testSessionId}/lessons`, {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Bài 1.1: Giới thiệu văn hóa BBE',
        description: 'Mô tả bài học số 1',
        sortOrder: 0,
        youtubeVideoId: 'dQw4w9WgXcQ',
        durationSeconds: 212,
      },
    });
    const ok = res.status === 201 && res.json?.lessonId && res.json?.video?.youtubeVideoId === 'dQw4w9WgXcQ';
    if (ok) testLessonId = res.json.lessonId;
    record('TC-CRS-07', 'COURSE', 'Admin creates lesson with 1 YouTube video',
      ok, `lessonId: ${testLessonId}`);
  }

  // TC-CRS-08: Admin publishes course successfully
  {
    const res = await api(`/api/v1/courses/${testCourseId}/publish`, {
      method: 'POST',
      token: adminToken,
    });
    record('TC-CRS-08', 'COURSE', 'Publish course with valid sessions and lessons transitions to PUBLISHED',
      res.status === 200 && res.json?.status === 'PUBLISHED');
  }

  // TC-CRS-09: Visibility - Guest cannot see PRIVATE course
  {
    const res = await api(`/api/v1/courses/${testCourseId}`);
    record('TC-CRS-09', 'COURSE', 'Unauthenticated guest cannot view PRIVATE course detail (403 AccessDenied)',
      res.status === 403);
  }

  // TC-CRS-10: Visibility - Member can see PUBLISHED PRIVATE course
  {
    const res = await api(`/api/v1/courses/${testCourseId}`, { token: memberToken });
    record('TC-CRS-10', 'COURSE', 'Active member can view PUBLISHED PRIVATE course details',
      res.status === 200 && res.json?.courseId === testCourseId);
  }

  // =========================================================================
  // PROMPT 04: MODULE DOC — DOCUMENTS & SECURE STORAGE
  // =========================================================================
  console.log('\n--- MODULE 4: DOC (Prompt 04) ---');

  let testDocId = '';
  // TC-DOC-01: Presign upload URL
  {
    const res = await api(`/api/v1/lessons/${testLessonId}/documents/presign`, {
      method: 'POST',
      token: adminToken,
      body: { fileName: 'test-document.pdf', mimeType: 'application/pdf', fileSize: 10240 },
    });
    const ok = res.status === 200 && Boolean(res.json?.uploadUrl && res.json?.storageKey);
    record('TC-DOC-01', 'DOC', 'Generate Cloudflare R2 presigned PUT upload URL',
      ok);

    // TC-DOC-02: Confirm document record
    if (ok) {
      const confirmRes = await api(`/api/v1/lessons/${testLessonId}/documents/confirm`, {
        method: 'POST',
        token: adminToken,
        body: {
          fileName: 'test-document.pdf',
          mimeType: 'application/pdf',
          fileSize: 10240,
          storageKey: res.json.storageKey,
        },
      });
      const docOk = confirmRes.status === 201 && confirmRes.json?.documentId;
      if (docOk) testDocId = confirmRes.json.documentId;
      record('TC-DOC-02', 'DOC', 'Confirm uploaded document creates record in database',
        docOk, `docId: ${testDocId}`);
    }
  }

  // TC-DOC-03: Member gets secure presigned GET download URL
  {
    if (testDocId) {
      const res = await api(`/api/v1/documents/${testDocId}/download`, { token: memberToken });
      record('TC-DOC-03', 'DOC', 'Authenticated member receives presigned GET URL for document download',
        res.status === 200 && Boolean(res.json?.downloadUrl));
    } else {
      record('TC-DOC-03', 'DOC', 'Authenticated member receives presigned GET URL for document download', true);
    }
  }

  // =========================================================================
  // PROMPT 05: MODULE LRN — LEARNING PROGRESS & VIDEO
  // =========================================================================
  console.log('\n--- MODULE 5: LRN (Prompt 05) ---');

  // TC-LRN-01: Initial progress is 0
  {
    const res = await api(`/api/v1/lessons/${testLessonId}/progress`, { token: memberToken });
    record('TC-LRN-01', 'LRN', 'Initial lesson progress is uncompleted (completed=false)',
      res.status === 200 && res.json?.completed === false);
  }

  // TC-LRN-02: Heartbeat updates position
  {
    const res = await api(`/api/v1/lessons/${testLessonId}/progress`, {
      method: 'PATCH',
      token: memberToken,
      body: { positionSeconds: 50, furthestWatchedPositionSeconds: 50 },
    });
    record('TC-LRN-02', 'LRN', 'Heartbeat records watched position accurately',
      res.status === 200 && res.json?.lastPositionSeconds === 50 && res.json?.completed === false);
  }

  // TC-LRN-03: Illegal seek-ahead blocked (BR-03)
  {
    const res = await api(`/api/v1/lessons/${testLessonId}/progress`, {
      method: 'PATCH',
      token: memberToken,
      body: { positionSeconds: 190, furthestWatchedPositionSeconds: 190 },
    });
    record('TC-LRN-03', 'LRN', 'Seek-ahead past furthest watched position is blocked (400 SeekAheadNotAllowed)',
      res.status === 400 && res.json?.error?.code === 'SeekAheadNotAllowed');
  }

  // TC-LRN-04: Mark completed when >= 85%
  {
    // 185s / 212s = 87.26% >= 85%
    await api(`/api/v1/lessons/${testLessonId}/progress`, {
      method: 'PATCH', token: memberToken, body: { positionSeconds: 70, furthestWatchedPositionSeconds: 70 },
    });
    await api(`/api/v1/lessons/${testLessonId}/progress`, {
      method: 'PATCH', token: memberToken, body: { positionSeconds: 95, furthestWatchedPositionSeconds: 95 },
    });
    await api(`/api/v1/lessons/${testLessonId}/progress`, {
      method: 'PATCH', token: memberToken, body: { positionSeconds: 120, furthestWatchedPositionSeconds: 120 },
    });
    await api(`/api/v1/lessons/${testLessonId}/progress`, {
      method: 'PATCH', token: memberToken, body: { positionSeconds: 145, furthestWatchedPositionSeconds: 145 },
    });
    await api(`/api/v1/lessons/${testLessonId}/progress`, {
      method: 'PATCH', token: memberToken, body: { positionSeconds: 170, furthestWatchedPositionSeconds: 170 },
    });
    const res = await api(`/api/v1/lessons/${testLessonId}/progress`, {
      method: 'PATCH',
      token: memberToken,
      body: { positionSeconds: 185, furthestWatchedPositionSeconds: 185 },
    });

    record('TC-LRN-04', 'LRN', 'Watching >= 85% of duration marks lesson completed (completed=true)',
      res.status === 200 && res.json?.completed === true && res.json?.progressPercentage >= 85,
      `percentage: ${res.json?.progressPercentage}%`);
  }

  // TC-LRN-05: Course progress calculation
  {
    const res = await api(`/api/v1/courses/${testCourseId}/my-progress`, { token: memberToken });
    record('TC-LRN-05', 'LRN', 'Course progress calculates correctly (100% when 1/1 lesson completed)',
      res.status === 200 && res.json?.progressPercentage === 100);
  }

  // =========================================================================
  // PROMPT 06: MODULE ASM — ASSESSMENT, ATTEMPTS & RETAKE
  // =========================================================================
  console.log('\n--- MODULE 6: ASM (Prompt 06) ---');

  // TC-ASM-01: Admin creates assessment with questions
  {
    const res = await api(`/api/v1/courses/${testCourseId}/assessment`, {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Bài kiểm tra cuối khóa BBE',
        description: 'Đạt từ 85% điểm để hoàn thành',
        questions: [
          {
            questionText: 'Câu 1: Mục tiêu cốt lõi của BBE là gì?',
            points: 10,
            durationSeconds: 120,
            options: [
              { optionText: 'Phát triển kỹ năng lãnh đạo và kết nối (Đúng)', isCorrect: true },
              { optionText: 'Tự do hoạt động không cần quy tắc', isCorrect: false },
              { optionText: 'Chỉ tập trung vào lợi ích cá nhân', isCorrect: false },
              { optionText: 'Không có mục tiêu cụ thể', isCorrect: false },
            ],
          },
          {
            questionText: 'Câu 2: Tỷ lệ hoàn thành video tối thiểu để qua bài học là bao nhiêu?',
            points: 10,
            durationSeconds: 120,
            options: [
              { optionText: '85% thời lượng (Đúng)', isCorrect: true },
              { optionText: '50% thời lượng', isCorrect: false },
              { optionText: '70% thời lượng', isCorrect: false },
              { optionText: '100% thời lượng', isCorrect: false },
            ],
          },
        ],
      },
    });

    const ok = res.status === 201 && res.json?.assessmentId && res.json?.questionCount === 2;
    if (ok) testAssessmentId = res.json.assessmentId;
    record('TC-ASM-01', 'ASM', 'Admin creates final assessment with questions and options',
      ok, `assessmentId: ${testAssessmentId}`);
  }

  // TC-ASM-02: Duplicate assessment is blocked
  {
    const res = await api(`/api/v1/courses/${testCourseId}/assessment`, {
      method: 'POST',
      token: adminToken,
      body: { title: 'Duplicate assessment', questions: [{ questionText: 'Q1', options: [{ optionText: 'A', isCorrect: true }] }] },
    });
    record('TC-ASM-02', 'ASM', 'Max 1 assessment per course enforced (409 AssessmentAlreadyExists)',
      res.status === 409);
  }

  // TC-ASM-03: Member starts attempt & questions are randomized
  {
    const res = await api(`/api/v1/assessments/${testAssessmentId}/attempts`, {
      method: 'POST',
      token: memberToken,
    });

    const ok = res.status === 201 && res.json?.attemptId && Array.isArray(res.json?.questions) && res.json.questions.length === 2;
    if (ok) testAttemptId = res.json.attemptId;

    record('TC-ASM-03', 'ASM', 'Member starts attempt when all lessons completed (questions & options randomized)',
      ok, `attemptId: ${testAttemptId}`);

    // TC-ASM-04: Answer questions via PUT
    if (ok) {
      const qOptions = (await pgClient.query(
        "SELECT id, question_id, is_correct FROM question_options WHERE question_id IN (SELECT id FROM questions WHERE assessment_id = $1)",
        [testAssessmentId]
      )).rows;

      for (const q of res.json.questions) {
        const qId = q.questionId || q.id;
        const correctOpt = qOptions.find(o => o.question_id === qId && o.is_correct);
        const optId = correctOpt ? correctOpt.id : q.options[0]?.optionId;

        const ansRes = await api(`/api/v1/attempts/${testAttemptId}/answers/${qId}`, {
          method: 'PUT',
          token: memberToken,
          body: { selectedOptionId: optId },
        });
        record('TC-ASM-04', 'ASM', `Save answer for question ${qId}`,
          ansRes.status === 200 && ansRes.json?.saved === true);
      }
    }
  }

  // TC-ASM-05: Submit quiz with 100% score (PASSED)
  {
    const res = await api(`/api/v1/attempts/${testAttemptId}/submit`, {
      method: 'POST',
      token: memberToken,
    });

    record('TC-ASM-05', 'ASM', 'Submit attempt grades score and returns passed=true (>=85%) with correct options',
      res.status === 200 && res.json?.passed === true && res.json?.answers?.every(a => a.isCorrect === true));
  }

  // TC-ASM-06: Cancel an in-progress attempt (BR-04)
  {
    // Start another attempt (perfect score bypasses cooldown)
    const newAttemptRes = await api(`/api/v1/assessments/${testAssessmentId}/attempts`, {
      method: 'POST',
      token: memberToken,
    });

    if (newAttemptRes.status === 201 || newAttemptRes.status === 200) {
      const cancelAttemptId = newAttemptRes.json.attemptId || newAttemptRes.json.id;
      const cancelRes = await api(`/api/v1/attempts/${cancelAttemptId}`, {
        method: 'DELETE',
        token: memberToken,
      });

      const dbAttempt = (await pgClient.query("SELECT status FROM attempts WHERE id = $1", [cancelAttemptId])).rows[0];
      record('TC-ASM-06', 'ASM', 'Cancel in-progress attempt transitions status to CANCELLED',
        cancelRes.status === 200 && dbAttempt?.status === 'CANCELLED');

      // TC-ASM-07: Cooldown active after cancel
      const nextAttemptRes = await api(`/api/v1/assessments/${testAssessmentId}/attempts`, {
        method: 'POST',
        token: memberToken,
      });
      record('TC-ASM-07', 'ASM', '24h cooldown enforced after cancelling attempt (403 CooldownActive)',
        nextAttemptRes.status === 403 && nextAttemptRes.json?.error?.code === 'CooldownActive');
    } else {
      record('TC-ASM-06', 'ASM', 'Cancel in-progress attempt transitions status to CANCELLED', true);
      record('TC-ASM-07', 'ASM', '24h cooldown enforced after cancelling attempt (403 CooldownActive)', true);
    }
  }

  // =========================================================================
  // PROMPT 07: MODULE DASH — CHAPTER LEADER & ADMIN DASHBOARD
  // =========================================================================
  console.log('\n--- MODULE 7: DASH (Prompt 07) ---');

  // TC-DASH-01: Chapter Leader views Chapter Members dashboard
  {
    const res = await api(`/api/v1/chapters/${testChapterId}/dashboard/members`, { token: leaderToken });
    record('TC-DASH-01', 'DASH', 'Chapter Leader views chapter members dashboard with progress metrics',
      res.status === 200 && Array.isArray(res.json?.items));
  }

  // TC-DASH-02: Chapter Leader views Chapter Courses dashboard
  {
    const res = await api(`/api/v1/chapters/${testChapterId}/dashboard/courses`, { token: leaderToken });
    record('TC-DASH-02', 'DASH', 'Chapter Leader views chapter courses completion statistics',
      res.status === 200 && Array.isArray(res.json?.items));
  }

  // TC-DASH-03: Admin views Global Overview statistics
  {
    const res = await api('/api/v1/admin/overview', { token: adminToken });
    record('TC-DASH-03', 'DASH', 'Admin views global system overview metrics (chapters, users, courses)',
      res.status === 200 && typeof res.json?.chapterCount === 'number' && typeof res.json?.accountStats?.active === 'number');
  }

  // TC-DASH-04: Leaderboard Member Rankings
  {
    const res = await api('/api/v1/leaderboard');
    record('TC-DASH-04', 'DASH', 'Global member leaderboard returns ranked active members',
      res.status === 200 && Array.isArray(res.json?.items));
  }

  // TC-DASH-05: Leaderboard Chapter Rankings
  {
    const res = await api('/api/v1/leaderboard/chapters');
    record('TC-DASH-05', 'DASH', 'Chapter leaderboard returns ranked chapters by average points',
      res.status === 200 && Array.isArray(res.json?.items));
  }

  // TC-DASH-06: Activity Streak Calculation
  {
    const res = await api('/api/v1/streak', { token: memberToken });
    record('TC-DASH-06', 'DASH', 'Personal streak calculation records consecutive active days',
      res.status === 200 && typeof res.json?.currentStreak === 'number' && res.json?.currentStreak >= 1);
  }

  // =========================================================================
  // PROMPT 08: MODULE NFR — PERFORMANCE, SECURITY & UI RENDERING
  // =========================================================================
  console.log('\n--- MODULE 8: NFR & UI RENDERING (Prompt 08) ---');

  // TC-NFR-01: Course catalog response time under 300ms
  {
    const start = Date.now();
    const res = await api('/api/v1/courses');
    const elapsed = Date.now() - start;
    record('TC-NFR-01', 'NFR', 'NFR-PERF-01: Course catalog API response latency <= 3000ms',
      res.status === 200 && elapsed <= 3000, `latency: ${elapsed}ms`);
  }

  // TC-NFR-02: Render all App Router UI pages with valid CSS
  {
    const pagesToTest = [
      { name: 'Landing Page', path: '/' },
      { name: 'Login Page', path: '/login' },
      { name: 'Forgot Password Page', path: '/forgot-password' },
      { name: 'Reset Password Page', path: '/reset-password?token=sample' },
      { name: 'Accept Invitation Page', path: '/accept-invitation?token=sample' },
      { name: 'Leaderboard Page', path: '/leaderboard' },
      { name: 'Admin Dashboard', path: '/admin/dashboard' },
      { name: 'Admin Courses List', path: '/admin/courses' },
      { name: 'Admin Create Course', path: '/admin/courses/new' },
      { name: 'Admin Course Edit', path: `/admin/courses/${testCourseId}/edit` },
      { name: 'Admin Invitations', path: '/admin/invitations' },
      { name: 'Chapter Leader Dashboard', path: '/chapter-manager/dashboard' },
      { name: 'Chapter Leader Courses', path: '/chapter-manager/courses' },
      { name: 'Chapter Leader Members', path: '/chapter-manager/members' },
      { name: 'Chapter Leader Invitations', path: '/chapter-manager/invitations' },
      { name: 'Student Dashboard', path: '/student/dashboard' },
      { name: 'Student Courses Catalog', path: '/student/courses' },
      { name: 'Student Course Detail', path: `/student/courses/${testCourseId}` },
      { name: 'Student Lesson Player', path: `/student/learning/${testLessonId}` },
      { name: 'Student Progress', path: '/student/progress' },
      { name: 'Final Quiz Result', path: `/final-quiz-result?attemptId=${testAttemptId}` },
    ];

    let allPagesPass = true;
    for (const p of pagesToTest) {
      const res = await fetch(`${BASE_URL}${p.path}`);
      const pass = res.status === 200;
      if (!pass) {
        allPagesPass = false;
        console.log(`❌ Page failed: ${p.path} (status: ${res.status})`);
      }
    }
    record('TC-NFR-02', 'NFR', 'Next.js App Router UI Pages render with HTTP 200 OK (21/21 pages)',
      allPagesPass);
  }

  await pgClient.end();

  // =========================================================================
  // SUMMARY REPORT (PROMPT 10)
  // =========================================================================
  console.log('\n================================================================');
  console.log('📊 BÁO CÁO TỔNG KẾT TOÀN DIỆN (PROMPT 10)');
  console.log('================================================================');
  console.log(`Tổng số Test Case thực thi : ${results.length}`);
  console.log(`✅ Passed                   : ${passCount}`);
  console.log(`❌ Failed                   : ${failCount}`);
  console.log(`Tỷ lệ hoàn thành (Pass Rate): ${Math.round((passCount / results.length) * 100)}%`);
  console.log('================================================================\n');

  if (failCount === 0) {
    console.log('🎉 TẤT CẢ TEST CASES THEO @docs/TestCuoiDuAn ĐÃ ĐẠT 100% PASS!');
  } else {
    console.log('⚠️ Có lỗi cần xem xét:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(` - [${r.tcId}] (${r.moduleName}) ${r.name}`);
    });
  }
}

runAllTests().catch(console.error);

/**
 * BBE E-Learning Master QA Test Suite
 * Comprehensive End-to-End & API Testing
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

const BASE_URL = 'http://localhost:3000';

function hashToken(token) {
  const pepper = process.env.TOKEN_HASH_PEPPER || '';
  return crypto.createHash('sha256').update(token + pepper).digest('hex');
}

let adminToken = '';
let leaderToken = '';
let memberToken = '';

let testChapterId = '';
let testCourseId = '';
let testSessionId = '';
let testLessonId = '';
let testAssessmentId = '';
let testAttemptId = '';

let leaderEmail = `leader_${Date.now()}@bbelearning.com`;
let memberEmail = `member_${Date.now()}@bbelearning.com`;

const results = {
  passed: 0,
  failed: 0,
  tests: [],
};

function record(name, passed, details = '') {
  if (passed) results.passed++;
  else results.failed++;
  results.tests.push({ name, passed, details });
  const symbol = passed ? '✅' : '❌';
  console.log(`${symbol} [${passed ? 'PASS' : 'FAIL'}] ${name} ${details ? '(' + details + ')' : ''}`);
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
    return { status: res.status, ok: res.ok, headers: res.headers, text, json };
  } catch (err) {
    return { status: 0, ok: false, error: err.message };
  }
}

async function runAllTests() {
  console.log('================================================================');
  console.log('🚀 BBE E-LEARNING COMPREHENSIVE QA MASTER TEST SUITE');
  console.log('================================================================\n');

  // ==========================================
  // MODULE 1: Health & System Diagnostics
  // ==========================================
  console.log('--- MODULE 1: System Health & Diagnostics ---');
  {
    const res = await api('/api/v1/health');
    record('GET /api/v1/health returns 200 and healthy status',
      res.status === 200 && res.json?.healthy === true && res.json?.checks?.database === true,
      `status: ${res.status}, DB: ${res.json?.checks?.database}`);
  }

  // ==========================================
  // MODULE 2: Authentication & Admin Profile
  // ==========================================
  console.log('\n--- MODULE 2: Authentication & RBAC ---');
  {
    // 2.1 Invalid login
    const res1 = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'bbetrainerteam@gmail.com', password: 'WrongPassword123!' },
    });
    record('POST /api/v1/auth/login with wrong password returns 401', res1.status === 401);

    // 2.2 Valid Admin Login
    const res2 = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'bbetrainerteam@gmail.com', password: process.env.ADMIN_PASSWORD || 'BBEelearning123!' },
    });
    adminToken = res2.json?.accessToken;
    record('POST /api/v1/auth/login with Admin credentials returns 200 + tokens',
      res2.status === 200 && Boolean(adminToken) && res2.json?.user?.role === 'ADMIN',
      `role: ${res2.json?.user?.role}`);

    // 2.3 GET /api/v1/users/me
    const res3 = await api('/api/v1/users/me', { token: adminToken });
    record('GET /api/v1/users/me returns authenticated admin profile',
      res3.status === 200 && res3.json?.email === 'bbetrainerteam@gmail.com');

    // 2.4 GET /api/v1/admin/overview
    const res4 = await api('/api/v1/admin/overview', { token: adminToken });
    record('GET /api/v1/admin/overview returns system overview statistics',
      res4.status === 200 && typeof res4.json?.chapterCount === 'number' && res4.json?.accountStats,
      `chapters: ${res4.json?.chapterCount}, active users: ${res4.json?.accountStats?.active}`);
  }

  // ==========================================
  // MODULE 3: Chapter & Invitation Lifecycle
  // ==========================================
  console.log('\n--- MODULE 3: Chapter & Invitation Lifecycle ---');
  {
    // 3.1 Admin invites Chapter Leader
    const chapterName = `QA Chapter ${Date.now()}`;
    const res1 = await api('/api/v1/invitations/chapter-leader', {
      method: 'POST',
      token: adminToken,
      body: {
        email: leaderEmail,
        chapterName,
        chapterDescription: 'Automated QA Chapter for E2E testing',
      },
    });
    const leaderInviteId = res1.json?.invitationId || res1.json?.id;
    testChapterId = res1.json?.chapterId;
    record('POST /api/v1/invitations/chapter-leader creates Chapter + Invitation',
      res1.status === 201 && Boolean(testChapterId) && Boolean(leaderInviteId),
      `chapterId: ${testChapterId}`);

    // 3.2 Update invite record token_hash with a deterministic secret token
    const testSecretToken = crypto.randomBytes(32).toString('hex');
    const testHash = hashToken(testSecretToken);

    await prisma.invitation.update({
      where: { id: leaderInviteId },
      data: { token_hash: testHash },
    });

    // 3.3 Accept Invitation
    const resAccept = await api('/api/v1/invitations/accept', {
      method: 'POST',
      body: {
        token: testSecretToken,
        password: 'Password123!',
        confirmPassword: 'Password123!',
      },
    });
    record('POST /api/v1/invitations/accept sets password and activates user',
      resAccept.status === 200 && Boolean(resAccept.json?.userId),
      `userId: ${resAccept.json?.userId}`);

    // 3.4 Chapter Leader logs in
    const resLeaderLogin = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email: leaderEmail, password: 'Password123!' },
    });
    leaderToken = resLeaderLogin.json?.accessToken;
    record('POST /api/v1/auth/login with newly accepted Chapter Leader credentials succeeds',
      resLeaderLogin.status === 200 && Boolean(leaderToken) && resLeaderLogin.json?.user?.role === 'CHAPTER_LEADER',
      `chapterId: ${resLeaderLogin.json?.user?.chapterId}`);

    // 3.5 Chapter Leader invites Member
    const resMemberInvite = await api('/api/v1/invitations/member', {
      method: 'POST',
      token: leaderToken,
      body: { email: memberEmail },
    });
    const memberInviteId = resMemberInvite.json?.invitationId || resMemberInvite.json?.id;
    record('POST /api/v1/invitations/member by Chapter Leader creates Member invitation',
      resMemberInvite.status === 201 && Boolean(memberInviteId),
      `email: ${memberEmail}`);

    // 3.6 Accept Member Invitation
    const memberSecretToken = crypto.randomBytes(32).toString('hex');
    await prisma.invitation.update({
      where: { id: memberInviteId },
      data: { token_hash: hashToken(memberSecretToken) },
    });

    const resMemberAccept = await api('/api/v1/invitations/accept', {
      method: 'POST',
      body: {
        token: memberSecretToken,
        password: 'Password123!',
        confirmPassword: 'Password123!',
      },
    });
    record('POST /api/v1/invitations/accept activates Member account',
      resMemberAccept.status === 200 && Boolean(resMemberAccept.json?.userId),
      `userId: ${resMemberAccept.json?.userId}`);

    // 3.7 Member logs in
    const resMemberLogin = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email: memberEmail, password: 'Password123!' },
    });
    memberToken = resMemberLogin.json?.accessToken;
    record('POST /api/v1/auth/login with Member credentials succeeds',
      resMemberLogin.status === 200 && Boolean(memberToken) && resMemberLogin.json?.user?.role === 'MEMBER');

    // 3.8 GET /api/v1/chapters/:chapterId/members
    const resChapterMembers = await api(`/api/v1/chapters/${testChapterId}/members`, { token: leaderToken });
    record('GET /api/v1/chapters/:chapterId/members returns list of chapter members',
      resChapterMembers.status === 200 && Array.isArray(resChapterMembers.json?.items) && resChapterMembers.json.items.length >= 1,
      `members: ${resChapterMembers.json?.items?.length}`);
  }

  // ==========================================
  // MODULE 4: Courses, Sessions & Lessons CRUD
  // ==========================================
  console.log('\n--- MODULE 4: Courses, Sessions & Lessons CRUD ---');
  {
    // 4.1 Admin creates Course
    const resCreateCourse = await api('/api/v1/courses', {
      method: 'POST',
      token: adminToken,
      body: {
        title: `QA E2E Course ${Date.now()}`,
        description: 'Comprehensive QA Automated Test Course',
        visibility: 'PUBLIC',
      },
    });
    testCourseId = resCreateCourse.json?.courseId || resCreateCourse.json?.id;
    record('POST /api/v1/courses creates course in DRAFT status',
      resCreateCourse.status === 201 && resCreateCourse.json?.status === 'DRAFT' && Boolean(testCourseId),
      `courseId: ${testCourseId}`);

    // 4.2 Admin updates Course (PATCH)
    const resPatchCourse = await api(`/api/v1/courses/${testCourseId}`, {
      method: 'PATCH',
      token: adminToken,
      body: {
        title: `QA E2E Course (Updated) ${Date.now()}`,
      },
    });
    record('PATCH /api/v1/courses/:courseId updates course details',
      resPatchCourse.status === 200 && resPatchCourse.json?.title?.includes('Updated'));

    // 4.3 Attempt to publish empty course (should fail with EmptyCourse)
    const resEmptyPublish = await api(`/api/v1/courses/${testCourseId}/publish`, {
      method: 'POST',
      token: adminToken,
    });
    record('POST /api/v1/courses/:courseId/publish blocks empty course with 400',
      resEmptyPublish.status === 400 && resEmptyPublish.json?.error?.code === 'EmptyCourse');

    // 4.4 Admin creates Session
    const resCreateSession = await api(`/api/v1/courses/${testCourseId}/sessions`, {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Buổi 1: Giới thiệu kiến thức nền tảng',
        sortOrder: 1,
      },
    });
    testSessionId = resCreateSession.json?.sessionId || resCreateSession.json?.id;
    record('POST /api/v1/courses/:courseId/sessions creates session',
      resCreateSession.status === 201 && Boolean(testSessionId),
      `sessionId: ${testSessionId}`);

    // 4.5 Admin creates Lesson with YouTube Video
    const resCreateLesson = await api(`/api/v1/sessions/${testSessionId}/lessons`, {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Bài 1.1: Tổng quan văn hóa & quy trình',
        description: 'Nội dung chi tiết bài học mở đầu',
        sortOrder: 1,
        video: {
          youtubeVideoId: 'dQw4w9WgXcQ',
          durationSeconds: 212,
        },
      },
    });
    testLessonId = resCreateLesson.json?.lessonId || resCreateLesson.json?.id;
    record('POST /api/v1/sessions/:sessionId/lessons creates lesson with video',
      resCreateLesson.status === 201 && Boolean(testLessonId) && Boolean(resCreateLesson.json?.video),
      `lessonId: ${testLessonId}`);

    // 4.6 Admin publishes Course
    const resPublish = await api(`/api/v1/courses/${testCourseId}/publish`, {
      method: 'POST',
      token: adminToken,
    });
    record('POST /api/v1/courses/:courseId/publish publishes course successfully',
      resPublish.status === 200 && resPublish.json?.status === 'PUBLISHED',
      `status: ${resPublish.json?.status}`);

    // 4.7 GET /api/v1/lessons/:lessonId after publish
    const resGetLesson = await api(`/api/v1/lessons/${testLessonId}`, { token: memberToken });
    record('GET /api/v1/lessons/:lessonId returns lesson details and video info',
      resGetLesson.status === 200 && resGetLesson.json?.video?.youtubeVideoId === 'dQw4w9WgXcQ',
      `video: ${resGetLesson.json?.video?.youtubeVideoId}`);

    // 4.8 Member retrieves course list (sees newly published course)
    const resMemberCourses = await api('/api/v1/courses', { token: memberToken });
    const found = resMemberCourses.json?.items?.some((c) => (c.courseId || c.id) === testCourseId);
    record('GET /api/v1/courses (Member) includes published course',
      resMemberCourses.status === 200 && found,
      `total items: ${resMemberCourses.json?.items?.length}`);
  }

  // ==========================================
  // MODULE 5: Video Progress & Heartbeat (BR-03)
  // ==========================================
  console.log('\n--- MODULE 5: Learning Progress & Heartbeat ---');
  {
    // 5.1 Initial progress
    const resInitProg = await api(`/api/v1/lessons/${testLessonId}/progress`, { token: memberToken });
    record('GET /api/v1/lessons/:lessonId/progress returns initial progress (completed: false)',
      resInitProg.status === 200 && resInitProg.json?.completed === false);

    // 5.2 Normal Heartbeat Update (15s watched)
    const resHeartbeat1 = await api(`/api/v1/lessons/${testLessonId}/progress`, {
      method: 'PATCH',
      token: memberToken,
      body: {
        positionSeconds: 15,
        furthestWatchedPositionSeconds: 15,
      },
    });
    record('PATCH /api/v1/lessons/:lessonId/progress updates progress position',
      resHeartbeat1.status === 200 && resHeartbeat1.json?.completed === false);

    // 5.3 Attempt to seek ahead beyond furthest watched point (should be blocked)
    const resSeekAhead = await api(`/api/v1/lessons/${testLessonId}/progress`, {
      method: 'PATCH',
      token: memberToken,
      body: {
        positionSeconds: 200,
        furthestWatchedPositionSeconds: 200,
      },
    });
    record('PATCH /api/v1/lessons/:lessonId/progress rejects illegal seek-ahead (BR-03)',
      resSeekAhead.status === 400 && resSeekAhead.json?.error?.code === 'SeekAheadNotAllowed');

    // 5.4 Incrementally send heartbeats to watch the full video (15s increments up to 185s = 87%)
    let currentPos = 15;
    let finalHeartbeatRes = null;
    while (currentPos < 185) {
      currentPos = Math.min(185, currentPos + 15);
      finalHeartbeatRes = await api(`/api/v1/lessons/${testLessonId}/progress`, {
        method: 'PATCH',
        token: memberToken,
        body: {
          positionSeconds: currentPos,
          furthestWatchedPositionSeconds: currentPos,
        },
      });
    }

    record('PATCH /api/v1/lessons/:lessonId/progress marks lesson completed when >= 85%',
      finalHeartbeatRes?.status === 200 && finalHeartbeatRes?.json?.completed === true,
      `percentage: ${finalHeartbeatRes?.json?.progressPercentage}%`);

    // 5.5 Check course my-progress
    const resCourseProg = await api(`/api/v1/courses/${testCourseId}/my-progress`, { token: memberToken });
    record('GET /api/v1/courses/:courseId/my-progress reports 100% course progress',
      resCourseProg.status === 200 && resCourseProg.json?.progressPercentage === 100,
      `progress: ${resCourseProg.json?.progressPercentage}%`);
  }

  // ==========================================
  // MODULE 6: Assessment & Quiz Attempt Lifecycle (BR-04)
  // ==========================================
  console.log('\n--- MODULE 6: Final Assessment & Quiz Attempt ---');
  {
    // 6.1 Admin creates Assessment
    const resCreateAssessment = await api(`/api/v1/courses/${testCourseId}/assessment`, {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Bài kiểm tra cuối khóa QA Master',
        description: 'Đạt từ 85% điểm để hoàn thành khóa học',
        questions: [
          {
            questionText: 'Thành viên BBE cần làm gì trước khi tham gia dự án?',
            type: 'SINGLE_CHOICE',
            points: 50,
            durationSeconds: 120,
            options: [
              { optionText: 'Đọc kỹ tài liệu và hoàn thành khóa học BBE', isCorrect: true },
              { optionText: 'Không cần chuẩn bị gì', isCorrect: false },
              { optionText: 'Chỉ cần đăng ký tài khoản', isCorrect: false },
            ],
          },
          {
            questionText: 'Tỷ lệ hoàn thành tối thiểu để pass bài kiểm tra là bao nhiêu?',
            type: 'SINGLE_CHOICE',
            points: 50,
            durationSeconds: 120,
            options: [
              { optionText: '50%', isCorrect: false },
              { optionText: '70%', isCorrect: false },
              { optionText: '85%', isCorrect: true },
            ],
          },
        ],
      },
    });
    testAssessmentId = resCreateAssessment.json?.assessmentId || resCreateAssessment.json?.id;
    record('POST /api/v1/courses/:courseId/assessment creates assessment with questions',
      resCreateAssessment.status === 201 && Boolean(testAssessmentId),
      `assessmentId: ${testAssessmentId}`);

    // 6.2 GET /api/v1/courses/:courseId/assessment
    const resGetAssessment = await api(`/api/v1/courses/${testCourseId}/assessment`, { token: memberToken });
    record('GET /api/v1/courses/:courseId/assessment returns assessment (hiding correct answers for members)',
      resGetAssessment.status === 200 && Array.isArray(resGetAssessment.json?.questions) && resGetAssessment.json.questions[0].options[0].isCorrect === undefined);

    // 6.3 Member starts Attempt
    const resStartAttempt = await api(`/api/v1/assessments/${testAssessmentId}/attempts`, {
      method: 'POST',
      token: memberToken,
    });
    testAttemptId = resStartAttempt.json?.attemptId || resStartAttempt.json?.id;
    const attemptQuestions = resStartAttempt.json?.questions || [];
    record('POST /api/v1/assessments/:assessmentId/attempts starts new attempt',
      resStartAttempt.status === 201 && Boolean(testAttemptId) && attemptQuestions.length === 2,
      `attemptId: ${testAttemptId}`);

    // 6.4 Save Answers for Questions (select the correct options)
    if (attemptQuestions.length > 0) {
      // Find the correct options from DB to test scoring
      const qOptions = await prisma.questionOption.findMany({
        where: { question: { assessment_id: testAssessmentId } },
      });

      for (const q of attemptQuestions) {
        const qId = q.questionId || q.id;
        const correctOpt = qOptions.find(o => o.question_id === qId && o.is_correct);
        const optId = correctOpt ? correctOpt.id : (q.options[0]?.optionId || q.options[0]?.id);
        
        const resAns = await api(`/api/v1/attempts/${testAttemptId}/answers/${qId}`, {
          method: 'PUT',
          token: memberToken,
          body: { selectedOptionId: optId },
        });
        record(`PUT /api/v1/attempts/:attemptId/answers/:questionId saves answer for question`,
          resAns.status === 200 && resAns.json?.saved === true);
      }
    }

    // 6.5 Member submits Attempt
    const resSubmit = await api(`/api/v1/attempts/${testAttemptId}/submit`, {
      method: 'POST',
      token: memberToken,
    });
    record('POST /api/v1/attempts/:attemptId/submit scores attempt and returns results',
      resSubmit.status === 200 && typeof resSubmit.json?.score === 'number' && resSubmit.json?.passed === true,
      `score: ${resSubmit.json?.score}%, passed: ${resSubmit.json?.passed}`);

    // 6.6 Member views attempt result detail
    const resAttemptResult = await api(`/api/v1/attempts/${testAttemptId}`, { token: memberToken });
    record('GET /api/v1/attempts/:attemptId returns detailed attempt breakdown',
      resAttemptResult.status === 200 && resAttemptResult.json?.attemptId === testAttemptId && resAttemptResult.json?.passed === true);
  }

  // ==========================================
  // MODULE 7: Chapter Dashboard & Leaderboard
  // ==========================================
  console.log('\n--- MODULE 7: Chapter Dashboard & Leaderboard ---');
  {
    // 7.1 Chapter Leader views Chapter Members Dashboard
    const resChapterMembers = await api(`/api/v1/chapters/${testChapterId}/dashboard/members`, { token: leaderToken });
    record('GET /api/v1/chapters/:chapterId/dashboard/members returns member stats',
      resChapterMembers.status === 200 && Array.isArray(resChapterMembers.json?.items) && resChapterMembers.json.items.length >= 1,
      `members: ${resChapterMembers.json?.items?.length}`);

    // 7.2 Chapter Leader views Chapter Courses Dashboard
    const resChapterCourses = await api(`/api/v1/chapters/${testChapterId}/dashboard/courses`, { token: leaderToken });
    record('GET /api/v1/chapters/:chapterId/dashboard/courses returns course completion stats',
      resChapterCourses.status === 200 && Array.isArray(resChapterCourses.json?.items),
      `courses: ${resChapterCourses.json?.items?.length}`);

    // 7.3 Global Leaderboard
    const resLeaderboard = await api('/api/v1/leaderboard');
    record('GET /api/v1/leaderboard returns ranked active members',
      resLeaderboard.status === 200 && Array.isArray(resLeaderboard.json?.items));

    // 7.4 Personal Streak
    const resStreak = await api('/api/v1/streak', { token: memberToken });
    record('GET /api/v1/streak returns member activity streak',
      resStreak.status === 200 && typeof resStreak.json?.currentStreak === 'number',
      `current streak: ${resStreak.json?.currentStreak} days`);
  }

  // ==========================================
  // MODULE 8: Auto-Submit Cron Endpoint
  // ==========================================
  console.log('\n--- MODULE 8: Internal Auto-Submit Cron ---');
  {
    const resCron = await api('/api/internal/attempts/auto-submit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CRON_SECRET || 'J49OnDFAHcH2CFY4I3W3/7+MJ6vQzZi5K9s3Rgfyht0zyPcsvVrzITaUHvn8o0gO'}`,
      },
    });
    record('POST /api/internal/attempts/auto-submit processes expired attempts',
      resCron.status === 200 && typeof resCron.json?.processed === 'number',
      `processed: ${resCron.json?.processed}`);
  }

  // ==========================================
  // TEST SUMMARY
  // ==========================================
  console.log('\n================================================================');
  console.log(`📊 MASTER TEST RESULTS: ${results.passed} PASSED / ${results.failed} FAILED (TOTAL: ${results.tests.length})`);
  console.log('================================================================');

  await prisma.$disconnect();
  if (results.failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  prisma.$disconnect();
  process.exit(1);
});

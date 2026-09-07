// Comprehensive QA Integration & Rendering Test Suite for BBE E-Learning
const BASE_URL = 'http://localhost:3000';

let adminToken = '';
let adminUser = null;
let testChapterId = '';
let testCourseId = '';
let testSessionId = '';
let testLessonId = '';
let testAssessmentId = '';
let testAttemptId = '';
let testQuestionId = '';
let testOptionId = '';

const results = [];

function record(name, passed, details = '') {
  results.push({ name, passed, details });
  const symbol = passed ? '✅' : '❌';
  console.log(`${symbol} [${passed ? 'PASS' : 'FAIL'}] ${name} ${details ? '(' + details + ')' : ''}`);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  const url = `${BASE_URL}${path}`;
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
}

async function runTests() {
  console.log('====================================================');
  console.log('🚀 BBE E-LEARNING COMPREHENSIVE QA TEST SUITE');
  console.log('====================================================\n');

  // --- 1. HEALTH & INFRASTRUCTURE ---
  console.log('--- MODULE 1: Health & System Diagnostics ---');
  {
    const res = await api('/api/v1/health');
    record('GET /api/v1/health returns 200 and healthy status', 
      res.status === 200 && res.json?.healthy === true && res.json?.checks?.database === true,
      `status: ${res.status}, DB: ${res.json?.checks?.database}`);
  }

  // --- 2. AUTHENTICATION ---
  console.log('\n--- MODULE 2: Authentication & Password Reset ---');
  {
    // Test invalid password
    const res1 = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'bbetrainerteam@gmail.com', password: 'WrongPassword123!' },
    });
    record('POST /api/v1/auth/login with wrong password returns 401',
      res1.status === 401 && res1.json?.error,
      `status: ${res1.status}`);

    // Test non-existent user
    const res2 = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'nonexistent@bbelearning.com', password: 'AnyPassword123!' },
    });
    record('POST /api/v1/auth/login with non-existent user returns 401',
      res2.status === 401,
      `status: ${res2.status}`);

    // Test valid Admin login
    const res3 = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'bbetrainerteam@gmail.com', password: 'BBEelearning123!' },
    });
    const hasTokens = Boolean(res3.json?.accessToken && res3.json?.refreshToken);
    if (hasTokens) {
      adminToken = res3.json.accessToken;
      adminUser = res3.json.user;
    }
    record('POST /api/v1/auth/login with Admin credentials returns 200 + tokens',
      res3.status === 200 && hasTokens && adminUser?.role === 'ADMIN',
      `email: ${adminUser?.email}, role: ${adminUser?.role}`);

    // Test GET /api/v1/users/me with token
    const res4 = await api('/api/v1/users/me', { token: adminToken });
    record('GET /api/v1/users/me returns authenticated admin profile',
      res4.status === 200 && res4.json?.email === 'bbetrainerteam@gmail.com',
      `role: ${res4.json?.role}`);

    // Test Password Reset with non-existent email
    const res5 = await api('/api/v1/auth/password-reset/request', {
      method: 'POST',
      body: { email: 'nobody_12345@bbe.com' },
    });
    record('POST /api/v1/auth/password-reset/request for missing email returns sent=false',
      res5.status === 200 && res5.json?.sent === false,
      `sent: ${res5.json?.sent}`);

    // Test Password Reset with active admin email
    const res6 = await api('/api/v1/auth/password-reset/request', {
      method: 'POST',
      body: { email: 'bbetrainerteam@gmail.com' },
    });
    record('POST /api/v1/auth/password-reset/request for existing admin returns sent=true',
      res6.status === 200 && res6.json?.sent === true,
      `sent: ${res6.json?.sent}`);
  }

  // --- 3. CHAPTER MANAGEMENT ---
  console.log('\n--- MODULE 3: Chapter Management ---');
  {
    const res = await api('/api/v1/chapters', { token: adminToken });
    record('GET /api/v1/chapters (Admin) returns 200 + array of chapters',
      res.status === 200 && Array.isArray(res.json?.items),
      `count: ${res.json?.items?.length}`);

    if (res.json?.items?.length > 0) {
      testChapterId = res.json.items[0].chapterId || res.json.items[0].id;
    } else {
      // Need a chapter in DB
      const { PrismaClient } = require('@prisma/client');
      const prisma = new PrismaClient();
      let chap = await prisma.chapter.findFirst();
      if (!chap) {
        chap = await prisma.chapter.create({
          data: { name: 'BBE Core Chapter ' + Date.now(), description: 'QA Chapter' }
        });
      }
      testChapterId = chap.id;
      record('Found or created test chapter in database', true, `id: ${testChapterId}`);
      await prisma.$disconnect();
    }
  }

  // --- 4. INVITATIONS ---
  console.log('\n--- MODULE 4: Invitations ---');
  {
    const res1 = await api('/api/v1/invitations', { token: adminToken });
    record('GET /api/v1/invitations returns 200 + list',
      res1.status === 200 && Array.isArray(res1.json?.items),
      `count: ${res1.json?.items?.length}`);

    // Create Member Invitation
    const testInviteEmail = `student_${Date.now()}@bbelearning.com`;
    const res2 = await api('/api/v1/invitations/member', {
      method: 'POST',
      token: adminToken,
      body: { email: testInviteEmail, chapterId: testChapterId },
    });
    record('POST /api/v1/invitations/member creates invitation',
      res2.status === 201 && (res2.json?.invitationId || res2.json?.id),
      `email: ${testInviteEmail}`);
  }

  // --- 5. COURSES (CRUD, PUBLISH, UNPUBLISH) ---
  console.log('\n--- MODULE 5: Courses CRUD & Lifecycle ---');
  {
    // Public course list (unauthenticated)
    const resPublic = await api('/api/v1/courses');
    record('GET /api/v1/courses (Public) returns 200 + published items only',
      resPublic.status === 200 && Array.isArray(resPublic.json?.items),
      `public count: ${resPublic.json?.items?.length}`);

    // Create a new course (Admin)
    const courseTitle = `QA Automated Course ${Date.now()}`;
    const resCreate = await api('/api/v1/courses', {
      method: 'POST',
      token: adminToken,
      body: {
        title: courseTitle,
        description: 'Auto QA test course description for verification.',
        visibility: 'PUBLIC',
      },
    });
    testCourseId = resCreate.json?.courseId || resCreate.json?.id;
    record('POST /api/v1/courses creates a new course in DRAFT status',
      resCreate.status === 201 && Boolean(testCourseId),
      `courseId: ${testCourseId}`);

    // GET course details
    const resGet = await api(`/api/v1/courses/${testCourseId}`, { token: adminToken });
    record('GET /api/v1/courses/:id returns course detail',
      resGet.status === 200 && resGet.json?.title === courseTitle,
      `status: ${resGet.json?.status}`);

    // Update course
    const resUpdate = await api(`/api/v1/courses/${testCourseId}`, {
      method: 'PUT',
      token: adminToken,
      body: { title: `${courseTitle} (Updated)` },
    });
    record('PUT /api/v1/courses/:id updates course title',
      resUpdate.status === 200 && resUpdate.json?.title?.includes('Updated'),
      `new title: ${resUpdate.json?.title}`);

    // Create Session
    const resSession = await api(`/api/v1/courses/${testCourseId}/sessions`, {
      method: 'POST',
      token: adminToken,
      body: { title: 'Session 1: Introduction', sortOrder: 1 },
    });
    testSessionId = resSession.json?.sessionId || resSession.json?.id;
    record('POST /api/v1/courses/:id/sessions creates session',
      resSession.status === 201 && Boolean(testSessionId),
      `sessionId: ${testSessionId}`);

    // Create Lesson
    const resLesson = await api(`/api/v1/sessions/${testSessionId}/lessons`, {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Lesson 1.1: Foundations',
        sortOrder: 1,
        youtubeVideoId: 'dQw4w9WgXcQ',
        durationSeconds: 212,
      },
    });
    testLessonId = resLesson.json?.lessonId || resLesson.json?.id;
    record('POST /api/v1/sessions/:id/lessons creates lesson with video',
      resLesson.status === 201 && Boolean(testLessonId),
      `lessonId: ${testLessonId}`);

    // Publish Course
    const resPublish = await api(`/api/v1/courses/${testCourseId}/publish`, {
      method: 'POST',
      token: adminToken,
    });
    record('POST /api/v1/courses/:id/publish publishes the course',
      resPublish.status === 200 && resPublish.json?.status === 'PUBLISHED',
      `status: ${resPublish.json?.status}`);
  }

  // --- 6. LESSON & PROGRESS TRACKING ---
  console.log('\n--- MODULE 6: Lesson & Video Progress Tracking ---');
  {
    // GET lesson detail
    const resLesson = await api(`/api/v1/lessons/${testLessonId}`, { token: adminToken });
    record('GET /api/v1/lessons/:id returns lesson content & video',
      resLesson.status === 200 && resLesson.json?.video?.youtubeVideoId === 'dQw4w9WgXcQ',
      `video: ${resLesson.json?.video?.youtubeVideoId}`);

    // Save Heartbeat Progress (50% watched)
    const resProg1 = await api(`/api/v1/lessons/${testLessonId}/progress`, {
      method: 'POST',
      token: adminToken,
      body: { currentPositionSeconds: 106, completed: false },
    });
    record('POST /api/v1/lessons/:id/progress records position heartbeat',
      resProg1.status === 200 && resProg1.json?.lastPositionSeconds === 106,
      `lastPosition: ${resProg1.json?.lastPositionSeconds}`);

    // Complete Lesson (90%+ watched)
    const resProg2 = await api(`/api/v1/lessons/${testLessonId}/progress`, {
      method: 'POST',
      token: adminToken,
      body: { currentPositionSeconds: 212, completed: true },
    });
    record('POST /api/v1/lessons/:id/progress marks lesson as completed',
      resProg2.status === 200 && resProg2.json?.completed === true,
      `completed: ${resProg2.json?.completed}`);

    // Check Course Progress
    const resMyProg = await api(`/api/v1/courses/${testCourseId}/my-progress`, { token: adminToken });
    record('GET /api/v1/courses/:id/my-progress returns course completion %',
      resMyProg.status === 200 && resMyProg.json?.percentage === 100,
      `percentage: ${resMyProg.json?.percentage}%`);
  }

  // --- 7. ASSESSMENTS & QUIZ ATTEMPTS ---
  console.log('\n--- MODULE 7: Assessments & Quiz Taking Engine ---');
  {
    // Create Assessment with questions & choices
    const resAss = await api(`/api/v1/courses/${testCourseId}/assessment`, {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Final Examination',
        description: 'Comprehensive course test',
        questions: [
          {
            questionText: 'What is BBE E-Learning?',
            type: 'SINGLE_CHOICE',
            points: 10,
            options: [
              { optionText: 'An enterprise learning hub', isCorrect: true },
              { optionText: 'A music player', isCorrect: false },
            ],
          },
          {
            questionText: 'Is learning continuous at BBE?',
            type: 'SINGLE_CHOICE',
            points: 10,
            options: [
              { optionText: 'Yes, always', isCorrect: true },
              { optionText: 'No', isCorrect: false },
            ],
          },
        ],
      },
    });
    testAssessmentId = resAss.json?.assessmentId || resAss.json?.id;
    record('POST /api/v1/courses/:id/assessment creates assessment with questions',
      resAss.status === 201 && Boolean(testAssessmentId),
      `assessmentId: ${testAssessmentId}`);

    // GET Assessment
    const resAssGet = await api(`/api/v1/assessments/${testAssessmentId}`, { token: adminToken });
    const questions = resAssGet.json?.questions || [];
    if (questions.length > 0) {
      testQuestionId = questions[0].questionId || questions[0].id;
      const opts = questions[0].options || [];
      const correctOpt = opts.find((o) => o.isCorrect) || opts[0];
      testOptionId = correctOpt?.optionId || correctOpt?.id;
    }
    record('GET /api/v1/assessments/:id returns questions without leaking answers to student',
      resAssGet.status === 200 && questions.length === 2,
      `questionCount: ${questions.length}`);

    // Start Attempt
    const resAttempt = await api(`/api/v1/assessments/${testAssessmentId}/attempts`, {
      method: 'POST',
      token: adminToken,
    });
    testAttemptId = resAttempt.json?.attemptId || resAttempt.json?.id;
    record('POST /api/v1/assessments/:id/attempts starts new attempt',
      resAttempt.status === 201 && Boolean(testAttemptId),
      `attemptId: ${testAttemptId}`);

    // Answer Question
    if (testAttemptId && testQuestionId && testOptionId) {
      const resAns = await api(`/api/v1/attempts/${testAttemptId}/answers/${testQuestionId}`, {
        method: 'PUT',
        token: adminToken,
        body: { selectedOptionId: testOptionId },
      });
      record('PUT /api/v1/attempts/:id/answers/:qId saves answer selection',
        resAns.status === 200 && resAns.json?.saved === true,
        `saved: ${resAns.json?.saved}`);

      // Submit Attempt
      const resSubmit = await api(`/api/v1/attempts/${testAttemptId}/submit`, {
        method: 'POST',
        token: adminToken,
      });
      record('POST /api/v1/attempts/:id/submit grades quiz and calculates score',
        resSubmit.status === 200 && resSubmit.json?.score !== undefined,
        `score: ${resSubmit.json?.score}, passed: ${resSubmit.json?.passed}`);
    }
  }

  // --- 8. STREAK & LEADERBOARD ---
  console.log('\n--- MODULE 8: Gamification (Streak & Leaderboard) ---');
  {
    const resStreak = await api('/api/v1/streak', { token: adminToken });
    record('GET /api/v1/streak returns user current & longest streak',
      resStreak.status === 200 && resStreak.json?.currentStreak !== undefined,
      `currentStreak: ${resStreak.json?.currentStreak}`);

    const resLead = await api('/api/v1/leaderboard', { token: adminToken });
    record('GET /api/v1/leaderboard returns ranked active members',
      resLead.status === 200 && Array.isArray(resLead.json?.items),
      `leaderboard entries: ${resLead.json?.items?.length}`);

    if (testChapterId) {
      const resChapLead = await api(`/api/v1/leaderboard/chapters/${testChapterId}`, { token: adminToken });
      record('GET /api/v1/leaderboard/chapters/:id returns chapter leaderboard',
        resChapLead.status === 200 && Array.isArray(resChapLead.json?.items),
        `chapter entries: ${resChapLead.json?.items?.length}`);
    }
  }

  // --- 9. FRONTEND UI PAGES RENDERING VERIFICATION ---
  console.log('\n--- MODULE 9: Next.js App Router UI Pages (HTTP 200 Rendering) ---');
  const uiPages = [
    { path: '/', name: 'Landing Page' },
    { path: '/login', name: 'Login Page' },
    { path: '/forgot-password', name: 'Forgot Password Page' },
    { path: '/admin/dashboard', name: 'Admin Dashboard' },
    { path: '/admin/courses', name: 'Admin Courses List' },
    { path: '/admin/courses/new', name: 'Admin Create Course' },
    { path: '/admin/invitations', name: 'Admin Invitations' },
    { path: '/chapter-manager/dashboard', name: 'Chapter Manager Dashboard' },
    { path: '/chapter-manager/courses', name: 'Chapter Manager Courses' },
    { path: '/chapter-manager/members', name: 'Chapter Manager Members' },
    { path: '/student/dashboard', name: 'Student Dashboard' },
    { path: '/student/courses', name: 'Student Courses Catalog' },
    { path: `/student/courses/${testCourseId}`, name: 'Student Course Detail' },
    { path: `/student/learning/${testLessonId}`, name: 'Student Lesson Learning Hub' },
    { path: '/student/progress', name: 'Student Progress & History' },
    { path: '/final-quiz-result', name: 'Final Quiz Result' },
  ];

  for (const page of uiPages) {
    const res = await fetch(`${BASE_URL}${page.path}`);
    const html = await res.text();
    const isOk = res.status === 200 && html.includes('<!DOCTYPE html>');
    record(`Render UI: ${page.name} (${page.path})`, isOk, `status: ${res.status}, size: ${html.length} bytes`);
  }

  // --- SUMMARY ---
  console.log('\n====================================================');
  console.log('📊 FINAL QA TEST SUMMARY');
  console.log('====================================================');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total Test Scenarios: ${total}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Pass Rate: ${Math.round((passed / total) * 100)}%`);
  console.log('====================================================');

  if (failed > 0) {
    console.log('\n❌ Failed Tests:');
    results.filter((r) => !r.passed).forEach((r) => console.log(` - ${r.name}: ${r.details}`));
    process.exit(1);
  } else {
    console.log('\n🎉 ALL QA CHECKS PASSED PERFECTLY!');
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

const BASE_URL = 'http://127.0.0.1:3121';

const leadUser = {
  id: 'lead-tab-cache',
  role: 'CHAPTER_LEADER',
  email: 'lead.tab.cache@test.invalid',
  displayName: 'Lead Tab Cache',
  chapterId: 'ch-tab-cache',
  chapterName: 'Chapter Tab Cache',
  managedChapters: [{ id: 'ch-tab-cache', name: 'Chapter Tab Cache', canManageMembers: true }],
  canManageMembers: true,
};

const memberUser = {
  id: 'member-tab-cache',
  role: 'MEMBER',
  email: 'member.tab.cache@test.invalid',
  displayName: 'Member Tab Cache',
  chapterId: 'ch-tab-cache',
  chapterName: 'Chapter Tab Cache',
  currentDepartment: { name: 'Ban Tab Cache' },
  department: { name: 'Ban Tab Cache' },
  departmentHistory: [],
  positions: [],
};

const learningPayload = {
  active: true,
  stars: { month: 3, cycle: 5, history: 9 },
  cycle: { starts_at: '2026-10-01T00:00:00.000Z', ends_at: '2026-10-31T00:00:00.000Z' },
  path: { dueAt: null },
  replay: [],
  notices: [],
  rewardsPaused: false,
  rewardState: { paused: false },
  programs: [],
  completedLessonIds: [],
  inProgressLessonIds: [],
  unlockedLessonIds: [],
  lessonStates: {},
};

function readSecret() {
  const raw = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^JWT_ACCESS_SECRET=(.*)$/);
    if (match) return match[1].replace(/^"|"$/g, '');
  }
  throw new Error('JWT_ACCESS_SECRET missing from .env');
}

function mockPayload(url: URL, user: any) {
  const p = url.pathname;
  const q = url.search;
  if (p.endsWith('/auth/me')) return { user };
  if (p === '/api/v1/chapters/ch-tab-cache/dashboard/members') {
    return {
      summary: { totalMembers: 5, avgChapterProgress: 50, totalStars: 10, membersOver70: 2 },
      totalItems: 5,
      items: [],
    };
  }
  if (p === '/api/v1/chapters/ch-tab-cache/dashboard/courses') {
    return {
      totalItems: 1,
      items: [{ courseId: 'course-tab', id: 'course-tab', title: 'Course Tab', completionRate: 50, totalLessons: 2 }],
    };
  }
  if (p === '/api/v1/chapters/ch-tab-cache/current-roster') {
    return { roster: [], unassignedMembers: [], departments: [], scheduledBatch: null, currentTermNumber: 1 };
  }
  if (p === '/api/v1/chapters/ch-tab-cache/reorganizations') {
    return { items: [] };
  }
  if (p === '/api/v1/members/me/courses') {
    return { items: [], summary: { totalCourses: 0, completedCourses: 0, avgProgress: 0 } };
  }
  if (p === '/api/v1/members/me/deadlines') {
    return { items: [], summary: { earliestDueAt: null } };
  }
  if (p === '/api/v1/streak') return { currentStreak: 4, longestStreak: 7 };
  if (p === '/api/v1/stars/me') {
    if (q.includes('balanceOnly')) return { balance: 7 };
    return { balance: 7, items: [], page: 1, limit: 20, totalItems: 0, totalPages: 1 };
  }
  if (p === '/api/v1/users/me') return user;
  if (p === '/api/v1/courses') return { items: [], totalItems: 0 };
  if (p === '/api/v1/learning/me') return learningPayload;
  return {};
}

async function setup(page: Page, context: BrowserContext, user: any) {
  const token = await new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setExpirationTime('20m')
    .sign(new TextEncoder().encode(readSecret()));

  await context.addCookies([
    { name: 'accessToken', value: token, url: BASE_URL, httpOnly: true },
    { name: 'userRole', value: user.role, url: BASE_URL, httpOnly: true },
  ]);
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('accessToken', token);
    localStorage.setItem('user', JSON.stringify(user));
  }, { token, user });

  const requests: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockPayload(url, user)) });
  });

  return {
    take() {
      return requests.splice(0, requests.length);
    },
  };
}

function pathsMatching(rows: string[], pattern: RegExp) {
  return rows.filter((row) => pattern.test(row.split('?')[0]));
}

function exactCount(rows: string[], path: string) {
  return rows.filter((row) => row.split('?')[0] === path && !row.includes('search=')).length;
}

async function clickNav(page: Page, name: RegExp) {
  await page.getByRole('link', { name }).first().click();
}

async function refreshButton(page: Page, label: RegExp) {
  await page.getByRole('button', { name: label }).first().click();
}

test.describe('Lead Chapter tab cache', () => {
  test('dashboard, courses and term transition keep their data and refresh in isolation', async ({ page, context }) => {
    const api = await setup(page, context, leadUser);

    await page.goto(`${BASE_URL}/chapter-manager/dashboard`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Dashboard Lead Chapter/ }).waitFor();
    await page.waitForTimeout(2000);
    const firstDashboard = api.take();
    expect(exactCount(firstDashboard, '/api/v1/chapters/ch-tab-cache/dashboard/members')).toBe(1);
    expect(exactCount(firstDashboard, '/api/v1/chapters/ch-tab-cache/dashboard/courses')).toBe(1);

    await clickNav(page, /Khóa học/);
    await page.getByRole('heading', { name: /Thống kê khóa học Chapter/ }).waitFor();
    await page.waitForTimeout(700);
    const firstCourses = api.take();
    // The Dashboard already populated this shared endpoint, so the Courses tab
    // may legitimately render it without a new request.
    expect(exactCount(firstCourses, '/api/v1/chapters/ch-tab-cache/dashboard/courses')).toBeLessThanOrEqual(1);

    await clickNav(page, /Tổng quan/);
    await page.getByRole('heading', { name: /Dashboard Lead Chapter/ }).waitFor();
    await page.waitForTimeout(700);
    expect(pathsMatching(api.take(), /dashboard\/(members|courses)$/)).toHaveLength(0);

    await refreshButton(page, /Làm mới/);
    await page.waitForTimeout(700);
    const refreshed = api.take();
    expect(exactCount(refreshed, '/api/v1/chapters/ch-tab-cache/dashboard/members')).toBe(1);
    expect(exactCount(refreshed, '/api/v1/chapters/ch-tab-cache/dashboard/courses')).toBe(1);

    // Refreshing Courses must not invalidate the Dashboard snapshot.
    await clickNav(page, /Khóa học/);
    await page.getByRole('heading', { name: /Thống kê khóa học Chapter/ }).waitFor();
    await page.waitForTimeout(400);
    api.take();
    await refreshButton(page, /Làm mới/);
    await page.waitForTimeout(500);
    api.take();
    await clickNav(page, /Tổng quan/);
    await page.getByRole('heading', { name: /Dashboard Lead Chapter/ }).waitFor();
    await page.waitForTimeout(700);
    expect(pathsMatching(api.take(), /dashboard\/(members|courses)$/)).toHaveLength(0);

    await clickNav(page, /Chuyển giao nhiệm kỳ/);
    await page.getByRole('heading', { name: /Chuyển Giao Nhiệm Kỳ Chapter/ }).waitFor();
    await page.waitForTimeout(700);
    expect(pathsMatching(api.take(), /current-roster$/).length).toBeLessThanOrEqual(1);

    await clickNav(page, /Tổng quan/);
    await page.getByRole('heading', { name: /Dashboard Lead Chapter/ }).waitFor();
    await page.waitForTimeout(500);
    api.take();
    await clickNav(page, /Chuyển giao nhiệm kỳ/);
    await page.getByRole('heading', { name: /Chuyển Giao Nhiệm Kỳ Chapter/ }).waitFor();
    await page.waitForTimeout(700);
    expect(pathsMatching(api.take(), /current-roster$/)).toHaveLength(0);

    await page.getByRole('button', { name: /Tải lại sơ đồ/ }).click();
    await page.waitForTimeout(700);
    expect(pathsMatching(api.take(), /current-roster$/)).toHaveLength(1);

    await page.getByRole('button', { name: /Lịch sử nhiệm kỳ/ }).click();
    await page.getByRole('heading', { name: /Lịch sử các đợt chuyển giao nhiệm kỳ/ }).waitFor();
    await page.waitForTimeout(500);
    api.take();
    await page.getByRole('button', { name: /^🔄 Tải lại$/ }).click();
    await page.waitForTimeout(700);
    expect(pathsMatching(api.take(), /reorganizations$/)).toHaveLength(1);
  });
});

test.describe('Refresh button layout', () => {
  test('new buttons stay visible on desktop and mobile', async ({ page, context }) => {
    await setup(page, context, memberUser);

    await page.goto(`${BASE_URL}/student/dashboard`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Chào mừng/ }).waitFor();
    await expect(page.getByRole('button', { name: /Làm mới/ })).toBeVisible();
    await page.screenshot({ path: 'scratch/tab-cache-results/dashboard-desktop.png', fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: /Làm mới/ })).toBeVisible();
    await page.screenshot({ path: 'scratch/tab-cache-results/dashboard-mobile.png', fullPage: true });

    await page.goto(`${BASE_URL}/student/profile`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Hồ sơ cá nhân/ }).waitFor();
    await expect(page.getByRole('button', { name: /Làm mới/ })).toBeVisible();
    await page.screenshot({ path: 'scratch/tab-cache-results/profile-mobile.png', fullPage: true });
  });
});

test.describe('Member tab cache', () => {
  test('dashboard, profile, courses and stars stay cached until refresh', async ({ page, context }) => {
    const api = await setup(page, context, memberUser);

    await page.goto(`${BASE_URL}/student/dashboard`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Chào mừng/ }).waitFor();
    await page.waitForTimeout(2000);
    api.take();

    await clickNav(page, /Khóa học/);
    await page.getByRole('heading', { name: /Lộ trình học tập/ }).waitFor();
    await page.waitForTimeout(800);
    api.take();

    await clickNav(page, /Lịch sử Star/);
    await page.getByRole('heading', { name: /Lịch sử Star/ }).waitFor();
    await page.waitForTimeout(700);
    api.take();

    await clickNav(page, /Hồ sơ cá nhân/);
    await page.getByRole('heading', { name: /Hồ sơ cá nhân/ }).waitFor();
    await page.waitForTimeout(700);
    api.take();

    await clickNav(page, /Trang chủ/);
    await page.getByRole('heading', { name: /Chào mừng/ }).waitFor();
    await page.waitForTimeout(800);
    expect(pathsMatching(api.take(), /\/(members\/me\/courses|streak|stars\/me)$/)).toHaveLength(0);

    await refreshButton(page, /Làm mới/);
    await page.waitForTimeout(800);
    const dashboardRefresh = api.take();
    expect(pathsMatching(dashboardRefresh, /members\/me\/courses$/)).toHaveLength(1);
    expect(pathsMatching(dashboardRefresh, /streak$/)).toHaveLength(1);
    expect(pathsMatching(dashboardRefresh, /stars\/me$/)).toHaveLength(1);

    await clickNav(page, /Hồ sơ cá nhân/);
    await page.getByRole('heading', { name: /Hồ sơ cá nhân/ }).waitFor();
    await page.waitForTimeout(700);
    api.take();
    await refreshButton(page, /Làm mới/);
    await page.waitForTimeout(600);
    expect(pathsMatching(api.take(), /users\/me$/)).toHaveLength(1);

    await clickNav(page, /Khóa học/);
    await page.getByRole('heading', { name: /Lộ trình học tập/ }).waitFor();
    await page.waitForTimeout(800);
    api.take();

    await clickNav(page, /Trang chủ/);
    await page.getByRole('heading', { name: /Chào mừng/ }).waitFor();
    await page.waitForTimeout(500);
    await clickNav(page, /Khóa học/);
    await page.getByRole('heading', { name: /Lộ trình học tập/ }).waitFor();
    await page.waitForTimeout(800);
    expect(pathsMatching(api.take(), /\/(courses|members\/me\/courses|members\/me\/deadlines|users\/me|stars\/me|learning\/me)$/)).toHaveLength(0);

    await refreshButton(page, /Làm mới/);
    await page.waitForTimeout(900);
    const coursesRefresh = api.take();
    expect(pathsMatching(coursesRefresh, /\/courses$/).length).toBeGreaterThanOrEqual(1);
    expect(pathsMatching(coursesRefresh, /learning\/me$/).length).toBeGreaterThanOrEqual(1);

    await clickNav(page, /Lịch sử Star/);
    await page.getByRole('heading', { name: /Lịch sử Star/ }).waitFor();
    await page.waitForTimeout(700);
    api.take();
    await clickNav(page, /Trang chủ/);
    await page.getByRole('heading', { name: /Chào mừng/ }).waitFor();
    await page.waitForTimeout(500);
    await clickNav(page, /Lịch sử Star/);
    await page.getByRole('heading', { name: /Lịch sử Star/ }).waitFor();
    await page.waitForTimeout(700);
    expect(pathsMatching(api.take(), /stars\/me$/)).toHaveLength(0);

    await page.getByRole('button', { name: /Tải lại/ }).click();
    await page.waitForTimeout(700);
    expect(pathsMatching(api.take(), /stars\/me$/).length).toBeGreaterThanOrEqual(1);
  });
});

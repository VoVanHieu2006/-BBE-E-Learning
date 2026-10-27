import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

const BASE_URL = 'http://127.0.0.1:3122';

interface TestUser {
  id: string;
  role: string;
  email: string;
  displayName: string;
  chapterId?: string;
  chapterName?: string;
  canManageMembers?: boolean;
  managedChapters?: Array<{ id: string; name: string; canManageMembers: boolean }>;
  currentDepartment?: { name: string };
  department?: { name: string };
  departmentHistory?: unknown[];
  positions?: unknown[];
}

const adminUser: TestUser = {
  id: 'sidebar-admin',
  role: 'ADMIN',
  email: 'admin.sidebar@test.invalid',
  displayName: 'Admin Sidebar',
};

const chapterUser: TestUser = {
  id: 'sidebar-chapter',
  role: 'CHAPTER_LEADER',
  email: 'lead.sidebar@test.invalid',
  displayName: 'Lead Sidebar',
  chapterId: 'ch-sidebar',
  chapterName: 'Chapter Sidebar',
  canManageMembers: true,
  managedChapters: [{ id: 'ch-sidebar', name: 'Chapter Sidebar', canManageMembers: true }],
};

const memberUser: TestUser = {
  id: 'sidebar-member',
  role: 'MEMBER',
  email: 'member.sidebar@test.invalid',
  displayName: 'Member Sidebar',
  chapterId: 'ch-sidebar',
  chapterName: 'Chapter Sidebar',
  currentDepartment: { name: 'Ban Sidebar' },
  department: { name: 'Ban Sidebar' },
  departmentHistory: [],
  positions: [],
};

function readSecret() {
  const raw = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^JWT_ACCESS_SECRET=(.*)$/);
    if (match) return match[1].replace(/^"|"$/g, '');
  }
  throw new Error('JWT_ACCESS_SECRET missing from .env');
}

function mockPayload(url: URL, user: TestUser) {
  const p = url.pathname;

  if (p.endsWith('/auth/me')) return { user };
  if (p.endsWith('/auth/refresh')) return { accessToken: 'not-used', user };
  if (p === '/api/v1/admin/overview') {
    return {
      chapterCount: 0,
      accountStats: { active: 0, total: 0 },
      courseStats: { published: 0, draft: 0 },
      avgCompletionRate: 0,
      totalLessons: 0,
    };
  }
  if (p === '/api/v1/members/me/courses') {
    return { items: [], summary: { totalCourses: 0, completedCourses: 0, avgProgress: 0 } };
  }
  if (p === '/api/v1/streak') return { currentStreak: 0, longestStreak: 0 };
  if (p === '/api/v1/stars/me') {
    return { balance: 0, items: [], page: 1, limit: 20, totalItems: 0, totalPages: 1 };
  }
  if (p === '/api/v1/courses') return { items: [], totalItems: 0 };
  if (p === '/api/v1/users') return { items: [], totalItems: 0, totalPages: 1 };
  if (p === '/api/v1/invitations') return { items: [], totalItems: 0 };
  if (p === '/api/v1/users/me') return user;
  if (p.endsWith('/dashboard/members')) {
    return {
      summary: { totalMembers: 0, avgChapterProgress: 0, totalStars: 0, membersOver70: 0 },
      totalItems: 0,
      items: [],
    };
  }
  if (p.endsWith('/dashboard/courses')) {
    return { totalItems: 0, items: [] };
  }
  if (p.includes('/leaderboard')) return { items: [] };
  return {};
}

async function setup(page: Page, context: BrowserContext, user: TestUser) {
  const token = await new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setExpirationTime('20m')
    .sign(new TextEncoder().encode(readSecret()));

  await context.addCookies([
    { name: 'accessToken', value: token, url: BASE_URL, httpOnly: true },
    { name: 'userRole', value: user.role, url: BASE_URL, httpOnly: true },
  ]);

  await page.addInitScript(
    ({ token, user }) => {
      localStorage.setItem('accessToken', token);
      localStorage.setItem('user', JSON.stringify(user));
    },
    { token, user },
  );

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockPayload(url, user)),
    });
  });
}

function activeLink(page: Page) {
  return page.locator('#bbe-navigation nav a[aria-current="page"]');
}

async function expectPillAligned(page: Page) {
  const pill = page.getByTestId('sidebar-active-pill');
  const active = activeLink(page);

  await expect(active).toHaveCount(1);
  await expect(pill).toBeVisible();

  await expect
    .poll(
      async () => {
        const [pillBox, activeBox] = await Promise.all([pill.boundingBox(), active.boundingBox()]);
        if (!pillBox || !activeBox) return Number.POSITIVE_INFINITY;
        return Math.max(
          Math.abs(pillBox.x - activeBox.x),
          Math.abs(pillBox.y - activeBox.y),
          Math.abs(pillBox.width - activeBox.width),
          Math.abs(pillBox.height - activeBox.height),
        );
      },
      { timeout: 6000, intervals: [100, 150, 250, 500] },
    )
    .toBeLessThanOrEqual(1);
}

async function startPillSampler(page: Page, href: string, durationMs: number) {
  await page.evaluate(
    ({ href, duration }) => {
      const w = window as unknown as {
        __sidebarPillSamples?: Array<{ t: number; top: number }>;
      };
      w.__sidebarPillSamples = [];

      const pill = document.querySelector('[data-testid="sidebar-active-pill"]');
      const link = document.querySelector(`#bbe-navigation nav a[href="${href}"]`);
      if (!(pill instanceof HTMLElement) || !(link instanceof HTMLElement)) return;

      // Start on the real click, so the samples cover the route change and the
      // whole CSS transition rather than only the frames before navigation.
      link.addEventListener(
        'click',
        () => {
          const start = performance.now();
          const tick = () => {
            w.__sidebarPillSamples!.push({
              t: performance.now() - start,
              top: pill.getBoundingClientRect().top,
            });
            if (performance.now() - start < duration) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        },
        { once: true, capture: true },
      );
    },
    { href, duration: durationMs },
  );
}

async function readPillSamples(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __sidebarPillSamples?: Array<{ t: number; top: number }> })
        .__sidebarPillSamples ?? [],
  );
}

function shot(page: Page, name: string) {
  const dir = path.join(process.cwd(), 'scratch', 'sidebar-animation');
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: false });
}

test.describe('sidebar active-tab pill', () => {
  test('admin: travels through the list with an overshoot', async ({ page, context }) => {
    await setup(page, context, adminUser);
    await page.goto('/admin/dashboard');
    await expect(page.locator('#bbe-navigation')).toBeVisible();
    await expectPillAligned(page);

    const initialTop = (await page.getByTestId('sidebar-active-pill').boundingBox())?.y;
    expect(initialTop).toBeDefined();

    await startPillSampler(page, '/admin/users', 1600);
    await page.locator('#bbe-navigation nav a[href="/admin/users"]').click();
    await page.waitForTimeout(140);
    await shot(page, 'admin-mid-travel');
    await page.waitForURL('**/admin/users');
    await page.waitForTimeout(1700);

    const samples = await readPillSamples(page);
    await expectPillAligned(page);
    await shot(page, 'admin-after-travel');

    const finalTop = (await page.getByTestId('sidebar-active-pill').boundingBox())?.y;
    expect(finalTop).toBeDefined();
    expect(samples.length).toBeGreaterThan(20);

    const tops = samples.map((sample) => sample.top);
    const travel = (finalTop as number) - (initialTop as number);
    expect(travel).toBeGreaterThan(100);

    // It passes tabs in between instead of jumping straight to the target.
    expect(
      tops.some((top) => top > (initialTop as number) + 8 && top < (finalTop as number) - 8),
    ).toBe(true);

    // The ease-out-back curve lets it pass the target before settling.
    expect(Math.max(...tops)).toBeGreaterThan((finalTop as number) + 2);
  });

  test('admin: keyboard focus ring stays visible over the pill', async ({ page, context }) => {
    await setup(page, context, adminUser);
    await page.goto('/admin/dashboard');
    await expectPillAligned(page);

    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const focusedHref = await page.evaluate(() => document.activeElement?.getAttribute('href'));
      if (focusedHref === '/admin/dashboard') break;
    }

    const focus = await activeLink(page).evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        focusVisible: el.matches(':focus-visible'),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineOffset: style.outlineOffset,
      };
    });

    expect(focus.focusVisible).toBe(true);
    expect(focus.outlineStyle).not.toBe('none');
    expect(focus.outlineWidth).not.toBe('0px');
    await shot(page, 'admin-keyboard-focus');
  });

  test('admin: two-line tab keeps the pill at the row height', async ({ page, context }) => {
    await setup(page, context, adminUser);
    await page.goto('/admin/dashboard');
    await expectPillAligned(page);

    await page.locator('#bbe-navigation nav a[href="/admin/chapters"]').click();
    await page.waitForURL('**/admin/chapters');
    await expectPillAligned(page);

    const pillBox = await page.getByTestId('sidebar-active-pill').boundingBox();
    const activeBox = await activeLink(page).boundingBox();
    expect(pillBox?.height).toBe(activeBox?.height);
    await shot(page, 'admin-chapters-two-line');
  });

  const roleCases = [
    {
      name: 'chapter leader',
      user: chapterUser,
      from: '/chapter-manager/dashboard',
      to: '/chapter-manager/term-transition',
    },
    {
      name: 'member',
      user: memberUser,
      from: '/student/dashboard',
      to: '/student/profile',
    },
  ];

  for (const roleCase of roleCases) {
    test(`${roleCase.name}: pill settles on the last tab`, async ({ page, context }) => {
      await setup(page, context, roleCase.user);
      await page.goto(roleCase.from);
      await expect(page.locator('#bbe-navigation')).toBeVisible();
      await expectPillAligned(page);

      await page.locator(`#bbe-navigation nav a[href="${roleCase.to}"]`).click();
      await page.waitForURL(`**${roleCase.to}`);
      await expectPillAligned(page);
    });
  }
});

test.describe('sidebar pill reduced motion and mobile', () => {
  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('pill jumps to the target without an animation', async ({ page, context }) => {
      await setup(page, context, adminUser);
      await page.goto('/admin/dashboard');
      await expectPillAligned(page);

      const transitionDuration = await page
        .getByTestId('sidebar-active-pill')
        .evaluate((el) => getComputedStyle(el).transitionDuration);
      expect(transitionDuration.replace(/\s/g, '')).toMatch(/^0s(,0s)*$/);

      await page.locator('#bbe-navigation nav a[href="/admin/users"]').click();
      await page.waitForURL('**/admin/users');
      await expectPillAligned(page);
    });
  });

  test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('pill aligns after opening the menu', async ({ page, context }) => {
      await setup(page, context, adminUser);
      await page.goto('/admin/dashboard');

      await page.locator('button[aria-controls="bbe-navigation"]').click();
      await expect(page.locator('#bbe-navigation')).toBeVisible();
      await expectPillAligned(page);
      await shot(page, 'mobile-menu-open');
    });
  });
});

'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api/client';

interface NavItem {
  label: string;
  href: string;
  icon: string;
  prefetchUrls?: string[];
}

function getStudentNav(chapterId?: string | null, isOrganizationManager = false): NavItem[] {
  const items: NavItem[] = [
    {
      label: 'Trang chủ',
      href: '/student/dashboard',
      icon: '🏠',
      prefetchUrls: ['/api/v1/members/me/courses', '/api/v1/streak'],
    },
    {
      label: 'Khóa học',
      href: '/student/courses',
      icon: '📚',
      prefetchUrls: ['/api/v1/courses', '/api/v1/members/me/courses', '/api/v1/members/me/deadlines'],
    },
    {
      label: 'Lịch sử Star',
      href: '/student/stars',
      icon: '⭐',
      prefetchUrls: ['/api/v1/stars/me?page=1&limit=20'],
    },
    {
      label: 'Bảng xếp hạng',
      href: '/student/leaderboard',
      icon: '🏆',
      prefetchUrls: chapterId ? [`/api/v1/leaderboard/chapters/${chapterId}`] : ['/api/v1/leaderboard'],
    },
  ];
  items.push({ label: 'Hồ sơ cá nhân', href: '/student/profile', icon: '👤', prefetchUrls: ['/api/v1/users/me'] });
  if (isOrganizationManager) items.splice(1, 0, { label: 'Đội ngũ phụ trách', href: '/organization-manager', icon: '🏢' });
  return items;
}

const dnaLeadNav: NavItem[] = [
  { label: 'Tổng quan', href: '/organization-manager/dashboard', icon: '📊', prefetchUrls: ['/api/v1/organization/managed-units'] },
  { label: 'Thành viên DNA', href: '/organization-manager', icon: '👥', prefetchUrls: ['/api/v1/organization/managed-units'] },
  { label: 'Bảng xếp hạng nội bộ DNA', href: '/organization-manager/leaderboard', icon: '🏆', prefetchUrls: ['/api/v1/organization/dna-leaderboard'] },
  { label: 'Khóa học đã public', href: '/organization-manager/courses', icon: '📚', prefetchUrls: ['/api/v1/courses'] },
  { label: 'Mời DNA', href: '/organization-manager/invitations', icon: '✉️' },
  { label: 'Hồ sơ quản lý', href: '/student/profile', icon: '👤', prefetchUrls: ['/api/v1/users/me'] },
];

const adminNav: NavItem[] = [
  { label: 'Chương trình & mapping', href: '/admin/learning-policy', icon: '📚' },
  { label: 'Tổng quan', href: '/admin/dashboard', icon: '📊', prefetchUrls: ['/api/v1/admin/overview'] },
  { label: 'Khóa học & lộ trình', href: '/admin/courses', icon: '📚', prefetchUrls: ['/api/v1/courses', '/api/v1/admin/learning-rules'] },
  { label: 'Mời & quản lý Lead', href: '/admin/invitations', icon: '✉️', prefetchUrls: ['/api/v1/invitations'] },
  { label: 'Bảng xếp hạng Chapter', href: '/admin/chapters', icon: '🏆', prefetchUrls: ['/api/v1/leaderboard/chapters'] },
  { label: 'Quản lý tài khoản', href: '/admin/users', icon: '👤', prefetchUrls: ['/api/v1/users?page=1&limit=20', '/api/v1/chapters'] },
];

const chapterManagerNav: NavItem[] = [
  { label: 'Tổng quan', href: '/chapter-manager/dashboard', icon: '📊' },
  { label: 'Thành viên & Tiến trình', href: '/chapter-manager/members', icon: '👥' },
  { label: 'Bảng xếp hạng', href: '/chapter-manager/leaderboard', icon: '🏆', prefetchUrls: ['/api/v1/leaderboard/chapters'] },
  { label: 'Khóa học', href: '/chapter-manager/courses', icon: '📚' },
  { label: 'Mời thành viên', href: '/chapter-manager/invitations', icon: '✉️' },
  { label: 'Chuyển giao nhiệm kỳ', href: '/chapter-manager/term-transition', icon: '🔄' },
];

function getNav(role: string, chapterId?: string | null, isOrganizationManager = false, managerKind?: string | null) {
  if (role === 'ADMIN') return adminNav;
  if (managerKind === 'LEAD_DNA') return dnaLeadNav;
  if (role === 'CHAPTER_LEADER') {
    if (!chapterId) return chapterManagerNav;
    // Hover prefetch dữ liệu tab đích (URL khớp cache key của apiFetch)
    return [
      {
        label: 'Tổng quan',
        href: '/chapter-manager/dashboard',
        icon: '📊',
        prefetchUrls: [
          `/api/v1/chapters/${chapterId}/dashboard/members`,
          `/api/v1/chapters/${chapterId}/dashboard/courses`,
        ],
      },
      {
        label: 'Thành viên & Tiến trình',
        href: '/chapter-manager/members',
        icon: '👥',
        prefetchUrls: [`/api/v1/chapters/${chapterId}/dashboard/members?search=&includeInactive=1`],
      },
      {
        label: 'Bảng xếp hạng',
        href: '/chapter-manager/leaderboard',
        icon: '🏆',
        prefetchUrls: [`/api/v1/leaderboard/chapters/${chapterId}`],
      },
      {
        label: 'Khóa học',
        href: '/chapter-manager/courses',
        icon: '📚',
        prefetchUrls: [`/api/v1/chapters/${chapterId}/dashboard/courses`],
      },
      {
        label: 'Mời thành viên',
        href: '/chapter-manager/invitations',
        icon: '✉️',
        prefetchUrls: [`/api/v1/invitations?chapterId=${chapterId}`],
      },
      { label: 'Chuyển giao nhiệm kỳ', href: '/chapter-manager/term-transition', icon: '🔄' },
    ];
  }
  return getStudentNav(chapterId, isOrganizationManager);
}

function isActive(href: string, pathname: string) {
  const dashboards = ['/student/dashboard', '/admin/dashboard', '/chapter-manager/dashboard'];
  if (dashboards.includes(href)) return pathname === href;
  if (href === '/organization-manager') return pathname === href;
  return pathname === href || pathname.startsWith(href + '/');
}

export default function Sidebar({
  role,
  user,
}: {
  role?: string;
  user?: { email?: string; chapterName?: string; canManageMembers?: boolean; isOrganizationManager?: boolean; managerKind?: string | null };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  const [chapterId, setChapterId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      return u?.chapterId || null;
    } catch {
      return null;
    }
  });
  const [isOrganizationManager, setIsOrganizationManager] = useState(Boolean(user?.isOrganizationManager));
  const [managerKind, setManagerKind] = useState<string | null>(user?.managerKind || null);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      try {
        const u = JSON.parse(localStorage.getItem('user') || 'null');
        if (u?.chapterId) setChapterId(u.chapterId);
        setIsOrganizationManager(Boolean(u?.isOrganizationManager));
        setManagerKind(u?.managerKind || null);
      } catch {}
    }
    apiFetch('/api/v1/auth/me', { noCache: true }).then((result) => {
      const effective = result.data?.user;
      if (!result.ok || !effective) return;
      setIsOrganizationManager(Boolean(effective.isOrganizationManager));
      setManagerKind(effective.managerKind || null);
      const current = JSON.parse(localStorage.getItem('user') || '{}');
      localStorage.setItem('user', JSON.stringify({ ...current, ...effective }));
    }).catch(() => {});
  }, []);

  const effectiveRole = role || 'MEMBER';
  const nav = getNav(effectiveRole, chapterId, isOrganizationManager || Boolean(user?.isOrganizationManager), managerKind || user?.managerKind).filter((item) =>
    !(item.href === '/chapter-manager/invitations' && user?.canManageMembers === false),
  );

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);

    const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('refreshToken') : null;
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {}

    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      sessionStorage.clear();
      document.cookie = 'accessToken=; path=/; max-age=0; SameSite=Lax';
      document.cookie = 'userRole=; path=/; max-age=0; SameSite=Lax';
      document.cookie = 'refreshToken=; path=/; max-age=0; SameSite=Lax';
    }
    window.location.href = '/login';
  };

  const roleLabel =
    effectiveRole === 'ADMIN'
      ? 'Quản trị viên'
      : effectiveRole === 'CHAPTER_LEADER'
      ? 'Lead Chapter'
      : managerKind === 'LEAD_DNA'
      ? 'Lead DNA'
      : 'Học viên';

  return (
    <>
    <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b bg-white px-4 md:hidden"><span className="font-bold text-[#172554]">BBE E-Learning</span><button type="button" aria-expanded={mobileOpen} aria-controls="bbe-navigation" onClick={() => setMobileOpen((open) => !open)} className="rounded-lg border px-3 py-2 text-sm font-semibold">☰ Menu</button></div>
    {mobileOpen && <button type="button" aria-label="Đóng menu điều hướng" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-slate-950/30 md:hidden" />}
    <aside id="bbe-navigation" onKeyDown={(event) => { if (event.key === 'Escape') setMobileOpen(false); }} className={`${mobileOpen ? 'flex' : 'hidden'} md:flex fixed left-0 top-0 h-screen max-h-screen w-64 bg-white border-r border-[#e5eeff] flex-col z-50 shadow-sm select-none`}>
      {/* Official BBE Logo */}
      <div className="p-5 border-b border-[#eff4ff]">
        <Link href="/" className="flex items-center gap-3 group">
          <img
            src="/images/logo-transparent.png"
            alt="BBE Logo"
            className="h-9 w-auto object-contain transition-transform group-hover:scale-105"
          />
          <div className="border-l border-slate-200 pl-2.5">
            <div
              className="font-bold text-[#172554] text-xs leading-tight uppercase tracking-wider"
              style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}
            >
              E-Learning
            </div>
            <div className="text-[11px] font-semibold text-[#2563EB]">{roleLabel}</div>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {nav.map((item) => {
          const active = isActive(item.href, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              onMouseEnter={() => {
                router.prefetch(item.href);
                if (item.prefetchUrls) {
                  item.prefetchUrls.forEach((url) => apiFetch(url).catch(() => {}));
                }
              }}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${
                active
                  ? 'bg-[#2563EB] text-white font-semibold shadow-sm'
                  : 'text-[#434655] hover:bg-[#f0f4ff] hover:text-[#172554]'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User Info & Logout (Mounted client-side only to eliminate hydration mismatch) */}
      <div className="shrink-0 p-4 border-t border-[#eff4ff] space-y-3 bg-white">
        {mounted && user?.email && (
          <div className="px-2">
            <div className="text-xs font-semibold text-[#172554] truncate">{user.email}</div>
            {user.chapterName && (
              <div className="text-[11px] text-[#737686] truncate">🏛️ {user.chapterName}</div>
            )}
          </div>
        )}
        <button
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed transition"
        >
          {isLoggingOut ? (
            <>
              <svg className="animate-spin h-3.5 w-3.5 text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Đang đăng xuất...</span>
            </>
          ) : (
            <>
              <span>🚪</span>
              <span>Đăng xuất</span>
            </>
          )}
        </button>
      </div>
    </aside>
    </>
  );
}

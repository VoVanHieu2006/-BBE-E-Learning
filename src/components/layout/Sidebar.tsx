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

function getStudentNav(chapterId?: string | null): NavItem[] {
  return [
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
      prefetchUrls: ['/api/v1/courses'],
    },
    {
      label: 'Tiến độ',
      href: '/student/progress',
      icon: '📈',
      prefetchUrls: ['/api/v1/members/me/courses'],
    },
    {
      label: 'Bảng xếp hạng',
      href: '/leaderboard',
      icon: '🏆',
      prefetchUrls: chapterId ? [`/api/v1/leaderboard/chapters/${chapterId}`] : ['/api/v1/leaderboard'],
    },
  ];
}

const adminNav: NavItem[] = [
  { label: 'Tổng quan', href: '/admin/dashboard', icon: '📊', prefetchUrls: ['/api/v1/admin/overview'] },
  { label: 'Quản lý khóa học', href: '/admin/courses', icon: '📚', prefetchUrls: ['/api/v1/courses'] },
  { label: 'Mời BĐHU', href: '/admin/invitations', icon: '✉️', prefetchUrls: ['/api/v1/invitations'] },
  { label: 'Tiến trình Chapter', href: '/admin/chapters', icon: '🏆', prefetchUrls: ['/api/v1/leaderboard/chapters'] },
  { label: 'Quản lý tài khoản', href: '/admin/users', icon: '👤' },
];

const chapterManagerNav: NavItem[] = [
  { label: 'Tổng quan', href: '/chapter-manager/dashboard', icon: '📊' },
  { label: 'Thành viên & Tiến trình', href: '/chapter-manager/members', icon: '👥' },
  { label: 'Bảng xếp hạng', href: '/leaderboard', icon: '🏆' },
  { label: 'Khóa học', href: '/chapter-manager/courses', icon: '📚' },
  { label: 'Mời thành viên', href: '/chapter-manager/invitations', icon: '✉️' },
];

function getNav(role: string, chapterId?: string | null) {
  if (role === 'ADMIN') return adminNav;
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
        href: '/leaderboard',
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
    ];
  }
  return getStudentNav(chapterId);
}

function isActive(href: string, pathname: string) {
  const dashboards = ['/student/dashboard', '/admin/dashboard', '/chapter-manager/dashboard'];
  if (dashboards.includes(href)) return pathname === href;
  return pathname === href || pathname.startsWith(href + '/');
}

export default function Sidebar({
  role,
  user,
}: {
  role?: string;
  user?: { email?: string; chapterName?: string };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [chapterId, setChapterId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      return u?.chapterId || null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      try {
        const u = JSON.parse(localStorage.getItem('user') || 'null');
        if (u?.chapterId) setChapterId(u.chapterId);
      } catch {}
    }
  }, []);

  const effectiveRole = role || 'MEMBER';
  const nav = getNav(effectiveRole, chapterId);

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
      ? 'Ban Định Hướng'
      : 'Học viên';

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-white border-r border-[#e5eeff] flex flex-col z-50 shadow-sm select-none">
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
      <div className="p-4 border-t border-[#eff4ff] space-y-3">
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
  );
}

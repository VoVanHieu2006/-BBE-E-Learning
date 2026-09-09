'use client';
import { AdminProvider, useAdmin } from './AdminContext';
import Sidebar from '@/components/layout/Sidebar';
import { apiFetch } from '@/lib/api/client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Prefetch API data for sibling admin tabs during browser idle time.
 * This ensures that when users navigate between admin pages, the data
 * is already cached in-memory and renders instantly.
 */
const PREFETCH_URLS = [
  '/api/v1/admin/overview',
  '/api/v1/courses',
  '/api/v1/leaderboard/chapters',
  '/api/v1/users?page=1&limit=20',
  '/api/v1/invitations',
  '/api/v1/chapters',
];

function AdminLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, mounted } = useAdmin();
  const [isAuthorized, setIsAuthorized] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const token = localStorage.getItem('accessToken');
    const storedUserRaw = localStorage.getItem('user');
    if (!token || !storedUserRaw) return false;
    try {
      const u = JSON.parse(storedUserRaw);
      return u.role === 'ADMIN';
    } catch {
      return false;
    }
  });
  const prefetched = useRef(false);

  // Client-side authentication and role authorization guard
  useEffect(() => {
    if (!mounted) return;

    const token = localStorage.getItem('accessToken');
    const storedUserRaw = localStorage.getItem('user');
    let storedUser: any = null;
    if (storedUserRaw) {
      try {
        storedUser = JSON.parse(storedUserRaw);
      } catch {}
    }

    if (!token || !storedUser) {
      router.replace('/login?callbackUrl=' + encodeURIComponent(window.location.pathname));
      return;
    }

    if (storedUser.role !== 'ADMIN') {
      if (storedUser.role === 'CHAPTER_LEADER') {
        router.replace('/chapter-manager/dashboard');
      } else {
        router.replace('/student/dashboard');
      }
      return;
    }

    setIsAuthorized(true);
  }, [mounted, router]);

  // Idle-time prefetch: after current page loads and is authorized, prefetch other tabs' data
  useEffect(() => {
    if (!isAuthorized || prefetched.current) return;
    prefetched.current = true;

    const prefetchAll = () => {
      PREFETCH_URLS.forEach((url) => {
        apiFetch(url).catch(() => {});
      });
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as any).requestIdleCallback(prefetchAll, { timeout: 3000 });
    } else {
      setTimeout(prefetchAll, 1500);
    }
  }, [isAuthorized]);



  return (
    <div className="min-h-screen bg-[#f8f9ff] flex">
      <Sidebar role={user?.role || 'ADMIN'} user={{ email: user?.email }} />
      <main className="ml-64 flex-1 px-8 py-10 w-full min-w-0">
        {children}
      </main>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminProvider>
      <AdminLayoutInner>{children}</AdminLayoutInner>
    </AdminProvider>
  );
}

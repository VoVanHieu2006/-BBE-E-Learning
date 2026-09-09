'use client';
import Sidebar from '@/components/layout/Sidebar';
import { apiFetch } from '@/lib/api/client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Layout dùng chung cho các trang BĐHU: Sidebar cố định (không remount khi chuyển tab)
 * + bảo vệ quyền truy cập vai trò BĐHU + idle prefetch dữ liệu.
 */
function ChapterManagerLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<any>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  });

  const [isAuthorized, setIsAuthorized] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const token = localStorage.getItem('accessToken');
    const uRaw = localStorage.getItem('user');
    if (!token || !uRaw) return false;
    try {
      const u = JSON.parse(uRaw);
      return u.role === 'CHAPTER_LEADER' || u.role === 'ADMIN';
    } catch {
      return false;
    }
  });

  const prefetched = useRef(false);

  // Client-side authentication and role authorization guard
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('accessToken');
      const uRaw = localStorage.getItem('user');
      let u: any = null;
      if (uRaw) {
        try {
          u = JSON.parse(uRaw);
          setUser(u);
        } catch {}
      }

      if (!token || !u) {
        router.replace('/login?callbackUrl=' + encodeURIComponent(window.location.pathname));
        return;
      }

      if (u.role !== 'CHAPTER_LEADER' && u.role !== 'ADMIN') {
        router.replace('/student/dashboard');
        return;
      }

      setIsAuthorized(true);
    }
  }, [router]);

  // Idle-time prefetch: sau khi xác thực hợp lệ, lấy sẵn dữ liệu các tab khác
  useEffect(() => {
    if (!isAuthorized || prefetched.current || !user?.chapterId) return;
    prefetched.current = true;

    const chapterId = user.chapterId;
    const PREFETCH_URLS = [
      `/api/v1/chapters/${chapterId}/dashboard/members`,
      `/api/v1/chapters/${chapterId}/dashboard/members?search=&includeInactive=1`,
      `/api/v1/chapters/${chapterId}/dashboard/courses`,
      `/api/v1/invitations?chapterId=${chapterId}`,
    ];

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
  }, [isAuthorized, user?.chapterId]);



  return (
    <div className="min-h-screen bg-[#f8f9ff] flex">
      <Sidebar role="CHAPTER_LEADER" user={{ email: user?.email, chapterName: user?.chapterName }} />
      <main className="ml-64 flex-1 px-8 py-10 w-full min-w-0">{children}</main>
    </div>
  );
}

export default function ChapterManagerLayout({ children }: { children: React.ReactNode }) {
  return <ChapterManagerLayoutInner>{children}</ChapterManagerLayoutInner>;
}

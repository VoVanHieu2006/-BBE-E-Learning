'use client';
import Sidebar from '@/components/layout/Sidebar';
import { apiFetch } from '@/lib/api/client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Layout dùng chung cho phân hệ Học viên (/student/*):
 * - Sidebar cố định (không unmount/remount khi chuyển giữa Trang chủ, Khóa học, Tiến độ)
 * - Xác thực vai trò tức thì (0ms flash)
 * - Hỗ trợ khách vãng lai xem danh mục khóa học public
 * - Idle-time prefetch cho các tab học viên
 */
export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isPublicRoute = (pathname.startsWith('/student/courses') || pathname.startsWith('/student/learning')) && !pathname.includes('/quiz');
  const isLearningRoute = pathname.startsWith('/student/learning');

  const [user, setUser] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const prefetched = useRef(false);

  useEffect(() => {
    setMounted(true);
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
        if (!isPublicRoute) {
          fetch('/api/v1/auth/refresh', { method: 'POST' })
            .then((res) => res.json())
            .then((data) => {
              if (data?.accessToken && data?.user) {
                localStorage.setItem('accessToken', data.accessToken);
                localStorage.setItem('user', JSON.stringify(data.user));
                setUser(data.user);
                return;
              }
              router.replace('/login?callbackUrl=' + encodeURIComponent(window.location.pathname));
            })
            .catch(() => {
              router.replace('/login?callbackUrl=' + encodeURIComponent(window.location.pathname));
            });
        }
      }
    }
  }, [router, isPublicRoute]);

  // Idle-time prefetch for sibling student tabs
  useEffect(() => {
    if (!user || prefetched.current) return;
    prefetched.current = true;

    const chapterId = user?.chapterId;
    const PREFETCH_URLS = [
      '/api/v1/members/me/courses',
      '/api/v1/streak',
      '/api/v1/courses',
      ...(chapterId ? [`/api/v1/leaderboard/chapters/${chapterId}`] : []),
    ];

    const prefetchAll = () => {
      PREFETCH_URLS.forEach((url) => {
        apiFetch(url).catch(() => {});
      });
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as any).requestIdleCallback(prefetchAll, { timeout: 3000 });
    } else {
      setTimeout(prefetchAll, 1200);
    }
  }, [user]);

  // Trang học video (/student/learning) có giao diện rạp chiếu & header riêng, không bọc Sidebar học viên
  if (isLearningRoute) {
    return <>{children}</>;
  }

  // Đối với route xem khóa học public (/student/courses), nếu là khách chưa đăng nhập thì không render Sidebar.
  // QUAN TRỌNG: SSR và lần render đầu tiên phải là guest layout (không Sidebar).
  // Nếu để điều kiện "mounted && !user" thì khi !mounted (SSR/hydrate) sẽ rơi vào nhánh Sidebar MEMBER,
  // khiến khách vãng lai thấy flash giao diện thành viên khi reload trang.
  if (isPublicRoute) {
    if (mounted && user) {
      return (
        <div className="min-h-screen bg-[#f8f9ff] flex">
          <Sidebar role={user?.role || 'MEMBER'} user={{ email: user?.email, chapterName: user?.chapterName }} />
          <main className="ml-64 flex-1 max-w-5xl mx-auto px-8 py-10 w-full min-w-0">{children}</main>
        </div>
      );
    }
    return <>{children}</>;
  }

  // Route student riêng tư (/student/* khác): cần đăng nhập — hiệu ứng auth check phía effect sẽ redirect khách về /login
  return (
    <div className="min-h-screen bg-[#f8f9ff] flex">
      <Sidebar role={user?.role || 'MEMBER'} user={{ email: user?.email, chapterName: user?.chapterName }} />
      <main className="ml-64 flex-1 max-w-5xl mx-auto px-8 py-10 w-full min-w-0">{children}</main>
    </div>
  );
}

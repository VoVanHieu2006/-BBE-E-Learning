'use client';
import Sidebar from '@/components/layout/Sidebar';
import { apiFetch } from '@/lib/api/client';
import { useEffect, useRef, useState } from 'react';

/**
 * Layout dùng chung cho các trang BĐHU: Sidebar cố định (không remount khi chuyển tab)
 * + idle prefetch dữ liệu các tab còn lại để chuyển tab mượt và hiển thị ngay từ cache.
 */
function ChapterManagerLayoutInner({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const prefetched = useRef(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const u = localStorage.getItem('user');
      if (u) {
        try {
          setUser(JSON.parse(u));
        } catch {}
      }
    }
  }, []);

  // Idle-time prefetch: sau khi trang hiện tại tải xong, lấy sẵn dữ liệu các tab khác
  useEffect(() => {
    if (prefetched.current || !user?.chapterId) return;
    prefetched.current = true;

    const chapterId = user.chapterId;
    // URL phải khớp chính xác với URL các trang gọi (cache key của apiFetch)
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
  }, [user?.chapterId]);

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

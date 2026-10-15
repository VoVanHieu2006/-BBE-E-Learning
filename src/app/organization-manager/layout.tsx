'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import ContentTransition from '@/components/layout/ContentTransition';
import { apiFetch } from '@/lib/api/client';

export default function OrganizationManagerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/v1/auth/me', { noCache: true }).then((result) => {
      if (cancelled) return;
      const effective = result.data?.user;
      if (!result.ok || !effective?.isOrganizationManager) {
        router.replace(result.ok ? '/student/dashboard' : '/login');
        return;
      }
      const current = JSON.parse(localStorage.getItem('user') || '{}');
      const scoped = { ...current, ...effective };
      localStorage.setItem('user', JSON.stringify(scoped));
      setUser(scoped);
      setChecking(false);
    }).catch(() => {
      if (!cancelled) router.replace('/login');
    });
    return () => { cancelled = true; };
  }, [router]);

  if (checking) return <div className="min-h-screen bg-[#f8f9ff] p-8 text-sm text-[#737686]">Đang kiểm tra phạm vi quản lý…</div>;
  return <div className="flex min-h-screen bg-[#f8f9ff]">
    <Sidebar role={user?.role || 'MEMBER'} user={{ email: user?.email, chapterName: user?.chapterName, isOrganizationManager: true }} />
    <main className="ml-64 w-full min-w-0 px-5 py-8 md:px-8"><ContentTransition>{children}</ContentTransition></main>
  </div>;
}

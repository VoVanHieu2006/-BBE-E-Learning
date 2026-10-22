'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/layout/Sidebar';
import Button from '@/components/ui/Button';
import UnifiedLeaderboard from '@/components/learning/UnifiedLeaderboard';

export default function LeaderboardPage() {
  const [user, setUser] = useState<any>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      const u = localStorage.getItem('user');
      if (u) {
        try {
          setUser(JSON.parse(u));
        } catch {}
      }
    }
  }, []);

  return (
    <div className="h-screen overflow-hidden bg-[#f8f9ff] flex">
      {mounted && user ? (
        <>
          <Sidebar role={user.role} user={{ email: user.email, chapterName: user.chapterName }} />
          <main className="ml-64 flex-1 h-screen overflow-y-auto flex flex-col p-6 max-w-6xl">
            <UnifiedLeaderboard showChapterSelector={true} />
          </main>
        </>
      ) : (
        <div className="flex flex-col flex-1 h-screen overflow-y-auto">
          <header className="bg-white/95 backdrop-blur-md border-b border-[#e5eeff] px-6 py-3 sticky top-0 z-50">
            <div className="max-w-6xl mx-auto flex items-center justify-between">
              <Link href="/" className="flex items-center gap-3">
                <img
                  src="/images/logo-transparent.png"
                  alt="BBE Logo"
                  className="h-10 w-auto object-contain"
                />
              </Link>
              <Link href="/login">
                <Button size="sm">Đăng nhập</Button>
              </Link>
            </div>
          </header>
          <div className="max-w-6xl mx-auto p-6 flex-1 w-full">
            <UnifiedLeaderboard showChapterSelector={true} />
          </div>
        </div>
      )}
    </div>
  );
}

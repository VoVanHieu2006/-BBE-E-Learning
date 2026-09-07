'use client';
import { useEffect, useState, createContext, useContext } from 'react';
import { useRouter } from 'next/navigation';

interface AppUser {
  userId: string;
  email: string;
  role: 'ADMIN' | 'CHAPTER_LEADER' | 'MEMBER';
  chapterName?: string;
  chapterId?: string;
}

const UserContext = createContext<AppUser | null>(null);
export const useAppUser = () => useContext(UserContext);

/**
 * AuthGuard: wraps pages that require login.
 * If user is not logged in → redirect to /login.
 * Also prevents going back to login page after login (issue #1 & #8).
 */
export function AuthGuard({
  children,
  allowedRoles,
}: {
  children: (user: AppUser) => React.ReactNode;
  allowedRoles?: Array<'ADMIN' | 'CHAPTER_LEADER' | 'MEMBER'>;
}) {
  const router = useRouter();
  const [user, setUser] = useState<AppUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem('user');
    const token = localStorage.getItem('accessToken');

    if (!raw || !token) {
      router.replace('/login');
      return;
    }

    try {
      const parsed = JSON.parse(raw) as AppUser;
      if (allowedRoles && !allowedRoles.includes(parsed.role)) {
        // Wrong role — redirect to correct dashboard
        if (parsed.role === 'ADMIN') router.replace('/admin/dashboard');
        else if (parsed.role === 'CHAPTER_LEADER') router.replace('/chapter-manager/dashboard');
        else router.replace('/student/dashboard');
        return;
      }
      setUser(parsed);
      setChecked(true);
    } catch {
      localStorage.removeItem('user');
      localStorage.removeItem('accessToken');
      router.replace('/login');
    }
  }, []);

  if (!checked || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9ff]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-[#737686]">Đang xác thực...</p>
        </div>
      </div>
    );
  }

  return <UserContext.Provider value={user}>{children(user)}</UserContext.Provider>;
}

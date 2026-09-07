'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

interface AdminUser {
  email?: string;
  role?: string;
  chapterName?: string;
  [key: string]: any;
}

interface AdminContextValue {
  user: AdminUser | null;
  mounted: boolean;
}

const AdminContext = createContext<AdminContextValue>({ user: null, mounted: false });

export function AdminProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
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
    <AdminContext.Provider value={{ user, mounted }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  return useContext(AdminContext);
}

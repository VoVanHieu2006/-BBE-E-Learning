import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Thành viên DNA' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

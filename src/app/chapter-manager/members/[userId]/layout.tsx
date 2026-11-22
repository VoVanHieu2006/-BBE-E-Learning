import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Hồ sơ thành viên' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Chi tiết học tập của thành viên' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

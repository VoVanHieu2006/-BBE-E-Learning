import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Lịch sử Star' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

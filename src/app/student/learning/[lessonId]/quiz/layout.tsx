import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Bài kiểm tra bài học' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

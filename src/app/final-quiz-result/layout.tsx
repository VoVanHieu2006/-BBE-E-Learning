import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Kết quả bài kiểm tra' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

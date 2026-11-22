import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Bảng xếp hạng nội bộ DNA' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

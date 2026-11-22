import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Tổng quan DNA' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

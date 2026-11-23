import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Tổng quan Chapter' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from 'next';
import { PAGE_TITLE_TEMPLATE } from '@/lib/page-title';

export const metadata: Metadata = { title: { default: 'Quản lý tài khoản', template: PAGE_TITLE_TEMPLATE } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

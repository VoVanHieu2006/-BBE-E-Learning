'use client'
import { usePathname } from 'next/navigation'

export default function ContentTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return <div key={pathname} className="page-transition min-w-0">{children}</div>
}

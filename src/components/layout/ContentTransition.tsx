'use client'
import { usePathname } from 'next/navigation'

export default function ContentTransition({ children, className = 'page-transition min-w-0' }: { children: React.ReactNode; className?: string }) {
  const pathname = usePathname()
  // Không unmount cây DOM khi chuyển bài học trong phòng học /student/learning/[lessonId]
  const transitionKey = pathname?.startsWith('/student/learning') ? '/student/learning' : pathname
  return <div key={transitionKey} className={className}>{children}</div>
}

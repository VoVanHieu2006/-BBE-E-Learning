'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const hasPersistentShell = ['/admin', '/student', '/chapter-manager', '/organization-manager'].some((prefix) => pathname.startsWith(prefix))
  const [navigating, setNavigating] = useState(false)
  useEffect(() => setNavigating(false), [pathname])
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as HTMLElement | null)?.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const target = new URL(anchor.href, window.location.href)
      if (target.origin === window.location.origin && target.pathname !== window.location.pathname) setNavigating(true)
    }
    document.addEventListener('click', handleClick, true)
    const cancel=()=>setNavigating(false)
    window.addEventListener('bbe:navigation-cancelled',cancel)
    return () => {document.removeEventListener('click', handleClick, true);window.removeEventListener('bbe:navigation-cancelled',cancel)}
  }, [])
  return <>
    <div aria-hidden className={`route-progress ${navigating ? 'route-progress--active' : ''}`} />
    <div key={hasPersistentShell ? 'persistent-shell' : pathname} className={hasPersistentShell ? 'min-w-0' : 'page-transition min-w-0'}>{children}</div>
  </>
}

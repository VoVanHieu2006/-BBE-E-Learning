import { accountHome, canOpenManagerArea, hasCurrentSessionClaims } from '@/lib/session-role'
import { isLeadRole } from '@/lib/roles'
import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || ''

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const token = request.cookies.get('accessToken')?.value
  const refreshTokenCookie = request.cookies.get('refreshToken')?.value

  let managerKind: string | null = null
  let role: string | null = null
  let isAuthenticated = false
  let newlyIssuedAccessToken: string | null = null
  let sessionRejected = false

  // 1. Check access token
  if (token && JWT_ACCESS_SECRET) {
    try {
      const secret = new TextEncoder().encode(JWT_ACCESS_SECRET)
      const { payload } = await jwtVerify(token, secret)
      if (!hasCurrentSessionClaims(payload)) throw new Error('InvalidSession')
      managerKind = (payload.managerKind as string) || null
      role = (payload.role as string) || null
      isAuthenticated = Boolean(payload.sub)
    } catch {
      // Token is invalid or expired
      isAuthenticated = false
      role = null
    }
  }

  // A valid signature does not prove the account's auth_version is still current.
  // Check on login before redirecting, so a revoked session can sign in again.
  if (pathname === '/login' && isAuthenticated && token) {
    try {
      const response = await fetch(new URL('/api/v1/auth/me', request.url), {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
      })
      if (!response.ok) {
        isAuthenticated = false
        role = null
        sessionRejected = response.status === 401 || response.status === 403
      }
    } catch { isAuthenticated = false; role = null }
  }

  // Refresh through the server so revocation and auth_version are checked against the DB.
  if (!isAuthenticated && refreshTokenCookie && JWT_ACCESS_SECRET) {
    try {
      const response = await fetch(new URL('/api/v1/auth/refresh', request.url), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshTokenCookie }), cache: 'no-store',
      })
      if (response.ok) {
        const refreshed = await response.json()
        const { payload } = await jwtVerify(refreshed.accessToken, new TextEncoder().encode(JWT_ACCESS_SECRET))
        if (payload.sub && hasCurrentSessionClaims(payload)) {
          newlyIssuedAccessToken = refreshed.accessToken
          role = payload.role as string
          managerKind = (payload.managerKind as string) || null
          isAuthenticated = true
          sessionRejected = false
        }
      } else if (response.status === 401 || response.status === 403) {
        sessionRejected = true
      }
    } catch { isAuthenticated = false; role = null }
  }

  // Helper to attach renewed cookies to outgoing responses
  const withCookies = (res: NextResponse): NextResponse => {
    if (sessionRejected) {
      for (const name of ['accessToken', 'refreshToken', 'userRole']) res.cookies.delete(name)
    }
    if (newlyIssuedAccessToken) {
      res.cookies.set('accessToken', newlyIssuedAccessToken, {
        path: '/',
        sameSite: 'lax',
        maxAge: 15 * 60,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
      })
      if (role) {
        res.cookies.set('userRole', role, {
          path: '/',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60,
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
        })
      }
    }
    return res
  }

  // Helper to redirect to login and clear dead cookies
  const redirectToLogin = (targetPath: string): NextResponse => {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('callbackUrl', targetPath)
    const res = NextResponse.redirect(loginUrl)
    res.cookies.delete('accessToken')
    res.cookies.delete('userRole')
    res.cookies.delete('refreshToken')
    return res
  }

  // 1. Routes requiring ADMIN
  if (pathname.startsWith('/admin')) {
    if (!isAuthenticated) {
      return redirectToLogin(pathname)
    }

    if (role !== 'ADMIN') {
      if (isLeadRole(role)) {
        return withCookies(NextResponse.redirect(new URL(accountHome(role, managerKind), request.url)))
      }
      return withCookies(NextResponse.redirect(new URL(accountHome(role, managerKind), request.url)))
    }

    return withCookies(NextResponse.next())
  }

  // 2. Routes requiring LEAD (or ADMIN)
  if (pathname.startsWith('/chapter-manager')) {
    if (!isAuthenticated) {
      return redirectToLogin(pathname)
    }

    if (!canOpenManagerArea('CHAPTER', role, managerKind)) {
      return withCookies(NextResponse.redirect(new URL(accountHome(role, managerKind), request.url)))
    }

    return withCookies(NextResponse.next())
  }

  if (pathname.startsWith('/organization-manager')) {
    if (!isAuthenticated) return redirectToLogin(pathname)
    if (!canOpenManagerArea('DNA', role, managerKind)) return withCookies(NextResponse.redirect(new URL(accountHome(role, managerKind), request.url)))
    return withCookies(NextResponse.next())
  }

  // 3. Protected Student Pages
  const isProtectedStudentRoute =
    pathname.startsWith('/student/dashboard') ||
    pathname.startsWith('/student/progress') ||
    pathname.includes('/quiz')

  if (isProtectedStudentRoute) {
    if (!isAuthenticated) {
      return redirectToLogin(pathname)
    }

    return withCookies(NextResponse.next())
  }

  // 4. Login page when already authenticated
  if (pathname === '/login') {
    if (isAuthenticated && role) {
      const callbackUrl = request.nextUrl.searchParams.get('callbackUrl')
      if (callbackUrl && callbackUrl.startsWith('/') && !callbackUrl.startsWith('//')) {
        if (callbackUrl.startsWith('/admin') && role === 'ADMIN') {
          return withCookies(NextResponse.redirect(new URL(callbackUrl, request.url)))
        }
        if (callbackUrl.startsWith('/chapter-manager') && canOpenManagerArea('CHAPTER', role, managerKind)) {
          return withCookies(NextResponse.redirect(new URL(callbackUrl, request.url)))
        }
        if (callbackUrl.startsWith('/student')) {
          return withCookies(NextResponse.redirect(new URL(callbackUrl, request.url)))
        }
      }

      if (role === 'ADMIN') {
        return withCookies(NextResponse.redirect(new URL('/admin/dashboard', request.url)))
      }
      if (isLeadRole(role)) {
        return withCookies(NextResponse.redirect(new URL(accountHome(role, managerKind), request.url)))
      }
      return withCookies(NextResponse.redirect(new URL('/student/dashboard', request.url)))
    }

    return withCookies(NextResponse.next())
  }

  // 5. IMP-02: Redirect legacy /invitations/accept → /accept-invitation (canonical URL)
  if (pathname === '/invitations/accept') {
    const target = new URL('/accept-invitation', request.url)
    // Preserve query parameters (token, etc.)
    request.nextUrl.searchParams.forEach((value, key) => {
      target.searchParams.set(key, value)
    })
    return NextResponse.redirect(target, { status: 301 })
  }

  // 6. IMP-01: Redirect debug player /lessons/[lessonId] → /student/learning/[lessonId]
  // Prevents public exposure of the developer token-input playground
  const lessonDebugMatch = pathname.match(/^\/lessons\/([^/]+)$/)
  if (lessonDebugMatch) {
    const lessonId = lessonDebugMatch[1]
    return NextResponse.redirect(new URL(`/student/learning/${lessonId}`, request.url), { status: 301 })
  }

  return withCookies(NextResponse.next())
}


export const config = {
  matcher: [
    '/admin/:path*',
    '/chapter-manager/:path*',
    '/organization-manager/:path*',
    '/student/dashboard/:path*',
    '/student/progress/:path*',
    '/student/courses/:courseId/quiz/:path*',
    '/login',
    // IMP-02: Canonical redirect for legacy invitation URL
    '/invitations/accept',
    // IMP-01: Redirect debug player to official learning page
    '/lessons/:lessonId',
  ],
}

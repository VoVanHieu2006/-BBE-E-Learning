import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify, SignJWT } from 'jose'

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || ''
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || ''

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const token = request.cookies.get('accessToken')?.value
  const refreshTokenCookie = request.cookies.get('refreshToken')?.value
  const userRoleCookie = request.cookies.get('userRole')?.value

  let role: string | null = null
  let isAuthenticated = false
  let newlyIssuedAccessToken: string | null = null

  // 1. Check access token
  if (token && JWT_ACCESS_SECRET) {
    try {
      const secret = new TextEncoder().encode(JWT_ACCESS_SECRET)
      const { payload } = await jwtVerify(token, secret)
      role = (payload.role as string) || null
      isAuthenticated = Boolean(payload.sub)
    } catch {
      // Token is invalid or expired
      isAuthenticated = false
      role = null
    }
  }

  // 2. Silent refresh: if accessToken is expired or missing, check refreshToken
  if (!isAuthenticated && refreshTokenCookie && JWT_REFRESH_SECRET && JWT_ACCESS_SECRET) {
    try {
      const refreshSecret = new TextEncoder().encode(JWT_REFRESH_SECRET)
      const { payload } = await jwtVerify(refreshTokenCookie, refreshSecret)
      if (payload.sub) {
        isAuthenticated = true
        role = (payload.role as string) || userRoleCookie || 'MEMBER'
        const sub = payload.sub as string
        const chapterId = (payload.chapterId as string) || undefined

        // Issue a fresh 15-minute access token right at the edge
        const accessSecret = new TextEncoder().encode(JWT_ACCESS_SECRET)
        newlyIssuedAccessToken = await new SignJWT({ sub, role, chapterId })
          .setProtectedHeader({ alg: 'HS256' })
          .setExpirationTime('15m')
          .setIssuedAt()
          .sign(accessSecret)
      }
    } catch {
      isAuthenticated = false
      role = null
    }
  }

  // Helper to attach renewed cookies to outgoing responses
  const withCookies = (res: NextResponse): NextResponse => {
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
      if (role === 'CHAPTER_LEADER') {
        return withCookies(NextResponse.redirect(new URL('/chapter-manager/dashboard', request.url)))
      }
      return withCookies(NextResponse.redirect(new URL('/student/dashboard', request.url)))
    }

    return withCookies(NextResponse.next())
  }

  // 2. Routes requiring CHAPTER_LEADER (or ADMIN)
  if (pathname.startsWith('/chapter-manager')) {
    if (!isAuthenticated) {
      return redirectToLogin(pathname)
    }

    if (role !== 'CHAPTER_LEADER' && role !== 'ADMIN') {
      return withCookies(NextResponse.redirect(new URL('/student/dashboard', request.url)))
    }

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
        if (callbackUrl.startsWith('/chapter-manager') && (role === 'CHAPTER_LEADER' || role === 'ADMIN')) {
          return withCookies(NextResponse.redirect(new URL(callbackUrl, request.url)))
        }
        if (callbackUrl.startsWith('/student')) {
          return withCookies(NextResponse.redirect(new URL(callbackUrl, request.url)))
        }
      }

      if (role === 'ADMIN') {
        return withCookies(NextResponse.redirect(new URL('/admin/dashboard', request.url)))
      }
      if (role === 'CHAPTER_LEADER') {
        return withCookies(NextResponse.redirect(new URL('/chapter-manager/dashboard', request.url)))
      }
      return withCookies(NextResponse.redirect(new URL('/student/dashboard', request.url)))
    }

    return NextResponse.next()
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

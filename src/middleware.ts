import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || ''

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const token = request.cookies.get('accessToken')?.value

  let role: string | null = null
  let isAuthenticated = false

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

  // 1. Routes requiring ADMIN
  if (pathname.startsWith('/admin')) {
    if (!isAuthenticated) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('callbackUrl', pathname)
      const res = NextResponse.redirect(loginUrl)
      res.cookies.delete('accessToken')
      res.cookies.delete('userRole')
      return res
    }

    if (role !== 'ADMIN') {
      if (role === 'CHAPTER_LEADER') {
        return NextResponse.redirect(new URL('/chapter-manager/dashboard', request.url))
      }
      return NextResponse.redirect(new URL('/student/dashboard', request.url))
    }

    return NextResponse.next()
  }

  // 2. Routes requiring CHAPTER_LEADER (or ADMIN)
  if (pathname.startsWith('/chapter-manager')) {
    if (!isAuthenticated) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('callbackUrl', pathname)
      const res = NextResponse.redirect(loginUrl)
      res.cookies.delete('accessToken')
      res.cookies.delete('userRole')
      return res
    }

    if (role !== 'CHAPTER_LEADER' && role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/student/dashboard', request.url))
    }

    return NextResponse.next()
  }

  // 3. Protected Student Pages
  const isProtectedStudentRoute =
    pathname.startsWith('/student/dashboard') ||
    pathname.startsWith('/student/progress') ||
    pathname.includes('/quiz')

  if (isProtectedStudentRoute) {
    if (!isAuthenticated) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('callbackUrl', pathname)
      const res = NextResponse.redirect(loginUrl)
      res.cookies.delete('accessToken')
      res.cookies.delete('userRole')
      return res
    }

    return NextResponse.next()
  }

  // 4. Login page when already authenticated
  if (pathname === '/login') {
    if (isAuthenticated && role) {
      const callbackUrl = request.nextUrl.searchParams.get('callbackUrl')
      if (callbackUrl && callbackUrl.startsWith('/') && !callbackUrl.startsWith('//')) {
        if (callbackUrl.startsWith('/admin') && role === 'ADMIN') {
          return NextResponse.redirect(new URL(callbackUrl, request.url))
        }
        if (callbackUrl.startsWith('/chapter-manager') && (role === 'CHAPTER_LEADER' || role === 'ADMIN')) {
          return NextResponse.redirect(new URL(callbackUrl, request.url))
        }
        if (callbackUrl.startsWith('/student')) {
          return NextResponse.redirect(new URL(callbackUrl, request.url))
        }
      }

      if (role === 'ADMIN') {
        return NextResponse.redirect(new URL('/admin/dashboard', request.url))
      }
      if (role === 'CHAPTER_LEADER') {
        return NextResponse.redirect(new URL('/chapter-manager/dashboard', request.url))
      }
      return NextResponse.redirect(new URL('/student/dashboard', request.url))
    }

    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/chapter-manager/:path*',
    '/student/dashboard/:path*',
    '/student/progress/:path*',
    '/student/courses/:courseId/quiz/:path*',
    '/login',
  ],
}

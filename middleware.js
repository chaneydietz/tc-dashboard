import { NextResponse } from 'next/server'

export function middleware(req) {
  const { pathname } = req.nextUrl

  // Always allow the login page and its API, and static assets
if (
  pathname.startsWith('/login') ||
  pathname.startsWith('/api/check-password') ||
  pathname.startsWith('/api/auth/microsoft') ||
  pathname.startsWith('/api/cron') ||
  pathname.startsWith('/_next') ||
  pathname.startsWith('/favicon')
) {
  return NextResponse.next()
}

  const authCookie = req.cookies.get('site_auth')
  if (authCookie?.value === process.env.SITE_PASSWORD) {
    return NextResponse.next()
  }

  const loginUrl = req.nextUrl.clone()
  loginUrl.pathname = '/login'
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// The app itself lives on the apex + www; every OTHER *.stategen.app label is an
// agency microsite subdomain (acme.stategen.app → that agency's listings page).
const ROOT_DOMAIN = 'stategen.app'

/** The company microsite label for a host, or null when the host is the app
 *  (apex, www, the vercel.app domain, or localhost). */
function companySubdomain(host: string | null): string | null {
  const h = (host ?? '').split(':')[0].toLowerCase()
  if (!h.endsWith(`.${ROOT_DOMAIN}`)) return null   // apex / vercel.app / localhost
  const label = h.slice(0, -(ROOT_DOMAIN.length + 1))
  if (!label || label === 'www' || label.includes('.')) return null
  return label
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Agency microsite subdomains ────────────────────────────────────────────
  // A company subdomain serves ONLY the public microsite. Rewrite its root to
  // the /a/<label> page (URL stays on the subdomain); let the listing pages, the
  // lead API and static assets through; send anything else back to the root.
  const sub = companySubdomain(request.headers.get('host'))
  if (sub) {
    if (pathname === '/') {
      return NextResponse.rewrite(new URL(`/a/${sub}`, request.url))
    }
    if (
      pathname.startsWith('/a/') || pathname.startsWith('/l/') ||
      pathname.startsWith('/api/') || pathname.startsWith('/_next/') ||
      pathname.startsWith('/icons/') || pathname === '/favicon.ico' ||
      pathname === '/manifest.webmanifest' || pathname === '/sw.js' ||
      pathname === '/offline.html' || /\.[a-z0-9]+$/i.test(pathname)
    ) {
      return NextResponse.next()
    }
    return NextResponse.redirect(new URL('/', request.url))
  }

  // ── Main app (apex / www) ──────────────────────────────────────────────────
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Require authentication for app pages. Public paths are always allowed
  // through: login, signup, API routes, and shared listing pages (/l/<token>),
  // which are meant for clients who have no account.
  const isPublicPath =
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/l/') ||
    pathname.startsWith('/a/') ||
    pathname.startsWith('/wa/') ||
    pathname.startsWith('/admin') ||
    // PWA assets must be reachable without a session, or install + offline break.
    pathname === '/manifest.webmanifest' ||
    pathname === '/sw.js' ||
    pathname === '/offline.html' ||
    pathname.startsWith('/icons/')

  if (!user && !isPublicPath) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}

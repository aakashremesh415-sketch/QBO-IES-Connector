import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse, type NextFetchEvent } from "next/server";

/**
 * Every page needs a session. On /c/<alias>/... pages the alias is also passed to the layout
 * (header) and remembered (cookie), so the company switcher and sidebar follow the user around.
 */
const auth = withAuth(function middleware(req) {
  const m = req.nextUrl.pathname.match(/^\/c\/([^/]+)/);
  if (!m) return NextResponse.next();
  const alias = decodeURIComponent(m[1]);
  const headers = new Headers(req.headers);
  headers.set("x-company-alias", alias);
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set("company", alias, { path: "/", sameSite: "lax", httpOnly: true, secure: req.nextUrl.protocol === "https:" });
  return res;
}, { pages: { signIn: "/login" } });

export default function middleware(req: NextRequestWithAuth, event: NextFetchEvent) {
  // Without a secret NextAuth can only show a bare "Configuration" error; send people to a page that says what's missing.
  if (!process.env.NEXTAUTH_SECRET) return NextResponse.redirect(new URL("/setup-check", req.url));
  return auth(req, event);
}

export const config = {
  matcher: ["/((?!login|setup-check|terms|privacy|disconnected|api/auth|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};

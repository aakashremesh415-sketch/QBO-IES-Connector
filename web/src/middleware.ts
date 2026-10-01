import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

/**
 * Every page needs a session. On /c/<alias>/... pages the alias is also passed to the layout
 * (header) and remembered (cookie), so the company switcher and sidebar follow the user around.
 */
export default withAuth(function middleware(req) {
  const m = req.nextUrl.pathname.match(/^\/c\/([^/]+)/);
  if (!m) return NextResponse.next();
  const alias = decodeURIComponent(m[1]);
  const headers = new Headers(req.headers);
  headers.set("x-company-alias", alias);
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set("company", alias, { path: "/", sameSite: "lax", httpOnly: true, secure: req.nextUrl.protocol === "https:" });
  return res;
}, { pages: { signIn: "/login" } });

export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};

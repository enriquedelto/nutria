import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic redirect only (cookie presence). Real authorization happens in the DAL
 * (`requireUser` / `requirePerson`) and in every route handler and server action.
 */
const PUBLIC = [/^\/login/, /^\/registro/, /^\/invitacion/, /^\/api\/auth/, /^\/api\/hooks\//, /^\/api\/mcp/, /^\/api\/health/, /^\/offline/];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const headers = new Headers(req.headers);
  headers.set("x-request-id", requestId);
  if (!PUBLIC.some((r) => r.test(pathname)) && !getSessionCookie(req)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: { "x-request-id": requestId } });
    // Relative Location: req.url carries the internal host behind Docker/Caddy.
    const next = pathname !== "/" ? `?next=${encodeURIComponent(pathname + req.nextUrl.search)}` : "";
    return new NextResponse(null, { status: 307, headers: { Location: `/login${next}`, "x-request-id": requestId } });
  }
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|serwist/|robots.txt).*)"],
};

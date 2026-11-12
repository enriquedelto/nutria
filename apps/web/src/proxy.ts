import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic redirect only (cookie presence). Real authorization happens in the DAL
 * (`requireUser` / `requirePerson`) and in every route handler and server action.
 */
const PUBLIC = [/^\/login/, /^\/registro/, /^\/invitacion/, /^\/api\/auth/, /^\/api\/hooks\//, /^\/api\/mcp/, /^\/api\/health/, /^\/offline/,
  // Android share sheet: the route itself sends people without a session to the login (not a JSON 401).
  /^\/api\/share-target$/,
];

/** Next 16 server action ids are 42 hex chars (SERVER_REFERENCE_ID_LENGTH); anything else is a probe. */
const ACTION_ID = /^[0-9a-f]{42}$/i;

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Bots probing server actions ("Next-Action: x", RSC exploit scanners) never reach Next's decoder,
  // which would log a "Server Reference ID did not match the expected format" error each time.
  const action = req.headers.get("next-action");
  if (action != null && !ACTION_ID.test(action)) return new NextResponse(null, { status: 404 });
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const headers = new Headers(req.headers);
  headers.set("x-request-id", requestId);
  if (!PUBLIC.some((r) => r.test(pathname)) && !getSessionCookie(req)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: { "x-request-id": requestId } });
    // Proxy redirects must be absolute; req.url carries the internal host behind Docker/Caddy,
    // so build it on the public URL.
    const url = new URL("/login", process.env.BETTER_AUTH_URL ?? req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|serwist/|robots.txt).*)"],
};

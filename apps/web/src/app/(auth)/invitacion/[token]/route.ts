/** Relative Location: behind Docker/Caddy, req.url carries the internal host (0.0.0.0:3000). */
const redirectTo = (path: string, status = 302) => new Response(null, { status, headers: { Location: path } });

// Short invitation links: /invitacion/<token> → /registro?token=<token>
export async function GET(_req: Request, ctx: RouteContext<"/invitacion/[token]">) {
  const { token } = await ctx.params;
  return redirectTo(`/registro?token=${encodeURIComponent(token)}`);
}

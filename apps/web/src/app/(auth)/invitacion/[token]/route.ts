// Short invitation links: /invitacion/<token> → /registro?token=<token>
export async function GET(req: Request, ctx: RouteContext<"/invitacion/[token]">) {
  const { token } = await ctx.params;
  return Response.redirect(new URL(`/registro?token=${encodeURIComponent(token)}`, req.url), 302);
}

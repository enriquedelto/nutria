import { and, eq, shoppingLists } from "@nutria/db";
import { bus } from "@/lib/bus";
import { db } from "@/lib/db";
import { HttpError, route } from "@/lib/api";
import { groupOf } from "@/lib/kitchen";

/** Server-Sent Events: tells every open shopping list that something changed (clients refetch). */
export const GET = route<RouteContext<"/api/sse/shopping/[id]">>(async (req, user, ctx) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "No encontrada");
  const g = await groupOf(user.id);
  const [l] = await db().select({ id: shoppingLists.id }).from(shoppingLists).where(and(eq(shoppingLists.id, id), eq(shoppingLists.groupId, g.groupId))).limit(1);
  if (!l) throw new HttpError(404, "No encontrada");
  const enc = new TextEncoder();
  const channel = `shopping:${l.id}`;
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(c) {
      const send = (data: unknown) => {
        try {
          c.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const onEvent = (p: unknown) => send(p);
      bus.on(channel, onEvent);
      const hb = setInterval(() => {
        try {
          c.enqueue(enc.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 25_000);
      cleanup = () => {
        clearInterval(hb);
        bus.off(channel, onEvent);
        try {
          c.close();
        } catch {}
      };
      req.signal.addEventListener("abort", () => cleanup());
      c.enqueue(enc.encode("retry: 5000\n\n"));
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
});

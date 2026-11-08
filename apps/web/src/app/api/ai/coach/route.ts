import { z } from "zod";
import { coachChat } from "@nutria/ai";
import { json, route } from "@/lib/api";
import { aiCtx, aiErrorResponse, Images, toImages } from "@/lib/ai";

const Body = z.object({
  personId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(4000),
  images: Images.optional(),
});

/**
 * Coach chat, streamed as NDJSON lines:
 *   {"type":"text","d":"…"} | {"type":"tool","name":"get_diary"} | {"type":"done",…} | {"type":"error",…}
 */
export const POST = route(async (req, user) => {
  const b = Body.parse(await req.json());
  const c = await aiCtx(user, b.personId, "diary", req);
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (o: unknown) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        const res = await coachChat(c, {
          conversationId: b.conversationId,
          message: b.message,
          images: b.images ? toImages(b.images) : undefined,
          onText: (d) => send({ type: "text", d }),
          onToolCall: (name) => send({ type: "tool", name }),
        });
        send({ type: "done", conversationId: res.conversationId, messageId: res.messageId, text: res.text, proposals: res.proposals });
      } catch (e) {
        const r = aiErrorResponse(e);
        send({ type: "error", error: r ? ((await r.json()) as { error: string }).error : "Error del coach" });
      } finally {
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
});

export const DELETE = route(async (req, user) => {
  const { conversationId } = z.object({ conversationId: z.string().uuid() }).parse(await req.json());
  const { aiConversations, and, eq } = await import("@nutria/db");
  const { db } = await import("@/lib/db");
  await db().delete(aiConversations).where(and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, user.id)));
  return json({ ok: true });
});

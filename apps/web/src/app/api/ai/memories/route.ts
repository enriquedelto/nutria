import { z } from "zod";
import { extractMemories } from "@nutria/ai";
import { json, route } from "@/lib/api";
import { aiCtx, withAi } from "@/lib/ai";

/** Suggest durable memories from a conversation (the user accepts them one by one). */
export const POST = route(async (req, user) => {
  const b = z.object({ personId: z.string().uuid(), conversationId: z.string().uuid() }).parse(await req.json());
  const c = await aiCtx(user, b.personId, "ai", req);
  return withAi(async () => json({ memories: await extractMemories(c, b.conversationId) }));
});

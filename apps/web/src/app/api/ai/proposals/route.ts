import { z } from "zod";
import { aiConversations, aiMessages, eq } from "@nutria/db";
import { applyProposal, dismissProposal } from "@nutria/core";
import { db } from "@/lib/db";
import { HttpError, json, personFor, route } from "@/lib/api";

const Body = z.object({ messageId: z.string().uuid(), index: z.number().int().min(0).max(50), action: z.enum(["apply", "dismiss"]) });

/** Confirm or dismiss a coach proposal. Requires write access to the conversation's person. */
export const POST = route(async (req, user) => {
  const b = Body.parse(await req.json());
  const [row] = await db()
    .select({ personId: aiConversations.personId, userId: aiConversations.userId })
    .from(aiMessages)
    .innerJoin(aiConversations, eq(aiConversations.id, aiMessages.conversationId))
    .where(eq(aiMessages.id, b.messageId))
    .limit(1);
  if (!row || row.userId !== user.id || !row.personId) throw new HttpError(404, "No encontrado");
  const { person } = await personFor(user, row.personId, "diary", true);
  if (b.action === "dismiss") {
    await dismissProposal(db(), b.messageId, b.index);
    return json({ ok: true });
  }
  return json(await applyProposal(db(), { userId: user.id, personId: person.id, groupId: person.groupId, messageId: b.messageId, index: b.index }));
});

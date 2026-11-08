import { z } from "zod";
import { undoAiAction } from "@nutria/core";
import { db } from "@/lib/db";
import { json, route } from "@/lib/api";

/** Undo an AI-originated diary write (inserted entries are removed). */
export const POST = route(async (req, user) => {
  const { actionId } = z.object({ actionId: z.string().uuid() }).parse(await req.json());
  return json({ ok: await undoAiAction(db(), user.id, actionId) });
});

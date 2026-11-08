"use server";
import { z } from "zod";
import { learnPortion } from "@nutria/ai";
import { db } from "@/lib/db";
import { assertAccess, getApiUser } from "@/lib/session";

/** Remember the user's corrections of AI portions ("un plato de lentejas" → 350 g). */
export async function learnPortions(personId: string, corrections: { phrase: string; grams: number; foodId?: string | null }[]) {
  const u = await getApiUser();
  if (!u) throw new Error("No autenticado");
  await assertAccess(u.id, personId, "diary", true);
  const list = z.array(z.object({ phrase: z.string().min(2).max(120), grams: z.number().min(1).max(3000), foodId: z.string().uuid().nullish() })).max(20).parse(corrections);
  for (const c of list) await learnPortion(db(), personId, c.phrase, c.grams, c.foodId ?? null);
}

"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { learnPortion } from "@nutria/ai";
import { aiMemories, and, eq, groupMembers, groups } from "@nutria/db";
import { db } from "@/lib/db";
import { assertAccess, getApiUser } from "@/lib/session";

async function user() {
  const u = await getApiUser();
  if (!u) throw new Error("No autenticado");
  return u;
}

/** Remember the user's corrections of AI portions ("un plato de lentejas" → 350 g). */
export async function learnPortions(personId: string, corrections: { phrase: string; grams: number; foodId?: string | null }[]) {
  const u = await user();
  await assertAccess(u.id, personId, "diary", true);
  const list = z.array(z.object({ phrase: z.string().min(2).max(120), grams: z.number().min(1).max(3000), foodId: z.string().uuid().nullish() })).max(20).parse(corrections);
  for (const c of list) await learnPortion(db(), personId, c.phrase, c.grams, c.foodId ?? null);
}

const CATEGORIES = ["gustos", "rutina", "salud", "objetivos", "cocina", "otros"] as const;

export async function addMemory(personId: string, category: string, contentMd: string) {
  const u = await user();
  await assertAccess(u.id, personId, "ai", true);
  await db().insert(aiMemories).values({ personId, category: z.enum(CATEGORIES).parse(category), contentMd: z.string().min(2).max(1000).parse(contentMd), source: "user" });
  refresh();
}

export async function deleteMemory(personId: string, id: string) {
  const u = await user();
  await assertAccess(u.id, personId, "ai", true);
  await db().delete(aiMemories).where(and(eq(aiMemories.id, z.string().uuid().parse(id)), eq(aiMemories.personId, personId)));
  refresh();
}

/** Household (group) preferences in markdown, used by the planner. Any member can edit. */
export async function saveHouseholdPreferences(groupId: string, md: string) {
  const u = await user();
  const [m] = await db().select().from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, u.id))).limit(1);
  if (!m) throw new Error("Sin permiso");
  await db().update(groups).set({ preferencesMd: z.string().max(8000).parse(md) }).where(eq(groups.id, groupId));
  refresh();
}

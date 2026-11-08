/**
 * Apply an AI proposal after the user confirms it. The AI never writes on its own: tools only
 * push proposals; this is the single place where they become data.
 */
import { aiMemories, aiMessages, and, desc, eq, notificationPrefs, shoppingItems, shoppingLists, targetSets, type Database } from "@nutria/db";
import { guessCategory, rebalanceMacros } from "@nutria/nutrition";
import { z } from "zod";
import { addEntries } from "./diary";

type Part = { type: string; kind?: string; summary?: string; payload?: unknown; status?: string };

const DiaryP = z.object({ date: z.string(), mealSlot: z.string(), items: z.array(z.object({ foodId: z.string().uuid().optional(), name: z.string(), grams: z.number().positive() })) });
const MemoryP = z.object({ category: z.string(), contentMd: z.string() });
const TargetsP = z.object({ kcal: z.number().optional(), protein: z.number().optional(), carbs: z.number().optional(), fat: z.number().optional(), reason: z.string().optional() });
const ShoppingP = z.object({ items: z.array(z.object({ name: z.string(), quantity: z.number().optional(), unit: z.string().optional() })) });
const ReminderP = z.object({ title: z.string(), time: z.string().regex(/^\d{2}:\d{2}$/), daysOfWeek: z.array(z.number().int()).default([]) });

/** Active shopping list of a group (created on demand). */
export async function activeShoppingList(db: Database, groupId: string) {
  const [l] = await db.select().from(shoppingLists).where(and(eq(shoppingLists.groupId, groupId), eq(shoppingLists.status, "open"))).orderBy(desc(shoppingLists.createdAt)).limit(1);
  if (l) return l;
  const [n] = await db.insert(shoppingLists).values({ groupId, name: "Lista de la compra", status: "open" }).returning();
  return n!;
}

export async function applyProposal(db: Database, input: { userId: string; personId: string; groupId: string | null; messageId: string; index: number }) {
  const [msg] = await db.select().from(aiMessages).where(eq(aiMessages.id, input.messageId)).limit(1);
  if (!msg) throw new Error("Mensaje no encontrado");
  const parts = (msg.parts ?? []) as Part[];
  const proposals = parts.filter((p) => p.type === "proposal");
  const p = proposals[input.index];
  if (!p) throw new Error("Propuesta no encontrada");
  if (p.status === "applied") return { already: true };
  let result: Record<string, unknown> = {};
  switch (p.kind) {
    case "diary_entries": {
      const v = DiaryP.parse(p.payload);
      const rows = await addEntries(db, { personId: input.personId, userId: input.userId, date: v.date, mealSlot: v.mealSlot, origin: "ai_text", items: v.items.map((i) => ({ foodId: i.foodId, name: i.name, grams: i.grams })) });
      result = { entries: rows.length };
      break;
    }
    case "memory": {
      const v = MemoryP.parse(p.payload);
      await db.insert(aiMemories).values({ personId: input.personId, category: v.category, contentMd: v.contentMd, source: "coach" });
      break;
    }
    case "targets": {
      const v = TargetsP.parse(p.payload);
      const [t] = await db.select().from(targetSets).where(and(eq(targetSets.personId, input.personId), eq(targetSets.isDefault, true))).limit(1);
      if (!t) throw new Error("No hay objetivos que cambiar");
      let next = { kcal: v.kcal ?? t.kcal, protein: v.protein ?? t.protein, carbs: v.carbs ?? t.carbs, fat: v.fat ?? t.fat };
      // If only kcal changes, rebalance the non-pinned macros.
      if (v.kcal && v.protein == null && v.carbs == null && v.fat == null) next = { ...rebalanceMacros({ kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat }, v.kcal, t.pinned), kcal: v.kcal };
      await db.update(targetSets).set({ ...next, source: "manual", mode: "fixed" }).where(eq(targetSets.id, t.id));
      break;
    }
    case "shopping": {
      if (!input.groupId) throw new Error("Sin casa para la lista de la compra");
      const v = ShoppingP.parse(p.payload);
      const list = await activeShoppingList(db, input.groupId);
      await db.insert(shoppingItems).values(v.items.map((i, k) => ({ listId: list.id, name: i.name, quantity: i.quantity ?? null, unit: i.unit ?? null, category: guessCategory(i.name), sortOrder: k })));
      result = { listId: list.id, items: v.items.length };
      break;
    }
    case "reminder": {
      const v = ReminderP.parse(p.payload);
      await db.insert(notificationPrefs).values({ userId: input.userId, type: `custom:${crypto.randomUUID()}`, enabled: true, config: { title: v.title, times: [v.time], daysOfWeek: v.daysOfWeek } });
      break;
    }
    default:
      throw new Error(`Propuesta no aplicable: ${p.kind}`);
  }
  let seen = -1;
  const updated = parts.map((x) => (x.type === "proposal" && ++seen === input.index ? { ...x, status: "applied" } : x));
  await db.update(aiMessages).set({ parts: updated as never }).where(eq(aiMessages.id, msg.id));
  return { applied: p.kind, ...result };
}

export async function dismissProposal(db: Database, messageId: string, index: number) {
  const [msg] = await db.select().from(aiMessages).where(eq(aiMessages.id, messageId)).limit(1);
  if (!msg) return;
  let seen = -1;
  const updated = ((msg.parts ?? []) as Part[]).map((x) => (x.type === "proposal" && ++seen === index ? { ...x, status: "dismissed" } : x));
  await db.update(aiMessages).set({ parts: updated as never }).where(eq(aiMessages.id, msg.id));
}

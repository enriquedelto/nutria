/** Faster logging: meal templates (one-tap), repeated-meal suggestions and the quick actions behind notifications. */
import { and, desc, diaryEntries, eq, gte, isNotNull, mealSlots, mealTemplates, persons, sql, type Database, type MealTemplateItem } from "@nutria/db";
import { addDays, todayIn } from "@nutria/nutrition";
import { addEntries, copyMeal } from "./diary";
import { supplementsForDate, takeSupplement } from "./supplements";

const keyOf = (foodIds: string[]) => [...new Set(foodIds)].sort().join(",");

/** Save the foods of a logged meal as a template. Quick-add lines without a food cannot be repeated and are skipped. */
export async function saveMealAsTemplate(db: Database, personId: string, date: string, slot: string, name: string) {
  const rows = await db.select().from(diaryEntries).where(and(eq(diaryEntries.personId, personId), eq(diaryEntries.date, date), eq(diaryEntries.mealSlot, slot), isNotNull(diaryEntries.foodId)));
  if (!rows.length) throw new Error("Esta comida no tiene alimentos que se puedan guardar");
  const items: MealTemplateItem[] = rows.map((r) => ({ foodId: r.foodId!, ...(r.recipeId ? { recipeId: r.recipeId } : {}), name: r.name, grams: r.grams, ...(r.servingLabel ? { servingLabel: r.servingLabel } : {}) }));
  const [t] = await db.insert(mealTemplates).values({ personId, name: name.trim().slice(0, 80) || "Plantilla", mealSlot: slot, items }).returning();
  return t!;
}

export async function listTemplates(db: Database, personId: string) {
  return db.select().from(mealTemplates).where(eq(mealTemplates.personId, personId)).orderBy(desc(mealTemplates.useCount), desc(mealTemplates.updatedAt));
}

/** Log a template in one go (to its own meal unless another slot is given) and count the use. */
export async function logTemplate(db: Database, input: { personId: string; userId: string; templateId: string; date: string; slot?: string | null; /** Makes it idempotent (offline replays). */ clientId?: string }) {
  const [t] = await db.select().from(mealTemplates).where(and(eq(mealTemplates.id, input.templateId), eq(mealTemplates.personId, input.personId))).limit(1);
  if (!t) throw new Error("Plantilla no encontrada");
  const items = t.items.filter((i) => i.foodId);
  if (!items.length) throw new Error("La plantilla está vacía");
  const rows = await addEntries(db, {
    personId: input.personId,
    userId: input.userId,
    date: input.date,
    mealSlot: input.slot ?? t.mealSlot ?? "lunch",
    origin: "manual",
    items: items.map((i, n) => ({ foodId: i.foodId!, recipeId: i.recipeId, grams: i.grams, servingLabel: i.servingLabel, clientId: input.clientId ? `${input.clientId}:${n}` : undefined })),
  });
  if (rows.length || !input.clientId) await db.update(mealTemplates).set({ useCount: sql`${mealTemplates.useCount} + 1`, updatedAt: new Date() }).where(eq(mealTemplates.id, t.id));
  return { template: t, rows };
}

export interface TemplateSuggestion {
  slot: string;
  /** Last day the combination was eaten (the template is saved from it). */
  date: string;
  times: number;
  names: string[];
}

/** Meals repeated 3+ times in 14 days (same foods, same meal) that are not a template yet. */
export async function templateSuggestions(db: Database, personId: string, today: string): Promise<TemplateSuggestion[]> {
  const [rows, existing] = await Promise.all([
    db
      .select({ date: diaryEntries.date, slot: diaryEntries.mealSlot, foodId: diaryEntries.foodId, name: diaryEntries.name })
      .from(diaryEntries)
      .where(and(eq(diaryEntries.personId, personId), gte(diaryEntries.date, addDays(today, -13)), isNotNull(diaryEntries.foodId), sql`${diaryEntries.origin} <> 'supplement'`)),
    db.select({ slot: mealTemplates.mealSlot, items: mealTemplates.items }).from(mealTemplates).where(eq(mealTemplates.personId, personId)),
  ]);
  const have = new Set(existing.map((t) => `${t.slot}|${keyOf(t.items.map((i) => i.foodId ?? ""))}`));
  const meals = new Map<string, { slot: string; date: string; ids: string[]; names: string[] }>();
  for (const r of rows) {
    const k = `${r.date}|${r.slot}`;
    const m = meals.get(k) ?? { slot: r.slot, date: r.date, ids: [], names: [] };
    m.ids.push(r.foodId!);
    if (!m.names.includes(r.name)) m.names.push(r.name);
    meals.set(k, m);
  }
  const combos = new Map<string, TemplateSuggestion>();
  for (const m of meals.values()) {
    if (new Set(m.ids).size < 2) continue; // a single food is already one tap away in «Frecuentes»
    const k = `${m.slot}|${keyOf(m.ids)}`;
    if (have.has(k)) continue;
    const c = combos.get(k);
    combos.set(k, c ? { ...c, times: c.times + 1, date: m.date > c.date ? m.date : c.date } : { slot: m.slot, date: m.date, times: 1, names: m.names });
  }
  return [...combos.values()].filter((c) => c.times >= 3).sort((a, b) => b.times - a.times);
}

/** Meal slot closest to the current time of the person. */
async function slotNow(db: Database, personId: string, timeZone: string, now: Date) {
  const slots = await db.select({ key: mealSlots.key, t: mealSlots.defaultTime }).from(mealSlots).where(eq(mealSlots.personId, personId));
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now).split(":").map(Number);
  const cur = h! * 60 + m!;
  let best = "lunch";
  let diff = Infinity;
  for (const s of slots) {
    if (!s.t) continue;
    const d = Math.abs(Number(s.t.slice(0, 2)) * 60 + Number(s.t.slice(3, 5)) - cur);
    if (d < diff) [best, diff] = [s.key, d];
  }
  return best;
}

export type QuickKind = "usual" | "yesterday" | "shake";

/**
 * One-tap logging without opening the app (notification actions, app shortcuts):
 *  - usual: the most used template of the meal that is closest to now;
 *  - yesterday: the same meal as yesterday, if today's is still empty;
 *  - shake: today's whey dose, or a template called «batido».
 * Always answers with a short message for the user.
 */
export async function quickLog(db: Database, input: { personId: string; userId: string; kind: QuickKind; slot?: string | null }, now = new Date()): Promise<{ ok: boolean; message: string }> {
  const [p] = await db.select({ tz: persons.timezone }).from(persons).where(eq(persons.id, input.personId)).limit(1);
  if (!p) return { ok: false, message: "Persona no encontrada" };
  const today = todayIn(p.tz, now);
  const slot = input.slot ?? (await slotNow(db, input.personId, p.tz, now));
  const [slotRow] = await db.select({ label: mealSlots.label }).from(mealSlots).where(and(eq(mealSlots.personId, input.personId), eq(mealSlots.key, slot))).limit(1);
  const label = (slotRow?.label ?? "comida").toLowerCase();

  if (input.kind === "shake") {
    const whey = (await supplementsForDate(db, input.personId, today)).find((s) => s.code === "whey");
    if (whey) {
      if (whey.taken) return { ok: true, message: "El batido de hoy ya estaba registrado" };
      await takeSupplement(db, input.personId, input.userId, whey.id, today);
      return { ok: true, message: `Batido registrado: ${whey.name} (${whey.doseLabel})` };
    }
    const [t] = await db.select().from(mealTemplates).where(and(eq(mealTemplates.personId, input.personId), sql`${mealTemplates.name} ilike '%batido%'`)).orderBy(desc(mealTemplates.useCount)).limit(1);
    if (!t) return { ok: false, message: "Añade la proteína a tus suplementos o guarda una plantilla llamada «Batido»" };
    await logTemplate(db, { personId: input.personId, userId: input.userId, templateId: t.id, date: today, slot });
    return { ok: true, message: `Registrado: ${t.name}` };
  }

  if (input.kind === "yesterday") {
    const [has] = await db.select({ id: diaryEntries.id }).from(diaryEntries).where(and(eq(diaryEntries.personId, input.personId), eq(diaryEntries.date, today), eq(diaryEntries.mealSlot, slot))).limit(1);
    if (has) return { ok: false, message: `Ya hay algo registrado en ${label}` };
    const rows = await copyMeal(db, { personId: input.personId, userId: input.userId, fromDate: addDays(today, -1), toDate: today, fromSlot: slot, toSlot: slot });
    return rows.length ? { ok: true, message: `Copiado de ayer: ${rows.length} ${rows.length === 1 ? "alimento" : "alimentos"} en ${label}` } : { ok: false, message: `Ayer no registraste ${label}` };
  }

  const all = await listTemplates(db, input.personId);
  const t = all.find((x) => x.mealSlot === slot) ?? null;
  if (!t) return { ok: false, message: `Aún no tienes una plantilla para ${label}: guárdala desde el menú de la comida` };
  await logTemplate(db, { personId: input.personId, userId: input.userId, templateId: t.id, date: today, slot });
  return { ok: true, message: `Registrado en ${label}: ${t.name}` };
}

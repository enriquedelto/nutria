"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { aiEstimates, and, eq, groups, inArray, mealPlanItems, mealPlans, mealSlots, persons, planRetros, recipeRatings, recipes, type PortionByPerson } from "@nutria/db";
import { addEntries, targetsForDate } from "@nutria/core";
import { generateMealPlan, summarizeRetro } from "@nutria/ai";
import { DEFAULT_SLOT_SHARES, familyPortions } from "@nutria/nutrition";
import { db } from "@/lib/db";
import { kitchenGuard } from "@/lib/kitchen";
import { assertAccess } from "@/lib/session";

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function ownPlan(planId: string, groupId: string) {
  const [p] = await db().select().from(mealPlans).where(and(eq(mealPlans.id, uuid.parse(planId)), eq(mealPlans.groupId, groupId))).limit(1);
  if (!p) throw new Error("Plan no encontrado");
  return p;
}

/** Group persons the user may read (diary scope) — the only ones that can be planned for. */
async function plannable(userId: string, groupId: string, ids: string[]) {
  const rows = await db().select({ id: persons.id }).from(persons).where(and(eq(persons.groupId, groupId), inArray(persons.id, ids)));
  const ok: { id: string; scopes: ReadonlySet<string> }[] = [];
  for (const r of rows) {
    try {
      const a = await assertAccess(userId, r.id, "diary");
      ok.push({ id: r.id, scopes: a.scopes });
    } catch {}
  }
  return ok;
}

export async function createPlan(weekStart: string, personIds: string[]) {
  const { user, groupId } = await kitchenGuard();
  const ps = await plannable(user.id, groupId, z.array(uuid).min(1).max(12).parse(personIds));
  const [p] = await db().insert(mealPlans).values({ groupId, weekStart: day.parse(weekStart), personIds: ps.map((x) => x.id), status: "active", createdBy: user.id }).returning({ id: mealPlans.id });
  refresh();
  return p!.id;
}

/** Portions per person for a dish: each person's kcal budget for that meal ÷ kcal per serving. */
async function portionsFor(personIds: string[], date: string, slot: string, kcalPerServing: number | null): Promise<PortionByPerson> {
  if (!kcalPerServing) return Object.fromEntries(personIds.map((id) => [id, { servings: 1 }]));
  const members = await Promise.all(
    personIds.map(async (id) => {
      const [t, [s]] = await Promise.all([targetsForDate(db(), id, date), db().select({ share: mealSlots.kcalShare }).from(mealSlots).where(and(eq(mealSlots.personId, id), eq(mealSlots.key, slot))).limit(1)]);
      return { personId: id, dailyKcal: t?.kcal ?? 2000, slotShare: s?.share ?? DEFAULT_SLOT_SHARES[slot] ?? 0.3 };
    }),
  );
  return familyPortions(members, kcalPerServing);
}

export async function addPlanItem(planId: string, input: { date: string; mealSlot: string; recipeId?: string | null; title?: string; note?: string | null }) {
  const { groupId } = await kitchenGuard();
  const p = await ownPlan(planId, groupId);
  const v = z.object({ date: day, mealSlot: z.string().min(1).max(40), recipeId: uuid.nullish(), title: z.string().trim().max(200).optional(), note: z.string().max(4000).nullish() }).parse(input);
  let title = v.title ?? "";
  let kcal: number | null = null;
  if (v.recipeId) {
    const [r] = await db().select({ title: recipes.title, kcal: recipes.kcalPerServing }).from(recipes).where(and(eq(recipes.id, v.recipeId), eq(recipes.groupId, groupId))).limit(1);
    if (!r) throw new Error("Receta no encontrada");
    title ||= r.title;
    kcal = r.kcal;
  }
  if (!title) throw new Error("Pon un título o elige una receta");
  await db().insert(mealPlanItems).values({ planId: p.id, date: v.date, mealSlot: v.mealSlot, recipeId: v.recipeId ?? null, title, note: v.note ?? null, portions: await portionsFor(p.personIds, v.date, v.mealSlot, kcal) });
  refresh();
}

export async function movePlanItem(itemId: string, date: string, mealSlot: string) {
  const { groupId } = await kitchenGuard();
  const [it] = await db().select({ id: mealPlanItems.id }).from(mealPlanItems).innerJoin(mealPlans, eq(mealPlans.id, mealPlanItems.planId)).where(and(eq(mealPlanItems.id, uuid.parse(itemId)), eq(mealPlans.groupId, groupId))).limit(1);
  if (!it) throw new Error("No encontrado");
  await db().update(mealPlanItems).set({ date: day.parse(date), mealSlot: z.string().max(40).parse(mealSlot) }).where(eq(mealPlanItems.id, it.id));
  refresh();
}

export async function deletePlanItem(itemId: string) {
  const { groupId } = await kitchenGuard();
  const [it] = await db().select({ id: mealPlanItems.id }).from(mealPlanItems).innerJoin(mealPlans, eq(mealPlans.id, mealPlanItems.planId)).where(and(eq(mealPlanItems.id, uuid.parse(itemId)), eq(mealPlans.groupId, groupId))).limit(1);
  if (it) await db().delete(mealPlanItems).where(eq(mealPlanItems.id, it.id));
  refresh();
}

export async function setPortion(itemId: string, personId: string, servings: number) {
  const { groupId } = await kitchenGuard();
  const [row] = await db().select({ item: mealPlanItems }).from(mealPlanItems).innerJoin(mealPlans, eq(mealPlans.id, mealPlanItems.planId)).where(and(eq(mealPlanItems.id, uuid.parse(itemId)), eq(mealPlans.groupId, groupId))).limit(1);
  if (!row) throw new Error("No encontrado");
  const portions = { ...row.item.portions };
  const s = z.number().min(0).max(10).parse(servings);
  if (s === 0) delete portions[personId];
  else portions[uuid.parse(personId)] = { ...portions[personId], servings: s };
  await db().update(mealPlanItems).set({ portions }).where(eq(mealPlanItems.id, row.item.id));
  refresh();
}

/** Log a planned dish to each person's diary with their portion. */
export async function logPlanItem(itemId: string, personIds: string[]) {
  const { user, groupId } = await kitchenGuard();
  const [row] = await db().select({ item: mealPlanItems, recipe: { foodId: recipes.foodId, totalWeightG: recipes.totalWeightG, servings: recipes.servings } }).from(mealPlanItems).innerJoin(mealPlans, eq(mealPlans.id, mealPlanItems.planId)).leftJoin(recipes, eq(recipes.id, mealPlanItems.recipeId)).where(and(eq(mealPlanItems.id, uuid.parse(itemId)), eq(mealPlans.groupId, groupId))).limit(1);
  if (!row) throw new Error("No encontrado");
  if (!row.recipe?.foodId) throw new Error("Solo se pueden registrar platos con receta guardada");
  const gramsPerServing = row.recipe.totalWeightG ? row.recipe.totalWeightG / (row.recipe.servings || 1) : 300;
  let n = 0;
  for (const pid of z.array(uuid).max(12).parse(personIds)) {
    const portion = row.item.portions[pid]?.servings ?? 1;
    await assertAccess(user.id, pid, "diary", true);
    await addEntries(db(), { personId: pid, userId: user.id, date: row.item.date, mealSlot: row.item.mealSlot, origin: "plan", items: [{ foodId: row.recipe.foodId, recipeId: row.item.recipeId, batchId: row.item.batchId, grams: Math.round(gramsPerServing * portion), servingLabel: "ración", servingQty: portion, clientId: `plan:${row.item.id}:${pid}` }] });
    n++;
  }
  refresh();
  return n;
}

/* ------------------------------- AI planner ------------------------------- */

const GenIn = z.object({
  weekStart: day,
  personIds: z.array(uuid).min(1).max(12),
  days: z.number().int().min(1).max(14).default(7),
  slots: z.array(z.string().max(40)).min(1).max(6),
  maxPrepMinWeekday: z.number().int().min(5).max(240).nullish(),
  budgetPerDay: z.number().min(1).max(500).nullish(),
  notes: z.string().max(1000).nullish(),
});

export async function generatePlanDraft(input: z.input<typeof GenIn>) {
  const { user, groupId } = await kitchenGuard();
  const v = GenIn.parse(input);
  const ps = await plannable(user.id, groupId, v.personIds);
  if (!ps.length) throw new Error("Sin personas que planificar");
  if (!ps.some((p) => p.scopes.has("ai"))) throw new Error("Sin permiso de IA");
  const r = await generateMealPlan({ db: db(), userId: user.id, groupId }, { personIds: ps.map((p) => p.id), from: v.weekStart, days: v.days, slots: v.slots, maxPrepMinWeekday: v.maxPrepMinWeekday ?? undefined, budgetPerDay: v.budgetPerDay ?? undefined, notes: v.notes ?? undefined, scopesByPerson: Object.fromEntries(ps.map((p) => [p.id, p.scopes])) });
  return r;
}

/** Turn an accepted AI draft into plan items (replacing the unplanned cells only). */
export async function applyPlanDraft(estimateId: string, weekStart: string, personIds: string[]) {
  const { user, groupId } = await kitchenGuard();
  const [e] = await db().select().from(aiEstimates).where(and(eq(aiEstimates.id, uuid.parse(estimateId)), eq(aiEstimates.userId, user.id), eq(aiEstimates.kind, "meal_plan"))).limit(1);
  if (!e) throw new Error("Propuesta no encontrada");
  const draft = e.output as { days: { date: string; meals: { mealSlot: string; recipeId: string | null; title: string; ingredients: string[]; servingsByPerson: { personId: string; servings: number }[]; why: string }[] }[] };
  const ps = (await plannable(user.id, groupId, z.array(uuid).parse(personIds))).map((p) => p.id);
  let [plan] = await db().select().from(mealPlans).where(and(eq(mealPlans.groupId, groupId), eq(mealPlans.weekStart, day.parse(weekStart)))).limit(1);
  if (!plan) [plan] = await db().insert(mealPlans).values({ groupId, weekStart, personIds: ps, status: "active", createdBy: user.id, aiEstimateId: e.id }).returning();
  const existing = await db().select({ date: mealPlanItems.date, slot: mealPlanItems.mealSlot }).from(mealPlanItems).where(eq(mealPlanItems.planId, plan!.id));
  const taken = new Set(existing.map((x) => `${x.date}|${x.slot}`));
  const kcalOf = new Map((await db().select({ id: recipes.id, kcal: recipes.kcalPerServing }).from(recipes).where(eq(recipes.groupId, groupId))).map((r) => [r.id, r.kcal]));
  let n = 0;
  for (const d of draft.days)
    for (const [i, m] of d.meals.entries()) {
      if (taken.has(`${d.date}|${m.mealSlot}`)) continue;
      const fromAi: PortionByPerson = Object.fromEntries(m.servingsByPerson.filter((s) => ps.includes(s.personId)).map((s) => [s.personId, { servings: s.servings }]));
      const portions = m.recipeId && kcalOf.get(m.recipeId) ? await portionsFor(ps, d.date, m.mealSlot, kcalOf.get(m.recipeId)!) : Object.keys(fromAi).length ? fromAi : Object.fromEntries(ps.map((id) => [id, { servings: 1 }]));
      const note = [m.why, ...(m.recipeId ? [] : m.ingredients.map((x) => `- ${x}`))].filter(Boolean).join("\n");
      await db().insert(mealPlanItems).values({ planId: plan!.id, date: d.date, mealSlot: m.mealSlot, recipeId: m.recipeId, title: m.title.slice(0, 200), note, portions, sortOrder: i });
      n++;
    }
  await db().update(aiEstimates).set({ status: "confirmed", confirmedAt: new Date() }).where(eq(aiEstimates.id, e.id));
  refresh();
  return { planId: plan!.id, added: n };
}

/* ----------------------------- retrospective ----------------------------- */

export async function saveRetroAnswers(planId: string, personId: string, answers: Record<string, { verdict?: "like" | "dislike" | "neutral"; notEaten?: boolean; stars?: number }>, comment: string) {
  const { user, groupId } = await kitchenGuard();
  const p = await ownPlan(planId, groupId);
  await assertAccess(user.id, uuid.parse(personId), "diary", true);
  const items = await db().select().from(mealPlanItems).where(eq(mealPlanItems.planId, p.id));
  for (const [itemId, a] of Object.entries(answers)) {
    const it = items.find((x) => x.id === itemId);
    if (!it?.recipeId) continue;
    await db().delete(recipeRatings).where(and(eq(recipeRatings.planItemId, it.id), eq(recipeRatings.personId, personId)));
    await db().insert(recipeRatings).values({ recipeId: it.recipeId, personId, planItemId: it.id, verdict: a.verdict ?? null, notEaten: a.notEaten ?? false, stars: a.stars ?? null });
  }
  await db().delete(planRetros).where(and(eq(planRetros.planId, p.id), eq(planRetros.personId, personId)));
  await db().insert(planRetros).values({ planId: p.id, personId, answers: { items: answers, comment: z.string().max(2000).parse(comment) } });
  refresh();
}

/** AI turns the week's feedback into updated household / per-person preferences (shown before saving). */
export async function retroProposal(planId: string) {
  const { user, groupId } = await kitchenGuard();
  const p = await ownPlan(planId, groupId);
  const [items, retros, [g], people] = await Promise.all([
    db().select().from(mealPlanItems).where(eq(mealPlanItems.planId, p.id)),
    db().select().from(planRetros).where(eq(planRetros.planId, p.id)),
    db().select({ md: groups.preferencesMd }).from(groups).where(eq(groups.id, groupId)),
    db().select({ id: persons.id, name: persons.displayName, md: persons.preferencesMd }).from(persons).where(inArray(persons.id, p.personIds.length ? p.personIds : ["00000000-0000-0000-0000-000000000000"])),
  ]);
  if (!retros.length) throw new Error("Primero valorad los platos de la semana");
  const title = new Map(items.map((i) => [i.id, i.title]));
  const feedback = retros
    .map((r) => {
      const who = people.find((x) => x.id === r.personId)?.name ?? "Alguien";
      const a = r.answers as { items?: Record<string, { verdict?: string; notEaten?: boolean; stars?: number }>; comment?: string };
      const lines = Object.entries(a.items ?? {}).map(([id, v]) => `- ${title.get(id) ?? "plato"}: ${v.notEaten ? "no se lo comió" : v.verdict === "like" ? "le gustó" : v.verdict === "dislike" ? "no le gustó" : "normal"}${v.stars ? ` (${v.stars}★)` : ""}`);
      return `### ${who}\n${lines.join("\n")}${a.comment ? `\nComentario: ${a.comment}` : ""}`;
    })
    .join("\n\n");
  const editable = [];
  for (const x of people) {
    try {
      const a = await assertAccess(user.id, x.id, "diary", true);
      if (a.role === "owner" || a.role === "manager") editable.push(x);
    } catch {}
  }
  const r = await summarizeRetro({ db: db(), userId: user.id, groupId }, { planId: p.id, feedback, household: g?.md ?? "", perPerson: editable.map((x) => ({ personId: x.id, name: x.name, current: x.md })) });
  return { ...r, names: Object.fromEntries(editable.map((x) => [x.id, x.name])) };
}

export async function applyRetro(planId: string, estimateId: string, householdMd: string, perPerson: { personId: string; preferencesMd: string }[]) {
  const { user, groupId } = await kitchenGuard();
  const plan = await ownPlan(planId, groupId);
  await db().update(mealPlans).set({ status: "done" }).where(eq(mealPlans.id, plan.id));
  await db().update(groups).set({ preferencesMd: z.string().max(8000).parse(householdMd) }).where(eq(groups.id, groupId));
  for (const p of z.array(z.object({ personId: uuid, preferencesMd: z.string().max(4000) })).max(12).parse(perPerson)) {
    const a = await assertAccess(user.id, p.personId, "diary", true);
    if (a.role === "owner" || a.role === "manager") await db().update(persons).set({ preferencesMd: p.preferencesMd }).where(eq(persons.id, p.personId));
  }
  await db().update(aiEstimates).set({ status: "confirmed", confirmedAt: new Date() }).where(and(eq(aiEstimates.id, uuid.parse(estimateId)), eq(aiEstimates.userId, user.id)));
  refresh();
}

export async function setItemCooked(itemId: string, cooked: boolean) {
  const { groupId } = await kitchenGuard();
  const [it] = await db().select({ id: mealPlanItems.id }).from(mealPlanItems).innerJoin(mealPlans, eq(mealPlans.id, mealPlanItems.planId)).where(and(eq(mealPlanItems.id, uuid.parse(itemId)), eq(mealPlans.groupId, groupId))).limit(1);
  if (!it) throw new Error("No encontrado");
  await db().update(mealPlanItems).set({ cooked }).where(eq(mealPlanItems.id, it.id));
  refresh();
}

export async function setPlanPersons(planId: string, personIds: string[]) {
  const { user, groupId } = await kitchenGuard();
  const p = await ownPlan(planId, groupId);
  const ps = await plannable(user.id, groupId, z.array(uuid).min(1).max(12).parse(personIds));
  await db().update(mealPlans).set({ personIds: ps.map((x) => x.id) }).where(eq(mealPlans.id, p.id));
  refresh();
}

/** Copy every item of another week into this one (same weekday), keeping portions recomputed. */
export async function copyWeek(fromPlanId: string, toWeekStart: string) {
  const { user, groupId } = await kitchenGuard();
  const src = await ownPlan(fromPlanId, groupId);
  const to = day.parse(toWeekStart);
  let [dst] = await db().select().from(mealPlans).where(and(eq(mealPlans.groupId, groupId), eq(mealPlans.weekStart, to))).limit(1);
  if (!dst) [dst] = await db().insert(mealPlans).values({ groupId, weekStart: to, personIds: src.personIds, status: "active", createdBy: user.id }).returning();
  const items = await db().select().from(mealPlanItems).where(eq(mealPlanItems.planId, src.id));
  const shift = Math.round((Date.parse(to) - Date.parse(src.weekStart)) / 86_400_000);
  const kcalOf = new Map((await db().select({ id: recipes.id, kcal: recipes.kcalPerServing }).from(recipes).where(eq(recipes.groupId, groupId))).map((r) => [r.id, r.kcal]));
  for (const it of items) {
    const d = new Date(`${it.date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + shift);
    const date = d.toISOString().slice(0, 10);
    const portions = it.recipeId && kcalOf.get(it.recipeId) ? await portionsFor(dst!.personIds, date, it.mealSlot, kcalOf.get(it.recipeId)!) : it.portions;
    await db().insert(mealPlanItems).values({ planId: dst!.id, date, mealSlot: it.mealSlot, recipeId: it.recipeId, foodId: it.foodId, title: it.title, note: it.note, portions, sortOrder: it.sortOrder });
  }
  refresh();
  return items.length;
}

/** Kitchen services: recipes (nutrition + catalogue food), plans → shopping, cooking, batches. */
import {
  and,
  asc,
  batches,
  desc,
  eq,
  foods,
  foodServings,
  gte,
  inArray,
  isNotNull,
  mealPlanItems,
  mealPlans,
  pantryItems,
  prices,
  recipeIngredients,
  recipes,
  recipeSteps,
  searchFoods,
  shoppingItems,
  shoppingLists,
  sql,
  type Database,
} from "@nutria/db";
import { openPrices } from "@nutria/integrations";
import { aggregateShopping, guessCategory, ingredientKey, macroColumns, parseIngredient, recipeNutrition, type NeedItem, type NutrientMap } from "@nutria/nutrition";

export interface RecipeInput {
  title: string;
  description?: string | null;
  servings: number;
  prepMin?: number | null;
  cookMin?: number | null;
  imageUrl?: string | null;
  sourceUrl?: string | null;
  sourceType?: "manual" | "url" | "video" | "ai" | "import";
  tags?: string[];
  equipment?: string[];
  freezable?: boolean;
  fridgeDays?: number | null;
  totalWeightG?: number | null;
  ingredients: { rawText: string; foodId?: string | null; grams?: number | null; section?: string | null; optional?: boolean }[];
  steps: { text: string; timerSec?: number | null }[];
}

/** Best catalogue match for an ingredient name: generic (CIQUAL) and own foods first. */
export async function matchIngredient(db: Database, name: string, groupId: string | null) {
  const q = name.replace(/\b(de|del|la|el|los|las|al|y|en)\b/gi, " ").replace(/\s+/g, " ").trim();
  if (q.length < 2) return null;
  const found = await searchFoods(db, q, { groupId, limit: 5 });
  return found.find((f) => f.source === "ciqual" || f.source === "custom") ?? found[0] ?? null;
}

/**
 * Fill in prices from Open Prices (crowd-sourced receipts) for foods with a barcode and no price
 * in the last 60 days: the median €/kg of the latest EUR observations. Network failures are ignored.
 */
export async function refreshOpenPrices(db: Database, foodIds: string[], f: typeof fetch = fetch) {
  if (!foodIds.length) return 0;
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const recent = await db.selectDistinct({ foodId: prices.foodId }).from(prices).where(and(inArray(prices.foodId, foodIds), gte(prices.observedOn, since), sql`${prices.pricePerKg} is not null`));
  const have = new Set(recent.map((r) => r.foodId));
  const todo = (await db.select({ id: foods.id, barcode: foods.barcode }).from(foods).where(and(inArray(foods.id, foodIds.filter((id) => !have.has(id))), isNotNull(foods.barcode)))).slice(0, 20);
  let n = 0;
  await Promise.all(
    todo.map(async (food) => {
      const obs = (await openPrices(food.barcode!, f).catch(() => [])).filter((o) => o.currency === "EUR" && o.pricePerKg != null);
      if (!obs.length) return;
      const sorted = obs.map((o) => o.pricePerKg!).sort((a, b) => a - b);
      const perKg = sorted[Math.floor(sorted.length / 2)]!;
      const latest = obs[0]!;
      await db.insert(prices).values({ foodId: food.id, barcode: food.barcode, price: latest.price.toFixed(2), pricePerKg: perKg.toFixed(2), packGrams: latest.packGrams, source: "open_prices", observedOn: latest.date.slice(0, 10) });
      n++;
    }),
  );
  return n;
}

/** Latest known €/kg per food (any store), for recipe cost. */
async function pricePerKg(db: Database, foodIds: string[]) {
  if (!foodIds.length) return new Map<string, number>();
  const rows = await db
    .selectDistinctOn([prices.foodId], { foodId: prices.foodId, perKg: prices.pricePerKg })
    .from(prices)
    .where(and(inArray(prices.foodId, foodIds), sql`${prices.pricePerKg} is not null`))
    .orderBy(prices.foodId, desc(prices.observedOn));
  return new Map(rows.map((r) => [r.foodId!, Number(r.perKg)]));
}

/**
 * Create or replace a recipe: parse ingredient lines, match foods, compute nutrition per serving
 * and keep a catalogue food (source=recipe) with a "ración" serving so it can be logged.
 */
export async function saveRecipe(db: Database, input: { groupId: string; userId: string; recipe: RecipeInput; recipeId?: string }) {
  const r = input.recipe;
  const parsed = await Promise.all(
    r.ingredients.map(async (ing, i) => {
      const p = parseIngredient(ing.rawText);
      const food = ing.foodId ? ((await db.select().from(foods).where(eq(foods.id, ing.foodId)).limit(1))[0] ?? null) : await matchIngredient(db, p.name, input.groupId);
      return { i, ing, p, food, grams: ing.grams ?? p.grams };
    }),
  );
  const matched = parsed.map((x) => x.food?.id).filter((x): x is string => !!x);
  await refreshOpenPrices(db, matched);
  const costs = await pricePerKg(db, matched);
  const nut = recipeNutrition(
    parsed.map((x) => ({ grams: x.grams, optional: x.ing.optional ?? x.p.optional, per100: x.food ? { ...x.food.nutrients, ...(x.food.kcal != null ? { energy_kcal: x.food.kcal } : {}) } : null, pricePerKg: x.food ? (costs.get(x.food.id) ?? null) : null })),
    r.servings,
    r.totalWeightG,
  );
  const ps = macroColumns(nut.perServing);
  const weight = r.totalWeightG ?? nut.rawWeight;
  const servingGrams = weight > 0 ? Math.round(weight / Math.max(r.servings, 0.01)) : null;

  return db.transaction(async (tx) => {
    const values = {
      groupId: input.groupId,
      createdBy: input.userId,
      title: r.title.slice(0, 200),
      description: r.description ?? null,
      servings: r.servings,
      prepMin: r.prepMin ?? null,
      cookMin: r.cookMin ?? null,
      imageUrl: r.imageUrl ?? null,
      sourceUrl: r.sourceUrl ?? null,
      sourceType: r.sourceType ?? "manual",
      tags: r.tags ?? [],
      equipment: r.equipment ?? [],
      freezable: r.freezable ?? false,
      fridgeDays: r.fridgeDays ?? null,
      totalWeightG: weight || null,
      nutrientsPerServing: nut.perServing,
      kcalPerServing: ps.kcal,
      proteinPerServing: ps.protein,
      carbsPerServing: ps.carbs,
      fatPerServing: ps.fat,
      costPerServing: nut.costPerServing != null ? String(nut.costPerServing) : null,
    };
    let recipe: typeof recipes.$inferSelect;
    if (input.recipeId) {
      [recipe] = (await tx.update(recipes).set(values).where(and(eq(recipes.id, input.recipeId), eq(recipes.groupId, input.groupId))).returning()) as [typeof recipe];
      if (!recipe) throw new Error("Receta no encontrada");
      await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, recipe.id));
      await tx.delete(recipeSteps).where(eq(recipeSteps.recipeId, recipe.id));
    } else {
      [recipe] = (await tx.insert(recipes).values(values).returning()) as [typeof recipe];
    }
    if (parsed.length)
      await tx.insert(recipeIngredients).values(
        parsed.map((x) => ({ recipeId: recipe.id, sortOrder: x.i, rawText: x.ing.rawText, foodId: x.food?.id ?? null, grams: x.grams, quantity: x.p.quantity, unit: x.p.unit, optional: x.ing.optional ?? x.p.optional, section: x.ing.section ?? null, shoppingCategory: guessCategory(x.p.name) })),
      );
    if (r.steps.length) await tx.insert(recipeSteps).values(r.steps.map((s, i) => ({ recipeId: recipe.id, sortOrder: i, text: s.text, timerSec: s.timerSec ?? null })));

    // Catalogue food mirroring the recipe (per 100 g of cooked dish).
    const per100: NutrientMap = nut.per100;
    const m = macroColumns(per100);
    const foodValues = { source: "recipe" as const, foodGroup: "platos", sourceId: `recipe:${recipe.id}`, name: recipe.title, nameEs: recipe.title, groupId: input.groupId, createdBy: input.userId, imageUrl: recipe.imageUrl, nutrients: per100, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat, fiber: m.fiber };
    const [food] = await tx
      .insert(foods)
      .values(foodValues)
      .onConflictDoUpdate({ target: [foods.source, foods.sourceId], targetWhere: sql`${foods.sourceId} is not null`, set: { ...foodValues, updatedAt: new Date() } })
      .returning({ id: foods.id });
    await tx.delete(foodServings).where(eq(foodServings.foodId, food!.id));
    if (servingGrams) await tx.insert(foodServings).values({ foodId: food!.id, label: "1 ración", grams: servingGrams, isDefault: true, source: "recipe" });
    await tx.update(recipes).set({ foodId: food!.id }).where(eq(recipes.id, recipe.id));
    return { ...recipe, foodId: food!.id, missing: nut.missing, servingGrams };
  });
}

export async function recipeDetail(db: Database, recipeId: string, groupId: string | null) {
  const [r] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), groupId ? eq(recipes.groupId, groupId) : sql`false`))
    .limit(1);
  if (!r) return null;
  const [ings, steps] = await Promise.all([
    db.select({ ing: recipeIngredients, food: { id: foods.id, name: foods.nameEs, rawName: foods.name, kcal: foods.kcal } }).from(recipeIngredients).leftJoin(foods, eq(foods.id, recipeIngredients.foodId)).where(eq(recipeIngredients.recipeId, r.id)).orderBy(asc(recipeIngredients.sortOrder)),
    db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, r.id)).orderBy(asc(recipeSteps.sortOrder)),
  ]);
  return { recipe: r, ingredients: ings.map((x) => ({ ...x.ing, food: x.food?.id ? { id: x.food.id, name: x.food.name ?? x.food.rawName ?? "", kcal: x.food.kcal } : null })), steps };
}

/* ------------------------------- shopping ------------------------------- */

/** Needs from a plan: recipe ingredients scaled by the total servings planned for each meal. */
export async function planNeeds(db: Database, planId: string): Promise<NeedItem[]> {
  const items = await db.select().from(mealPlanItems).where(and(eq(mealPlanItems.planId, planId), eq(mealPlanItems.cooked, false)));
  const recipeIds = [...new Set(items.map((i) => i.recipeId).filter((x): x is string => !!x))];
  const [recs, ings] = recipeIds.length
    ? await Promise.all([db.select({ id: recipes.id, servings: recipes.servings }).from(recipes).where(inArray(recipes.id, recipeIds)), db.select().from(recipeIngredients).where(inArray(recipeIngredients.recipeId, recipeIds))])
    : [[], []];
  const servingsOf = new Map(recs.map((r) => [r.id, r.servings]));
  const needs: NeedItem[] = [];
  for (const it of items) {
    const planned = Object.values(it.portions).reduce((a, p) => a + (p.servings ?? 0), 0) || 1;
    if (it.recipeId) {
      const f = planned / (servingsOf.get(it.recipeId) ?? 1);
      for (const ing of ings.filter((x) => x.recipeId === it.recipeId && !x.optional)) {
        const p = parseIngredient(ing.rawText);
        needs.push({ key: ingredientKey(p.name), name: p.name, grams: ing.grams != null ? ing.grams * f : null, quantity: ing.quantity != null ? ing.quantity * f : null, unit: ing.unit, foodId: ing.foodId, category: ing.shoppingCategory, recipeId: it.recipeId });
      }
    } else if (it.batchId == null) {
      // Free-form dish from the planner: ingredients kept in the note as lines.
      for (const line of (it.note ?? "").split("\n").filter((l) => l.startsWith("- "))) {
        const p = parseIngredient(line.slice(2));
        needs.push({ key: ingredientKey(p.name), name: p.name, grams: p.grams != null ? p.grams * planned : null, quantity: p.quantity, unit: p.unit });
      }
    }
  }
  return needs;
}

export async function openShoppingList(db: Database, groupId: string, planId?: string | null) {
  const [cur] = await db.select().from(shoppingLists).where(and(eq(shoppingLists.groupId, groupId), eq(shoppingLists.status, "open"))).orderBy(desc(shoppingLists.createdAt)).limit(1);
  if (cur) return cur;
  const [l] = await db.insert(shoppingLists).values({ groupId, planId: planId ?? null, name: "Compra" }).returning();
  return l!;
}

/** Plan − pantry → add missing lines to the open list (merging with unchecked lines of the same name). */
export async function shoppingFromPlan(db: Database, input: { groupId: string; planId: string }) {
  const needs = await planNeeds(db, input.planId);
  const stock = await db.select({ name: pantryItems.name, quantity: pantryItems.quantity, unit: pantryItems.unit, gramsPerUnit: pantryItems.gramsPerUnit, staple: pantryItems.staple }).from(pantryItems).where(eq(pantryItems.groupId, input.groupId));
  const lines = aggregateShopping(
    needs,
    stock.map((s) => ({ key: ingredientKey(s.name), staple: s.staple, grams: s.unit === "g" || s.unit === "ml" ? s.quantity : s.gramsPerUnit ? s.gramsPerUnit * s.quantity : null })),
  );
  const list = await openShoppingList(db, input.groupId, input.planId);
  const existing = await db.select().from(shoppingItems).where(and(eq(shoppingItems.listId, list.id), eq(shoppingItems.checked, false)));
  const byKey = new Map<string, (typeof existing)[number]>();
  for (const e of existing) if (!byKey.has(ingredientKey(e.name))) byKey.set(ingredientKey(e.name), e);
  const fresh: (typeof shoppingItems.$inferInsert)[] = [];
  for (const l of lines) {
    const dup = byKey.get(l.key);
    if (dup) {
      // Merging into an existing line is rare (re-adding the same plan): one update each is fine.
      if (l.grams != null && dup.unit === "g") await db.update(shoppingItems).set({ quantity: Math.round((dup.quantity ?? 0) + l.grams), fromRecipes: [...new Set([...dup.fromRecipes, ...l.fromRecipes])] }).where(eq(shoppingItems.id, dup.id));
      continue;
    }
    fresh.push({ listId: list.id, foodId: l.foodId, name: l.name, quantity: l.grams ?? l.quantity, unit: l.grams != null ? "g" : l.unit, category: l.category, fromRecipes: l.fromRecipes });
  }
  if (fresh.length) await db.insert(shoppingItems).values(fresh);
  const added = fresh.length;
  await db.update(shoppingLists).set({ planId: input.planId, updatedAt: new Date() }).where(eq(shoppingLists.id, list.id));
  return { listId: list.id, added, total: lines.length };
}

/* -------------------------------- cooking -------------------------------- */

/**
 * Mark a recipe as cooked: subtract ingredients from the pantry (by food or ingredient key) and
 * optionally store leftovers as a batch of portions (tuppers).
 */
export async function cookRecipe(db: Database, input: { groupId: string; recipeId: string; servings: number; batchPortions?: number; location?: string; planItemId?: string | null; today: string }) {
  const d = await recipeDetail(db, input.recipeId, input.groupId);
  if (!d) throw new Error("Receta no encontrada");
  const f = input.servings / (d.recipe.servings || 1);
  const pantry = await db.select().from(pantryItems).where(eq(pantryItems.groupId, input.groupId)).orderBy(sql`${pantryItems.expiresOn} asc nulls last`);
  const used: string[] = [];
  for (const ing of d.ingredients) {
    if (ing.optional) continue;
    const key = ingredientKey(parseIngredient(ing.rawText).name);
    const item = pantry.find((p) => (ing.foodId && p.foodId === ing.foodId) || ingredientKey(p.name) === key);
    if (!item || item.staple) continue;
    let left = item.quantity;
    if (ing.grams != null && (item.unit === "g" || item.unit === "ml")) left -= ing.grams * f;
    else if (ing.grams != null && item.gramsPerUnit) left -= (ing.grams * f) / item.gramsPerUnit;
    else if (ing.quantity != null && item.unit === "ud") left -= ing.quantity * f;
    else continue;
    used.push(item.name);
    if (left <= 0.01) await db.delete(pantryItems).where(eq(pantryItems.id, item.id));
    else await db.update(pantryItems).set({ quantity: Math.round(left * 100) / 100 }).where(eq(pantryItems.id, item.id));
  }
  let batchId: string | null = null;
  if (input.batchPortions && input.batchPortions > 0) {
    const days = input.location === "congelador" ? 90 : (d.recipe.fridgeDays ?? 3);
    const exp = new Date(Date.parse(`${input.today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    const gramsPerPortion = d.recipe.totalWeightG ? d.recipe.totalWeightG / (d.recipe.servings || 1) : null;
    const [b] = await db
      .insert(batches)
      .values({ groupId: input.groupId, recipeId: d.recipe.id, title: d.recipe.title, portionsTotal: input.batchPortions, portionsLeft: input.batchPortions, gramsPerPortion, location: input.location ?? "nevera", cookedOn: input.today, expiresOn: exp })
      .returning({ id: batches.id });
    batchId = b!.id;
  }
  if (input.planItemId) await db.update(mealPlanItems).set({ cooked: true }).where(eq(mealPlanItems.id, input.planItemId));
  return { used, batchId };
}

/** A week's plan with items, for the plan page and the shopping generator. */
export async function planWeek(db: Database, groupId: string, weekStart: string) {
  const [plan] = await db.select().from(mealPlans).where(and(eq(mealPlans.groupId, groupId), eq(mealPlans.weekStart, weekStart))).orderBy(desc(mealPlans.createdAt)).limit(1);
  if (!plan) return null;
  const items = await db.select().from(mealPlanItems).where(eq(mealPlanItems.planId, plan.id)).orderBy(asc(mealPlanItems.date), asc(mealPlanItems.sortOrder));
  return { plan, items };
}

import "server-only";
import { additives, and, desc, diaryEntries, eq, foodFavorites, foodServings, foods, gte, inArray, isNull, medications, ne, or, personConditions, persons, prices, sql, stores } from "@nutria/db";
import { allergenAlerts, checkInteractions, conditionFoodAlerts, DRUG_FOOD_INTERACTIONS, rankAlternatives, scaleNutrients, specificCategory } from "@nutria/nutrition";
import { db } from "../db";

export type FoodRow = typeof foods.$inferSelect;

/** Compact shape sent to the client for lists. */
export const brief = (f: FoodRow) => ({
  id: f.id,
  name: f.nameEs ?? f.name,
  brand: f.brand,
  kcal: f.kcal,
  protein: f.protein,
  carbs: f.carbs,
  fat: f.fat,
  imageUrl: f.imageUrl,
  nutriscore: f.nutriscore,
  nova: f.nova,
  source: f.source,
  kind: f.kind,
  quantityLabel: f.quantityLabel,
  barcode: f.barcode,
});
export type FoodBrief = ReturnType<typeof brief>;

/** Full detail + per-person alerts (allergens, conditions, medication interactions) + healthier swaps. */
export async function foodDetail(foodId: string, personId: string | null, groupId: string | null) {
  const d = db();
  const [f] = await d
    .select()
    .from(foods)
    .where(and(eq(foods.id, foodId), groupId ? or(isNull(foods.groupId), eq(foods.groupId, groupId)) : isNull(foods.groupId)))
    .limit(1);
  if (!f) return null;
  const servings = await d.select().from(foodServings).where(eq(foodServings.foodId, f.id)).orderBy(desc(foodServings.isDefault));
  const adds = f.additives.length ? await d.select().from(additives).where(inArray(additives.code, f.additives)) : [];
  let alerts: { level: "info" | "caution" | "avoid"; message: string; kind: string }[] = [];
  let alternatives: FoodBrief[] = [];
  if (personId) {
    const [p] = await d.select().from(persons).where(eq(persons.id, personId)).limit(1);
    const [conds, meds] = await Promise.all([
      d.select({ code: personConditions.conditionCode, config: personConditions.config }).from(personConditions).where(and(eq(personConditions.personId, personId), eq(personConditions.active, true))),
      d.select({ name: medications.name, substanceCode: medications.substanceCode }).from(medications).where(and(eq(medications.personId, personId), eq(medications.active, true))),
    ]);
    const per100 = { ...f.nutrients, energy_kcal: f.kcal ?? 0, protein: f.protein ?? 0, carbs: f.carbs ?? 0, fat: f.fat ?? 0 };
    const portion = scaleNutrients(per100, servings[0]?.grams ?? 100);
    alerts = [
      ...allergenAlerts({ allergens: f.allergens, traces: f.traces }, p?.allergens ?? []).map((a) => ({ level: a.level === "traces" ? ("caution" as const) : ("avoid" as const), message: a.level === "traces" ? `Puede contener trazas de ${a.nameEs}` : `Contiene ${a.nameEs}`, kind: "alérgeno" })),
      ...conditionFoodAlerts({ name: f.name, nutrients: portion, categories: f.categories, labels: f.labels, allergens: f.allergens, ingredientsText: f.ingredientsText }, conds, 70).map((a) => ({ level: a.level, message: a.message, kind: a.condition })),
      ...checkInteractions({ name: f.name, nutrients: portion, categories: f.categories, ingredientsText: f.ingredientsText }, meds, DRUG_FOOD_INTERACTIONS).map((h) => ({ level: h.severity, message: `${h.medication}: ${h.message}`, kind: "medicación" })),
    ];
    const cat = specificCategory(f.categories);
    if (cat && (f.nutriscore && f.nutriscore > "b" || (f.nova ?? 0) >= 4)) {
      const cands = await d
        .select()
        .from(foods)
        .where(and(sql`${foods.categories} @> array[${cat}]::text[]`, ne(foods.id, f.id), isNull(foods.groupId)))
        .orderBy(desc(foods.popularity))
        .limit(60);
      const ranked = rankAlternatives(
        { id: f.id, name: f.name, nutriscore: f.nutriscore, nova: f.nova, categories: f.categories, kcal: f.kcal, allergens: f.allergens },
        cands.map((c) => ({ id: c.id, name: c.nameEs ?? c.name, nutriscore: c.nutriscore, nova: c.nova, categories: c.categories, kcal: c.kcal, allergens: c.allergens })),
        p?.allergens ?? [],
      );
      const byId = new Map(cands.map((c) => [c.id, c]));
      alternatives = ranked.map((r) => brief(byId.get(r.id)!));
    }
  }
  return { food: f, servings, additives: adds, alerts, alternatives };
}

/** Recents, frequent and favourites for the quick lists in Buscar. */
export async function quickLists(personId: string) {
  const d = db();
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const [recent, frequent, favs] = await Promise.all([
    d
      .select({ foodId: diaryEntries.foodId, last: sql<string>`max(${diaryEntries.createdAt})`, grams: sql<number>`(array_agg(${diaryEntries.grams} order by ${diaryEntries.createdAt} desc))[1]` })
      .from(diaryEntries)
      .where(and(eq(diaryEntries.personId, personId), gte(diaryEntries.date, since), sql`${diaryEntries.foodId} is not null`))
      .groupBy(diaryEntries.foodId)
      .orderBy(desc(sql`max(${diaryEntries.createdAt})`))
      .limit(20),
    d
      .select({ foodId: diaryEntries.foodId, n: sql<number>`count(*)::int`, grams: sql<number>`percentile_disc(0.5) within group (order by ${diaryEntries.grams})` })
      .from(diaryEntries)
      .where(and(eq(diaryEntries.personId, personId), gte(diaryEntries.date, since), sql`${diaryEntries.foodId} is not null`))
      .groupBy(diaryEntries.foodId)
      .orderBy(desc(sql`count(*)`))
      .limit(20),
    d.select({ foodId: foodFavorites.foodId }).from(foodFavorites).where(eq(foodFavorites.personId, personId)).orderBy(foodFavorites.sortOrder),
  ]);
  const ids = [...new Set([...recent, ...frequent, ...favs].map((r) => r.foodId).filter(Boolean))] as string[];
  const rows = ids.length ? await d.select().from(foods).where(inArray(foods.id, ids)) : [];
  const map = new Map(rows.map((f) => [f.id, brief(f)]));
  const pick = <T extends { foodId: string | null }>(xs: T[]) => xs.map((x) => ({ ...map.get(x.foodId!)!, lastGrams: "grams" in x ? Number((x as { grams: number }).grams) : undefined })).filter((x) => x.id);
  return { recent: pick(recent), frequent: pick(frequent), favorites: pick(favs), favoriteIds: favs.map((f) => f.foodId!) };
}

/** Price history of a food (by id or barcode), newest first, with the store name. */
export async function foodPrices(food: { id: string; barcode: string | null }, groupId: string | null) {
  const match = food.barcode ? or(eq(prices.foodId, food.id), eq(prices.barcode, food.barcode)) : eq(prices.foodId, food.id);
  const rows = await db()
    .select({ id: prices.id, price: prices.price, pricePerKg: prices.pricePerKg, observedOn: prices.observedOn, source: prices.source, store: stores.name })
    .from(prices)
    .leftJoin(stores, eq(stores.id, prices.storeId))
    .where(and(match, groupId ? or(isNull(prices.groupId), eq(prices.groupId, groupId)) : isNull(prices.groupId)))
    .orderBy(desc(prices.observedOn), desc(prices.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r, price: Number(r.price), pricePerKg: r.pricePerKg != null ? Number(r.pricePerKg) : null }));
}

/** Queries shared by web, worker and AI tools. */
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { ACCESS_SCOPES, foods, personAccess, persons, type AccessScope } from "./schema";
import type { Database } from "./client";

/** Same expression as the foods_name_trgm_idx GIN index (so the index is used). */
const searchExpr = sql`f_unaccent(lower(coalesce(${foods.nameEs}, ${foods.name}) || ' ' || coalesce(${foods.brand}, '')))`;

export interface FoodSearchOptions {
  groupId?: string | null;
  limit?: number;
  kinds?: (typeof foods.$inferSelect.kind)[];
  sources?: (typeof foods.$inferSelect.source)[];
}

/**
 * Accent-insensitive fuzzy search over the local catalogue (OFF mirror + CIQUAL + custom of the
 * group). Ranking: exact prefix > trigram similarity > popularity; generic (CIQUAL) foods get a
 * small boost when the query has no brand-like words.
 */
export async function searchFoods(db: Database, q: string, o: FoodSearchOptions = {}) {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  if (/^\d{6,14}$/.test(query)) {
    return db.select().from(foods).where(and(eq(foods.barcode, query), visible(o.groupId))).limit(1);
  }
  const uq = sql`f_unaccent(${query})`;
  const conds = [
    or(sql`${searchExpr} % ${uq}`, sql`${searchExpr} like '%' || ${uq} || '%'`),
    visible(o.groupId),
  ];
  if (o.kinds?.length) conds.push(inArray(foods.kind, o.kinds));
  // Store catalogue rows (prices/cart, usually without nutrition) only when explicitly asked for.
  conds.push(o.sources?.length ? inArray(foods.source, o.sources) : ne(foods.source, "store"));
  return db
    .select()
    .from(foods)
    .where(and(...conds))
    .orderBy(
      desc(sql`(${searchExpr} like ${uq} || '%')::int`),
      desc(sql`word_similarity(${uq}, ${searchExpr}) + case when ${foods.source} in ('custom','recipe') then 0.15 when ${foods.source} = 'ciqual' then 0.05 else 0 end`),
      desc(foods.popularity),
    )
    .limit(o.limit ?? 20);
}

function visible(groupId?: string | null) {
  return groupId ? or(isNull(foods.groupId), eq(foods.groupId, groupId)) : isNull(foods.groupId);
}

export interface PersonAccessInfo {
  personId: string;
  role: "owner" | "manager" | "viewer" | "professional";
  scopes: Set<AccessScope>;
  canWrite: boolean;
}

/**
 * Resolve what `userId` may do on `personId`. Owners and managers get every scope; viewers and
 * professionals only the scopes they were granted. Expired grants are ignored.
 */
export async function getPersonAccess(db: Database, userId: string, personId: string): Promise<PersonAccessInfo | null> {
  const [row] = await db
    .select({ role: personAccess.role, scopes: personAccess.scopes, canWrite: personAccess.canWrite, expiresAt: personAccess.expiresAt })
    .from(personAccess)
    .where(and(eq(personAccess.userId, userId), eq(personAccess.personId, personId)))
    .limit(1);
  if (row) {
    if (row.expiresAt && row.expiresAt < new Date()) return null;
    const full = row.role === "owner" || row.role === "manager";
    return {
      personId,
      role: row.role,
      scopes: new Set(full ? ACCESS_SCOPES : row.scopes),
      canWrite: full || row.canWrite,
    };
  }
  // Own person (persons.user_id) always has full access even without an explicit row.
  const [own] = await db.select({ id: persons.id }).from(persons).where(and(eq(persons.id, personId), eq(persons.userId, userId))).limit(1);
  return own ? { personId, role: "owner", scopes: new Set(ACCESS_SCOPES), canWrite: true } : null;
}

/** getPersonAccess for several persons in two queries (no per-person round trips). */
export async function getPersonAccessMany(db: Database, userId: string, personIds: string[]): Promise<Map<string, PersonAccessInfo>> {
  const out = new Map<string, PersonAccessInfo>();
  const ids = [...new Set(personIds)];
  if (!ids.length) return out;
  const rows = await db
    .select({ personId: personAccess.personId, role: personAccess.role, scopes: personAccess.scopes, canWrite: personAccess.canWrite, expiresAt: personAccess.expiresAt })
    .from(personAccess)
    .where(and(eq(personAccess.userId, userId), inArray(personAccess.personId, ids)));
  const now = new Date();
  for (const r of rows) {
    if (r.expiresAt && r.expiresAt < now) continue;
    const full = r.role === "owner" || r.role === "manager";
    out.set(r.personId, { personId: r.personId, role: r.role, scopes: new Set(full ? ACCESS_SCOPES : r.scopes), canWrite: full || r.canWrite });
  }
  const explicit = new Set(rows.map((r) => r.personId));
  const rest = ids.filter((id) => !explicit.has(id));
  if (rest.length) {
    const own = await db.select({ id: persons.id }).from(persons).where(and(inArray(persons.id, rest), eq(persons.userId, userId)));
    for (const o of own) out.set(o.id, { personId: o.id, role: "owner", scopes: new Set(ACCESS_SCOPES), canWrite: true });
  }
  return out;
}

/** Persons the user can see, with role (for the person switcher). */
export async function listAccessiblePersons(db: Database, userId: string) {
  return db
    .select({ person: persons, role: personAccess.role, scopes: personAccess.scopes, canWrite: personAccess.canWrite })
    .from(personAccess)
    .innerJoin(persons, eq(persons.id, personAccess.personId))
    .where(and(eq(personAccess.userId, userId), or(isNull(personAccess.expiresAt), sql`${personAccess.expiresAt} > now()`)))
    .orderBy(sql`${personAccess.role} = 'owner' desc`, persons.displayName);
}

/* ------------------------------- explore ------------------------------- */

export const EXPLORE_ORIGINS = ["generic", "brand", "store", "mine"] as const;
export const EXPLORE_SORTS = ["relevance", "protein_density", "protein_price", "kcal_asc", "kcal_desc", "price_kg", "nutriscore", "popularity"] as const;

export interface ExploreFilters {
  q?: string;
  group?: string;
  origin?: (typeof EXPLORE_ORIGINS)[number];
  kcalMin?: number;
  kcalMax?: number;
  proteinMin?: number;
  /** ≥ 20 % of the energy from protein. */
  highProtein?: boolean;
  /** EU "low" claims: sugars ≤ 5 g and salt ≤ 0.3 g per 100 g. */
  lowSugar?: boolean;
  lowSalt?: boolean;
  nutriscore?: string[];
  novaMax?: number;
  /** Allergen tags (en:milk…) the food must not contain. */
  withoutAllergens?: string[];
  vegan?: boolean;
  glutenFree?: boolean;
  withPrice?: boolean;
  sort?: (typeof EXPLORE_SORTS)[number];
}

/**
 * Browse the catalogue with nutrition filters. Latest price (own group's or public) per food, by id
 * or barcode. Sorting by price implies "with price". Returns limit+1 rows so callers know if there are more.
 */
export async function exploreFoods(db: Database, f: ExploreFilters, o: { groupId?: string | null; offset?: number; limit?: number } = {}) {
  const limit = Math.min(o.limit ?? 30, 60);
  const g = o.groupId ?? null;
  const priceScope = g ? sql`(p.group_id is null or p.group_id = ${g})` : sql`p.group_id is null`;
  const priceMatch = sql`(p.food_id = ${foods.id} or (${foods.barcode} is not null and p.barcode = ${foods.barcode}))`;
  const latest = (col: string) => sql`(select p.${sql.raw(col)} from prices p where ${priceMatch} and ${priceScope} order by p.observed_on desc, p.created_at desc limit 1)`;
  const price = sql<string | null>`${latest("price")}`;
  const pricePerKg = sql<string | null>`${latest("price_per_kg")}`;
  const sort = f.sort ?? (f.q ? "relevance" : "popularity");
  const needsPrice = f.withPrice || sort === "protein_price" || sort === "price_kg";

  const conds = [visible(g), sql`coalesce(${foods.foodGroup}, '') <> 'no_alimento'`];
  const q = f.q?.trim().toLowerCase();
  const uq = q ? sql`f_unaccent(${q})` : null;
  if (uq) conds.push(or(sql`${searchExpr} % ${uq}`, sql`${searchExpr} like '%' || ${uq} || '%'`)!);
  if (f.origin === "generic") conds.push(eq(foods.source, "ciqual"));
  else if (f.origin === "brand") conds.push(eq(foods.source, "off"));
  else if (f.origin === "store") conds.push(eq(foods.source, "store"));
  else if (f.origin === "mine") conds.push(and(sql`${foods.groupId} is not null`, inArray(foods.source, ["custom", "ai", "recipe"]))!);
  else conds.push(ne(foods.source, "store"));
  if (f.origin !== "store") conds.push(sql`${foods.kcal} is not null`);
  if (f.group) conds.push(eq(foods.foodGroup, f.group));
  if (f.kcalMin != null) conds.push(sql`${foods.kcal} >= ${f.kcalMin}`);
  if (f.kcalMax != null) conds.push(sql`${foods.kcal} <= ${f.kcalMax}`);
  if (f.proteinMin != null) conds.push(sql`${foods.protein} >= ${f.proteinMin}`);
  if (f.highProtein) conds.push(sql`${foods.kcal} > 0 and ${foods.protein} * 4 >= 0.2 * ${foods.kcal}`);
  if (f.lowSugar) conds.push(sql`${foods.sugars} <= 5`);
  if (f.lowSalt) conds.push(sql`${foods.salt} <= 0.3`);
  if (f.nutriscore?.length) conds.push(inArray(foods.nutriscore, f.nutriscore));
  if (f.novaMax) conds.push(sql`${foods.nova} <= ${f.novaMax}`);
  if (f.withoutAllergens?.length) conds.push(sql`not (${foods.allergens} && ${sql`array[${sql.join(f.withoutAllergens.map((a) => sql`${a}`), sql`, `)}]::text[]`})`);
  if (f.vegan) conds.push(sql`${foods.labels} && array['en:vegan','en:european-vegetarian-union-vegan','en:the-vegan-society']::text[]`);
  if (f.glutenFree) conds.push(sql`${foods.labels} && array['en:no-gluten','en:dzg-gluten-free']::text[]`);
  if (needsPrice) conds.push(sql`exists (select 1 from prices p where ${priceMatch} and ${priceScope})`);

  const order = {
    relevance: uq
      ? [desc(sql`(${searchExpr} like ${uq} || '%')::int`), desc(sql`word_similarity(${uq}, ${searchExpr})`), desc(foods.popularity)]
      : [desc(foods.popularity)],
    popularity: [desc(foods.popularity)],
    protein_density: [desc(sql`${foods.protein} / nullif(${foods.kcal}, 0) * 100`), desc(foods.popularity)],
    protein_price: [sql`${foods.protein} * 10 / nullif(${pricePerKg}::numeric, 0) desc nulls last`],
    kcal_asc: [sql`${foods.kcal} asc`, desc(foods.popularity)],
    kcal_desc: [sql`${foods.kcal} desc`, desc(foods.popularity)],
    price_kg: [sql`${pricePerKg}::numeric asc nulls last`],
    nutriscore: [sql`${foods.nutriscore} asc nulls last`, desc(foods.popularity)],
  }[sort];

  return db
    .select({
      id: foods.id,
      name: sql<string>`coalesce(${foods.nameEs}, ${foods.name})`,
      brand: foods.brand,
      source: foods.source,
      kind: foods.kind,
      foodGroup: foods.foodGroup,
      imageUrl: foods.imageUrl,
      quantityLabel: foods.quantityLabel,
      kcal: foods.kcal,
      protein: foods.protein,
      carbs: foods.carbs,
      fat: foods.fat,
      sugars: foods.sugars,
      salt: foods.salt,
      nutriscore: foods.nutriscore,
      nova: foods.nova,
      price,
      pricePerKg,
    })
    .from(foods)
    .where(and(...conds))
    .orderBy(...order)
    .limit(limit + 1)
    .offset(o.offset ?? 0);
}

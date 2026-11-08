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

/** Persons the user can see, with role (for the person switcher). */
export async function listAccessiblePersons(db: Database, userId: string) {
  return db
    .select({ person: persons, role: personAccess.role, scopes: personAccess.scopes, canWrite: personAccess.canWrite })
    .from(personAccess)
    .innerJoin(persons, eq(persons.id, personAccess.personId))
    .where(and(eq(personAccess.userId, userId), or(isNull(personAccess.expiresAt), sql`${personAccess.expiresAt} > now()`)))
    .orderBy(sql`${personAccess.role} = 'owner' desc`, persons.displayName);
}

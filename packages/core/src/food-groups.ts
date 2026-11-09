import { and, asc, foods, gt, isNull, sql, type Database } from "@nutria/db";
import { groupOf } from "@nutria/nutrition";

/**
 * Fill foods.food_group where it is still empty (custom/AI foods, rows imported before the column
 * existed), or recompute every row with `all` after changing the rules. Walks the primary key in
 * batches (keyset) so it neither rescans updated rows nor holds long locks over ~270k rows.
 */
export async function assignFoodGroups(db: Database, opts: { batch?: number; all?: boolean } = {}) {
  const batch = opts.batch ?? 2000;
  let done = 0;
  let last: string | null = null;
  for (;;) {
    const rows: { id: string; name: string; nameEs: string | null; categories: string[]; kind: string; foodGroup: string | null }[] = await db
      .select({ id: foods.id, name: foods.name, nameEs: foods.nameEs, categories: foods.categories, kind: foods.kind, foodGroup: foods.foodGroup })
      .from(foods)
      .where(and(last ? gt(foods.id, last) : undefined, opts.all ? undefined : isNull(foods.foodGroup)))
      .orderBy(asc(foods.id))
      .limit(batch);
    if (!rows.length) break;
    last = rows.at(-1)!.id;
    const changed = rows.map((r) => ({ id: r.id, old: r.foodGroup, g: groupOf(r) ?? "otros" })).filter((r) => r.g !== r.old);
    if (changed.length) {
      const values = sql.join(changed.map((r) => sql`(${r.id}::uuid, ${r.g})`), sql`, `);
      await db.execute(sql`update foods set food_group = v.g from (values ${values}) as v(id, g) where foods.id = v.id`);
    }
    done += changed.length;
    if (rows.length < batch) break;
  }
  return done;
}

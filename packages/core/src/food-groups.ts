import { foods, isNull, sql, type Database } from "@nutria/db";
import { groupOf } from "@nutria/nutrition";

/**
 * Fill foods.food_group where it is still empty (custom/AI foods, rows imported before the column
 * existed). Batched by id so it can run over the whole catalogue (~270k rows) without long locks.
 */
export async function assignFoodGroups(db: Database, opts: { batch?: number; max?: number } = {}) {
  const batch = opts.batch ?? 2000;
  let done = 0;
  for (;;) {
    const rows = await db
      .select({ id: foods.id, name: foods.name, nameEs: foods.nameEs, categories: foods.categories, kind: foods.kind })
      .from(foods)
      .where(isNull(foods.foodGroup))
      .limit(batch);
    if (!rows.length) break;
    const values = sql.join(rows.map((r) => sql`(${r.id}::uuid, ${groupOf(r) ?? "otros"})`), sql`, `);
    await db.execute(sql`update foods set food_group = v.g from (values ${values}) as v(id, g) where foods.id = v.id`);
    done += rows.length;
    if (rows.length < batch || (opts.max && done >= opts.max)) break;
  }
  return done;
}

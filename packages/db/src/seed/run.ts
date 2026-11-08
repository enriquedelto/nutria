/** Idempotent seed of reference catalogues. Usage: DATABASE_URL=... pnpm db:seed */
import { sql } from "drizzle-orm";
import { DRV, DRUG_FOOD_INTERACTIONS, FASTING_PROTOCOLS, NUTRIENTS } from "@nutria/nutrition";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import {
  achievements,
  activities,
  additives,
  conditions,
  drugFoodInteractions,
  fastingProtocols,
  labParameters,
  nutrientReferences,
  nutrients,
  stores,
} from "../schema";
import { ACHIEVEMENTS, ACTIVITIES, ADDITIVES, CONDITIONS_SEED, LAB_PARAMETERS, STORES } from "./data";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<PgQueryResultHKT, any>;

export async function seedReference(db: AnyDb) {
  await db.transaction(async (tx) => {
    await tx
      .insert(nutrients)
      .values(
        NUTRIENTS.map((n, i) => ({
          code: n.code,
          nameEs: n.nameEs,
          nameEn: n.nameEn,
          unit: n.unit,
          category: n.category,
          sortOrder: i,
          upperLimit: n.ul ?? null,
          offKey: n.off ?? null,
          ciqualKey: n.ciqual?.source ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: nutrients.code,
        set: { nameEs: sql`excluded.name_es`, nameEn: sql`excluded.name_en`, unit: sql`excluded.unit`, category: sql`excluded.category`, sortOrder: sql`excluded.sort_order`, upperLimit: sql`excluded.upper_limit`, offKey: sql`excluded.off_key`, ciqualKey: sql`excluded.ciqual_key` },
      });

    await tx.delete(nutrientReferences);
    const known = new Set(NUTRIENTS.map((n) => n.code));
    await tx.insert(nutrientReferences).values(
      DRV.filter((r) => known.has(r.code)).map((r) => ({
        nutrientCode: r.code,
        sex: r.sex,
        ageMinYears: r.ageMin,
        ageMaxYears: r.ageMax,
        lifeStage: r.lifeStage,
        kind: r.kind,
        amount: r.amount,
      })),
    );

    await tx
      .insert(activities)
      .values(ACTIVITIES)
      .onConflictDoUpdate({ target: activities.code, set: { nameEs: sql`excluded.name_es`, category: sql`excluded.category`, met: sql`excluded.met` } });

    await tx
      .insert(fastingProtocols)
      .values(FASTING_PROTOCOLS.map((p) => ({ code: p.code, nameEs: p.nameEs, fastHours: p.fastHours, description: p.description })))
      .onConflictDoNothing();

    await tx
      .insert(conditions)
      .values(CONDITIONS_SEED)
      .onConflictDoUpdate({ target: conditions.code, set: { nameEs: sql`excluded.name_es`, description: sql`excluded.description`, sensitive: sql`excluded.sensitive` } });

    await tx
      .insert(labParameters)
      .values(LAB_PARAMETERS.map((l) => ({ ...l, refLow: l.refLow ?? null, refHigh: l.refHigh ?? null, relatedNutrient: l.relatedNutrient ?? null })))
      .onConflictDoUpdate({
        target: labParameters.code,
        set: { nameEs: sql`excluded.name_es`, aliases: sql`excluded.aliases`, unit: sql`excluded.unit`, refLow: sql`excluded.ref_low`, refHigh: sql`excluded.ref_high`, relatedNutrient: sql`excluded.related_nutrient`, category: sql`excluded.category` },
      });

    await tx.delete(drugFoodInteractions);
    await tx.insert(drugFoodInteractions).values(DRUG_FOOD_INTERACTIONS);

    await tx
      .insert(additives)
      .values(ADDITIVES)
      .onConflictDoUpdate({ target: additives.code, set: { name: sql`excluded.name`, function: sql`excluded.function`, risk: sql`excluded.risk`, descriptionEs: sql`excluded.description_es` } });

    await tx
      .insert(achievements)
      .values(ACHIEVEMENTS)
      .onConflictDoUpdate({ target: achievements.code, set: { nameEs: sql`excluded.name_es`, descriptionEs: sql`excluded.description_es`, icon: sql`excluded.icon`, rule: sql`excluded.rule` } });

    await tx.insert(stores).values(STORES).onConflictDoNothing();
  });
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()!);
if (isMain) {
  const { getDb, closeDb } = await import("../client");
  await seedReference(getDb() as unknown as AnyDb);
  await closeDb();
  console.log("Seed de referencia completado");
}

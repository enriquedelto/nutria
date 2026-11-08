"use server";
import { UserError } from "@/lib/errors";
import { refresh } from "next/cache";
import { z } from "zod";
import { and, eq, foodServings, foods } from "@nutria/db";
import { completeDerived } from "@nutria/nutrition";
import { db } from "@/lib/db";
import { assertAccess, getApiUser } from "@/lib/session";
import { personFor } from "@/lib/api";

const FoodInput = z.object({
  name: z.string().min(1).max(160),
  brand: z.string().max(80).nullish(),
  barcode: z.string().regex(/^\d{6,14}$/).nullish(),
  kind: z.enum(["food", "drink", "supplement", "alcohol"]).default("food"),
  per100: z.record(z.string(), z.number().min(0).max(100_000)),
  serving: z.object({ label: z.string().min(1).max(60), grams: z.number().positive().max(5000) }).nullish(),
  ingredientsText: z.string().max(4000).nullish(),
  allergens: z.array(z.string().max(40)).max(30).default([]),
  estimateId: z.string().uuid().nullish(),
});

/** Custom food shared with the person's group (visible to the whole household). */
export async function createFood(personId: string, input: z.input<typeof FoodInput>) {
  const u = await getApiUser();
  if (!u) throw new UserError("No autenticado");
  await assertAccess(u.id, personId, "diary", true);
  const { person } = await personFor(u, personId, "diary", true);
  const v = FoodInput.parse(input);
  const n = completeDerived(v.per100);
  const [f] = await db()
    .insert(foods)
    .values({
      source: "custom",
      kind: v.kind,
      name: v.name,
      nameEs: v.name,
      brand: v.brand ?? null,
      barcode: v.barcode ?? null,
      groupId: person.groupId,
      createdBy: u.id,
      kcal: n.energy_kcal ?? null,
      protein: n.protein ?? null,
      carbs: n.carbs ?? null,
      sugars: n.sugars ?? null,
      fat: n.fat ?? null,
      satFat: n.sat_fat ?? null,
      fiber: n.fiber ?? null,
      salt: n.salt ?? null,
      nutrients: n,
      ingredientsText: v.ingredientsText ?? null,
      allergens: v.allergens,
      completeness: v.estimateId ? 0.7 : 0.9,
      verified: !v.estimateId,
      fetchedAt: new Date(),
    })
    .returning({ id: foods.id });
  if (v.serving) await db().insert(foodServings).values({ foodId: f!.id, label: v.serving.label, grams: v.serving.grams, isDefault: true, source: "custom" });
  refresh();
  return f!.id;
}

export async function deleteCustomFood(personId: string, foodId: string) {
  const u = await getApiUser();
  if (!u) throw new UserError("No autenticado");
  const { person } = await personFor(u, personId, "diary", true);
  await db().delete(foods).where(and(eq(foods.id, z.string().uuid().parse(foodId)), eq(foods.source, "custom"), eq(foods.groupId, person.groupId!)));
  refresh();
}

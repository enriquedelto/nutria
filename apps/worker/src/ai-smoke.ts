/**
 * End-to-end check of the AI features against the real model, for the admin's own person.
 * Everything runs inside a transaction that is rolled back: no estimates, conversations or usage remain.
 *   pnpm --filter @nutria/worker ai:smoke
 */
import { aiUsage, closeDb, desc, eq, getDb, getPersonAccess, persons, user, type Database } from "@nutria/db";
import { coachChat, estimateMeal, refineMeal, structureRecipe, suggestSubstitutions, translateFoodNames, whatToEat } from "@nutria/ai";

class Rollback extends Error {}
const db = getDb(process.env.DATABASE_URL!);
const email = process.env.ADMIN_EMAIL!;
let failed = 0;
// ONLY=coach,come → run just the steps whose name contains one of those words (case-insensitive).
const only = process.env.ONLY?.toLowerCase().split(",").filter(Boolean);
const step = async (name: string, fn: () => Promise<string>) => {
  if (only && !only.some((w) => name.toLowerCase().includes(w))) return;
  const t = Date.now();
  try {
    const out = await fn();
    console.log(`✔ ${name} (${((Date.now() - t) / 1000).toFixed(1)} s): ${out}`);
  } catch (e) {
    failed++;
    console.log(`✘ ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
};

try {
  await db.transaction(async (tx) => {
    const t = tx as unknown as Database;
    const [u] = await t.select().from(user).where(eq(user.email, email)).limit(1);
    if (!u) throw new Error(`No existe el usuario ${email}`);
    const [p] = await t.select().from(persons).where(eq(persons.userId, u.id)).limit(1);
    if (!p) throw new Error("El usuario no tiene persona propia");
    const access = await getPersonAccess(t, u.id, p.id);
    const c = { db: t, userId: u.id, personId: p.id, scopes: access!.scopes as ReadonlySet<string>, signal: AbortSignal.timeout(240_000) };

    await step("Registro por texto", async () => {
      const r = await estimateMeal(c, { text: "un plato de lentejas con chorizo y un trozo de pan", mode: "text" });
      return `${r.items.map((i) => `${i.name} ${Math.round(i.grams)} g`).join(", ")} → ${Math.round(r.totals.kcal ?? 0)} kcal`;
    });
    await step("Corregir un registro en palabras", async () => {
      const first = await estimateMeal(c, { text: "un plato de arroz con pollo y una ensalada", mode: "text" });
      const r = await refineMeal(c, { refineOf: first.estimateId, correction: "el doble de arroz y sin ensalada", items: first.items.map((i) => ({ name: i.name, grams: i.grams, servingLabel: i.servingLabel })) });
      const show = (xs: { name: string; grams: number }[]) => xs.map((i) => `${i.name} ${Math.round(i.grams)} g`).join(", ");
      return `${show(first.items)} → ${show(r.items)}`;
    });
    await step("Traducción de alimentos (modelo rápido si AI_MODEL_FAST)", async () => {
      const r = await translateFoodNames(c, [{ id: "a", name: "Chicken breast, roasted" }, { id: "b", name: "Lentils, boiled, drained" }]);
      const [u] = await t.select({ model: aiUsage.model }).from(aiUsage).where(eq(aiUsage.feature, "translate_foods")).orderBy(desc(aiUsage.createdAt)).limit(1);
      return `${r.map((x) => x.nameEs).join(" · ")} (modelo: ${u?.model ?? "?"})`;
    });
    await step("Receta desde texto", async () => {
      const r = await structureRecipe(c, { sourceType: "text", text: "Tortilla de patatas para 4: 6 huevos, 600 g de patatas, 1 cebolla, aceite de oliva y sal. Freír patata y cebolla, batir los huevos, mezclar y cuajar por ambos lados." });
      return `«${r.title}», ${r.ingredients.length} ingredientes, ${r.steps.length} pasos`;
    });
    await step("Sustituciones", async () => {
      const r = await suggestSubstitutions(c, { recipeTitle: "Tortilla de patatas", ingredients: ["6 huevos", "600 g de patatas"], reason: "Sin huevo" });
      return JSON.stringify(r).slice(0, 100);
    });
    await step("¿Qué como ahora?", async () => {
      const r = await whatToEat(c, { remaining: { kcal: 600, protein: 35, carbs: 60, fat: 20 }, maxMinutes: 20 });
      return JSON.stringify(r).slice(0, 100);
    });
    await step("Coach (con herramientas)", async () => {
      const r = await coachChat({ ...c, groupId: p.groupId ?? null, timezone: p.timezone }, { message: "¿Cuáles son mis objetivos de calorías y proteína? Responde en una frase." });
      return `${r.toolCalls.map((x) => x.name).join(", ") || "sin herramientas"} → ${r.text.replace(/\s+/g, " ").slice(0, 120)}`;
    });
    await step("Coach busca en la base de alimentos", async () => {
      const r = await coachChat({ ...c, groupId: p.groupId ?? null, timezone: p.timezone }, { message: "Busca en la base de alimentos el tofu firme y dime cuánta proteína tiene por 100 g. Una frase." });
      if (!r.toolCalls.length) throw new Error("no usó ninguna herramienta: " + r.text.slice(0, 80));
      return `${r.toolCalls.map((x) => x.name).join(", ")} → ${r.text.replace(/\s+/g, " ").slice(0, 120)}`;
    });
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { console.error(e); failed++; }
}
await closeDb();
console.log(failed ? `${failed} prueba(s) fallida(s)` : "Todo OK (cambios deshechos)");
process.exit(failed ? 1 : 0);

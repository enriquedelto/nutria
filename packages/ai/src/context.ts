/** Builds the per-person context injected into AI requests (respecting access scopes). */
import { aiMemories, and, desc, eq, groups, personConditions, persons, portionMemory, targetSets, weightLogs, type Database } from "@nutria/db";
import { ageFromBirthDate, conditionsAiContext, formatDateEs, todayIn } from "@nutria/nutrition";

export interface PersonContext {
  personId: string;
  groupId: string | null;
  displayName: string;
  timezone: string;
  today: string;
  weightKg: number | null;
  lines: string[];
}

const SLOT_NAMES: Record<string, string> = {
  breakfast: "desayuno",
  morning_snack: "media mañana",
  lunch: "comida",
  afternoon_snack: "merienda",
  dinner: "cena",
  late_snack: "recena",
};
export const mealSlotName = (s: string) => SLOT_NAMES[s] ?? s;

export async function buildPersonContext(db: Database, personId: string, scopes: ReadonlySet<string>, now = new Date()): Promise<PersonContext> {
  const [p] = await db.select().from(persons).where(eq(persons.id, personId)).limit(1);
  if (!p) throw new Error("Persona no encontrada");
  const today = todayIn(p.timezone, now);
  const lines: string[] = [`Hoy es ${formatDateEs(today)} (${today}), hora local ${now.toLocaleTimeString("es-ES", { timeZone: p.timezone, hour: "2-digit", minute: "2-digit" })}.`];

  const [w] = scopes.has("body")
    ? await db.select({ kg: weightLogs.kg }).from(weightLogs).where(eq(weightLogs.personId, personId)).orderBy(desc(weightLogs.date)).limit(1)
    : [];
  const weightKg = w?.kg ?? null;

  const facts = [
    p.isChild ? "niño/a" : null,
    p.birthDate ? `${ageFromBirthDate(p.birthDate, now)} años` : null,
    p.sex === "female" ? "mujer" : p.sex === "male" ? "hombre" : null,
    p.heightCm ? `${p.heightCm} cm` : null,
    weightKg ? `${weightKg} kg` : null,
    `actividad ${p.activityLevel}`,
    `objetivo ${p.goalType === "lose" ? "perder peso" : p.goalType === "gain" ? "ganar peso" : "mantener"}${p.weeklyRateKg ? ` (${p.weeklyRateKg} kg/sem)` : ""}`,
  ].filter(Boolean);
  lines.push(`Persona: ${p.displayName} — ${facts.join(", ")}.`);
  if (p.dietPattern) lines.push(`Patrón de dieta: ${p.dietPattern}.`);
  if (p.allergens.length) lines.push(`ALÉRGENOS/INTOLERANCIAS (evitar siempre): ${p.allergens.join(", ")}.`);
  if (p.dislikes.length) lines.push(`No le gusta: ${p.dislikes.join(", ")}.`);
  if (p.preferencesMd.trim()) lines.push(`Preferencias personales:\n${p.preferencesMd.trim()}`);

  if (scopes.has("diary")) {
    const [t] = await db.select().from(targetSets).where(and(eq(targetSets.personId, personId), eq(targetSets.isDefault, true))).limit(1);
    if (t) lines.push(`Objetivo diario: ${Math.round(t.kcal)} kcal, ${Math.round(t.protein)} g proteína, ${Math.round(t.carbs)} g hidratos, ${Math.round(t.fat)} g grasa${t.fiber ? `, ${Math.round(t.fiber)} g fibra` : ""}.`);
  }

  if (scopes.has("health")) {
    if (p.pregnancy) lines.push(`Etapa: ${p.pregnancy === "lactation" ? "lactancia" : `embarazo (${p.pregnancy.replace("trimester", "trimestre ")})`}.`);
    const conds = await db.select({ code: personConditions.conditionCode, config: personConditions.config }).from(personConditions).where(and(eq(personConditions.personId, personId), eq(personConditions.active, true)));
    const ctx = conditionsAiContext(conds, weightKg ?? 70);
    if (ctx.length) lines.push(`Condiciones:\n- ${ctx.join("\n- ")}`);
  }

  if (scopes.has("ai")) {
    const mems = await db.select({ category: aiMemories.category, contentMd: aiMemories.contentMd }).from(aiMemories).where(eq(aiMemories.personId, personId)).orderBy(aiMemories.category, desc(aiMemories.updatedAt)).limit(60);
    if (mems.length) lines.push(`Lo que sabes de la persona:\n${mems.map((m) => `- [${m.category}] ${m.contentMd}`).join("\n")}`);
  }

  const portions = await db.select({ key: portionMemory.key, grams: portionMemory.grams }).from(portionMemory).where(eq(portionMemory.personId, personId)).orderBy(desc(portionMemory.samples)).limit(25);
  if (portions.length) lines.push(`Porciones habituales: ${portions.map((x) => `${x.key} ≈ ${Math.round(x.grams)} g`).join("; ")}.`);

  if (p.groupId) {
    const [g] = await db.select({ preferencesMd: groups.preferencesMd }).from(groups).where(eq(groups.id, p.groupId)).limit(1);
    if (g?.preferencesMd.trim()) lines.push(`Preferencias del hogar:\n${g.preferencesMd.trim()}`);
  }

  return { personId, groupId: p.groupId, displayName: p.displayName, timezone: p.timezone, today, weightKg, lines };
}

/** Normalized key for portion memory ("Mi plato de Pasta" → "mi plato de pasta"). */
export const portionKey = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();


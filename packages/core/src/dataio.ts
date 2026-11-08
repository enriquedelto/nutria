/** Import (MFP, Lose It, Cronometer, Waistline CSV) and full export (JSON / CSV). */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { schema, eq, imports, weightLogs, type Database } from "@nutria/db";
import { importDiaryCsv } from "@nutria/integrations";
import { addEntries } from "./diary";

export const uploadDir = () => process.env.UPLOAD_DIR ?? join(process.cwd(), ".data", "uploads");
export const importPath = (id: string) => join(uploadDir(), "imports", `${id}.csv`);

export async function runImport(db: Database, importId: string) {
  const [imp] = await db.select().from(imports).where(eq(imports.id, importId)).limit(1);
  if (!imp || !imp.personId) throw new Error("Importación no encontrada");
  await db.update(imports).set({ status: "running" }).where(eq(imports.id, imp.id));
  try {
    const text = await readFile(importPath(imp.id), "utf8");
    const r = importDiaryCsv(text);
    const groups = new Map<string, typeof r.entries>();
    for (const e of r.entries) groups.set(`${e.date}|${e.mealSlot}`, [...(groups.get(`${e.date}|${e.mealSlot}`) ?? []), e]);
    let n = 0;
    for (const [key, list] of groups) {
      const [date, mealSlot] = key.split("|") as [string, string];
      const rows = await addEntries(db, {
        personId: imp.personId,
        userId: imp.userId,
        date,
        mealSlot,
        origin: "import",
        items: list.map((e, i) => ({
          name: e.name,
          grams: e.grams ?? 0,
          servingLabel: e.servingLabel,
          absolute: e.nutrients,
          clientId: `imp:${imp.id}:${key}:${i}`,
        })),
      });
      n += rows.length;
    }
    if (r.weights.length) await db.insert(weightLogs).values(r.weights.map((w) => ({ personId: imp.personId!, date: w.date, kg: w.kg, source: "import", externalId: `imp:${w.date}` }))).onConflictDoNothing();
    const stats = { entries: n, weights: r.weights.length, skipped: r.skipped };
    await db.update(imports).set({ status: "done", source: r.source, stats }).where(eq(imports.id, imp.id));
    return stats;
  } catch (e) {
    await db.update(imports).set({ status: "failed", error: e instanceof Error ? e.message : String(e) }).where(eq(imports.id, imp.id));
    throw e;
  }
}

/** Tables exported for a person (everything that hangs from persons.id). */
const PERSON_TABLES = {
  diario: schema.diaryEntries,
  agua: schema.waterLogs,
  pesos: schema.weightLogs,
  medidas: schema.bodyMeasurements,
  objetivos: schema.targetSets,
  metas: schema.goals,
  tdee: schema.tdeeEstimates,
  ejercicio: schema.exerciseLogs,
  pasos: schema.stepLogs,
  ayunos: schema.fastingSessions,
  sueno: schema.sleepLogs,
  ciclo: schema.cyclePeriods,
  sintomas_ciclo: schema.cycleSymptoms,
  condiciones: schema.personConditions,
  analiticas: schema.labResults,
  medicacion: schema.medications,
  tomas: schema.medicationDoses,
  sensaciones: schema.mealFeelings,
  sintomas: schema.symptomLogs,
  memoria_ia: schema.aiMemories,
} as const;

export async function exportPerson(db: Database, personId: string): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  const [p] = await db.select().from(schema.persons).where(eq(schema.persons.id, personId));
  out.persona = p ? [p] : [];
  for (const [name, table] of Object.entries(PERSON_TABLES)) {
    out[name] = await db.select().from(table).where(eq((table as typeof schema.diaryEntries).personId, personId));
  }
  return out;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    if (v == null) return "";
    const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

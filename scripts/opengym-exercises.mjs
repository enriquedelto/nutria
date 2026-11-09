// Builds, from an openGym checkout's catalogue:
//  - packages/integrations/src/opengym-exercises.json (exercise id → Spanish name)
//  - packages/core/src/opengym-muscles.json (exercise id → "main,secondary,…" muscle groups, for weekly sets)
// Usage: node scripts/opengym-exercises.mjs <path-to>/opengym/catalogue
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("Uso: node scripts/opengym-exercises.mjs <opengym>/catalogue");
const es = JSON.parse(readFileSync(join(dir, "i18n", "es.json"), "utf8"));

/** ExerciseDB "target" → our muscle groups (packages/nutrition/src/bulk.ts MUSCLE_GROUPS). Cardio and neck are left out. */
const TARGET = {
  pectorals: "pecho",
  "serratus anterior": "pecho",
  lats: "espalda",
  "upper back": "espalda",
  traps: "espalda",
  "levator scapulae": "espalda",
  spine: "espalda",
  delts: "hombros",
  biceps: "biceps",
  triceps: "triceps",
  forearms: "antebrazo",
  quads: "cuadriceps",
  adductors: "cuadriceps",
  hamstrings: "isquios",
  glutes: "gluteos",
  abductors: "gluteos",
  calves: "gemelos",
  abs: "abdomen",
};

/** Secondary muscles (counted as half a set). Vague ones (core, hip flexors, grip…) are left out. */
const SECONDARY = {
  shoulders: "hombros",
  deltoids: "hombros",
  "rear deltoids": "hombros",
  glutes: "gluteos",
  hamstrings: "isquios",
  quadriceps: "cuadriceps",
  triceps: "triceps",
  biceps: "biceps",
  brachialis: "biceps",
  forearms: "antebrazo",
  "upper back": "espalda",
  "lower back": "espalda",
  rhomboids: "espalda",
  trapezius: "espalda",
  traps: "espalda",
  lats: "espalda",
  "latissimus dorsi": "espalda",
  back: "espalda",
  chest: "pecho",
  "upper chest": "pecho",
  calves: "gemelos",
  soleus: "gemelos",
  adductors: "cuadriceps",
  obliques: "abdomen",
  "lower abs": "abdomen",
  abdominals: "abdomen",
};

const names = {};
const muscles = {};
for (const f of readdirSync(join(dir, "exercises")).filter((f) => f.endsWith(".json")).sort()) {
  const ex = JSON.parse(readFileSync(join(dir, "exercises", f), "utf8"));
  const name = es[ex.id]?.name ?? ex.name;
  if (ex.id && name) names[ex.id] = name.charAt(0).toUpperCase() + name.slice(1);
  const m = TARGET[ex.target];
  if (ex.id && m) muscles[ex.id] = [...new Set([m, ...(ex.secondaryMuscles ?? []).map((x) => SECONDARY[x]).filter(Boolean)])].join(",");
}
writeFileSync(new URL("../packages/integrations/src/opengym-exercises.json", import.meta.url), JSON.stringify(names) + "\n");
writeFileSync(new URL("../packages/core/src/opengym-muscles.json", import.meta.url), JSON.stringify(muscles) + "\n");
console.log(`${Object.keys(names).length} ejercicios, ${Object.keys(muscles).length} con músculo`);

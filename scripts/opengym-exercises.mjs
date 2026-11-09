// Builds packages/integrations/src/opengym-exercises.json (exercise id → Spanish name) from an
// openGym checkout's catalogue. Usage: node scripts/opengym-exercises.mjs <path-to>/opengym/catalogue
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("Uso: node scripts/opengym-exercises.mjs <opengym>/catalogue");
const es = JSON.parse(readFileSync(join(dir, "i18n", "es.json"), "utf8"));
const out = {};
for (const f of readdirSync(join(dir, "exercises")).filter((f) => f.endsWith(".json")).sort()) {
  const ex = JSON.parse(readFileSync(join(dir, "exercises", f), "utf8"));
  const name = es[ex.id]?.name ?? ex.name;
  if (ex.id && name) out[ex.id] = name.charAt(0).toUpperCase() + name.slice(1);
}
writeFileSync(new URL("../packages/integrations/src/opengym-exercises.json", import.meta.url), JSON.stringify(out) + "\n");
console.log(`${Object.keys(out).length} ejercicios`);

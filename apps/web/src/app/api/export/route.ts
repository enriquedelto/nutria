import { audit, exportPerson, toCsv } from "@nutria/core";
import type { AccessScope } from "@nutria/db";
import { db } from "@/lib/db";
import { HttpError, personFor, route } from "@/lib/api";

/** Which access scope each exported table needs (sensitive tables stay out unless granted). */
const TABLE_SCOPE: Record<string, AccessScope> = {
  persona: "diary",
  diario: "diary",
  agua: "diary",
  objetivos: "diary",
  ayunos: "diary",
  sensaciones: "diary",
  pesos: "body",
  medidas: "body",
  metas: "body",
  tdee: "body",
  ejercicio: "body",
  pasos: "body",
  sueno: "health",
  condiciones: "health",
  sintomas: "health",
  ciclo: "cycle",
  sintomas_ciclo: "cycle",
  analiticas: "labs",
  medicacion: "medication",
  tomas: "medication",
  memoria_ia: "ai",
};

/** GET /api/export?personId=…&format=json|csv[&table=diario] */
export const GET = route(async (req, user) => {
  const url = new URL(req.url);
  const { person, access } = await personFor(user, url.searchParams.get("personId"), "diary");
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  const all = await exportPerson(db(), person.id);
  const data = Object.fromEntries(Object.entries(all).filter(([k]) => access.scopes.has(TABLE_SCOPE[k] ?? "health")));
  await audit(db(), { userId: user.id, personId: person.id, action: "export", resource: "person", resourceId: person.id, meta: { format, tables: Object.keys(data) } });
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = person.displayName.normalize("NFD").replace(/[^\w]+/g, "-").toLowerCase();
  if (format === "json")
    return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), app: "nutria", data }, null, 2), {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="nutria-${slug}-${stamp}.json"`, "cache-control": "no-store" },
    });
  const table = url.searchParams.get("table") ?? "diario";
  if (!(table in data)) throw new HttpError(404, "Tabla no disponible");
  return new Response("﻿" + toCsv(data[table] as Record<string, unknown>[]), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="nutria-${slug}-${table}-${stamp}.csv"`, "cache-control": "no-store" },
  });
});

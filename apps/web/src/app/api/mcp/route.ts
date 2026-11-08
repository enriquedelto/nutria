import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { audit, deleteEntries, recomputeTargets } from "@nutria/core";
import { listAccessiblePersons, waterLogs, weightLogs, type AccessScope } from "@nutria/db";
import { READ_TOOLS, type ToolContext } from "@nutria/ai";
import { todayIn } from "@nutria/nutrition";
import { db } from "@/lib/db";
import { addDiaryItems } from "@/lib/diary-service";
import { emit } from "@/lib/events";
import { HttpError } from "@/lib/api";
import { publicRoute, tokenAuth, tokenPerson, type TokenAuth } from "@/lib/tokens";

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const fail = (msg: string) => ({ content: [{ type: "text" as const, text: msg }], isError: true });
const personId = z.string().uuid().optional().describe("Persona (por defecto, la tuya). Usa list_persons para ver los ids.");

function buildServer(auth: TokenAuth, req: Request) {
  const server = new McpServer({ name: "nutria", version: "0.1.0" }, { instructions: "Nutria: diario de alimentación, nutrientes, peso y salud de la familia. Las cantidades van en gramos y kcal. Lee antes de escribir; las herramientas de borrado exigen confirm: \"BORRAR\"." });
  const guard = async <T,>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  };
  const ctxFor = async (pid: string | undefined, scope: AccessScope = "diary"): Promise<ToolContext> => {
    const { person, access } = await tokenPerson(auth, pid, scope);
    return { db: db(), userId: auth.userId, personId: person.id, groupId: person.groupId, timezone: person.timezone, scopes: access.scopes, proposals: [] };
  };

  server.registerTool("list_persons", { description: "Personas a las que tienes acceso (tú, tus hijos, familiares que te han dado permiso).", inputSchema: {}, annotations: { readOnlyHint: true } }, async () =>
    guard(async () => {
      const rows = await listAccessiblePersons(db(), auth.userId);
      return text(rows.map((r) => ({ id: r.person.id, name: r.person.displayName, role: r.role, isChild: r.person.isChild, timezone: r.person.timezone })));
    }),
  );

  // Read tools shared with the coach; each checks its own scope against person_access.
  for (const tool of READ_TOOLS) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: { ...tool.input.shape, personId }, annotations: { readOnlyHint: true } }, async (args: Record<string, unknown>) =>
      guard(async () => {
        const { personId: pid, ...rest } = args as { personId?: string } & Record<string, unknown>;
        const ctx = await ctxFor(pid);
        if (tool.scope && !ctx.scopes.has(tool.scope)) return fail(`Sin permiso «${tool.scope}» para esta persona`);
        return text(await tool.run(tool.input.parse(rest), ctx));
      }),
    );
  }

  if (auth.scopes.has("write")) {
    server.registerTool(
      "log_food",
      {
        description: "Registra alimentos en el diario. Usa search_foods antes para obtener foodId; si no existe, da name + per100 (nutrientes por 100 g: energy_kcal, protein, carbs, fat…).",
        inputSchema: {
          personId,
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD, por defecto hoy"),
          mealSlot: z.string().describe("breakfast | morning_snack | lunch | afternoon_snack | dinner"),
          items: z.array(z.object({ foodId: z.string().uuid().optional(), name: z.string().optional(), grams: z.number().min(0).max(5000), per100: z.record(z.string(), z.number()).optional(), note: z.string().optional() })).min(1).max(30),
        },
      },
      async (a) =>
        guard(async () => {
          const { person } = await tokenPerson(auth, a.personId, "diary", true);
          const rows = await addDiaryItems(auth.userId, { personId: person.id, date: a.date ?? todayIn(person.timezone), mealSlot: a.mealSlot, origin: "mcp", items: a.items });
          return text({ ok: true, entries: rows.map((r) => ({ id: r.id, name: r.name, grams: r.grams, kcal: Math.round(r.kcal) })) });
        }),
    );
    server.registerTool("log_weight", { description: "Registra un pesaje en kg.", inputSchema: { personId, kg: z.number().min(2).max(400), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), bodyFatPct: z.number().min(2).max(70).optional() } }, async (a) =>
      guard(async () => {
        const { person } = await tokenPerson(auth, a.personId, "body", true);
        const date = a.date ?? todayIn(person.timezone);
        await db().insert(weightLogs).values({ personId: person.id, date, kg: a.kg, bodyFatPct: a.bodyFatPct ?? null, source: "mcp", measuredAt: new Date() });
        await recomputeTargets(db(), person.id).catch(() => undefined);
        void emit(auth.userId, "weight.logged", { personId: person.id, date, kg: a.kg });
        return text({ ok: true, date, kg: a.kg });
      }),
    );
    server.registerTool("log_water", { description: "Registra agua bebida en ml.", inputSchema: { personId, ml: z.number().int().min(10).max(5000) } }, async (a) =>
      guard(async () => {
        const { person } = await tokenPerson(auth, a.personId, "diary", true);
        await db().insert(waterLogs).values({ personId: person.id, date: todayIn(person.timezone), ml: a.ml });
        return text({ ok: true, ml: a.ml });
      }),
    );
  }

  if (auth.scopes.has("destroy")) {
    server.registerTool(
      "delete_diary_entries",
      { description: "Borra entradas del diario por id. Irreversible: pide confirmación al usuario y pasa confirm: \"BORRAR\".", inputSchema: { personId, ids: z.array(z.string().uuid()).min(1).max(50), confirm: z.string().describe('Debe ser exactamente "BORRAR"') }, annotations: { destructiveHint: true } },
      async (a) =>
        guard(async () => {
          if (a.confirm !== "BORRAR") return fail('Operación destructiva: confirma con el usuario y repite con confirm: "BORRAR".');
          const { person } = await tokenPerson(auth, a.personId, "diary", true);
          await deleteEntries(db(), person.id, a.ids);
          await audit(db(), { userId: auth.userId, personId: person.id, action: "mcp.delete_diary_entries", resource: "diary_entry", ip: req.headers.get("x-forwarded-for"), meta: { ids: a.ids, tokenId: auth.tokenId } });
          return text({ ok: true, deleted: a.ids.length });
        }),
    );
  }
  return server;
}

/** MCP over Streamable HTTP, stateless (one server per request). Auth: personal token. */
async function handle(req: Request) {
  const auth = await tokenAuth(req, "read");
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = buildServer(auth, req);
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}

export const POST = publicRoute(handle);
export const GET = publicRoute(async () => {
  throw new HttpError(405, "Usa POST (Streamable HTTP sin sesión)");
});
export const DELETE = GET;

/**
 * AI provider layer.
 *  - subscription: Claude Agent SDK authenticated with CLAUDE_CODE_OAUTH_TOKEN (the owner's
 *    Claude subscription). Built-in tools are disabled; only our in-process MCP tools exist.
 *  - api: Anthropic Messages API with an API key (recommended when family uses it daily).
 *  - mock: deterministic, for tests and E2E.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  AiError,
  type AiContent,
  type AiProvider,
  type AiTool,
  type AiUsage,
  type Backend,
  type RunRequest,
  type RunResult,
  type StructuredRequest,
  type ToolContext,
} from "./types";

export const DEFAULT_MODEL = "claude-opus-5-5";

/** Background and simple reading tasks: AI_MODEL_FAST, when set, so they don't use up the limit photo logging and the coach need. */
const FAST_FEATURES = new Set(["translate_foods", "label"]);
export const modelFor = (feature: string): string | undefined => (FAST_FEATURES.has(feature) && process.env.AI_MODEL_FAST) || undefined;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/* ------------------------------- helpers -------------------------------- */

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new AiError("Cancelado", "aborted"));
    });
  });

/** Exponential backoff with jitter for 429/529/overloaded. */
export async function withRetry<T>(fn: () => Promise<T>, opts: { retries?: number; baseMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  const base = opts.baseMs ?? 1500;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const err = toAiError(e);
      if (!err.retryable || attempt >= retries) throw err;
      await sleep(base * 2 ** attempt + Math.random() * 500, opts.signal);
    }
  }
}

export function toAiError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.RateLimitError) return new AiError("Límite de uso de la IA alcanzado; reintentando", "rate_limit", true);
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new AiError("Credenciales de IA no válidas", "auth");
  if (e instanceof Anthropic.InternalServerError) return new AiError("Servicio de IA saturado", "overloaded", true);
  if (e instanceof Anthropic.APIConnectionError) return new AiError("Sin conexión con la IA", "overloaded", true);
  if (e instanceof Anthropic.APIError && (e.status === 529 || e.status === 503)) return new AiError("Servicio de IA saturado", "overloaded", true);
  if (e instanceof Error && e.name === "AbortError") return new AiError("Cancelado", "aborted");
  return new AiError(e instanceof Error ? e.message : String(e), "unknown");
}

/** Validate tool input, check scope, run and serialize (shared by every backend). */
export async function executeTool(tool: AiTool, raw: unknown, ctx: ToolContext): Promise<{ ok: boolean; text: string; input: unknown }> {
  const parsed = tool.input.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, text: `Entrada no válida: ${z.prettifyError(parsed.error)}`, input: raw };
  if (tool.scope && !ctx.scopes.has(tool.scope)) return { ok: false, text: `Sin permiso para leer «${tool.scope}» de esta persona.`, input: parsed.data };
  try {
    const out = await tool.run(parsed.data, ctx);
    return { ok: true, text: typeof out === "string" ? out : JSON.stringify(out), input: parsed.data };
  } catch (e) {
    return { ok: false, text: `Error: ${e instanceof Error ? e.message : String(e)}`, input: parsed.data };
  }
}

/** Some models wrap JSON in prose or fences; extract the first JSON value. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(src);
  } catch {
    const start = src.search(/[[{]/);
    const end = Math.max(src.lastIndexOf("}"), src.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(src.slice(start, end + 1));
    throw new AiError("La IA no devolvió JSON", "invalid_output");
  }
}

function parseStructured<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(typeof value === "string" ? extractJson(value) : value);
  if (!r.success) throw new AiError(`Respuesta de la IA con formato inesperado: ${z.prettifyError(r.error)}`, "invalid_output");
  return r.data;
}

function toAnthropicBlocks(content: AiContent[]): Anthropic.Beta.BetaContentBlockParam[] {
  return content.map((c) => {
    if (c.type === "text") return { type: "text", text: c.text };
    if (c.type === "image") return { type: "image", source: { type: "base64", media_type: c.mediaType, data: c.data } };
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: c.data } };
  });
}

function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  return betaZodOutputFormat(schema).schema as Record<string, unknown>;
}

/* --------------------------------- API ---------------------------------- */

export class ApiProvider implements AiProvider {
  readonly backend = "api" as const;
  private client: Anthropic;
  constructor(
    readonly model = process.env.AI_MODEL ?? DEFAULT_MODEL,
    apiKey = process.env.ANTHROPIC_API_KEY,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 0 });
  }

  private usage(start: number, u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }[], model = this.model): AiUsage {
    const input = u.reduce((s, x) => s + x.input_tokens + (x.cache_read_input_tokens ?? 0) + (x.cache_creation_input_tokens ?? 0), 0);
    const output = u.reduce((s, x) => s + x.output_tokens, 0);
    // Opus 5.5 list price: $4 / $20 per MTok (estimate; cache reads billed lower).
    return { inputTokens: input, outputTokens: output, costUsd: (input * 4 + output * 20) / 1e6, durationMs: Date.now() - start, model };
  }

  async structured<S extends z.ZodType>(req: StructuredRequest<S>) {
    const start = Date.now();
    const model = req.model ?? this.model;
    const msg = await withRetry(
      () =>
        this.client.beta.messages
          .stream(
            {
              model,
              max_tokens: 32000,
              betas: [FALLBACK_BETA],
              fallbacks: "default",
              system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
              output_config: { effort: req.effort ?? "medium", format: { type: "json_schema", schema: jsonSchemaFor(req.schema) } },
              messages: [{ role: "user", content: toAnthropicBlocks(req.content) }],
            },
            { signal: req.signal },
          )
          .finalMessage(),
      { signal: req.signal },
    );
    if (msg.stop_reason === "refusal") throw new AiError("La IA rechazó la petición", "refusal");
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return { data: parseStructured(req.schema, text), usage: this.usage(start, [msg.usage], model) };
  }

  async run(req: RunRequest): Promise<RunResult> {
    const start = Date.now();
    const tools: Anthropic.Beta.BetaToolUnion[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: z.toJSONSchema(t.input) as Anthropic.Beta.BetaTool.InputSchema,
      eager_input_streaming: true,
    }));
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...req.history.map((h) => ({ role: h.role, content: typeof h.content === "string" ? h.content : toAnthropicBlocks(h.content) })),
      { role: "user" as const, content: toAnthropicBlocks(req.message) },
    ];
    const usages: Anthropic.Beta.BetaUsage[] = [];
    const toolCalls: RunResult["toolCalls"] = [];
    let text = "";
    for (let turn = 0; turn < (req.maxTurns ?? 8); turn++) {
      const msg = await withRetry(
        async () => {
          const stream = this.client.beta.messages.stream(
            {
              model: this.model,
              max_tokens: 64000,
              betas: [FALLBACK_BETA],
              fallbacks: "default",
              system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
              output_config: { effort: req.effort ?? "medium" },
              tools,
              messages,
            },
            { signal: req.signal },
          );
          stream.on("text", (d) => {
            text += d;
            req.onText?.(d);
          });
          return stream.finalMessage();
        },
        { signal: req.signal },
      );
      usages.push(msg.usage);
      if (msg.stop_reason === "refusal") throw new AiError("La IA rechazó la petición", "refusal");
      messages.push({ role: "assistant", content: msg.content });
      const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      // Only run tools on a clean tool_use stop (max_tokens may leave a truncated input).
      if (msg.stop_reason !== "tool_use" || uses.length === 0) break;
      const results = await Promise.all(
        uses.map(async (u) => {
          const tool = req.tools.find((t) => t.name === u.name);
          req.onToolCall?.(u.name, u.input);
          const r = tool ? await executeTool(tool, u.input, req.ctx) : { ok: false, text: "Herramienta desconocida", input: u.input };
          toolCalls.push({ name: u.name, input: r.input, ok: r.ok });
          return { type: "tool_result" as const, tool_use_id: u.id, content: r.text, is_error: !r.ok };
        }),
      );
      messages.push({ role: "user", content: results });
      text += "\n\n";
    }
    return { text: text.trim(), toolCalls, usage: this.usage(start, usages) };
  }
}

/* ----------------------------- subscription ----------------------------- */

type AgentSdk = typeof import("@anthropic-ai/claude-agent-sdk");
let agentSdk: Promise<AgentSdk> | null = null;
const loadAgentSdk = () => (agentSdk ??= import("@anthropic-ai/claude-agent-sdk"));

export class SubscriptionProvider implements AiProvider {
  readonly backend = "subscription" as const;
  constructor(
    readonly model = process.env.AI_MODEL ?? DEFAULT_MODEL,
    private token = process.env.CLAUDE_CODE_OAUTH_TOKEN,
  ) {}

  private baseOptions(signal?: AbortSignal, model = this.model) {
    const abortController = new AbortController();
    signal?.addEventListener("abort", () => abortController.abort());
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v != null && !/^(ANTHROPIC_API_KEY|DATABASE_URL|APP_ENCRYPTION_KEY|BETTER_AUTH_SECRET)$/.test(k)) env[k] = v;
    if (this.token) env.CLAUDE_CODE_OAUTH_TOKEN = this.token;
    return {
      model,
      abortController,
      env,
      cwd: process.env.AI_SANDBOX_DIR ?? process.cwd(),
      tools: [] as string[], // no Bash/Read/Edit… only our MCP tools
      settingSources: [] as [],
      persistSession: false,
      permissionMode: "dontAsk" as const,
    };
  }

  private async *prompt(content: AiContent[]) {
    yield {
      type: "user" as const,
      message: { role: "user" as const, content: toAnthropicBlocks(content) as Anthropic.ContentBlockParam[] },
      parent_tool_use_id: null,
    };
  }

  private async collect(
    q: AsyncIterable<import("@anthropic-ai/claude-agent-sdk").SDKMessage>,
    start: number,
    on: { text?: (d: string) => void; tool?: (name: string, input: unknown) => void } = {},
    model = this.model,
  ) {
    let text = "";
    let structured: unknown;
    let usage: AiUsage = { inputTokens: 0, outputTokens: 0, costUsd: null, durationMs: 0, model };
    const toolCalls: { name: string; input: unknown }[] = [];
    for await (const m of q) {
      if (m.type === "stream_event") {
        const ev = m.event;
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          text += ev.delta.text;
          on.text?.(ev.delta.text);
        }
      } else if (m.type === "assistant") {
        // The subscription limit lasts hours: retrying only makes the person wait longer.
        if (m.error === "rate_limit") throw new AiError("Límite de la suscripción alcanzado", "rate_limit", false);
        if (m.error === "overloaded" || m.error === "server_error") throw new AiError("Servicio de IA saturado", "overloaded", true);
        if (m.error === "authentication_failed" || m.error === "oauth_org_not_allowed") throw new AiError("Token de suscripción no válido", "auth");
        for (const b of m.message.content) {
          if (b.type === "tool_use") {
            const name = b.name.replace(/^mcp__nutria__/, "");
            toolCalls.push({ name, input: b.input });
            on.tool?.(name, b.input);
          }
        }
      } else if (m.type === "result") {
        const u = m.usage;
        usage = {
          inputTokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
          outputTokens: u.output_tokens,
          costUsd: m.total_cost_usd,
          durationMs: Date.now() - start,
          model,
        };
        if (m.subtype === "success") {
          structured = m.structured_output;
          if (!text) text = m.result;
        } else {
          throw new AiError(`La IA no terminó (${m.subtype})`, m.subtype === "error_max_structured_output_retries" ? "invalid_output" : "unknown");
        }
      }
    }
    return { text, structured, usage, toolCalls };
  }

  async structured<S extends z.ZodType>(req: StructuredRequest<S>) {
    const sdk = await loadAgentSdk();
    const start = Date.now();
    const out = await withRetry(
      () =>
        this.collect(
          sdk.query({
            prompt: this.prompt(req.content),
            options: {
              ...this.baseOptions(req.signal, req.model),
              systemPrompt: req.system,
              effort: req.effort ?? "medium",
              maxTurns: 3,
              outputFormat: { type: "json_schema", schema: jsonSchemaFor(req.schema) },
            },
          }),
          start,
          {},
          req.model,
        ),
      { signal: req.signal },
    );
    return { data: parseStructured(req.schema, out.structured ?? out.text), usage: out.usage };
  }

  async run(req: RunRequest): Promise<RunResult> {
    const sdk = await loadAgentSdk();
    const start = Date.now();
    const results = new Map<string, boolean>();
    const server = sdk.createSdkMcpServer({
      name: "nutria",
      version: "1.0.0",
      tools: req.tools.map((t) =>
        sdk.tool(t.name, t.description, t.input.shape, async (args) => {
          const r = await executeTool(t, args, req.ctx);
          results.set(t.name, r.ok);
          return { content: [{ type: "text" as const, text: r.text }], isError: !r.ok };
        }),
      ),
    });
    // The Agent SDK is single-prompt here: prior turns go into the system prompt as a transcript.
    const transcript = req.history.length
      ? `\n\n## Conversación previa\n${req.history
          .map((h) => `${h.role === "user" ? "Usuario" : "Asistente"}: ${typeof h.content === "string" ? h.content : h.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join(" ")}`)
          .join("\n")}`
      : "";
    const out = await withRetry(
      () =>
        this.collect(
          sdk.query({
            prompt: this.prompt(req.message),
            options: {
              ...this.baseOptions(req.signal),
              systemPrompt: req.system + transcript,
              effort: req.effort ?? "medium",
              maxTurns: req.maxTurns ?? 8,
              includePartialMessages: true,
              mcpServers: { nutria: server },
              allowedTools: req.tools.map((t) => `mcp__nutria__${t.name}`),
            },
          }),
          start,
          { text: req.onText, tool: req.onToolCall },
        ),
      { signal: req.signal, retries: 2 },
    );
    return {
      text: out.text.trim(),
      toolCalls: out.toolCalls.map((c) => ({ ...c, ok: results.get(c.name) ?? true })),
      usage: out.usage,
    };
  }
}

/* --------------------------------- mock --------------------------------- */

export type MockHandler = (req: { feature: string; system: string; content: AiContent[] }) => unknown;

/**
 * Deterministic provider. `structured` answers from handlers keyed by feature; `run` can
 * call scripted tools (`script`) and then echoes a reply. Used in unit tests and Playwright.
 */
export class MockProvider implements AiProvider {
  readonly backend = "mock" as const;
  readonly model = "mock";
  constructor(
    private handlers: Record<string, MockHandler> = {},
    private script: (req: RunRequest) => { tool?: string; input?: unknown }[] = () => [],
  ) {}

  private usage(): AiUsage {
    return { inputTokens: 10, outputTokens: 10, costUsd: 0, durationMs: 1, model: "mock" };
  }

  async structured<S extends z.ZodType>(req: StructuredRequest<S>) {
    const h = this.handlers[req.feature];
    if (!h) throw new AiError(`Sin respuesta simulada para ${req.feature}`, "invalid_output");
    return { data: parseStructured(req.schema, h(req)), usage: this.usage() };
  }

  async run(req: RunRequest): Promise<RunResult> {
    const toolCalls: RunResult["toolCalls"] = [];
    for (const step of this.script(req)) {
      const tool = req.tools.find((t) => t.name === step.tool);
      if (!tool) continue;
      req.onToolCall?.(tool.name, step.input);
      const r = await executeTool(tool, step.input, req.ctx);
      toolCalls.push({ name: tool.name, input: r.input, ok: r.ok });
    }
    const last = req.message.flatMap((c) => (c.type === "text" ? [c.text] : [])).join(" ");
    const text = `(simulado) He recibido: ${last}`;
    req.onText?.(text);
    return { text, toolCalls, usage: this.usage() };
  }
}

/* -------------------------------- factory ------------------------------- */

let cached: AiProvider | null = null;

export function createProvider(backend: Backend = (process.env.AI_BACKEND as Backend) ?? "subscription"): AiProvider {
  if (backend === "api") {
    if (!process.env.ANTHROPIC_API_KEY) throw new AiError("Falta ANTHROPIC_API_KEY", "auth");
    return new ApiProvider();
  }
  if (backend === "mock") return new MockProvider(defaultMockHandlers());
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) throw new AiError("Falta CLAUDE_CODE_OAUTH_TOKEN (genéralo con `claude setup-token`)", "auth");
  return new SubscriptionProvider();
}

export function getProvider(): AiProvider {
  return (cached ??= createProvider());
}

export function setProvider(p: AiProvider | null) {
  cached = p;
}

/** Plausible fixtures so the app is fully usable with AI_BACKEND=mock (E2E, demos). */
export function defaultMockHandlers(): Record<string, MockHandler> {
  return {
    meal_text: () => ({
      items: [
        { name: "Tortilla de patatas", searchQuery: "tortilla de patatas", grams: 150, servingLabel: "1 porción", confidence: 0.8, nova: 3, per100: [{ code: "energy_kcal", amount: 190 }, { code: "protein", amount: 6.5 }, { code: "carbs", amount: 13 }, { code: "fat", amount: 12 }, { code: "fiber", amount: 1.2 }] },
        { name: "Pan blanco", searchQuery: "pan blanco", grams: 40, servingLabel: "1 rebanada", confidence: 0.7, nova: 4, per100: [{ code: "energy_kcal", amount: 265 }, { code: "protein", amount: 9 }, { code: "carbs", amount: 49 }, { code: "fat", amount: 3.2 }, { code: "fiber", amount: 2.7 }] },
      ],
      mealSlot: "lunch",
      notes: "Estimación simulada",
      questions: [],
    }),
    meal_photo: () => defaultMockHandlers().meal_text!({ feature: "meal_text", system: "", content: [] }),
    meal_voice: () => defaultMockHandlers().meal_text!({ feature: "meal_text", system: "", content: [] }),
    // "el doble de tortilla" doubles it, "media ración" halves everything, "sin pan" drops the bread.
    meal_refine: (req) => {
      const text = req.content.map((x) => (x.type === "text" ? x.text : "")).join(" ").toLowerCase();
      const base = defaultMockHandlers().meal_text!({ feature: "meal_text", system: "", content: [] }) as { items: { name: string; grams: number }[] };
      const items = base.items
        .filter((i) => !(text.includes("sin pan") && i.name === "Pan blanco"))
        .map((i) => ({ ...i, grams: text.includes("media ración") ? i.grams / 2 : text.includes("doble de tortilla") && i.name === "Tortilla de patatas" ? i.grams * 2 : i.grams }));
      return { ...base, items, notes: "Corrección simulada", questions: [], answers: [] };
    },
    label: () => ({
      name: "Yogur natural",
      brand: "Marca simulada",
      barcode: null,
      servingGrams: 125,
      per100: [{ code: "energy_kcal", amount: 61 }, { code: "protein", amount: 3.5 }, { code: "carbs", amount: 4.7 }, { code: "sugars", amount: 4.7 }, { code: "fat", amount: 3.2 }, { code: "sat_fat", amount: 2.1 }, { code: "salt", amount: 0.13 }],
      ingredientsText: "Leche, fermentos lácticos",
      allergens: ["leche"],
      confidence: 0.9,
    }),
    lab_report: () => ({
      date: "2026-10-15",
      labName: "Laboratorio simulado",
      results: [
        { rawName: "Ferritina", parameterCode: "ferritin", value: 18, unit: "ng/mL", refLow: 30, refHigh: 400 },
        { rawName: "Vitamina D (25-OH)", parameterCode: "vit_d_25oh", value: 24, unit: "ng/mL", refLow: 30, refHigh: 100 },
      ],
    }),
    recipe_structure: () => ({
      title: "Receta simulada",
      description: null,
      servings: 2,
      prepMin: 10,
      cookMin: 20,
      ingredients: ["200 g de arroz", "1 cebolla"],
      steps: [{ text: "Cocer el arroz." }],
      tags: ["simulada"],
    }),
    translate_foods: (r) => {
      const text = r.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");
      const items = [...text.matchAll(/^- (\S+): (.+)$/gm)].map((m) => ({ id: m[1]!, nameEs: m[2]!.trim() }));
      return { items };
    },
    receipt: () => ({
      store: { chain: "mercadona", name: "MERCADONA, S.A.", address: "Calle Mayor 1", city: "Madrid", postalCode: "28013" },
      date: "2026-11-02",
      time: "18:42",
      items: [
        { text: "QUINOA ECO NUTRIA", name: "Quinoa ecológica Nutria", quantity: 1, unit: "ud", unitPrice: 2.6, total: 2.6, discount: null, isFood: true },
        { text: "PLATANO", name: "Plátano", quantity: 0.85, unit: "kg", unitPrice: 1.99, total: 1.69, discount: null, isFood: true },
        { text: "BOLSA PLASTICO", name: "Bolsa", quantity: 1, unit: "ud", unitPrice: 0.15, total: 0.15, discount: null, isFood: false },
      ],
      total: 4.44,
      cropBottom: 0.7,
      confidence: 0.9,
    }),
    pantry_photo: () => ({ items: [{ name: "Leche", quantity: 1, unit: "ud", location: "nevera", expiresInDays: 5 }] }),
    // One free-text dish (with the planner's estimate) on the first planned day.
    meal_plan: (req) => {
      const text = req.content.map((c) => (c.type === "text" ? c.text : "")).join(" ");
      const from = text.match(/desde (\d{4}-\d{2}-\d{2})/)?.[1];
      const meal = { mealSlot: "lunch", recipeId: null, title: "Lentejas con arroz (simulado)", ingredients: ["80 g de lentejas", "60 g de arroz"], kcalPerServing: 650, proteinPerServing: 32, servingsByPerson: [], prepMin: 40, why: "Plato simulado" };
      return { days: from ? [{ date: from, meals: [meal] }] : [], notes: "Plan simulado" };
    },
    weekly_report: () => ({ title: "Semana simulada", summaryMd: "Todo en orden (simulado).", highlights: ["Proteína cumplida 5 de 7 días"], suggestions: ["Pésate tres veces"], oneChange: "Añade un yogur con frutos secos a la merienda" }),
    substitutions: () => ({ options: [{ ingredient: "nata", substitute: "yogur griego", reason: "menos grasa", ratio: "1:1" }] }),
    what_to_eat: () => ({ options: [{ title: "Yogur con fruta", why: "Encaja con tus macros", items: [{ name: "Yogur natural", grams: 125 }] }] }),
    correlation_explain: () => ({ bodyMd: "Posible relación (simulado). No es un diagnóstico." }),
    memory_extract: () => ({ memories: [] }),
    retro_summary: () => ({ householdMd: "- Gustan las legumbres (simulado)", perPerson: [] }),
  };
}

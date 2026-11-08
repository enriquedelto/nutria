import type { z } from "zod";
import type { Database } from "@nutria/db";

export type Backend = "subscription" | "api" | "mock";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Provider-neutral input content. Images/PDF are base64 without data: prefix. */
export type AiContent =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string }
  | { type: "pdf"; data: string };

export interface AiTurn {
  role: "user" | "assistant";
  content: string | AiContent[];
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  durationMs: number;
  model: string;
}

/** What tools see: who is asking, about whom, and what they may read. */
export interface ToolContext {
  db: Database;
  userId: string;
  personId: string;
  groupId: string | null;
  timezone: string;
  /** Scopes granted to `userId` on `personId` (from person_access). */
  scopes: ReadonlySet<string>;
  /** Proposals collected during the run (nothing is written without confirmation). */
  proposals: Proposal[];
  now?: Date;
}

export interface Proposal {
  kind: "diary_entries" | "targets" | "memory" | "pantry" | "shopping" | "meal_plan" | "recipe" | "reminder";
  summary: string;
  payload: Record<string, unknown>;
}

export interface AiTool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  input: S;
  /** Scope required to run (checked before execution). */
  scope?: string;
  run(input: z.infer<S>, ctx: ToolContext): Promise<unknown>;
}

export interface StructuredRequest<S extends z.ZodType> {
  feature: string;
  system: string;
  content: AiContent[];
  schema: S;
  effort?: Effort;
  signal?: AbortSignal;
}

export interface RunRequest {
  feature: string;
  system: string;
  history: AiTurn[];
  message: AiContent[];
  tools: AiTool[];
  ctx: ToolContext;
  effort?: Effort;
  maxTurns?: number;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onToolCall?: (name: string, input: unknown) => void;
}

export interface RunResult {
  text: string;
  toolCalls: { name: string; input: unknown; ok: boolean }[];
  usage: AiUsage;
}

export interface AiProvider {
  readonly backend: Backend;
  readonly model: string;
  structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<{ data: z.infer<S>; usage: AiUsage }>;
  run(req: RunRequest): Promise<RunResult>;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly code: "rate_limit" | "overloaded" | "refusal" | "invalid_output" | "quota" | "auth" | "aborted" | "unknown",
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AiError";
  }
}

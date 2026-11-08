/** M11 AI: conversations, memory, estimates (proposals awaiting confirmation), undoable actions, usage. */
import { index, integer, jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { user } from "./auth";
import { persons } from "./core";

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text().notNull().default("Conversación"),
    kind: text().notNull().default("coach"), // coach | planner | retro
    archivedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index().on(t.personId, t.updatedAt)],
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: id(),
    conversationId: uuid()
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: text().notNull(), // user | assistant | tool
    content: text().notNull(),
    /** Structured parts: tool calls/results, attached image keys, proposals. */
    parts: jsonb().$type<unknown[]>().notNull().default([]),
    ...timestamps(),
  },
  (t) => [index().on(t.conversationId, t.createdAt)],
);

/** Persistent memory per person (markdown by category) — the coach & planner read/write it. */
export const aiMemories = pgTable(
  "ai_memories",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    category: text().notNull(), // gustos | rutina | salud | objetivos | cocina | otros
    contentMd: text().notNull(),
    source: text().notNull().default("coach"), // coach | retro | user
    ...timestamps(),
  },
  (t) => [index().on(t.personId, t.category)],
);

/**
 * AI estimate = a proposal produced by the model (meal from text/photo/voice, label OCR, lab
 * extraction, recipe import, meal plan…). Nothing is written to real tables until confirmed.
 */
export const aiEstimates = pgTable(
  "ai_estimates",
  {
    id: id(),
    personId: uuid().references(() => persons.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text().notNull(), // meal | label | lab_report | recipe | meal_plan | pantry_photo | substitution
    input: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    status: text().notNull().default("pending"), // pending | confirmed | discarded | failed
    confidence: real(),
    model: text(),
    error: text(),
    confirmedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index().on(t.userId, t.createdAt), index().on(t.personId, t.kind)],
);

/** Every write performed as a consequence of AI (after confirmation) is recorded here so it can be undone. */
export const aiActions = pgTable(
  "ai_actions",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    personId: uuid().references(() => persons.id, { onDelete: "cascade" }),
    estimateId: uuid().references(() => aiEstimates.id, { onDelete: "set null" }),
    action: text().notNull(), // insert | update | delete
    tableName: text().notNull(),
    rowIds: text().array().notNull(),
    /** Previous row state for updates/deletes. */
    before: jsonb().$type<unknown[]>().notNull().default([]),
    undoneAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index().on(t.userId, t.createdAt)],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    feature: text().notNull(), // meal_text | meal_photo | coach | plan | label | lab | recipe_import | weekly_report …
    backend: text().notNull(), // subscription | api | mock
    model: text(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    costUsd: real(),
    durationMs: integer(),
    ok: text().notNull().default("ok"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.userId, t.createdAt)],
);

/**
 * Health modules: targets & goals, progress/TDEE (M6), exercise/steps/fasting (M7),
 * sleep & cycle (M8), conditions (M9), labs (M10), medication (M4), feelings & symptoms (M5).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps, type NutrientMap } from "./_shared";
import { persons } from "./core";

/* ----------------------------- Targets & goals ---------------------------- */

export type TargetRule = { days?: number[]; trainingDay?: boolean };

/**
 * A set of daily targets. A person can have several (rest day / training day / fasting day…);
 * `rule` decides which applies on a date. `pinned` macros stay fixed under adaptive adjustments.
 */
export const targetSets = pgTable(
  "target_sets",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    name: text().notNull().default("Diario"),
    isDefault: boolean().notNull().default(true),
    rule: jsonb().$type<TargetRule>().notNull().default({}),
    kcal: real().notNull(),
    protein: real().notNull(),
    carbs: real().notNull(),
    fat: real().notNull(),
    fiber: real(),
    /** Micro targets & limits keyed by nutrient code (min = target, max = limit). */
    micros: jsonb().$type<Record<string, { min?: number; max?: number }>>().notNull().default({}),
    pinned: text().array().notNull().default(sql`'{}'::text[]`), // ["protein"]
    mode: text().notNull().default("dynamic"), // fixed | dynamic | adaptive
    source: text().notNull().default("formula"), // formula | adaptive | manual | condition
    ...timestamps(),
  },
  (t) => [index().on(t.personId)],
);

export const goals = pgTable(
  "goals",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    type: text().notNull(), // weight | body_fat | measurement | habit
    targetValue: real().notNull(),
    startValue: real(),
    startDate: date({ mode: "string" }).notNull(),
    targetDate: date({ mode: "string" }),
    status: text().notNull().default("active"), // active | reached | abandoned
    reachedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index().on(t.personId)],
);

/* ------------------------------ M6 progress ------------------------------- */

export const weightLogs = pgTable(
  "weight_logs",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    measuredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    kg: real().notNull(),
    bodyFatPct: real(),
    source: text().notNull().default("manual"), // manual | opengym | webhook | import
    externalId: text(),
    note: text(),
    ...timestamps(),
  },
  (t) => [
    index().on(t.personId, t.date),
    uniqueIndex("weight_external_uq").on(t.personId, t.source, t.externalId).where(sql`${t.externalId} is not null`),
    check("weight_kg_ck", sql`${t.kg} > 1 and ${t.kg} < 400`),
  ],
);

export const bodyMeasurements = pgTable(
  "body_measurements",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    site: text().notNull(), // waist | hip | chest | arm | thigh | neck …
    cm: real().notNull(),
    ...timestamps(),
  },
  (t) => [index().on(t.personId, t.date)],
);

export const progressPhotos = pgTable(
  "progress_photos",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    pose: text().notNull().default("front"),
    /** Path inside uploads volume; file is AES-GCM encrypted at rest. */
    storageKey: text().notNull(),
    ...timestamps(),
  },
  (t) => [index().on(t.personId, t.date)],
);

/** Weekly adaptive TDEE estimate snapshots. */
export const tdeeEstimates = pgTable(
  "tdee_estimates",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    formulaTdee: real().notNull(),
    adaptiveTdee: real(),
    avgIntake: real(),
    trendWeightStart: real(),
    trendWeightEnd: real(),
    windowDays: integer().notNull(),
    loggedDays: integer().notNull(),
    confidence: real().notNull().default(0),
    underLoggingSuspected: boolean().notNull().default(false),
    suggestedKcal: real(),
    acceptedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [uniqueIndex().on(t.personId, t.date)],
);

/* ---------------------- M7 exercise, steps, fasting ----------------------- */

/** Compendium of Physical Activities (seeded). */
export const activities = pgTable("activities", {
  code: text().primaryKey(),
  nameEs: text().notNull(),
  category: text().notNull(),
  met: real().notNull(),
});

export const exerciseLogs = pgTable(
  "exercise_logs",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    startedAt: timestamp({ withTimezone: true }),
    activityCode: text().references(() => activities.code, { onDelete: "set null" }),
    name: text().notNull(),
    durationMin: real().notNull(),
    kcal: real().notNull(),
    met: real(),
    volumeKg: real(),
    sets: integer(),
    source: text().notNull().default("manual"), // manual | opengym | import
    externalId: text(),
    details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    index().on(t.personId, t.date),
    uniqueIndex("exercise_external_uq").on(t.personId, t.source, t.externalId).where(sql`${t.externalId} is not null`),
  ],
);

export const stepLogs = pgTable(
  "step_logs",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    steps: integer().notNull(),
    kcal: real(),
    ...timestamps(),
  },
  (t) => [uniqueIndex().on(t.personId, t.date)],
);

export const fastingProtocols = pgTable("fasting_protocols", {
  code: text().primaryKey(), // "16:8", "18:6", "omad", "5:2", "custom"
  nameEs: text().notNull(),
  fastHours: real(),
  description: text(),
});

export const fastingSessions = pgTable(
  "fasting_sessions",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    protocol: text().notNull().default("16:8"),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    targetHours: real().notNull(),
    endedAt: timestamp({ withTimezone: true }),
    note: text(),
    ...timestamps(),
  },
  (t) => [index().on(t.personId, t.startedAt)],
);

/* ---------------------------- M8 sleep & cycle ---------------------------- */

export const sleepLogs = pgTable(
  "sleep_logs",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(), // wake-up date
    bedtime: timestamp({ withTimezone: true }),
    wakeTime: timestamp({ withTimezone: true }),
    hours: real().notNull(),
    quality: smallint(), // 1..5
    note: text(),
    ...timestamps(),
  },
  (t) => [uniqueIndex().on(t.personId, t.date)],
);

export const cyclePeriods = pgTable(
  "cycle_periods",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    startDate: date({ mode: "string" }).notNull(),
    endDate: date({ mode: "string" }),
    flow: smallint(), // 1..4
    ...timestamps(),
  },
  (t) => [index().on(t.personId, t.startDate)],
);

export const cycleSymptoms = pgTable(
  "cycle_symptoms",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    symptom: text().notNull(), // cramps | cravings | bloating | headache | mood …
    intensity: smallint().notNull().default(2),
    ...timestamps(),
  },
  (t) => [index().on(t.personId, t.date)],
);

/* ------------------------------ M9 conditions ----------------------------- */

export const conditions = pgTable("conditions", {
  code: text().primaryKey(), // diabetes_t1 | diabetes_t2 | hypertension | pregnancy | vegan | keto | fodmap | celiac | athlete …
  nameEs: text().notNull(),
  description: text(),
  sensitive: boolean().notNull().default(true),
});

export const personConditions = pgTable(
  "person_conditions",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    conditionCode: text()
      .notNull()
      .references(() => conditions.code, { onDelete: "cascade" }),
    /** Condition-specific settings (e.g. carbs per meal, sodium limit, FODMAP phase). */
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    active: boolean().notNull().default(true),
    since: date({ mode: "string" }),
    ...timestamps(),
  },
  (t) => [uniqueIndex().on(t.personId, t.conditionCode)],
);

/* ------------------------------- M10 labs --------------------------------- */

export const labParameters = pgTable("lab_parameters", {
  code: text().primaryKey(), // ferritin | vit_b12 | vit_d_25oh | glucose | hba1c | ldl | tsh …
  nameEs: text().notNull(),
  aliases: text().array().notNull().default(sql`'{}'::text[]`),
  unit: text().notNull(),
  refLow: real(),
  refHigh: real(),
  relatedNutrient: text(),
  category: text().notNull().default("general"),
});

export const labReports = pgTable(
  "lab_reports",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    labName: text(),
    storageKey: text(),
    status: text().notNull().default("pending"), // pending | extracted | confirmed
    aiEstimateId: uuid(),
    ...timestamps(),
  },
  (t) => [index().on(t.personId, t.date)],
);

export const labResults = pgTable(
  "lab_results",
  {
    id: id(),
    reportId: uuid()
      .notNull()
      .references(() => labReports.id, { onDelete: "cascade" }),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    parameterCode: text().references(() => labParameters.code, { onDelete: "set null" }),
    rawName: text().notNull(),
    value: real().notNull(),
    unit: text().notNull(),
    refLow: real(),
    refHigh: real(),
    flag: text(), // low | high | normal
    ...timestamps(),
  },
  (t) => [index().on(t.personId, t.parameterCode, t.date), index().on(t.reportId)],
);

/* ----------------------------- M4 medication ------------------------------ */

export const medications = pgTable(
  "medications",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    name: text().notNull(),
    activeIngredient: text(),
    /** Normalized substance code used to look up drug_food_interactions. */
    substanceCode: text(),
    dose: text(),
    times: time().array().notNull().default(sql`'{}'::time[]`),
    daysOfWeek: smallint().array().notNull().default(sql`'{1,2,3,4,5,6,7}'::smallint[]`),
    withFood: text(), // null | "fasting" | "with_food" | "after_food"
    startDate: date({ mode: "string" }),
    endDate: date({ mode: "string" }),
    active: boolean().notNull().default(true),
    note: text(),
    ...timestamps(),
  },
  (t) => [index().on(t.personId)],
);

export const medicationDoses = pgTable(
  "medication_doses",
  {
    id: id(),
    medicationId: uuid()
      .notNull()
      .references(() => medications.id, { onDelete: "cascade" }),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    scheduledAt: timestamp({ withTimezone: true }).notNull(),
    takenAt: timestamp({ withTimezone: true }),
    status: text().notNull().default("pending"), // pending | taken | skipped
    ...timestamps(),
  },
  (t) => [index().on(t.personId, t.scheduledAt), index().on(t.medicationId)],
);

/** Curated drug–food interactions (seeded; never AI-only). */
export const drugFoodInteractions = pgTable(
  "drug_food_interactions",
  {
    id: id(),
    substanceCode: text().notNull(), // warfarin | maoi | levothyroxine | statin_cyp3a4 | lithium | tetracycline …
    substanceNameEs: text().notNull(),
    /** Match: nutrient code, food category tag or keyword. */
    matchType: text().notNull(), // nutrient | category | keyword | timing
    matchValue: text().notNull(),
    severity: text().notNull(), // info | caution | avoid
    messageEs: text().notNull(),
    source: text().notNull(),
  },
  (t) => [index().on(t.substanceCode)],
);

/* -------------------------- M5 feelings & symptoms ------------------------ */

export const mealFeelings = pgTable(
  "meal_feelings",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    mealSlot: text().notNull(),
    hungerBefore: smallint(), // 1..5
    satietyAfter: smallint(), // 1..5
    mood: smallint(), // 1..5
    note: text(),
    ...timestamps(),
  },
  (t) => [uniqueIndex().on(t.personId, t.date, t.mealSlot)],
);

export const symptomLogs = pgTable(
  "symptom_logs",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    date: date({ mode: "string" }).notNull(),
    symptom: text().notNull(), // bloating | gas | pain | reflux | diarrhea | constipation | headache | fatigue | energy …
    intensity: smallint().notNull(), // 1..5
    note: text(),
    ...timestamps(),
  },
  (t) => [index().on(t.personId, t.occurredAt)],
);

/** Generated insights (symptom correlations, weekly findings) shown to the user and fed to the coach. */
export const insights = pgTable(
  "insights",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    kind: text().notNull(), // symptom_correlation | micro_gap | weekly | under_logging | lab_link
    title: text().notNull(),
    bodyMd: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    score: real(),
    periodStart: date({ mode: "string" }),
    periodEnd: date({ mode: "string" }),
    dismissedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index().on(t.personId, t.kind, t.createdAt)],
);

/** Daily cached aggregates for fast charts (recomputed on diary change). */
export const dailySummaries = pgTable(
  "daily_summaries",
  {
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    kcal: real().notNull().default(0),
    protein: real().notNull().default(0),
    carbs: real().notNull().default(0),
    fat: real().notNull().default(0),
    fiber: real().notNull().default(0),
    nutrients: jsonb().$type<NutrientMap>().notNull().default({}),
    entries: integer().notNull().default(0),
    upfKcalPct: real(),
    qualityScore: real(),
    waterMl: integer().notNull().default(0),
    exerciseKcal: real().notNull().default(0),
    complete: boolean().notNull().default(false), // user marked day as fully logged
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("daily_summaries_pk").on(t.personId, t.date)],
);


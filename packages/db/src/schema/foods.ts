/** M1 foods & diary, M2 quality, M3 supplements/alcohol/caffeine. */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { hhmm, id, timestamps, type NutrientMap } from "./_shared";
import { user } from "./auth";
import { groups, persons } from "./core";

export const nutrientCategoryEnum = pgEnum("nutrient_category", [
  "energy",
  "macro",
  "carb_detail",
  "fat_detail",
  "vitamin",
  "mineral",
  "other",
]);

/** Nutrient catalogue (seeded). `code` is the key used in every NutrientMap. */
export const nutrients = pgTable("nutrients", {
  code: text().primaryKey(), // e.g. "energy_kcal", "protein", "vit_d", "iron"
  nameEs: text().notNull(),
  nameEn: text().notNull(),
  unit: text().notNull(), // "kcal" | "g" | "mg" | "µg"
  category: nutrientCategoryEnum().notNull(),
  sortOrder: integer().notNull().default(0),
  /** Tolerable upper intake level for adults, if any (same unit). */
  upperLimit: real(),
  offKey: text(), // Open Food Facts nutriments key (e.g. "vitamin-d")
  ciqualKey: text(),
});

// Dietary reference values (EFSA) live in code: DRV in @nutria/nutrition (drv.ts), not in a table.

export const foodSourceEnum = pgEnum("food_source", ["off", "ciqual", "usda", "custom", "ai", "recipe", "store"]);
export const foodKindEnum = pgEnum("food_kind", ["food", "drink", "supplement", "alcohol"]);

/**
 * Foods: local cache/mirror of Open Food Facts, CIQUAL generics, custom and AI-estimated foods.
 * `nutrients` are per 100 g (or 100 ml for drinks). Main macros duplicated as columns for indexing.
 */
export const foods = pgTable(
  "foods",
  {
    id: id(),
    source: foodSourceEnum().notNull(),
    sourceId: text(), // OFF barcode, CIQUAL code…
    barcode: text(),
    kind: foodKindEnum().notNull().default("food"),
    name: text().notNull(),
    nameEs: text(),
    brand: text(),
    quantityLabel: text(), // "500 g"
    imageUrl: text(),
    /** Owner group for custom/AI foods (null = public catalogue). */
    groupId: uuid().references(() => groups.id, { onDelete: "cascade" }),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    kcal: real(),
    protein: real(),
    carbs: real(),
    sugars: real(),
    fat: real(),
    satFat: real(),
    fiber: real(),
    salt: real(),
    nutrients: jsonb().$type<NutrientMap>().notNull().default({}),
    /** Density for ml→g conversion (g/ml), default 1. */
    density: real().notNull().default(1),
    nutriscore: text(), // a..e
    nova: smallint(), // 1..4
    ecoscore: text(),
    additives: text().array().notNull().default(sql`'{}'::text[]`),
    allergens: text().array().notNull().default(sql`'{}'::text[]`),
    traces: text().array().notNull().default(sql`'{}'::text[]`),
    categories: text().array().notNull().default(sql`'{}'::text[]`),
    labels: text().array().notNull().default(sql`'{}'::text[]`), // vegan, gluten-free…
    /** Browsing group (FOOD_GROUPS key in @nutria/nutrition, "no_alimento" for non-food); filled by food.groups. */
    foodGroup: text(),
    ingredientsText: text(),
    countries: text().array().notNull().default(sql`'{}'::text[]`),
    /** 0..1 estimate of data completeness (OFF quality signals / AI confidence). */
    completeness: real(),
    /** Caffeine mg and alcohol % vol live in nutrients ("caffeine", "alcohol"). */
    verified: boolean().notNull().default(false),
    fetchedAt: timestamp({ withTimezone: true }),
    popularity: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("foods_source_uq").on(t.source, t.sourceId).where(sql`${t.sourceId} is not null`),
    index("foods_barcode_idx").on(t.barcode),
    index("foods_group_idx").on(t.groupId),
    index("foods_name_trgm_idx").using("gin", sql`f_unaccent(lower(coalesce(${t.nameEs}, ${t.name}) || ' ' || coalesce(${t.brand}, ''))) gin_trgm_ops`),
    index("foods_categories_idx").using("gin", t.categories),
    index("foods_food_group_idx").on(t.foodGroup, t.popularity.desc()),
  ],
);

/** Serving sizes / household units ("1 yogur" = 125 g, "1 cucharada" = 15 g). Grams are truth. */
export const foodServings = pgTable(
  "food_servings",
  {
    id: id(),
    foodId: uuid()
      .notNull()
      .references(() => foods.id, { onDelete: "cascade" }),
    label: text().notNull(),
    grams: real().notNull(),
    isDefault: boolean().notNull().default(false),
    source: text().notNull().default("off"),
  },
  (t) => [index().on(t.foodId), check("food_servings_grams_ck", sql`${t.grams} > 0`)],
);

/** Additive catalogue (E-numbers) with plain-language explanation and risk level. */
export const additives = pgTable("additives", {
  code: text().primaryKey(), // "en:e330"
  name: text().notNull(),
  function: text(),
  risk: text(), // "none" | "low" | "moderate" | "high"
  descriptionEs: text(),
});

export const foodFavorites = pgTable(
  "food_favorites",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    foodId: uuid().references(() => foods.id, { onDelete: "cascade" }),
    recipeId: uuid(),
    sortOrder: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [index().on(t.personId)],
);

/** Configurable meal slots per person (breakfast, lunch…). */
export const mealSlots = pgTable(
  "meal_slots",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    key: text().notNull(), // "breakfast"
    label: text().notNull(),
    defaultTime: hhmm(),
    sortOrder: integer().notNull().default(0),
    /** Share of daily kcal for plan portioning (0..1). */
    kcalShare: real(),
  },
  (t) => [uniqueIndex().on(t.personId, t.key)],
);

export type DiaryLockedValues = Record<string, number>;

/**
 * Diary entry. `nutrients` is a SNAPSHOT for the eaten quantity so history never changes when a
 * food is edited. Locked values are user corrections (per 100 g) that scale with quantity.
 */
export const diaryEntries = pgTable(
  "diary_entries",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    mealSlot: text().notNull(),
    eatenAt: timestamp({ withTimezone: true }),
    foodId: uuid().references(() => foods.id, { onDelete: "set null" }),
    recipeId: uuid(),
    batchId: uuid(),
    name: text().notNull(),
    brand: text(),
    grams: real().notNull(),
    servingLabel: text(),
    servingQty: real(),
    kcal: real().notNull().default(0),
    protein: real().notNull().default(0),
    carbs: real().notNull().default(0),
    fat: real().notNull().default(0),
    fiber: real().notNull().default(0),
    nutrients: jsonb().$type<NutrientMap>().notNull().default({}),
    lockedValues: jsonb().$type<DiaryLockedValues>().notNull().default({}),
    /** Quality snapshot */
    nova: smallint(),
    nutriscore: text(),
    origin: text().notNull().default("manual"), // manual | scan | ai_text | ai_photo | ai_voice | label | plan | import | quick | mcp
    aiEstimateId: uuid(),
    quick: boolean().notNull().default(false), // quick-add kcal/macros only
    note: text(),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    /** Client-generated id for offline sync idempotency. */
    clientId: text(),
    ...timestamps(),
  },
  (t) => [
    index("diary_person_date_idx").on(t.personId, t.date),
    index().on(t.foodId),
    uniqueIndex("diary_client_uq").on(t.clientId).where(sql`${t.clientId} is not null`),
    check("diary_grams_ck", sql`${t.grams} >= 0`),
  ],
);

export type MealTemplateItem = { foodId?: string; recipeId?: string; name: string; grams: number; servingLabel?: string };

export const mealTemplates = pgTable(
  "meal_templates",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    name: text().notNull(),
    mealSlot: text(),
    items: jsonb().$type<MealTemplateItem[]>().notNull().default([]),
    useCount: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [index().on(t.personId)],
);

export const waterLogs = pgTable(
  "water_logs",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    ml: integer().notNull(),
    loggedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    clientId: text(),
  },
  (t) => [index().on(t.personId, t.date)],
);

/** Learned portion sizes from user corrections ("mi plato de pasta" = 110 g en seco). */
export const portionMemory = pgTable(
  "portion_memory",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    key: text().notNull(), // normalized food phrase
    foodId: uuid().references(() => foods.id, { onDelete: "set null" }),
    grams: real().notNull(),
    samples: integer().notNull().default(1),
    ...timestamps(),
  },
  (t) => [uniqueIndex().on(t.personId, t.key)],
);

/** M3: supplement schedule (supplement = food with kind=supplement). */
export const supplementSchedules = pgTable(
  "supplement_schedules",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    foodId: uuid()
      .notNull()
      .references(() => foods.id, { onDelete: "cascade" }),
    dose: real().notNull().default(1),
    doseUnit: text().notNull().default("unidad"),
    gramsPerDose: real().notNull(),
    times: hhmm().array().notNull().default(sql`'{}'::time[]`),
    daysOfWeek: smallint().array().notNull().default(sql`'{1,2,3,4,5,6,7}'::smallint[]`),
    active: boolean().notNull().default(true),
    autoLog: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [index().on(t.personId)],
);

/** Home screen cards are stored in persons.settings.homeCards. */

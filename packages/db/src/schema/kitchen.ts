/** M12 kitchen: recipes, plans + retro, pantry, shopping, stores & prices, batch cooking. */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  smallint,
  text,

  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps, type NutrientMap } from "./_shared";
import { user } from "./auth";
import { groups, persons } from "./core";
import { foods } from "./foods";

export const recipes = pgTable(
  "recipes",
  {
    id: id(),
    groupId: uuid().references(() => groups.id, { onDelete: "cascade" }),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    title: text().notNull(),
    description: text(),
    servings: real().notNull().default(1),
    prepMin: integer(),
    cookMin: integer(),
    imageUrl: text(),
    sourceUrl: text(),
    sourceType: text().notNull().default("manual"), // manual | url | video | ai | import
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    equipment: text().array().notNull().default(sql`'{}'::text[]`),
    /** Computed nutrition per serving and total cooked weight. */
    nutrientsPerServing: jsonb().$type<NutrientMap>().notNull().default({}),
    kcalPerServing: real(),
    proteinPerServing: real(),
    carbsPerServing: real(),
    fatPerServing: real(),
    totalWeightG: real(),
    costPerServing: numeric({ precision: 10, scale: 2 }),
    /** Food entry representing this recipe (source=recipe) so it can be logged like any food. */
    foodId: uuid().references(() => foods.id, { onDelete: "set null" }),
    freezable: boolean().notNull().default(false),
    fridgeDays: smallint(),
    ...timestamps(),
  },
  (t) => [
    index().on(t.groupId),
    index("recipes_title_trgm_idx").using("gin", sql`${t.title} gin_trgm_ops`),
    index("recipes_tags_idx").using("gin", t.tags),
  ],
);

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    id: id(),
    recipeId: uuid()
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    sortOrder: integer().notNull().default(0),
    rawText: text().notNull(), // "200 g de garbanzos cocidos"
    foodId: uuid().references(() => foods.id, { onDelete: "set null" }),
    grams: real(),
    quantity: real(),
    unit: text(),
    optional: boolean().notNull().default(false),
    section: text(), // "Para la salsa"
    shoppingCategory: text(),
  },
  (t) => [index().on(t.recipeId), index().on(t.foodId)],
);

export const recipeSteps = pgTable(
  "recipe_steps",
  {
    id: id(),
    recipeId: uuid()
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    sortOrder: integer().notNull(),
    text: text().notNull(),
    timerSec: integer(),
  },
  (t) => [index().on(t.recipeId)],
);

export const recipeRatings = pgTable(
  "recipe_ratings",
  {
    id: id(),
    recipeId: uuid()
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    stars: smallint(), // 1..5
    verdict: text(), // like | dislike | neutral
    notEaten: boolean().notNull().default(false),
    comment: text(),
    planItemId: uuid(),
    ...timestamps(),
  },
  (t) => [index().on(t.recipeId), index().on(t.personId)],
);

export const mealPlans = pgTable(
  "meal_plans",
  {
    id: id(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    weekStart: date({ mode: "string" }).notNull(),
    title: text(),
    status: text().notNull().default("draft"), // draft | active | done
    budget: numeric({ precision: 10, scale: 2 }),
    /** Persons included in this (family) plan. */
    personIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    constraints: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    aiEstimateId: uuid(),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [index().on(t.groupId, t.weekStart)],
);

export type PortionByPerson = Record<string, { servings: number; grams?: number; kcal?: number }>;

export const mealPlanItems = pgTable(
  "meal_plan_items",
  {
    id: id(),
    planId: uuid()
      .notNull()
      .references(() => mealPlans.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    mealSlot: text().notNull(),
    recipeId: uuid().references(() => recipes.id, { onDelete: "set null" }),
    foodId: uuid().references(() => foods.id, { onDelete: "set null" }),
    batchId: uuid(),
    title: text().notNull(),
    /** Portions per person computed from each person's targets. */
    portions: jsonb().$type<PortionByPerson>().notNull().default({}),
    sortOrder: integer().notNull().default(0),
    cooked: boolean().notNull().default(false),
    note: text(),
  },
  (t) => [index().on(t.planId, t.date), index().on(t.recipeId)],
);

export const planRetros = pgTable(
  "plan_retros",
  {
    id: id(),
    planId: uuid()
      .notNull()
      .references(() => mealPlans.id, { onDelete: "cascade" }),
    personId: uuid().references(() => persons.id, { onDelete: "cascade" }),
    answers: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    summaryMd: text(),
    ...timestamps(),
  },
  (t) => [index().on(t.planId)],
);

export const pantryItems = pgTable(
  "pantry_items",
  {
    id: id(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    foodId: uuid().references(() => foods.id, { onDelete: "set null" }),
    name: text().notNull(),
    quantity: real().notNull().default(1),
    unit: text().notNull().default("ud"), // g | ml | ud
    gramsPerUnit: real(),
    location: text().notNull().default("despensa"), // nevera | congelador | despensa
    expiresOn: date({ mode: "string" }),
    openedOn: date({ mode: "string" }),
    staple: boolean().notNull().default(false),
    batchId: uuid(),
    ...timestamps(),
  },
  (t) => [index().on(t.groupId), index().on(t.groupId, t.expiresOn)],
);

export const shoppingLists = pgTable(
  "shopping_lists",
  {
    id: id(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    planId: uuid().references(() => mealPlans.id, { onDelete: "set null" }),
    name: text().notNull().default("Compra"),
    status: text().notNull().default("open"), // open | done
    storeId: uuid(),
    estimatedTotal: numeric({ precision: 10, scale: 2 }),
    ...timestamps(),
  },
  (t) => [index().on(t.groupId, t.status)],
);

export const shoppingItems = pgTable(
  "shopping_items",
  {
    id: id(),
    listId: uuid()
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    foodId: uuid().references(() => foods.id, { onDelete: "set null" }),
    name: text().notNull(),
    quantity: real(),
    unit: text(),
    category: text().notNull().default("otros"),
    checked: boolean().notNull().default(false),
    checkedBy: text().references(() => user.id, { onDelete: "set null" }),
    estimatedPrice: numeric({ precision: 10, scale: 2 }),
    storeProductId: text(),
    fromRecipes: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    sortOrder: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [index().on(t.listId)],
);

export const stores = pgTable("stores", {
  id: id(),
  code: text().notNull().unique(), // mercadona | manual-<uuid>
  name: text().notNull(),
  provider: text(), // adapter key, null for manual stores
  postalCode: text(),
  ...timestamps(),
});

export const storeAccounts = pgTable(
  "store_accounts",
  {
    id: id(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    credentialsEnc: text(),
    postalCode: text(),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [uniqueIndex().on(t.groupId, t.storeId)],
);

/** Mapping food ↔ product in a store, learned from user choices. */
export const storeProductLinks = pgTable(
  "store_product_links",
  {
    id: id(),
    groupId: uuid().references(() => groups.id, { onDelete: "cascade" }),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    foodId: uuid().references(() => foods.id, { onDelete: "cascade" }),
    ingredientKey: text(), // normalized ingredient name when no food
    productId: text().notNull(),
    productName: text().notNull(),
    packSize: text(),
    packGrams: real(),
    ...timestamps(),
  },
  (t) => [index().on(t.storeId, t.foodId), index().on(t.storeId, t.ingredientKey)],
);

export const prices = pgTable(
  "prices",
  {
    id: id(),
    foodId: uuid().references(() => foods.id, { onDelete: "cascade" }),
    barcode: text(),
    storeId: uuid().references(() => stores.id, { onDelete: "set null" }),
    groupId: uuid().references(() => groups.id, { onDelete: "cascade" }),
    price: numeric({ precision: 10, scale: 2 }).notNull(),
    currency: text().notNull().default("EUR"),
    /** Price per kg/l for comparisons. */
    pricePerKg: numeric({ precision: 10, scale: 2 }),
    packGrams: real(),
    source: text().notNull(), // open_prices | store | manual | receipt
    observedOn: date({ mode: "string" }).notNull(),
    ...timestamps(),
  },
  (t) => [index().on(t.foodId, t.observedOn), index().on(t.barcode)],
);

export const cookSessions = pgTable(
  "cook_sessions",
  {
    id: id(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    title: text().notNull().default("Batch cooking"),
    recipeIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    status: text().notNull().default("planned"), // planned | done
    stepsPlan: jsonb().$type<unknown[]>().notNull().default([]),
    ...timestamps(),
  },
  (t) => [index().on(t.groupId, t.date)],
);

/** A batch of cooked portions (tuppers) that are consumed over the following days. */
export const batches = pgTable(
  "batches",
  {
    id: id(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    cookSessionId: uuid().references(() => cookSessions.id, { onDelete: "set null" }),
    recipeId: uuid().references(() => recipes.id, { onDelete: "set null" }),
    title: text().notNull(),
    portionsTotal: real().notNull(),
    portionsLeft: real().notNull(),
    gramsPerPortion: real(),
    location: text().notNull().default("nevera"),
    cookedOn: date({ mode: "string" }).notNull(),
    expiresOn: date({ mode: "string" }),
    ...timestamps(),
  },
  (t) => [index().on(t.groupId), check("batches_left_ck", sql`${t.portionsLeft} >= 0`)],
);


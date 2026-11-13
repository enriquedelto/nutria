/**
 * Core: groups (households), persons (who the health data belongs to), access control,
 * invitations and platform tables (notifications, tokens, webhooks, integrations, audit).
 */
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
import { id, timestamps } from "./_shared";
import { user } from "./auth";

export const sexEnum = pgEnum("sex", ["female", "male"]);
export const activityLevelEnum = pgEnum("activity_level", [
  "sedentary",
  "light",
  "moderate",
  "active",
  "very_active",
]);
export const goalTypeEnum = pgEnum("goal_type", ["lose", "maintain", "gain"]);
export const accessRoleEnum = pgEnum("access_role", ["owner", "manager", "viewer", "professional"]);
export const groupRoleEnum = pgEnum("group_role", ["admin", "member"]);

/** Household / circle of family & friends. Shares custom foods, recipes, plans, lists, challenges. */
export const groups = pgTable("groups", {
  id: id(),
  name: text().notNull(),
  /** Free-form household preferences (markdown) used by the meal planner. */
  preferencesMd: text().notNull().default(""),
  weekStartsOn: integer().notNull().default(1),
  currency: text().notNull().default("EUR"),
  ...timestamps(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    id: id(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: groupRoleEnum().notNull().default("member"),
    ...timestamps(),
  },
  (t) => [uniqueIndex().on(t.groupId, t.userId), index().on(t.userId)],
);

export type PersonSettings = {
  homeCards?: string[];
  trackedMicros?: string[];
  units?: "metric" | "imperial";
  energyUnit?: "kcal" | "kj";
  waterGoalMl?: number;
  enabledModules?: string[];
  mealReminders?: boolean;
  /** Caffeine curve: own half-life and fixed bedtime ("HH:MM"); defaults come from data. */
  caffeine?: { halfLifeH?: number; bedtime?: string };
};

/**
 * A person whose diet/health is tracked. A user has one own person and may manage others
 * (e.g. children without an account). All health data hangs from persons, never from users.
 */
export const persons = pgTable(
  "persons",
  {
    id: id(),
    groupId: uuid().references(() => groups.id, { onDelete: "set null" }),
    /** Account linked to this person (null for managed persons such as children). */
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    displayName: text().notNull(),
    avatarColor: text().notNull().default("#22c55e"),
    sex: sexEnum(),
    birthDate: date({ mode: "string" }),
    heightCm: real(),
    activityLevel: activityLevelEnum().notNull().default("light"),
    goalType: goalTypeEnum().notNull().default("maintain"),
    /** Desired weekly change in kg (negative to lose). */
    weeklyRateKg: real().notNull().default(0),
    pregnancy: text(), // null | "trimester1" | "trimester2" | "trimester3" | "lactation"
    dietPattern: text(), // null | "vegan" | "vegetarian" | "pescatarian" | "keto" ...
    allergens: text().array().notNull().default(sql`'{}'::text[]`),
    dislikes: text().array().notNull().default(sql`'{}'::text[]`),
    /** Free-form personal preferences (markdown) used by the planner and the coach. */
    preferencesMd: text().notNull().default(""),
    timezone: text().notNull().default("Europe/Madrid"),
    settings: jsonb().$type<PersonSettings>().notNull().default({}),
    isChild: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index().on(t.groupId),
    uniqueIndex("persons_user_own_uq").on(t.userId).where(sql`${t.userId} is not null`),
    check("persons_height_ck", sql`${t.heightCm} is null or (${t.heightCm} > 30 and ${t.heightCm} < 260)`),
  ],
);

/** Data categories that can be granted independently. */
export const ACCESS_SCOPES = [
  "diary",
  "body",
  "health",
  "cycle",
  "labs",
  "medication",
  "photos",
  "ai",
] as const;
export type AccessScope = (typeof ACCESS_SCOPES)[number];

export const personAccess = pgTable(
  "person_access",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: accessRoleEnum().notNull(),
    /** Scopes granted; owner/manager implicitly have all. */
    scopes: text().array().$type<AccessScope[]>().notNull().default(sql`'{}'::text[]`),
    canWrite: boolean().notNull().default(false),
    expiresAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [uniqueIndex().on(t.personId, t.userId), index().on(t.userId)],
);

/** Invitations: closed registration. Token is stored hashed. */
export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    email: text().notNull(),
    tokenHash: text().notNull().unique(),
    groupId: uuid().references(() => groups.id, { onDelete: "cascade" }),
    groupRole: groupRoleEnum().notNull().default("member"),
    /** Optional: invite as professional (read-only) of a person. */
    personId: uuid().references(() => persons.id, { onDelete: "cascade" }),
    accessRole: accessRoleEnum(),
    scopes: text().array().$type<AccessScope[]>().notNull().default(sql`'{}'::text[]`),
    /** How long the granted person access lasts once accepted (professionals); null = no expiry. */
    accessDays: smallint(),
    invitedBy: text().references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    acceptedBy: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [index().on(t.email), index().on(t.groupId)],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text().notNull().unique(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    userAgent: text(),
    ...timestamps(),
  },
  (t) => [index().on(t.userId)],
);

export const NOTIFICATION_TYPES = [
  "meal_reminder",
  "water",
  "medication",
  "supplement",
  "fasting",
  "expiry",
  "weekly_report",
  "challenge",
  "plan_ready",
  "retro",
  "quiet_hours",
] as const;

export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text().notNull(),
    enabled: boolean().notNull().default(true),
    /** e.g. { times: ["08:30","14:00"], quietHours: ["23:00","07:30"] } */
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [uniqueIndex().on(t.userId, t.type)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text().notNull(),
    title: text().notNull(),
    body: text().notNull().default(""),
    url: text(),
    readAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index().on(t.userId, t.createdAt)],
);

/** Personal API tokens (MCP, API, Home Assistant). Stored hashed; scopes read/write/destroy. */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text().notNull(),
    tokenHash: text().notNull().unique(),
    prefix: text().notNull(),
    scopes: text().array().notNull().default(sql`'{read}'::text[]`),
    lastUsedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index().on(t.userId)],
);

/** Outgoing webhooks (goal reached, expiries…), signed with HMAC secret. */
export const webhooks = pgTable(
  "webhooks",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    url: text().notNull(),
    events: text().array().notNull(),
    secretEnc: text().notNull(),
    enabled: boolean().notNull().default(true),
    lastStatus: integer(),
    lastDeliveryAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index().on(t.userId)],
);

/** External integrations (openGym, Open Food Facts account, Mercadona…). Credentials encrypted. */
export const integrationAccounts = pgTable(
  "integration_accounts",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    personId: uuid().references(() => persons.id, { onDelete: "cascade" }),
    provider: text().notNull(), // "opengym" | "off" | "mercadona" | ...
    baseUrl: text(),
    credentialsEnc: text(),
    webhookSecretEnc: text(),
    status: text().notNull().default("active"),
    lastSyncAt: timestamp({ withTimezone: true }),
    lastError: text(),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [index().on(t.userId), uniqueIndex().on(t.userId, t.provider, t.personId)],
);

export const imports = pgTable(
  "imports",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    personId: uuid().references(() => persons.id, { onDelete: "cascade" }),
    source: text().notNull(), // "mfp" | "loseit" | "cronometer" | "waistline" | "json"
    status: text().notNull().default("pending"),
    fileName: text(),
    stats: jsonb().$type<Record<string, number>>().notNull().default({}),
    error: text(),
    ...timestamps(),
  },
  (t) => [index().on(t.userId)],
);

/** Audit trail for access to sensitive health data and admin actions. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    userId: text().references(() => user.id, { onDelete: "set null" }),
    personId: uuid().references(() => persons.id, { onDelete: "set null" }),
    action: text().notNull(),
    resource: text().notNull(),
    resourceId: text(),
    ip: text(),
    requestId: text(),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.personId, t.createdAt), index().on(t.userId, t.createdAt)],
);

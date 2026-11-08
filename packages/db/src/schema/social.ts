/** M13 gamification and professional access notes. */
import { date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { user } from "./auth";
import { groups, persons } from "./core";

export const streaks = pgTable(
  "streaks",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    kind: text().notNull(), // logging | water | protein | veggies | fasting | steps
    current: integer().notNull().default(0),
    best: integer().notNull().default(0),
    lastDate: date({ mode: "string" }),
    ...timestamps(),
  },
  (t) => [uniqueIndex().on(t.personId, t.kind)],
);

export const achievements = pgTable("achievements", {
  code: text().primaryKey(),
  nameEs: text().notNull(),
  descriptionEs: text().notNull(),
  icon: text().notNull().default("trophy"),
  /** Machine-readable rule evaluated by the worker. */
  rule: jsonb().$type<Record<string, unknown>>().notNull(),
});

export const personAchievements = pgTable(
  "person_achievements",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    achievementCode: text()
      .notNull()
      .references(() => achievements.code, { onDelete: "cascade" }),
    unlockedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.personId, t.achievementCode)],
);

export const challenges = pgTable(
  "challenges",
  {
    id: id(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    title: text().notNull(),
    description: text(),
    /** e.g. { metric: "veggie_servings", perDay: 5 } */
    rule: jsonb().$type<Record<string, unknown>>().notNull(),
    startDate: date({ mode: "string" }).notNull(),
    endDate: date({ mode: "string" }).notNull(),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [index().on(t.groupId, t.endDate)],
);

export const challengeParticipants = pgTable(
  "challenge_participants",
  {
    id: id(),
    challengeId: uuid()
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    score: integer().notNull().default(0),
    progress: jsonb().$type<Record<string, number>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [uniqueIndex().on(t.challengeId, t.personId)],
);

/** Notes left by a professional (nutritionist) on a person's data. */
export const professionalNotes = pgTable(
  "professional_notes",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    authorId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }),
    bodyMd: text().notNull(),
    ...timestamps(),
  },
  (t) => [index().on(t.personId, t.createdAt)],
);

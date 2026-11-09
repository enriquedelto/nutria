/** Sport profile (athlete condition config), training/rest days and the day's water goal. */
import { and, eq, exerciseLogs, gte, gt, integrationAccounts, personConditions, persons, sql, type Database } from "@nutria/db";
import { addDays, isoDow, sportProfile, todayIn, trainingDaySplit, waterTargetMl, type SportProfile } from "@nutria/nutrition";
import { latestWeight } from "./targets";

export type DayKind = "training" | "rest";

export async function getSportProfile(db: Database, personId: string): Promise<{ active: boolean; exists: boolean; profile: SportProfile; config: Record<string, unknown> }> {
  const [c] = await db
    .select({ active: personConditions.active, config: personConditions.config })
    .from(personConditions)
    .where(and(eq(personConditions.personId, personId), eq(personConditions.conditionCode, "athlete")))
    .limit(1);
  return { active: !!c?.active, exists: !!c, profile: sportProfile(c?.config), config: c?.config ?? {} };
}

/** Upsert the athlete condition with a (partial) sport profile. */
export async function saveSportProfile(db: Database, personId: string, active: boolean, patch: Partial<SportProfile>) {
  const cur = await getSportProfile(db, personId);
  const config: Record<string, unknown> = { ...cur.config, ...patch };
  for (const k of Object.keys(config)) if (config[k] === undefined) delete config[k];
  await db
    .insert(personConditions)
    .values({ personId, conditionCode: "athlete", active, config, since: new Date().toISOString().slice(0, 10) })
    .onConflictDoUpdate({ target: [personConditions.personId, personConditions.conditionCode], set: { active, config, updatedAt: new Date() } });
  return sportProfile(config);
}

/** Planned training weekdays from an openGym `week` map (keys 0/7 = Sunday, 1 = Monday …). */
export function plannedDaysFromWeek(week: Record<string, unknown> | null | undefined): number[] {
  if (!week) return [];
  const days = Object.entries(week)
    .filter(([, v]) => (Array.isArray(v) ? v.length > 0 : !!v))
    .map(([k]) => Number(k))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 7)
    .map((d) => (d === 0 ? 7 : d));
  return [...new Set(days)].sort((a, b) => a - b);
}

/** Copy openGym planned days into the sport profile unless the person set them by hand. */
export async function applyPlannedDays(db: Database, personId: string, days: number[]) {
  if (!days.length) return false;
  const cur = await getSportProfile(db, personId);
  if (!cur.exists || cur.profile.trainingDaysSource === "manual") return false;
  if (cur.profile.trainingDays?.join() === days.join()) return false;
  await saveSportProfile(db, personId, cur.active, { trainingDays: days, trainingDaysSource: "opengym" });
  return true;
}

/** openGym planned days stored on the integration (for defaults in the profile form). */
export async function openGymPlannedDays(db: Database, personId: string): Promise<number[]> {
  const [a] = await db.select({ meta: integrationAccounts.meta }).from(integrationAccounts).where(and(eq(integrationAccounts.personId, personId), eq(integrationAccounts.provider, "opengym"))).limit(1);
  const d = a?.meta?.plannedDays;
  return Array.isArray(d) ? d.map(Number).filter((x) => x >= 1 && x <= 7) : [];
}

async function loggedMinutes(db: Database, personId: string, date: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int`, min: sql<number>`coalesce(sum(${exerciseLogs.durationMin}),0)::float` })
    .from(exerciseLogs)
    .where(and(eq(exerciseLogs.personId, personId), eq(exerciseLogs.date, date)));
  return { n: r?.n ?? 0, min: r?.min ?? 0 };
}

/** Average session length over the last 6 weeks (sessions with a duration), default 60 min. */
export async function averageSessionMin(db: Database, personId: string, today: string) {
  const [r] = await db
    .select({ avg: sql<number | null>`avg(${exerciseLogs.durationMin})::float` })
    .from(exerciseLogs)
    .where(and(eq(exerciseLogs.personId, personId), gte(exerciseLogs.date, addDays(today, -42)), gt(exerciseLogs.durationMin, 0)));
  return r?.avg ? Math.round(r.avg) : 60;
}

/**
 * Training day = a workout is logged that day, or (today/future) it is a planned weekday.
 * Past planned days without a workout count as rest (the session was skipped).
 */
export function dayKindFor(date: string, today: string, logged: boolean, sp: SportProfile): DayKind {
  if (logged) return "training";
  if (date >= today && sp.trainingDays?.includes(isoDow(date))) return "training";
  return "rest";
}

export async function personToday(db: Database, personId: string) {
  const [p] = await db.select({ tz: persons.timezone }).from(persons).where(eq(persons.id, personId)).limit(1);
  return todayIn(p?.tz ?? "Europe/Madrid");
}

type Macros = { kcal: number; protein: number; carbs: number; fat: number };

/** Training and rest variants of a daily target (null when carb cycling is off or not applicable). */
export function sportDayVariants<T extends Macros>(base: T, sp: SportProfile) {
  if (!sp.cycleCarbs || !sp.trainingDays?.length) return null;
  return trainingDaySplit(base, sp.trainingDays.length);
}

/** Water goal for a date: automatic (weight + training time) when enabled in the sport profile. */
export async function waterGoalFor(db: Database, personId: string, date: string) {
  const [p] = await db.select({ settings: persons.settings, tz: persons.timezone }).from(persons).where(eq(persons.id, personId)).limit(1);
  const manual = p?.settings?.waterGoalMl ?? 2000;
  const sport = await getSportProfile(db, personId);
  if (!sport.active || !sport.profile.waterAuto) return { ml: manual, auto: false as const };
  const w = await latestWeight(db, personId);
  if (!w) return { ml: manual, auto: false as const };
  const today = todayIn(p?.tz ?? "Europe/Madrid");
  const logged = await loggedMinutes(db, personId, date);
  const kind = dayKindFor(date, today, logged.n > 0, sport.profile);
  const minutes = kind === "training" ? Math.max(logged.min, logged.n ? 0 : await averageSessionMin(db, personId, today)) : 0;
  return { ml: waterTargetMl({ weightKg: w.kg, trainingMin: minutes }), auto: true as const, dayKind: kind, trainingMin: Math.round(minutes) };
}

/** Water goal without training (streaks use it for every day): automatic or the fixed setting. */
export async function baseWaterGoal(db: Database, personId: string, manual: number) {
  const sport = await getSportProfile(db, personId);
  if (!sport.active || !sport.profile.waterAuto) return manual;
  const w = await latestWeight(db, personId);
  return w ? waterTargetMl({ weightKg: w.kg }) : manual;
}

/** Is `date` a training day for this person (sport profile + logged workouts)? */
export async function isTrainingDay(db: Database, personId: string, date: string, sp?: SportProfile) {
  const profile = sp ?? (await getSportProfile(db, personId)).profile;
  const today = await personToday(db, personId);
  const logged = await loggedMinutes(db, personId, date);
  return dayKindFor(date, today, logged.n > 0, profile);
}

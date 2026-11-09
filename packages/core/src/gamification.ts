/** Streaks, achievements and group challenge scoring. */
import {
  achievements,
  and,
  challengeParticipants,
  challenges,
  count,
  dailySummaries,
  desc,
  diaryEntries,
  eq,
  fastingSessions,
  goals,
  gte,
  lte,
  personAchievements,
  persons,
  recipes,
  sql,
  streaks,
  targetSets,
  type Database,
} from "@nutria/db";
import { addDays, streak, todayIn } from "@nutria/nutrition";
import { rowsOf } from "./util";
import { baseWaterGoal } from "./sport";

const VEG_CATEGORY = /en:(fruits|vegetables|fresh-vegetables|fresh-fruits|legumes)/;

/** Day-level achievement flags from the daily summary + targets. */
async function dayFlags(db: Database, personId: string, from: string, to: string) {
  const [t] = await db.select().from(targetSets).where(and(eq(targetSets.personId, personId), eq(targetSets.isDefault, true))).limit(1);
  const [p] = await db.select({ settings: persons.settings }).from(persons).where(eq(persons.id, personId)).limit(1);
  const days = await db.select().from(dailySummaries).where(and(eq(dailySummaries.personId, personId), gte(dailySummaries.date, from), lte(dailySummaries.date, to)));
  // Fruit & veg servings ≈ 80 g portions from entries whose food is in fruit/veg categories.
  const veg = await db.execute<{ date: string; grams: number }>(sql`
    select d.date::text as date, coalesce(sum(d.grams), 0)::float as grams
    from diary_entries d join foods f on f.id = d.food_id
    where d.person_id = ${personId} and d.date between ${from} and ${to}
      and exists (select 1 from unnest(f.categories) c where c ~ ${VEG_CATEGORY.source})
    group by d.date`);
  const vegRows = rowsOf<{ date: string; grams: number }>(veg);
  const vegByDate = new Map(vegRows.map((r) => [r.date, r.grams]));
  const waterGoal = await baseWaterGoal(db, personId, p?.settings.waterGoalMl ?? 2000);
  return {
    logging: days.filter((d) => d.entries >= 2).map((d) => d.date),
    water: days.filter((d) => d.waterMl >= waterGoal).map((d) => d.date),
    protein: t ? days.filter((d) => d.protein >= t.protein * 0.95).map((d) => d.date) : [],
    veggies: [...vegByDate].filter(([, g]) => g >= 400).map(([d]) => d),
    days,
    target: t ?? null,
  };
}

export async function updateStreaks(db: Database, personId: string, today: string) {
  const flags = await dayFlags(db, personId, addDays(today, -400), today);
  const out: Record<string, { current: number; best: number }> = {};
  for (const kind of ["logging", "water", "protein", "veggies"] as const) {
    const s = streak(flags[kind], today);
    out[kind] = s;
    await db
      .insert(streaks)
      .values({ personId, kind, current: s.current, best: s.best, lastDate: s.lastDate })
      .onConflictDoUpdate({ target: [streaks.personId, streaks.kind], set: { current: s.current, best: sql`greatest(${streaks.best}, ${s.best})`, lastDate: s.lastDate, updatedAt: new Date() } });
  }
  return { streaks: out, flags };
}

/** Evaluate every achievement rule; returns newly unlocked codes. */
export async function evaluateAchievements(db: Database, personId: string, now = new Date()) {
  const [p] = await db.select({ timezone: persons.timezone, groupId: persons.groupId }).from(persons).where(eq(persons.id, personId)).limit(1);
  if (!p) return [];
  const today = todayIn(p.timezone, now);
  const { streaks: st, flags } = await updateStreaks(db, personId, today);
  const all = await db.select().from(achievements);
  const have = new Set((await db.select({ code: personAchievements.achievementCode }).from(personAchievements).where(eq(personAchievements.personId, personId))).map((r) => r.code));
  const week = flags.days.filter((d) => d.date > addDays(today, -7));
  const unlocked: string[] = [];
  for (const a of all) {
    if (have.has(a.code)) continue;
    const r = a.rule as Record<string, unknown>;
    let ok = false;
    switch (r.type) {
      case "streak":
        ok = (st[r.kind as string]?.best ?? 0) >= Number(r.gte);
        break;
      case "count": {
        const gteN = Number(r.gte);
        if (r.table === "diary_entries") {
          const [c] = await db.select({ n: count() }).from(diaryEntries).where(and(eq(diaryEntries.personId, personId), r.origin ? eq(diaryEntries.origin, String(r.origin)) : undefined));
          ok = (c?.n ?? 0) >= gteN;
        } else if (r.table === "recipes" && p.groupId) {
          const [c] = await db.select({ n: count() }).from(recipes).where(eq(recipes.groupId, p.groupId));
          ok = (c?.n ?? 0) >= gteN;
        } else if (r.table === "fasting_sessions") {
          const [c] = await db.select({ n: count() }).from(fastingSessions).where(and(eq(fastingSessions.personId, personId), sql`${fastingSessions.endedAt} is not null and extract(epoch from ${fastingSessions.endedAt} - ${fastingSessions.startedAt}) / 3600 >= ${fastingSessions.targetHours}`));
          ok = (c?.n ?? 0) >= gteN;
        } else if (r.table === "meal_plans" || r.table === "cook_sessions") {
          const table = r.table === "meal_plans" ? sql`meal_plans` : sql`cook_sessions`;
          const res = await db.execute<{ n: number }>(sql`select count(*)::int as n from ${table} t where t.group_id = ${p.groupId} and t.status = ${String(r.status ?? "done")}`);
          const rows = rowsOf<{ n: number }>(res);
          ok = (rows[0]?.n ?? 0) >= gteN;
        }
        break;
      }
      case "weekly_avg":
        if (week.length >= 5) {
          if (r.nutrient === "fiber" && flags.target?.fiber) ok = week.reduce((s, d) => s + d.fiber, 0) / week.length >= flags.target.fiber * Number(r.gteTarget ?? 1);
          if (r.metric === "upf_kcal_pct") {
            const vals = week.map((d) => d.upfKcalPct).filter((v): v is number => v != null);
            ok = vals.length >= 5 && vals.reduce((s, v) => s + v, 0) / vals.length <= Number(r.lte);
          }
        }
        break;
      case "goal_reached": {
        const [g] = await db.select({ id: goals.id }).from(goals).where(and(eq(goals.personId, personId), eq(goals.status, "reached"))).limit(1);
        ok = !!g;
        break;
      }
      case "challenge_win": {
        const won = await db
          .select({ id: challenges.id })
          .from(challenges)
          .innerJoin(challengeParticipants, eq(challengeParticipants.challengeId, challenges.id))
          .where(and(eq(challengeParticipants.personId, personId), sql`${challenges.endDate} < ${today}`, sql`${challengeParticipants.score} = (select max(cp.score) from challenge_participants cp where cp.challenge_id = ${challenges.id})`, sql`${challengeParticipants.score} > 0`))
          .limit(1);
        ok = won.length > 0;
        break;
      }
    }
    if (ok) unlocked.push(a.code);
  }
  if (unlocked.length) await db.insert(personAchievements).values(unlocked.map((code) => ({ personId, achievementCode: code }))).onConflictDoNothing();
  return unlocked;
}

/**
 * Challenge scoring. rule: { metric: "logging_days" | "water_days" | "protein_days" | "veggie_days" | "steps" }
 * Score = number of qualifying days (or total steps / 1000) between startDate and min(endDate, today).
 */
export async function scoreChallenge(db: Database, challengeId: string, today = todayIn()) {
  const [c] = await db.select().from(challenges).where(eq(challenges.id, challengeId)).limit(1);
  if (!c) return [];
  const end = c.endDate < today ? c.endDate : today;
  const parts = await db.select().from(challengeParticipants).where(eq(challengeParticipants.challengeId, c.id));
  const metric = String((c.rule as Record<string, unknown>).metric ?? "logging_days");
  for (const part of parts) {
    let score = 0;
    if (metric === "steps") {
      const res = await db.execute<{ s: number }>(sql`select coalesce(sum(steps), 0)::int as s from step_logs where person_id = ${part.personId} and date between ${c.startDate} and ${end}`);
      const rows = rowsOf<{ s: number }>(res);
      score = Math.floor((rows[0]?.s ?? 0) / 1000);
    } else {
      const f = await dayFlags(db, part.personId, c.startDate, end);
      const key = ({ logging_days: "logging", water_days: "water", protein_days: "protein", veggie_days: "veggies" } as const)[metric as "logging_days"] ?? "logging";
      score = f[key].length;
    }
    await db.update(challengeParticipants).set({ score, progress: { [metric]: score } }).where(eq(challengeParticipants.id, part.id));
  }
  return db.select().from(challengeParticipants).where(eq(challengeParticipants.challengeId, c.id)).orderBy(desc(challengeParticipants.score));
}

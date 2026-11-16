import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, checkins, dailySummaries, eq, notifications, persons, targetSets, user, weightLogs, type Database } from "@nutria/db";
import { createTestDb } from "@nutria/db/testing";
import { seedReference } from "@nutria/db/seed";
import { addDays } from "@nutria/nutrition";

const core = await import("../src");

let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Database;
let pid: string;
const uid = "chk";
// Monday 16-11-2026, 08:00 in Madrid.
const monday = new Date("2026-11-16T07:00:00Z");
const nextMonday = new Date(monday.getTime() + 7 * 86_400_000);

beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Database;
  await seedReference(db as never);
  await db.insert(user).values({ id: uid, name: "Check", email: "chk@example.com" });
  await core.onUserCreated(db, { id: uid, name: "Check", email: "chk@example.com" }, null, { firstUser: true });
  const [p] = await db.select().from(persons).where(eq(persons.userId, uid));
  pid = p!.id;
  await db.update(persons).set({ sex: "male", birthDate: "1995-01-01", heightCm: 178, activityLevel: "active", goalType: "gain", weeklyRateKg: 0.2, timezone: "Europe/Madrid" }).where(eq(persons.id, pid));
  // 50 days up to the second week: flat weight (no gain) and a full diary.
  for (let i = -50; i <= 7; i++) {
    const d = addDays("2026-11-16", i);
    await db.insert(weightLogs).values({ personId: pid, date: d, kg: 75 + (i % 2) * 0.1 });
    // Thursday of the first week reviewed: logged by half and not marked.
    const partial = d === "2026-11-12";
    await db.insert(dailySummaries).values({ personId: pid, date: d, kcal: partial ? 600 : 2900, protein: 140, entries: partial ? 1 : 4, complete: !partial });
  }
  await core.recomputeTargets(db, pid);
}, 120_000);

afterAll(async () => {
  await t?.close?.();
});

const kcalNow = async () => (await db.select({ kcal: targetSets.kcal }).from(targetSets).where(and(eq(targetSets.personId, pid), eq(targetSets.isDefault, true))))[0]!.kcal;
const notes = () => db.select().from(notifications).where(eq(notifications.type, core.CHECKIN));

describe("check-in semanal", () => {
  it("primera semana lenta: avisa una vez, sin cambio, y pregunta por el día a medias", async () => {
    const c = await core.weeklyCheckin(db, pid, monday);
    expect(c).toMatchObject({ weekStart: "2026-11-16", phase: "bulk", status: "pending", kcalDelta: 0 });
    expect(c!.data.proposal.verdict).toBe("more");
    expect(c!.data.suspectDays).toEqual([{ date: "2026-11-12", kcal: 600 }]);
    expect(c!.data.weekLoggedDays).toBe(6);
    expect(c!.data.recovery.level).toBe("unknown");
    // Run again (worker retry): the same row and still one notification.
    const again = await core.weeklyCheckin(db, pid, monday);
    expect(again!.id).toBe(c!.id);
    expect(await db.select().from(checkins).where(eq(checkins.personId, pid))).toHaveLength(1);
    expect(await notes()).toHaveLength(1);

    // Excluding the partial day marks it as such (it no longer counts anywhere).
    const a = await core.answerCheckin(db, pid, c!.id, { adherence: "all", pace: "keep", excludeDays: ["2026-11-12", "2026-11-13"] }, monday);
    expect(a.answers.excludeDays).toEqual(["2026-11-12"]); // only days that were offered
    expect(a.data.suspectDays).toHaveLength(1); // still shown, now ticked
    const [thu] = await db.select().from(dailySummaries).where(and(eq(dailySummaries.personId, pid), eq(dailySummaries.date, "2026-11-12")));
    expect(thu!.incomplete).toBe(true);

    const before = await kcalNow();
    const done = await core.decideCheckin(db, pid, c!.id, true);
    expect(done.status).toBe("accepted");
    expect(await kcalNow()).toBe(before);
  });

  it("segunda semana igual: propone +150; «solo algunas comidas» no cambia nada; al aceptar sube el objetivo", async () => {
    const c = await core.weeklyCheckin(db, pid, nextMonday);
    expect(c!.weekStart).toBe("2026-11-23");
    expect(c!.data.proposal).toMatchObject({ verdict: "more", kcalDelta: 150 });
    expect(await notes()).toHaveLength(2);

    const some = await core.answerCheckin(db, pid, c!.id, { adherence: "some", pace: "keep", excludeDays: [] }, nextMonday);
    expect(some.data.proposal.verdict).toBe("hold");
    expect(some.kcalDelta).toBe(0);

    const faster = await core.answerCheckin(db, pid, c!.id, { adherence: "all", pace: "faster", excludeDays: [] }, nextMonday);
    expect(faster.data.proposal.kcalDelta).toBe(150);
    // +0,1 % of ~75 kg a week ≈ +0,07–0,08 kg → 75–100 kcal.
    const pace = faster.data.proposal.paceKcal;
    expect([75, 100]).toContain(pace);
    expect(faster.kcalDelta).toBe(150 + pace);

    const before = await kcalNow();
    const done = await core.decideCheckin(db, pid, c!.id, true);
    expect(done.status).toBe("accepted");
    // +150 from the trend, and the new rate recalculates the targets.
    const after = await kcalNow();
    expect(after - before).toBeGreaterThanOrEqual(150 + pace - 25);
    expect(after - before).toBeLessThanOrEqual(150 + pace + 25);
    expect(done.kcalAfter).toBe(Math.round(after));
    const [p] = await db.select({ rate: persons.weeklyRateKg }).from(persons).where(eq(persons.id, pid));
    expect(p!.rate).toBe(faster.data.proposal.targetRateKgWeek);
    // Decided: the job leaves it alone, and deciding twice changes nothing.
    expect((await core.weeklyCheckin(db, pid, nextMonday))!.status).toBe("accepted");
    await core.decideCheckin(db, pid, c!.id, true);
    expect(await kcalNow()).toBe(after);
    expect(await core.listCheckins(db, pid)).toHaveLength(2);
  });
});

describe("cerrar el día", () => {
  it("avisa por la noche si el día va corto, y «Completo» lo marca", async () => {
    const day = "2026-11-24";
    await db.insert(dailySummaries).values({ personId: pid, date: day, kcal: 1200, protein: 60, entries: 3 }).onConflictDoUpdate({ target: [dailySummaries.personId, dailySummaries.date], set: { kcal: 1200, entries: 3, complete: false, incomplete: false } });
    // 22:00: not yet.
    await core.remindersTick(db, core.zonedTime(day, "22:00", "Europe/Madrid"));
    expect(await db.select().from(notifications).where(eq(notifications.type, core.DAY_CLOSE))).toHaveLength(0);
    await core.remindersTick(db, core.zonedTime(day, "22:32", "Europe/Madrid"));
    const [n] = await db.select().from(notifications).where(eq(notifications.type, core.DAY_CLOSE));
    expect(n!.title).toMatch(/^🌙 Faltan ~\d+ kcal hoy$/);

    // Answered after midnight: it marks the day of the notification.
    const r = await core.quickLog(db, { personId: pid, userId: uid, kind: "day_complete", date: day }, core.zonedTime("2026-11-25", "00:20", "Europe/Madrid"));
    expect(r.ok).toBe(true);
    const [s] = await db.select().from(dailySummaries).where(and(eq(dailySummaries.personId, pid), eq(dailySummaries.date, day)));
    expect(s!.complete).toBe(true);
  });

  it("solo con días cortos sin marcar", () => {
    expect(core.dayCloseGap({ kcal: 1200, entries: 3 }, 3000)).toBe(1800);
    expect(core.dayCloseGap({ kcal: 2200, entries: 3 }, 3000)).toBeNull(); // > 70 %
    expect(core.dayCloseGap({ kcal: 0, entries: 0 }, 3000)).toBeNull(); // nothing logged
    expect(core.dayCloseGap({ kcal: 1200, entries: 3, complete: true }, 3000)).toBeNull();
    expect(core.dayCloseGap({ kcal: 1200, entries: 3 }, null)).toBeNull();
  });
});

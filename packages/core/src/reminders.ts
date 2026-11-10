/**
 * Time-based reminders (called every 5 min by the worker): medication doses, supplements,
 * meal/water reminders from notification_prefs, fasting goal reached, pantry expiry.
 */
import {
  and,
  eq,
  gte,
  isNull,
  lte,
  mealSlots,
  medicationDoses,
  medications,
  notificationPrefs,
  pantryItems,
  progressPhotos,
  personAccess,
  persons,
  fastingSessions,
  groupMembers,
  sql,
  supplementSchedules,
  foods,
  type Database,
} from "@nutria/db";
import { addDays, expiryStatus, isoDow, photoReminderDue, proteinGapG, todayIn } from "@nutria/nutrition";
import { targetsForDate } from "./targets";
import { proteinIdeas, proteinToday } from "./timing";
import { notify, QUICK_ACTIONS } from "./notify";
import { supplementTakenOn } from "./supplements";

/** Users that should receive reminders for a person (owners/managers). */
async function caretakers(db: Database, personId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: personAccess.userId })
    .from(personAccess)
    .where(and(eq(personAccess.personId, personId), sql`${personAccess.role} in ('owner','manager')`));
  const [own] = await db.select({ userId: persons.userId }).from(persons).where(eq(persons.id, personId)).limit(1);
  return [...new Set([...rows.map((r) => r.userId), ...(own?.userId ? [own.userId] : [])])];
}

/** Wall-clock date+time in a zone → UTC Date. */
export function zonedTime(date: string, hhmm: string, timeZone: string): Date {
  const guess = new Date(`${date}T${hhmm.slice(0, 5)}:00Z`);
  const local = new Date(guess.toLocaleString("en-US", { timeZone }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (local.getTime() - utc.getTime()));
}

/** Create today's pending medication doses (idempotent). */
export async function generateMedicationDoses(db: Database, now = new Date()) {
  const meds = await db
    .select({ id: medications.id, personId: medications.personId, times: medications.times, daysOfWeek: medications.daysOfWeek, startDate: medications.startDate, endDate: medications.endDate, timezone: persons.timezone })
    .from(medications)
    .innerJoin(persons, eq(persons.id, medications.personId))
    .where(eq(medications.active, true));
  let created = 0;
  for (const m of meds) {
    const today = todayIn(m.timezone, now);
    if ((m.startDate && today < m.startDate) || (m.endDate && today > m.endDate)) continue;
    if (!m.daysOfWeek.includes(isoDow(today))) continue;
    for (const t of m.times) {
      const at = zonedTime(today, t, m.timezone);
      const exists = await db.select({ id: medicationDoses.id }).from(medicationDoses).where(and(eq(medicationDoses.medicationId, m.id), eq(medicationDoses.scheduledAt, at))).limit(1);
      if (exists.length) continue;
      await db.insert(medicationDoses).values({ medicationId: m.id, personId: m.personId, scheduledAt: at });
      created++;
    }
  }
  return created;
}

/** Fire due reminders within the last `windowMin` minutes (de-duplicated by `notifiedAt`-like markers). */
export async function remindersTick(db: Database, now = new Date(), windowMin = 5) {
  const since = new Date(now.getTime() - windowMin * 60_000);
  let sent = 0;

  // Medication doses due now and still pending.
  const due = await db
    .select({ id: medicationDoses.id, personId: medicationDoses.personId, name: medications.name, dose: medications.dose, withFood: medications.withFood, person: persons.displayName, timezone: persons.timezone })
    .from(medicationDoses)
    .innerJoin(medications, eq(medications.id, medicationDoses.medicationId))
    .innerJoin(persons, eq(persons.id, medicationDoses.personId))
    .where(and(eq(medicationDoses.status, "pending"), gte(medicationDoses.scheduledAt, since), lte(medicationDoses.scheduledAt, now)));
  for (const d of due) {
    const hint = d.withFood === "fasting" ? " · en ayunas" : d.withFood === "with_food" ? " · con comida" : d.withFood === "after_food" ? " · después de comer" : "";
    for (const userId of await caretakers(db, d.personId)) {
      await notify(db, { userId, type: "medication", title: `💊 ${d.name}${d.dose ? ` (${d.dose})` : ""}`, body: `${d.person}${hint}`, url: `/salud/medicacion?dosis=${d.id}`, tag: `med-${d.id}`, respectQuietHours: false, timezone: d.timezone });
      sent++;
    }
  }

  // Supplements at their times.
  const sups = await db
    .select({ id: supplementSchedules.id, personId: supplementSchedules.personId, foodId: supplementSchedules.foodId, times: supplementSchedules.times, daysOfWeek: supplementSchedules.daysOfWeek, name: sql<string>`coalesce(${foods.nameEs}, ${foods.name})`, timezone: persons.timezone })
    .from(supplementSchedules)
    .innerJoin(foods, eq(foods.id, supplementSchedules.foodId))
    .innerJoin(persons, eq(persons.id, supplementSchedules.personId))
    .where(eq(supplementSchedules.active, true));
  for (const s of sups) {
    const today = todayIn(s.timezone, now);
    if (!s.daysOfWeek.includes(isoDow(today))) continue;
    for (const t of s.times) {
      const at = zonedTime(today, t, s.timezone);
      if (at <= since || at > now) continue;
      // Already logged today (from Hoy or the diary): no reminder.
      if (await supplementTakenOn(db, s.personId, s.foodId, today)) continue;
      for (const userId of await caretakers(db, s.personId)) {
        await notify(db, { userId, type: "supplement", title: `Suplemento: ${s.name}`, url: "/hoy", tag: `sup-${s.id}`, timezone: s.timezone });
        sent++;
      }
    }
  }

  // Meal & water reminders configured in notification_prefs.config.times (["08:30", …]).
  const prefs = await db
    .select({ userId: notificationPrefs.userId, type: notificationPrefs.type, config: notificationPrefs.config, timezone: persons.timezone })
    .from(notificationPrefs)
    .innerJoin(persons, eq(persons.userId, notificationPrefs.userId))
    .where(and(eq(notificationPrefs.enabled, true), sql`(${notificationPrefs.type} in ('meal_reminder','water') or ${notificationPrefs.type} like 'custom:%')`));
  for (const p of prefs) {
    const times = Array.isArray(p.config.times) ? (p.config.times as string[]) : [];
    const today = todayIn(p.timezone, now);
    const days = Array.isArray(p.config.daysOfWeek) ? (p.config.daysOfWeek as number[]) : null;
    if (days?.length && !days.includes(isoDow(today))) continue;
    for (const t of times) {
      const at = zonedTime(today, t, p.timezone);
      if (at > since && at <= now) {
        await notify(db, p.type.startsWith("custom:") ? { userId: p.userId, type: "custom", title: `⏰ ${String(p.config.title ?? "Recordatorio")}`, url: String(p.config.url ?? "/hoy"), tag: p.type, timezone: p.timezone } : p.type === "water" ? { userId: p.userId, type: "water", title: "💧 ¿Un vaso de agua?", url: "/hoy?agua=250", tag: "water", timezone: p.timezone } : { userId: p.userId, type: "meal_reminder", title: "🍽️ ¿Registramos la comida?", url: "/registrar", tag: "meal", timezone: p.timezone, actions: [QUICK_ACTIONS.usual, QUICK_ACTIONS.dictate] });
        sent++;
      }
    }
  }

  // Evening protein nudge: on by default for people gaining, or when enabled in Avisos (config.times[0], default 20:00).
  const prot = await db
    .select({ personId: persons.id, userId: persons.userId, timezone: persons.timezone, config: notificationPrefs.config })
    .from(persons)
    .leftJoin(notificationPrefs, and(eq(notificationPrefs.userId, persons.userId), eq(notificationPrefs.type, "protein")))
    .where(sql`${persons.userId} is not null and (${notificationPrefs.enabled} is true or (${notificationPrefs.id} is null and ${persons.goalType} = 'gain'))`);
  for (const p of prot) {
    const today = todayIn(p.timezone, now);
    const t = Array.isArray(p.config?.times) && typeof p.config.times[0] === "string" ? (p.config.times[0] as string) : "20:00";
    const at = zonedTime(today, t, p.timezone);
    if (at <= since || at > now) continue;
    const [target, eaten] = await Promise.all([targetsForDate(db, p.personId, today), proteinToday(db, p.personId, today)]);
    // Nothing logged today is a logging problem, not a protein one.
    const gap = target && eaten.entries ? proteinGapG(target.protein, eaten.protein) : 0;
    if (!gap) continue;
    const ideas = await proteinIdeas(db, p.personId, today);
    await notify(db, {
      userId: p.userId!,
      type: "protein",
      title: `🥚 Te faltan ${gap} g de proteína`,
      body: ideas.length ? `Ideas: ${ideas.map((i) => `${i.name} (${i.protein} g)`).join(", ")}` : "Un lácteo, huevos, legumbre o un batido antes de acostarte.",
      url: "/hoy",
      tag: "protein",
      timezone: p.timezone,
    });
    sent++;
  }

  // Fasting target reached.
  const fasts = await db
    .select({ id: fastingSessions.id, personId: fastingSessions.personId, startedAt: fastingSessions.startedAt, targetHours: fastingSessions.targetHours, timezone: persons.timezone })
    .from(fastingSessions)
    .innerJoin(persons, eq(persons.id, fastingSessions.personId))
    .where(isNull(fastingSessions.endedAt));
  for (const f of fasts) {
    const goal = new Date(f.startedAt.getTime() + f.targetHours * 3_600_000);
    if (goal > since && goal <= now) for (const userId of await caretakers(db, f.personId)) {
      await notify(db, { userId, type: "fasting", title: `⏱️ ¡${f.targetHours} h de ayuno completadas!`, url: "/salud/ayuno", tag: `fast-${f.id}`, timezone: f.timezone });
      sent++;
    }
  }
  return sent;
}

/** Daily: notify group members about items expiring today/tomorrow (and expired). */
export async function expiryCheck(db: Database, now = new Date()) {
  const today = todayIn("Europe/Madrid", now);
  const items = await db.select().from(pantryItems).where(and(sql`${pantryItems.expiresOn} is not null`, lte(pantryItems.expiresOn, addDays(today, 2))));
  const byGroup = new Map<string, typeof items>();
  for (const i of items) byGroup.set(i.groupId, [...(byGroup.get(i.groupId) ?? []), i]);
  let sent = 0;
  for (const [groupId, list] of byGroup) {
    const members = await db.select({ userId: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, groupId));
    const label = (on: string) => {
      if (expiryStatus(on, today) === "expired") return "caducado";
      return on === today ? "hoy" : on === addDays(today, 1) ? "mañana" : "pasado mañana";
    };
    const names = list.sort((a, b) => a.expiresOn!.localeCompare(b.expiresOn!)).map((i) => `${i.name} (${label(i.expiresOn!)})`);
    for (const m of members) {
      await notify(db, { userId: m.userId, type: "expiry", title: `🥫 ${list.length} producto(s) caducan pronto`, body: names.slice(0, 6).join(", "), url: "/despensa?filtro=caduca", tag: "expiry" });
      sent++;
    }
  }
  return sent;
}

/** Ensure the default meal slots exist for a person. */
export async function ensureMealSlots(db: Database, personId: string) {
  const defaults = [
    { key: "breakfast", label: "Desayuno", defaultTime: "08:00", sortOrder: 1, kcalShare: 0.2 },
    { key: "morning_snack", label: "Media mañana", defaultTime: "11:00", sortOrder: 2, kcalShare: 0.1 },
    { key: "lunch", label: "Comida", defaultTime: "14:30", sortOrder: 3, kcalShare: 0.35 },
    { key: "afternoon_snack", label: "Merienda", defaultTime: "18:00", sortOrder: 4, kcalShare: 0.1 },
    { key: "dinner", label: "Cena", defaultTime: "21:30", sortOrder: 5, kcalShare: 0.25 },
  ];
  await db.insert(mealSlots).values(defaults.map((d) => ({ ...d, personId }))).onConflictDoNothing();
}

/** Daily: people who take progress photos get a nudge every 4 weeks after the last one. */
export async function photoReminders(db: Database, now = new Date()) {
  const rows = await db
    .select({ personId: persons.id, userId: persons.userId, timezone: persons.timezone, last: sql<string>`max(${progressPhotos.date})` })
    .from(progressPhotos)
    .innerJoin(persons, eq(persons.id, progressPhotos.personId))
    .where(sql`${persons.userId} is not null`)
    .groupBy(persons.id);
  let sent = 0;
  for (const r of rows) {
    if (!photoReminderDue(r.last, todayIn(r.timezone, now))) continue;
    await notify(db, { userId: r.userId!, type: "progress_photo", title: "📷 Toca foto de progreso", body: "Han pasado 4 semanas desde la última. Misma luz, misma postura.", url: "/progreso", tag: "progress-photo", timezone: r.timezone });
    sent++;
  }
  return sent;
}

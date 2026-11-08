"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { and, challengeParticipants, challenges, eq, persons } from "@nutria/db";
import { evaluateAchievements, scoreChallenge, updateStreaks } from "@nutria/core";
import { todayIn } from "@nutria/nutrition";
import { db } from "@/lib/db";
import { kitchenGuard } from "@/lib/kitchen";
import { assertAccess } from "@/lib/session";

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type ChallengeMetric = "logging_days" | "water_days" | "protein_days" | "veggie_days" | "steps";
const METRICS = ["logging_days", "water_days", "protein_days", "veggie_days", "steps"] as const;

async function ownChallenge(id: string, groupId: string) {
  const [c] = await db().select().from(challenges).where(and(eq(challenges.id, uuid.parse(id)), eq(challenges.groupId, groupId))).limit(1);
  if (!c) throw new Error("Reto no encontrado");
  return c;
}

/** Only persons of the group the user can at least read the diary of can be enrolled. */
async function enrollable(userId: string, groupId: string, personIds: string[]) {
  const ok: string[] = [];
  for (const pid of personIds) {
    const [p] = await db().select({ id: persons.id }).from(persons).where(and(eq(persons.id, pid), eq(persons.groupId, groupId))).limit(1);
    if (!p) continue;
    try {
      await assertAccess(userId, pid, "diary", true);
      ok.push(pid);
    } catch {}
  }
  return ok;
}

export async function createChallenge(input: { title: string; description?: string; metric: ChallengeMetric; startDate: string; endDate: string; personIds: string[]; target?: number | null }) {
  const { user, groupId } = await kitchenGuard();
  const v = z
    .object({ title: z.string().trim().min(1).max(100), description: z.string().max(500).optional(), metric: z.enum(METRICS), startDate: day, endDate: day, personIds: z.array(uuid).max(20), target: z.number().int().min(1).max(10000).nullish() })
    .refine((x) => x.endDate >= x.startDate, "La fecha de fin es anterior al inicio")
    .parse(input);
  const [c] = await db().insert(challenges).values({ groupId, title: v.title, description: v.description ?? null, rule: { metric: v.metric, target: v.target ?? null }, startDate: v.startDate, endDate: v.endDate, createdBy: user.id }).returning({ id: challenges.id });
  const ps = await enrollable(user.id, groupId, v.personIds);
  if (ps.length) await db().insert(challengeParticipants).values(ps.map((personId) => ({ challengeId: c!.id, personId }))).onConflictDoNothing();
  if (ps.length) await scoreChallenge(db(), c!.id);
  refresh();
  return c!.id;
}

export async function joinChallenge(challengeId: string, personId: string) {
  const { user, groupId } = await kitchenGuard();
  const c = await ownChallenge(challengeId, groupId);
  const [pid] = await enrollable(user.id, groupId, [uuid.parse(personId)]);
  if (!pid) throw new Error("No puedes apuntar a esta persona");
  await db().insert(challengeParticipants).values({ challengeId: c.id, personId: pid }).onConflictDoNothing();
  await scoreChallenge(db(), c.id);
  refresh();
}

export async function leaveChallenge(challengeId: string, personId: string) {
  const { user, groupId } = await kitchenGuard();
  const c = await ownChallenge(challengeId, groupId);
  await assertAccess(user.id, uuid.parse(personId), "diary", true);
  await db().delete(challengeParticipants).where(and(eq(challengeParticipants.challengeId, c.id), eq(challengeParticipants.personId, personId)));
  refresh();
}

export async function deleteChallenge(challengeId: string) {
  const { user, groupId, groupRole } = await kitchenGuard();
  const c = await ownChallenge(challengeId, groupId);
  if (c.createdBy !== user.id && groupRole !== "admin") throw new Error("Solo quien lo creó o un admin puede borrarlo");
  await db().delete(challenges).where(eq(challenges.id, c.id));
  refresh();
}

/** Recompute scores, streaks and achievements now instead of waiting for the nightly job. */
export async function refreshProgress(personId: string, timezone: string) {
  const { user, groupId } = await kitchenGuard();
  await assertAccess(user.id, uuid.parse(personId), "diary");
  const today = todayIn(z.string().max(60).parse(timezone));
  await updateStreaks(db(), personId, today);
  const unlocked = await evaluateAchievements(db(), personId);
  const mine = await db().select({ id: challengeParticipants.challengeId }).from(challengeParticipants).innerJoin(challenges, eq(challenges.id, challengeParticipants.challengeId)).where(and(eq(challengeParticipants.personId, personId), eq(challenges.groupId, groupId)));
  for (const c of mine) await scoreChallenge(db(), c.id, today);
  refresh();
  return unlocked;
}

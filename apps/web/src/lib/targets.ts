import "server-only";
import { bestEffort, JOBS, recomputeTargets } from "@nutria/core";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";

/**
 * Recompute targets after a change (weigh-in, profile) without failing the user's request. If it
 * fails, log it and queue a retry in the worker instead of leaving stale targets unnoticed.
 */
export async function recomputeTargetsSafe(personId: string) {
  const ok = await bestEffort("recalcular objetivos", recomputeTargets(db(), personId).then(() => true), { svc: "web", personId });
  if (!ok) await enqueue(JOBS.targetsRecompute, { personId }, { singletonKey: `targets:${personId}`, startAfter: 30 });
}

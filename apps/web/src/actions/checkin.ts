"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { answerCheckin, decideCheckin, weeklyCheckin } from "@nutria/core";
import { UserError } from "@/lib/errors";
import { db } from "@/lib/db";
import { assertAccess, getApiUser } from "@/lib/session";

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function guard(personId: string) {
  const u = await getApiUser();
  if (!u) throw new UserError("No autenticado");
  await assertAccess(u.id, uuid.parse(personId), "body", true);
  return u;
}

const asUserError = (e: unknown, fallback: string) => new UserError(e instanceof Error && e.message ? e.message : fallback);

/** Build this week's check-in now (without waiting for Monday's job; no notification). */
export async function startCheckin(personId: string) {
  await guard(personId);
  const c = await weeklyCheckin(db(), personId, new Date(), { notify: false }).catch((e) => {
    throw asUserError(e, "No se pudo preparar el check-in");
  });
  if (!c) throw new UserError("Faltan datos del perfil (sexo, fecha de nacimiento, altura y un pesaje)");
  refresh();
  return c.id;
}

const Answers = z.object({
  adherence: z.enum(["all", "some", "untracked"]),
  pace: z.enum(["faster", "keep", "slower"]),
  excludeDays: z.array(day).max(7),
});

export async function answerCheckinAction(personId: string, id: string, answers: z.input<typeof Answers>) {
  await guard(personId);
  const c = await answerCheckin(db(), personId, uuid.parse(id), Answers.parse(answers)).catch((e) => {
    throw asUserError(e, "No se pudo guardar");
  });
  refresh();
  return { kcalDelta: c.data.proposal.kcalDelta, paceKcal: c.data.proposal.paceKcal, reasons: c.data.proposal.reasons, verdict: c.data.proposal.verdict };
}

export async function decideCheckinAction(personId: string, id: string, accept: boolean) {
  await guard(personId);
  const c = await decideCheckin(db(), personId, uuid.parse(id), z.boolean().parse(accept)).catch((e) => {
    throw asUserError(e, "No se pudo aplicar");
  });
  refresh();
  return { status: c.status, kcalAfter: c.kcalAfter };
}

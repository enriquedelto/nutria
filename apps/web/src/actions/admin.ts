"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { and, auditLog, desc, eq, gte, user } from "@nutria/db";
import { audit, createInvitation, JOBS } from "@nutria/core";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { getApiUser } from "@/lib/session";

async function admin() {
  const u = await getApiUser();
  if (!u || u.role !== "admin") throw new Error("Solo administración");
  return u;
}

const base = () => (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");

export async function setUserRole(userId: string, role: "admin" | "member") {
  const me = await admin();
  if (userId === me.id && role !== "admin") throw new Error("No puedes quitarte la administración a ti");
  await db().update(user).set({ role: z.enum(["admin", "member"]).parse(role) }).where(eq(user.id, z.string().min(1).parse(userId)));
  await audit(db(), { userId: me.id, action: "set_role", resource: "user", resourceId: userId, meta: { role } });
  refresh();
}

/** Without SMTP, the reset link lands in the audit log; return it so the admin can pass it on. */
export async function resetLinkFor(userId: string) {
  const me = await admin();
  const [u] = await db().select({ id: user.id, email: user.email }).from(user).where(eq(user.id, z.string().min(1).parse(userId))).limit(1);
  if (!u) throw new Error("Usuario no encontrado");
  const since = new Date(Date.now() - 5_000);
  await auth().api.requestPasswordReset({ body: { email: u.email, redirectTo: "/login/restablecer" } });
  const [row] = await db().select().from(auditLog).where(and(eq(auditLog.resourceId, u.id), eq(auditLog.action, "password_reset_requested"), gte(auditLog.createdAt, since))).orderBy(desc(auditLog.createdAt)).limit(1);
  await audit(db(), { userId: me.id, action: "reset_link_generated", resource: "user", resourceId: u.id });
  const url = (row?.meta as { url?: string } | undefined)?.url;
  if (!url) throw new Error("No se pudo generar el enlace");
  return url;
}

/** Invitation that creates a brand-new household (not tied to the admin's). */
export async function inviteNewHousehold(email: string) {
  const me = await admin();
  const r = await createInvitation(db(), { email: z.string().trim().toLowerCase().email().parse(email), invitedBy: me.id, groupId: null });
  await audit(db(), { userId: me.id, action: "invite", resource: "invitation", resourceId: r.invitation.id, meta: { kind: "new_household" } });
  refresh();
  return `${base()}/invitacion/${r.token}`;
}

const RUNNABLE = { offMirror: JOBS.offMirror, ciqualImport: JOBS.ciqualImport, gamification: JOBS.gamification, cleanup: JOBS.cleanup, opengymSyncAll: JOBS.opengymSyncAll, tdeeWeekly: JOBS.tdeeWeekly } as const;
export type RunnableJob = keyof typeof RUNNABLE;

export async function runJobNow(job: RunnableJob) {
  const me = await admin();
  const name = RUNNABLE[z.enum(Object.keys(RUNNABLE) as [RunnableJob, ...RunnableJob[]]).parse(job)];
  // Manual runs are explicit: re-import even if data is already there.
  await enqueue(name, (name === JOBS.ciqualImport ? { force: true } : {}) as never, { singletonKey: `manual:${name}` });
  await audit(db(), { userId: me.id, action: "run_job", resource: "job", resourceId: name });
  refresh();
}

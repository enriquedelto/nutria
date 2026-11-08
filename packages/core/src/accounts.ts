/** Account bootstrap: closed invitations → group, own person, access rows, defaults. */
import { and, auditLog, count, eq, groupMembers, groups, invitations, isNull, personAccess, persons, sql, user, type Database } from "@nutria/db";
import { newToken, sha256 } from "@nutria/integrations";
import { ensureMealSlots } from "./reminders";

export async function createInvitation(db: Database, input: { email: string; invitedBy: string; groupId?: string | null; groupRole?: "admin" | "member"; personId?: string | null; accessRole?: "viewer" | "professional" | "manager"; scopes?: string[]; days?: number }) {
  const t = newToken("inv");
  const [inv] = await db
    .insert(invitations)
    .values({
      email: input.email.trim().toLowerCase(),
      tokenHash: t.hash,
      groupId: input.groupId ?? null,
      groupRole: input.groupRole ?? "member",
      personId: input.personId ?? null,
      accessRole: input.accessRole ?? null,
      scopes: (input.scopes ?? []) as never,
      invitedBy: input.invitedBy,
      expiresAt: new Date(Date.now() + (input.days ?? 14) * 86_400_000),
    })
    .returning();
  return { invitation: inv!, token: t.token };
}

/** Valid (unused, unexpired) invitation for token + email. */
export async function findInvitation(db: Database, token: string, email?: string) {
  const [inv] = await db.select().from(invitations).where(and(eq(invitations.tokenHash, sha256(token)), isNull(invitations.acceptedAt), sql`${invitations.expiresAt} > now()`)).limit(1);
  if (!inv) return null;
  if (email && inv.email !== email.trim().toLowerCase()) return null;
  return inv;
}

/** True when there are no users yet: the first sign-up becomes admin without invitation. */
export async function isFirstUser(db: Database) {
  const [c] = await db.select({ n: count() }).from(user);
  return (c?.n ?? 0) === 0;
}

/**
 * Called after a user is created. Professionals only get access to the invited person; everyone
 * else gets an own person, a group (the inviter's or a new one) and default meal slots.
 */
export async function onUserCreated(db: Database, u: { id: string; name: string; email: string }, inv: typeof invitations.$inferSelect | null, opts: { firstUser?: boolean } = {}) {
  if (opts.firstUser) await db.update(user).set({ role: "admin" }).where(eq(user.id, u.id));
  if (inv?.accessRole === "professional" && inv.personId) {
    await db.insert(personAccess).values({ personId: inv.personId, userId: u.id, role: "professional", scopes: inv.scopes, canWrite: false }).onConflictDoNothing();
  } else {
    let groupId = inv?.groupId ?? null;
    if (!groupId) {
      const [g] = await db.insert(groups).values({ name: `Casa de ${u.name.split(" ")[0]}` }).returning({ id: groups.id });
      groupId = g!.id;
    }
    await db.insert(groupMembers).values({ groupId, userId: u.id, role: inv?.groupId ? inv.groupRole : "admin" }).onConflictDoNothing();
    const [p] = await db.insert(persons).values({ groupId, userId: u.id, displayName: u.name }).returning({ id: persons.id });
    await db.insert(personAccess).values({ personId: p!.id, userId: u.id, role: "owner", canWrite: true });
    await ensureMealSlots(db, p!.id);
    if (inv?.personId && inv.accessRole) {
      await db.insert(personAccess).values({ personId: inv.personId, userId: u.id, role: inv.accessRole, scopes: inv.scopes, canWrite: inv.accessRole === "manager" }).onConflictDoNothing();
    }
  }
  if (inv) await db.update(invitations).set({ acceptedAt: new Date(), acceptedBy: u.id }).where(eq(invitations.id, inv.id));
  await audit(db, { userId: u.id, action: "signup", resource: "user", resourceId: u.id, meta: { invitation: inv?.id ?? null, firstUser: !!opts.firstUser } });
}

/** A managed person (e.g. a child without account) inside the user's group. */
export async function createManagedPerson(db: Database, input: { userId: string; groupId: string; displayName: string; isChild?: boolean; sex?: "male" | "female" | null; birthDate?: string | null; heightCm?: number | null }) {
  const [p] = await db.insert(persons).values({ groupId: input.groupId, displayName: input.displayName, isChild: input.isChild ?? false, sex: input.sex ?? null, birthDate: input.birthDate ?? null, heightCm: input.heightCm ?? null }).returning();
  await db.insert(personAccess).values({ personId: p!.id, userId: input.userId, role: "manager", canWrite: true });
  await ensureMealSlots(db, p!.id);
  return p!;
}

export async function audit(db: Database, row: { userId?: string | null; personId?: string | null; action: string; resource: string; resourceId?: string | null; ip?: string | null; requestId?: string | null; meta?: Record<string, unknown> }) {
  await db.insert(auditLog).values({ ...row, meta: row.meta ?? {} });
}

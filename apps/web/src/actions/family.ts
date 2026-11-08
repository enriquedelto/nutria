"use server";
import { UserError } from "@/lib/errors";
import { refresh } from "next/cache";
import { z } from "zod";
import { ACCESS_SCOPES, and, eq, getPersonAccess, groupMembers, groups, invitations, isNull, ne, personAccess, persons, professionalNotes } from "@nutria/db";
import { audit, createInvitation, createManagedPerson } from "@nutria/core";
import { db } from "@/lib/db";
import { kitchenGuard } from "@/lib/kitchen";
import { getApiUser } from "@/lib/session";

const uuid = z.string().uuid();
const email = z.string().trim().toLowerCase().email().max(200);
const scopes = z.array(z.enum(ACCESS_SCOPES)).max(ACCESS_SCOPES.length);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const base = () => (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function groupAdmin() {
  const g = await kitchenGuard();
  if (g.groupRole !== "admin") throw new UserError("Solo quien administra el hogar puede hacer esto");
  return g;
}

/** Owner/manager of a person. */
async function managerOf(personId: string) {
  const u = await getApiUser();
  if (!u) throw new UserError("No autenticado");
  const a = await getPersonAccess(db(), u.id, uuid.parse(personId));
  if (!a || (a.role !== "owner" && a.role !== "manager")) throw new UserError("Solo quien gestiona a esta persona puede cambiar esto");
  return { user: u, access: a };
}

/* --------------------------------- hogar --------------------------------- */

export async function renameGroup(name: string) {
  const { groupId } = await groupAdmin();
  await db().update(groups).set({ name: z.string().trim().min(1).max(80).parse(name) }).where(eq(groups.id, groupId));
  refresh();
}

export async function inviteToGroup(input: { email: string; role: "admin" | "member"; days?: number }) {
  const { user, groupId } = await groupAdmin();
  const v = z.object({ email, role: z.enum(["admin", "member"]), days: z.number().int().min(1).max(60).default(14) }).parse(input);
  const r = await createInvitation(db(), { email: v.email, invitedBy: user.id, groupId, groupRole: v.role, days: v.days });
  await audit(db(), { userId: user.id, action: "invite", resource: "invitation", resourceId: r.invitation.id, meta: { kind: "group", role: v.role } });
  refresh();
  return { link: `${base()}/invitacion/${r.token}` };
}

export async function revokeInvitation(id: string) {
  const { user, groupId } = await kitchenGuard();
  const [inv] = await db().select().from(invitations).where(and(eq(invitations.id, uuid.parse(id)), isNull(invitations.acceptedAt))).limit(1);
  if (!inv) return;
  // Group admins revoke group invitations; the inviter revokes their own (e.g. professionals).
  const [m] = await db().select({ role: groupMembers.role }).from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id))).limit(1);
  if (inv.invitedBy !== user.id && !(inv.groupId === groupId && m?.role === "admin")) throw new UserError("Sin permiso");
  await db().delete(invitations).where(eq(invitations.id, inv.id));
  refresh();
}

export async function setMemberRole(userId: string, role: "admin" | "member") {
  const { user, groupId } = await groupAdmin();
  if (userId === user.id && role !== "admin") {
    const admins = await db().select({ id: groupMembers.id }).from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, "admin")));
    if (admins.length <= 1) throw new UserError("El hogar necesita al menos una persona administradora");
  }
  await db().update(groupMembers).set({ role: z.enum(["admin", "member"]).parse(role) }).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, z.string().min(1).parse(userId))));
  refresh();
}

/** Remove someone from the household: their own person stays theirs; shared access to others is revoked. */
export async function removeMember(userId: string) {
  const { user, groupId } = await groupAdmin();
  if (userId === user.id) throw new UserError("No puedes quitarte a ti");
  await db().delete(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  const groupPersons = await db().select({ id: persons.id }).from(persons).where(and(eq(persons.groupId, groupId), ne(persons.userId, userId)));
  for (const p of groupPersons) await db().delete(personAccess).where(and(eq(personAccess.personId, p.id), eq(personAccess.userId, userId), ne(personAccess.role, "owner")));
  await db().update(persons).set({ groupId: null }).where(and(eq(persons.groupId, groupId), eq(persons.userId, userId)));
  await audit(db(), { userId: user.id, action: "remove_member", resource: "group", resourceId: groupId, meta: { removed: userId } });
  refresh();
}

/* -------------------------------- personas -------------------------------- */

const NewPerson = z.object({
  displayName: z.string().trim().min(1).max(60),
  isChild: z.boolean().default(true),
  sex: z.enum(["male", "female"]).nullish(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  heightCm: z.number().min(40).max(230).nullish(),
  avatarColor: color.optional(),
});

export async function addManagedPerson(input: z.input<typeof NewPerson>) {
  const { user, groupId } = await kitchenGuard();
  const v = NewPerson.parse(input);
  const p = await createManagedPerson(db(), { userId: user.id, groupId, displayName: v.displayName, isChild: v.isChild, sex: v.sex ?? null, birthDate: v.birthDate ?? null, heightCm: v.heightCm ?? null });
  if (v.avatarColor) await db().update(persons).set({ avatarColor: v.avatarColor }).where(eq(persons.id, p.id));
  await audit(db(), { userId: user.id, personId: p.id, action: "create", resource: "person", resourceId: p.id });
  refresh();
  return p.id;
}

export async function updatePersonBasics(personId: string, patch: { displayName?: string; avatarColor?: string }) {
  await managerOf(personId);
  const v = z.object({ displayName: z.string().trim().min(1).max(60).optional(), avatarColor: color.optional() }).parse(patch);
  await db().update(persons).set(v).where(eq(persons.id, personId));
  refresh();
}

/** Delete a managed person (no account) with all their data. */
export async function deleteManagedPerson(personId: string, confirm: string) {
  const { user } = await managerOf(personId);
  const [p] = await db().select().from(persons).where(eq(persons.id, personId)).limit(1);
  if (!p) return;
  if (p.userId) throw new UserError("Esta persona tiene cuenta propia; solo ella puede borrarla");
  if (confirm.trim() !== p.displayName) throw new UserError("Escribe el nombre exacto para confirmar");
  await db().delete(persons).where(eq(persons.id, p.id));
  await audit(db(), { userId: user.id, action: "delete", resource: "person", resourceId: p.id });
  refresh();
}

/* --------------------------------- accesos -------------------------------- */

const Grant = z.object({ personId: uuid, userId: z.string().min(1), role: z.enum(["manager", "viewer"]), scopes, canWrite: z.boolean().default(false) });

/** Share a person with another member of the household (e.g. the other parent, or a partner viewing your diary). */
export async function grantAccess(input: z.input<typeof Grant>) {
  const v = Grant.parse(input);
  const { user } = await managerOf(v.personId);
  const [p] = await db().select({ groupId: persons.groupId, userId: persons.userId }).from(persons).where(eq(persons.id, v.personId)).limit(1);
  if (!p?.groupId) throw new UserError("La persona no pertenece a un hogar");
  if (p.userId === v.userId) throw new UserError("Ya es su propia persona");
  const [m] = await db().select({ id: groupMembers.id }).from(groupMembers).where(and(eq(groupMembers.groupId, p.groupId), eq(groupMembers.userId, v.userId))).limit(1);
  if (!m) throw new UserError("Solo se puede compartir con miembros del hogar");
  const row = { role: v.role, scopes: v.role === "manager" ? [] : v.scopes, canWrite: v.role === "manager" || v.canWrite };
  await db()
    .insert(personAccess)
    .values({ personId: v.personId, userId: v.userId, ...row })
    .onConflictDoUpdate({ target: [personAccess.personId, personAccess.userId], set: row });
  await audit(db(), { userId: user.id, personId: v.personId, action: "grant", resource: "person_access", meta: { to: v.userId, role: v.role, scopes: v.scopes } });
  refresh();
}

export async function revokeAccess(personId: string, userId: string) {
  const { user } = await managerOf(personId);
  const [row] = await db().select().from(personAccess).where(and(eq(personAccess.personId, personId), eq(personAccess.userId, userId))).limit(1);
  if (!row) return;
  if (row.role === "owner") throw new UserError("No se puede quitar el acceso a la propia persona");
  if (row.role === "manager") {
    const managers = await db().select({ id: personAccess.id }).from(personAccess).where(and(eq(personAccess.personId, personId), eq(personAccess.role, "manager")));
    const [owner] = await db().select({ id: personAccess.id }).from(personAccess).where(and(eq(personAccess.personId, personId), eq(personAccess.role, "owner"))).limit(1);
    if (!owner && managers.length <= 1) throw new UserError("Tiene que quedar al menos alguien que la gestione");
  }
  await db().delete(personAccess).where(eq(personAccess.id, row.id));
  await audit(db(), { userId: user.id, personId, action: "revoke", resource: "person_access", meta: { from: userId } });
  refresh();
}

/** Invite a nutritionist / doctor with read-only access to chosen categories. */
export async function inviteProfessional(input: { personId: string; email: string; scopes: string[]; days?: number }) {
  const v = z.object({ personId: uuid, email, scopes: scopes.min(1), days: z.number().int().min(1).max(365).default(90) }).parse(input);
  const { user } = await managerOf(v.personId);
  const r = await createInvitation(db(), { email: v.email, invitedBy: user.id, personId: v.personId, accessRole: "professional", scopes: v.scopes, days: 14 });
  await audit(db(), { userId: user.id, personId: v.personId, action: "invite", resource: "invitation", resourceId: r.invitation.id, meta: { kind: "professional", scopes: v.scopes } });
  refresh();
  return { link: `${base()}/invitacion/${r.token}` };
}

/** For an existing account: give professional access directly by email. */
export async function shareWithProfessionalAccount(personId: string, userId: string, s: string[], days: number) {
  const { user } = await managerOf(personId);
  const row = { role: "professional" as const, scopes: scopes.min(1).parse(s), canWrite: false, expiresAt: new Date(Date.now() + z.number().int().min(1).max(365).parse(days) * 86_400_000) };
  await db().insert(personAccess).values({ personId, userId, ...row }).onConflictDoUpdate({ target: [personAccess.personId, personAccess.userId], set: row });
  await audit(db(), { userId: user.id, personId, action: "grant", resource: "person_access", meta: { to: userId, role: "professional" } });
  refresh();
}

/* --------------------------- notas profesionales -------------------------- */

export async function addProfessionalNote(personId: string, bodyMd: string, date?: string | null) {
  const u = await getApiUser();
  if (!u) throw new UserError("No autenticado");
  const a = await getPersonAccess(db(), u.id, uuid.parse(personId));
  if (!a) throw new UserError("Sin acceso");
  await db().insert(professionalNotes).values({ personId, authorId: u.id, bodyMd: z.string().trim().min(1).max(8000).parse(bodyMd), date: date ?? null });
  refresh();
}

export async function deleteProfessionalNote(id: string) {
  const u = await getApiUser();
  if (!u) throw new UserError("No autenticado");
  const [n] = await db().select().from(professionalNotes).where(eq(professionalNotes.id, uuid.parse(id))).limit(1);
  if (!n) return;
  const a = await getPersonAccess(db(), u.id, n.personId);
  if (n.authorId !== u.id && a?.role !== "owner" && a?.role !== "manager") throw new UserError("Sin permiso");
  await db().delete(professionalNotes).where(eq(professionalNotes.id, n.id));
  refresh();
}

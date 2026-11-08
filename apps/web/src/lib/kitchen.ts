import "server-only";
import { UserError } from "@/lib/errors";
import { and, asc, eq, groupMembers, persons } from "@nutria/db";
import { db } from "./db";
import { getApiUser, getPersonContext } from "./session";

/** Kitchen data (recipes, plans, pantry, shopping) belongs to the household group. */
export async function groupOf(userId: string, preferred?: string | null) {
  const rows = await db().select({ groupId: groupMembers.groupId, role: groupMembers.role }).from(groupMembers).where(eq(groupMembers.userId, userId)).orderBy(asc(groupMembers.createdAt));
  const g = rows.find((r) => r.groupId === preferred) ?? rows[0];
  if (!g) throw new UserError("Sin permiso: no perteneces a ningún hogar");
  return g;
}

/** For server actions. */
export async function kitchenGuard() {
  const u = await getApiUser();
  if (!u) throw new UserError("No autenticado");
  const g = await groupOf(u.id);
  return { user: u, groupId: g.groupId, groupRole: g.role };
}

/** For pages: group of the active person when the user belongs to it, else the user's own. */
export async function kitchenContext() {
  const ctx = await getPersonContext();
  const g = await groupOf(ctx.user.id, ctx.person.groupId);
  const members = await db()
    .select({ id: persons.id, name: persons.displayName, color: persons.avatarColor, isChild: persons.isChild, timezone: persons.timezone })
    .from(persons)
    .where(and(eq(persons.groupId, g.groupId)))
    .orderBy(asc(persons.displayName));
  return { ...ctx, groupId: g.groupId, groupRole: g.role, members };
}

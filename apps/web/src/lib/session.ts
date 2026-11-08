import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPersonAccess, listAccessiblePersons, type AccessScope } from "@nutria/db";
import { auth } from "./auth";
import { db } from "./db";

export const PERSON_COOKIE = "nutria_person";

export type CurrentUser = { id: string; name: string; email: string; role: string; twoFactorEnabled: boolean };

/** Session user; redirects to /login when there is none. Private cache: browser only. */
export async function getCurrentUser(): Promise<CurrentUser> {
  "use cache: private";
  const s = await auth().api.getSession({ headers: await headers() });
  if (!s) redirect("/login");
  const u = s.user as typeof s.user & { role?: string; twoFactorEnabled?: boolean | null };
  return { id: u.id, name: u.name, email: u.email, role: u.role ?? "member", twoFactorEnabled: !!u.twoFactorEnabled };
}

/** Same as getCurrentUser but for route handlers: null instead of redirect. */
export async function getApiUser(req?: Request): Promise<CurrentUser | null> {
  const s = await auth().api.getSession({ headers: req?.headers ?? (await headers()) });
  if (!s) return null;
  const u = s.user as typeof s.user & { role?: string; twoFactorEnabled?: boolean | null };
  return { id: u.id, name: u.name, email: u.email, role: u.role ?? "member", twoFactorEnabled: !!u.twoFactorEnabled };
}

export async function requireAdmin() {
  const u = await getCurrentUser();
  if (u.role !== "admin") redirect("/hoy");
  return u;
}

export type PersonSummary = { id: string; name: string; color: string; role: string; isChild: boolean; isSelf: boolean; groupId: string | null; timezone: string };

export type PersonContext = {
  user: CurrentUser;
  persons: PersonSummary[];
  person: PersonSummary;
  scopes: Set<AccessScope>;
  canWrite: boolean;
};

/** Persons the user can see plus the active one (cookie, falling back to the own person). */
export async function getPersonContext(): Promise<PersonContext> {
  const user = await getCurrentUser();
  const rows = await listAccessiblePersons(db(), user.id);
  const persons: PersonSummary[] = rows.map((r) => ({
    id: r.person.id,
    name: r.person.displayName,
    color: r.person.avatarColor,
    role: r.role,
    isChild: r.person.isChild,
    isSelf: r.person.userId === user.id,
    groupId: r.person.groupId,
    timezone: r.person.timezone,
  }));
  if (!persons.length) redirect("/bienvenida");
  const wanted = (await cookies()).get(PERSON_COOKIE)?.value;
  const person = persons.find((p) => p.id === wanted) ?? persons.find((p) => p.isSelf) ?? persons[0]!;
  const access = await getPersonAccess(db(), user.id, person.id);
  if (!access) redirect("/hoy");
  return { user, persons, person, scopes: access.scopes, canWrite: access.canWrite };
}

/** Throws (redirect) if the active person lacks a scope; returns the context otherwise. */
export async function requireScope(scope: AccessScope, opts: { write?: boolean } = {}) {
  const ctx = await getPersonContext();
  if (!ctx.scopes.has(scope) || (opts.write && !ctx.canWrite)) redirect("/hoy?sinpermiso=" + scope);
  return ctx;
}

/** For server actions / route handlers: verify access to an explicit person id. */
export async function assertAccess(userId: string, personId: string, scope: AccessScope, write = false) {
  const access = await getPersonAccess(db(), userId, personId);
  if (!access || !access.scopes.has(scope) || (write && !access.canWrite)) throw new Error("Sin permiso para esta persona");
  return access;
}

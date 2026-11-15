import { Suspense } from "react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { and, asc, diaryEntries, eq, groupMembers, groups, inArray, invitations, isNull, listAccessiblePersons, persons, sql, user } from "@nutria/db";
import { targetsForDate } from "@nutria/core";
import { todayIn } from "@nutria/nutrition";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { dateShort, n0, plural } from "@/lib/format";
import { kitchenContext } from "@/lib/kitchen";
import { getCurrentUser } from "@/lib/session";
import { AddPerson, HouseholdPrefs, InviteMember, MemberActions, RenameGroup, RevokeInvite } from "./family-client";

export const metadata = { title: "Familia" };

const ROLE: Record<string, string> = { owner: "Tú", manager: "Gestionas", viewer: "Puedes ver", professional: "Profesional" };

/** Professionals (no household): just the persons shared with them. */
async function Followed() {
  const me = await getCurrentUser();
  const list = await listAccessiblePersons(db(), me.id);
  return (
    <Card>
      <CardHeader title="Personas que sigues" subtitle="Acceso de solo lectura que te han compartido" />
      <ul className="divide-y divide-line">
        {list.map((a) => (
          <li key={a.person.id}>
            <Link href={`/familia/${a.person.id}`} className="flex items-center gap-3 py-2.5 hover:text-herb">
              <span className="grid size-9 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: a.person.avatarColor }}>
                {a.person.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="flex-1 font-medium">{a.person.displayName}</span>
              <ChevronRight className="size-4 text-ink-3" />
            </Link>
          </li>
        ))}
        {!list.length ? <li className="py-2 text-sm text-ink-3">Nadie te ha compartido datos todavía.</li> : null}
      </ul>
    </Card>
  );
}

async function Content() {
  const k = await kitchenContext().catch((e: unknown) => {
    unstable_rethrow(e);
    return null;
  });
  if (!k) return <Followed />;
  const today = todayIn(k.person.timezone);
  const isAdmin = k.groupRole === "admin";
  const [[g], members, pending, accessible] = await Promise.all([
    db().select().from(groups).where(eq(groups.id, k.groupId)),
    db().select({ userId: groupMembers.userId, role: groupMembers.role, name: user.name, email: user.email }).from(groupMembers).innerJoin(user, eq(user.id, groupMembers.userId)).where(eq(groupMembers.groupId, k.groupId)).orderBy(asc(user.name)),
    db().select().from(invitations).where(and(isNull(invitations.acceptedAt), sql`${invitations.expiresAt} > now()`, sql`(${invitations.groupId} = ${k.groupId} or ${invitations.invitedBy} = ${k.user.id})`)),
    listAccessiblePersons(db(), k.user.id),
  ]);
  const ids = accessible.map((a) => a.person.id);
  const kcalRows = ids.length
    ? await db().select({ personId: diaryEntries.personId, kcal: sql<number>`coalesce(sum(${diaryEntries.kcal}),0)`.mapWith(Number) }).from(diaryEntries).where(and(inArray(diaryEntries.personId, ids), eq(diaryEntries.date, today))).groupBy(diaryEntries.personId)
    : [];
  const kcal = new Map(kcalRows.map((r) => [r.personId, r.kcal]));
  const targets = new Map(await Promise.all(accessible.filter((a) => a.role === "owner" || a.role === "manager" || a.scopes.includes("diary")).map(async (a) => [a.person.id, (await targetsForDate(db(), a.person.id, today))?.kcal ?? null] as const)));
  const inGroup = accessible.filter((a) => a.person.groupId === k.groupId);
  const outside = accessible.filter((a) => a.person.groupId !== k.groupId);
  const groupPersons = await db().select({ id: persons.id, name: persons.displayName, color: persons.avatarColor, isChild: persons.isChild }).from(persons).where(eq(persons.groupId, k.groupId)).orderBy(asc(persons.displayName));
  const hidden = groupPersons.filter((p) => !ids.includes(p.id));

  const PersonRow = ({ a }: { a: (typeof accessible)[number] }) => {
    const t = targets.get(a.person.id);
    const eaten = kcal.get(a.person.id) ?? 0;
    return (
      <li>
        <Link href={`/familia/${a.person.id}`} className="flex items-center gap-3 py-2.5 hover:text-herb">
          <span className="grid size-9 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: a.person.avatarColor }}>
            {a.person.displayName.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">
              {a.person.displayName} {a.person.isChild ? <Badge tone="accent">niño/a</Badge> : null}
            </span>
            <span className="text-xs text-ink-3">
              {ROLE[a.role] ?? a.role}
              {targets.has(a.person.id) ? <span className="num"> · hoy {n0(eaten)}{t ? ` / ${n0(t)}` : ""} kcal</span> : null}
            </span>
          </span>
          {t ? (
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-paper-2">
              <span className="block h-full bg-herb" style={{ width: `${Math.min(100, (eaten / t) * 100)}%` }} />
            </span>
          ) : null}
          <ChevronRight className="size-4 text-ink-3" />
        </Link>
      </li>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Card>
          <CardHeader title={g?.name ?? "Hogar"} subtitle={`${members.length} ${members.length === 1 ? "cuenta" : "cuentas"} · ${plural(groupPersons.length, "persona", "personas")}`} action={isAdmin ? <RenameGroup name={g?.name ?? ""} /> : null} />
          <ul className="divide-y divide-line">
            {inGroup.map((a) => (
              <PersonRow key={a.person.id} a={a} />
            ))}
          </ul>
          {hidden.length ? <p className="mt-2 text-xs text-ink-3">También en el hogar (no compartido contigo): {hidden.map((h) => h.name).join(", ")}</p> : null}
          <div className="mt-3">
            <AddPerson />
          </div>
        </Card>
        {outside.length ? (
          <Card>
            <CardHeader title="Personas que sigues" subtitle="Compartidas contigo desde otros hogares" />
            <ul className="divide-y divide-line">
              {outside.map((a) => (
                <PersonRow key={a.person.id} a={a} />
              ))}
            </ul>
          </Card>
        ) : null}
        <Card>
          <CardHeader title="Gustos del hogar" subtitle="Lo usa el planificador de menús; también se actualiza con el repaso semanal" />
          <HouseholdPrefs groupId={k.groupId} value={g?.preferencesMd ?? ""} />
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Cuentas del hogar" subtitle="Cada cuenta tiene su persona; los datos de salud solo se ven si se comparten" />
          <ul className="divide-y divide-line">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-2 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {m.name} {m.userId === k.user.id ? <span className="text-xs text-ink-3">(tú)</span> : null}
                  </span>
                  <span className="block truncate text-xs text-ink-3">{m.email}</span>
                </span>
                <Badge tone={m.role === "admin" ? "herb" : "neutral"}>{m.role === "admin" ? "admin" : "miembro"}</Badge>
                {isAdmin && m.userId !== k.user.id ? <MemberActions userId={m.userId} name={m.name} role={m.role} /> : null}
              </li>
            ))}
          </ul>
        </Card>
        {isAdmin ? (
          <Card>
            <CardHeader title="Invitar al hogar" subtitle="El registro es cerrado: solo entra quien tenga enlace" />
            <InviteMember />
          </Card>
        ) : null}
        {pending.length ? (
          <Card>
            <CardHeader title="Invitaciones pendientes" />
            <ul className="divide-y divide-line text-sm">
              {pending.map((i) => (
                <li key={i.id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{i.email}</span>
                    <span className="text-xs text-ink-3">
                      {i.accessRole === "professional" ? "profesional" : i.groupRole === "admin" ? "admin del hogar" : "miembro"} · caduca el {dateShort(i.expiresAt.toISOString().slice(0, 10))}
                    </span>
                  </span>
                  <RevokeInvite id={i.id} />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

export default function FamiliaPage() {
  return (
    <>
      <PageHeader title="Familia" subtitle="Personas, cuentas y qué ve cada uno" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}


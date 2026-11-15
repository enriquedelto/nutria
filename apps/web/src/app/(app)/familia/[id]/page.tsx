import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { and, asc, desc, eq, getPersonAccess, groupMembers, personAccess, persons, professionalNotes, user, weightLogs } from "@nutria/db";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { dateShort, kg } from "@/lib/format";
import { getCurrentUser } from "@/lib/session";
import { AccessRow, DeletePerson, DeleteNote, EditBasics, GrantAccess, InviteProfessional, NoteForm, SwitchTo } from "./person-client";

export const metadata = { title: "Persona" };

const SCOPE_NAMES: Record<string, string> = { diary: "Diario", body: "Peso y ejercicio", health: "Salud", cycle: "Ciclo", labs: "Analíticas", medication: "Medicación", photos: "Fotos", ai: "IA" };
const ROLE: Record<string, string> = { owner: "Propietaria", manager: "Gestiona", viewer: "Ve", professional: "Profesional" };

async function Content({ params }: { params: PageProps<"/familia/[id]">["params"] }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await getCurrentUser();
  const access = await getPersonAccess(db(), me.id, id);
  if (!access) notFound();
  const [[p], rows, notes] = await Promise.all([
    db().select().from(persons).where(eq(persons.id, id)),
    db().select({ userId: personAccess.userId, role: personAccess.role, scopes: personAccess.scopes, canWrite: personAccess.canWrite, expiresAt: personAccess.expiresAt, name: user.name, email: user.email }).from(personAccess).innerJoin(user, eq(user.id, personAccess.userId)).where(eq(personAccess.personId, id)).orderBy(asc(personAccess.role)),
    db().select({ note: professionalNotes, author: user.name }).from(professionalNotes).innerJoin(user, eq(user.id, professionalNotes.authorId)).where(eq(professionalNotes.personId, id)).orderBy(desc(professionalNotes.createdAt)).limit(50),
  ]);
  if (!p) notFound();
  const manage = access.role === "owner" || access.role === "manager";
  const [lastWeight] = access.scopes.has("body") ? await db().select().from(weightLogs).where(eq(weightLogs.personId, id)).orderBy(desc(weightLogs.measuredAt)).limit(1) : [];
  const members = manage && p.groupId ? await db().select({ userId: groupMembers.userId, name: user.name }).from(groupMembers).innerJoin(user, eq(user.id, groupMembers.userId)).where(and(eq(groupMembers.groupId, p.groupId))) : [];
  const shareable = members.filter((m) => m.userId !== p.userId && !rows.some((r) => r.userId === m.userId));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Card>
          <div className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-full text-lg font-semibold text-white" style={{ background: p.avatarColor }}>
              {p.displayName.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg font-semibold">
                {p.displayName} {p.isChild ? <Badge tone="accent">niño/a</Badge> : null} {!p.userId ? <Badge>sin cuenta</Badge> : null}
              </p>
              <p className="text-sm text-ink-3">
                {ROLE[access.role]} · {p.birthDate ? `nacimiento ${dateShort(p.birthDate)}` : "sin fecha de nacimiento"}
                {lastWeight ? ` · ${kg(lastWeight.kg)}` : ""}
              </p>
            </div>
            {manage ? <EditBasics personId={p.id} name={p.displayName} color={p.avatarColor} /> : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <SwitchTo personId={p.id} />
            {manage ? (
              <Button asChild size="sm" variant="outline">
                <Link href="/ajustes">Perfil y objetivos</Link>
              </Button>
            ) : null}
            {manage && !p.userId ? <DeletePerson personId={p.id} name={p.displayName} /> : null}
          </div>
          {manage ? <p className="mt-2 text-xs text-ink-3">Para editar su perfil, objetivos o diario, cambia a esta persona y entra en Ajustes.</p> : null}
        </Card>

        <Card>
          <CardHeader title="Quién tiene acceso" subtitle="El ciclo, las analíticas, la medicación y las fotos son privados salvo que los compartas" />
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <AccessRow
                key={r.userId}
                personId={p.id}
                row={{ userId: r.userId, name: r.name, email: r.email, role: r.role, canWrite: r.canWrite, scopes: r.role === "owner" || r.role === "manager" ? ["todo"] : r.scopes.map((s) => SCOPE_NAMES[s] ?? s), expires: r.expiresAt ? dateShort(r.expiresAt.toISOString().slice(0, 10)) : null }}
                canRevoke={manage && r.role !== "owner" && r.userId !== me.id}
              />
            ))}
          </ul>
          {manage ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {shareable.length ? <GrantAccess personId={p.id} members={shareable} scopeNames={SCOPE_NAMES} /> : null}
              <InviteProfessional personId={p.id} scopeNames={SCOPE_NAMES} />
            </div>
          ) : null}
        </Card>
      </div>

      <Card>
        <CardHeader title="Notas" subtitle={access.role === "professional" ? "Tus pautas y observaciones para esta persona" : "Notas de profesionales y de quien la gestiona"} />
        <NoteForm personId={p.id} />
        <ul className="mt-4 space-y-3">
          {notes.map(({ note, author }) => (
            <li key={note.id} className="rounded-lg border border-line p-3">
              <div className="mb-1 flex items-center gap-2 text-xs text-ink-3">
                <span className="flex-1">
                  {author} · {dateShort(note.date ?? note.createdAt.toISOString().slice(0, 10))}
                </span>
                {note.authorId === me.id || manage ? <DeleteNote id={note.id} /> : null}
              </div>
              <p className="text-sm whitespace-pre-line">{note.bodyMd}</p>
            </li>
          ))}
          {!notes.length ? <li className="text-sm text-ink-3">Sin notas todavía.</li> : null}
        </ul>
      </Card>
    </div>
  );
}

export default function PersonaPage(props: PageProps<"/familia/[id]">) {
  return (
    <>
      <div className="mb-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/familia">
            <ChevronLeft /> Familia
          </Link>
        </Button>
      </div>
      <PageHeader title="Persona" subtitle="Datos básicos, accesos y notas" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content params={props.params} />
      </Suspense>
    </>
  );
}

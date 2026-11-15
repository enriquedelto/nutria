import { Suspense } from "react";
import { asc, conditions, eq, personConditions } from "@nutria/db";
import { ConditionToggle } from "@/components/health/forms";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { requireScope } from "@/lib/session";

export const metadata = { title: "Condiciones" };

async function Content() {
  const ctx = await requireScope("health");
  const pid = ctx.person.id;
  const [all, mine] = await Promise.all([
    db().select().from(conditions).orderBy(asc(conditions.nameEs)),
    db().select().from(personConditions).where(eq(personConditions.personId, pid)),
  ]);
  const active = new Map(mine.filter((m) => m.active).map((m) => [m.conditionCode, m]));
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-ink-2">
        Al activar una condición, Nutria ajusta tus objetivos (por ejemplo, el sodio en hipertensión o los carbohidratos por comida en diabetes), te avisa al registrar alimentos poco adecuados y se lo cuenta al coach. Es información orientativa: sigue siempre las pautas de tu equipo sanitario.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {all.map((c) => {
          const on = active.get(c.code);
          return (
            <Card key={c.code} className={on ? "border-herb" : ""}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {c.nameEs} {on?.since ? <Badge tone="herb">desde {on.since.split("-").reverse().join("/")}</Badge> : null}
                  </p>
                  {c.description ? <p className="mt-1 text-sm text-ink-2">{c.description}</p> : null}
                </div>
                {ctx.canWrite ? <ConditionToggle personId={pid} code={c.code} active={!!on} label={c.nameEs} /> : on ? <Badge tone="herb">activa</Badge> : null}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default function CondicionesPage() {
  return (
    <>
      <PageHeader title="Condiciones y dietas" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}

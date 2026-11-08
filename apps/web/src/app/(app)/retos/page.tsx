import { Suspense } from "react";
import { Beef, CalendarCheck, Carrot, ChefHat, Crown, Droplet, Flame, Leaf, Medal, Package, ScanBarcode, Sparkles, Timer, Trophy, Wheat, type LucideIcon } from "lucide-react";
import { achievements, and, asc, challengeParticipants, challenges, desc, eq, gte, inArray, lt, personAchievements, streaks } from "@nutria/db";
import { todayIn } from "@nutria/nutrition";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { dateShort, n0 } from "@/lib/format";
import { kitchenContext } from "@/lib/kitchen";
import { cn } from "@/lib/utils";
import { ChallengeActions, NewChallenge, RefreshProgress } from "./challenges-client";

export const metadata = { title: "Retos" };

const ICONS: Record<string, LucideIcon> = { beef: Beef, "calendar-check": CalendarCheck, carrot: Carrot, "chef-hat": ChefHat, crown: Crown, droplet: Droplet, flame: Flame, leaf: Leaf, medal: Medal, package: Package, "scan-barcode": ScanBarcode, sparkles: Sparkles, timer: Timer, trophy: Trophy, wheat: Wheat };
const STREAKS: Record<string, { label: string; icon: LucideIcon; hint: string }> = {
  logging: { label: "Registro", icon: CalendarCheck, hint: "días con 2+ comidas registradas" },
  water: { label: "Agua", icon: Droplet, hint: "días cumpliendo el objetivo de agua" },
  protein: { label: "Proteína", icon: Beef, hint: "días llegando a la proteína" },
  veggies: { label: "Fruta y verdura", icon: Carrot, hint: "días con 400 g o más" },
};
const METRIC_LABEL: Record<string, string> = { logging_days: "días registrando", water_days: "días con el agua", protein_days: "días con la proteína", veggie_days: "días con 5 raciones de fruta y verdura", steps: "miles de pasos" };

async function Content() {
  const k = await kitchenContext();
  const today = todayIn(k.person.timezone);
  const [myStreaks, all, mine, active, past] = await Promise.all([
    db().select().from(streaks).where(eq(streaks.personId, k.person.id)),
    db().select().from(achievements).orderBy(asc(achievements.nameEs)),
    db().select().from(personAchievements).where(eq(personAchievements.personId, k.person.id)),
    db().select().from(challenges).where(and(eq(challenges.groupId, k.groupId), gte(challenges.endDate, today))).orderBy(asc(challenges.endDate)),
    db().select().from(challenges).where(and(eq(challenges.groupId, k.groupId), lt(challenges.endDate, today))).orderBy(desc(challenges.endDate)).limit(5),
  ]);
  const ids = [...active, ...past].map((c) => c.id);
  const parts = ids.length ? await db().select().from(challengeParticipants).where(inArray(challengeParticipants.challengeId, ids)).orderBy(desc(challengeParticipants.score)) : [];
  const got = new Map(mine.map((m) => [m.achievementCode, m.unlockedAt]));
  const memberName = new Map(k.members.map((m) => [m.id, m.name]));
  const memberColor = new Map(k.members.map((m) => [m.id, m.color]));
  const streakOf = (kind: string) => myStreaks.find((s) => s.kind === kind);
  const alive = (s?: { lastDate: string | null }) => !!s?.lastDate && (s.lastDate === today || Date.parse(today) - Date.parse(s.lastDate) <= 86_400_000);

  const Board = ({ c }: { c: (typeof active)[number] }) => {
    const ps = parts.filter((p) => p.challengeId === c.id);
    const metric = String(c.rule.metric ?? "logging_days");
    const target = typeof c.rule.target === "number" ? c.rule.target : null;
    const max = Math.max(target ?? 0, ...ps.map((p) => p.score), 1);
    const joined = ps.some((p) => p.personId === k.person.id);
    return (
      <Card>
        <CardHeader
          title={c.title}
          subtitle={`${dateShort(c.startDate)} – ${dateShort(c.endDate)} · ${METRIC_LABEL[metric] ?? metric}${target ? ` · meta ${target}` : ""}`}
          action={<ChallengeActions challengeId={c.id} personId={k.person.id} joined={joined} ended={c.endDate < today} />}
        />
        {c.description ? <p className="mb-3 text-sm text-ink-2">{c.description}</p> : null}
        <ol className="space-y-2">
          {ps.map((p, i) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <span className={cn("num w-5 text-right font-semibold", i === 0 && p.score > 0 ? "text-persimmon" : "text-ink-3")}>{i + 1}</span>
              <span className="w-24 truncate">{memberName.get(p.personId) ?? "—"}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-paper-2">
                <span className="block h-full rounded-full" style={{ width: `${(p.score / max) * 100}%`, background: memberColor.get(p.personId) ?? "var(--color-herb)" }} />
              </span>
              <span className="num w-10 text-right font-medium">{n0(p.score)}</span>
              {i === 0 && p.score > 0 && c.endDate < today ? <Crown className="size-4 text-persimmon" aria-label="Ganador" /> : null}
            </li>
          ))}
          {!ps.length ? <li className="text-sm text-ink-3">Nadie apuntado todavía.</li> : null}
        </ol>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Rachas de {k.person.name}</h2>
          <RefreshProgress personId={k.person.id} timezone={k.person.timezone} />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Object.entries(STREAKS).map(([kind, s]) => {
            const st = streakOf(kind);
            const on = alive(st);
            const Icon = s.icon;
            return (
              <Card key={kind} className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-sm font-medium text-ink-2">
                  <Icon className="size-4 text-herb" /> {s.label}
                </span>
                <span className="flex items-baseline gap-1">
                  <span className={cn("num font-display text-3xl font-semibold", on ? "text-ink" : "text-ink-3")}>{on ? (st?.current ?? 0) : 0}</span>
                  <span className="text-xs text-ink-3">días</span>
                  {on && (st?.current ?? 0) >= 3 ? <Flame className="size-4 text-persimmon" /> : null}
                </span>
                <span className="text-xs text-ink-3">
                  Mejor: {st?.best ?? 0} · {s.hint}
                </span>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Retos del hogar</h2>
          <NewChallenge today={today} members={k.members.map((m) => ({ id: m.id, name: m.name }))} metrics={METRIC_LABEL} />
        </div>
        {active.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {active.map((c) => (
              <Board key={c.id} c={c} />
            ))}
          </div>
        ) : (
          <Card className="text-sm text-ink-2">No hay retos en marcha. Crea uno: «una semana bebiendo agua», «mes de verduras»…</Card>
        )}
        {past.length ? (
          <details>
            <summary className="cursor-pointer text-sm text-ink-2">Retos terminados</summary>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              {past.map((c) => (
                <Board key={c.id} c={c} />
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <section>
        <h2 className="mb-2 font-display text-lg font-semibold">
          Logros <span className="num text-sm font-normal text-ink-3">{got.size} de {all.length}</span>
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {all.map((a) => {
            const at = got.get(a.code);
            const Icon = ICONS[a.icon] ?? Trophy;
            return (
              <li key={a.code} className={cn("rounded-2xl border border-line bg-card p-3 text-center", !at && "opacity-50 grayscale")}>
                <Icon className={cn("mx-auto size-8", at ? "text-persimmon" : "text-ink-3")} />
                <p className="mt-1 text-sm font-semibold">{a.nameEs}</p>
                <p className="text-xs text-ink-3">{a.descriptionEs}</p>
                {at ? <Badge tone="ok" className="mt-1">{dateShort(at.toISOString().slice(0, 10))}</Badge> : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export default function RetosPage() {
  return (
    <>
      <PageHeader title="Retos" subtitle="Rachas, logros y retos con tu gente" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}

import { Suspense } from "react";
import { Lock, Pencil } from "lucide-react";
import Link from "next/link";
import { asc, desc, eq, persons, targetSets } from "@nutria/db";
import { averageSessionMin, getSportProfile, latestWeight, personToday, sportDayVariants } from "@nutria/core";
import { proteinPerMeal, ratePctOfWeight, sportFatFloor, sportProteinPerKg, surplusForRate, waterTargetMl } from "@nutria/nutrition";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Empty, Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { n0, nutrient, nutrientName } from "@/lib/format";
import { requireScope } from "@/lib/session";
import { NewSpecialSet, Recalc, TargetEditor, TargetRowActions, type TargetSet } from "./targets-client";

export const metadata = { title: "Objetivos" };

const MODE: Record<string, string> = { fixed: "fijo", dynamic: "calculado", adaptive: "adaptativo" };
const SOURCE: Record<string, string> = { formula: "fórmula", adaptive: "TDEE real", manual: "manual", condition: "condición" };
const DAYS = ["L", "M", "X", "J", "V", "S", "D"];

async function Content() {
  const ctx = await requireScope("diary");
  const pid = ctx.person.id;
  const sets = await db().select().from(targetSets).where(eq(targetSets.personId, pid)).orderBy(desc(targetSets.isDefault), asc(targetSets.createdAt));
  const base = sets.find((s) => s.isDefault) ?? sets[0];
  if (!base)
    return (
      <Card>
        <Empty title="Aún no hay objetivos">Completa tu perfil (sexo, edad, altura y peso) y pulsa recalcular.</Empty>
        {ctx.canWrite ? <Recalc personId={pid} /> : null}
      </Card>
    );
  const toSet = (s: typeof base): TargetSet => ({ id: s.id, name: s.name, kcal: Math.round(s.kcal), protein: Math.round(s.protein), carbs: Math.round(s.carbs), fat: Math.round(s.fat), fiber: s.fiber ? Math.round(s.fiber) : null, mode: s.mode as TargetSet["mode"], pinned: s.pinned, rule: s.rule, isDefault: s.isDefault });
  const micros = Object.entries(base.micros);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Energía y macros"
            action={
              ctx.canWrite ? (
                <div className="flex gap-2">
                  <Recalc personId={pid} />
                  <NewSpecialSet personId={pid} base={toSet(base)} />
                </div>
              ) : null
            }
          />
          <ul className="divide-y divide-line">
            {sets.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {s.name} <Badge>{MODE[s.mode] ?? s.mode}</Badge> <Badge tone="neutral">{SOURCE[s.source] ?? s.source}</Badge>
                  </p>
                  <p className="num text-sm text-ink-2">
                    {n0(s.kcal)} kcal · P {n0(s.protein)} g{s.pinned.includes("protein") ? <Lock className="ml-0.5 inline size-3" /> : null} · H {n0(s.carbs)} g{s.pinned.includes("carbs") ? <Lock className="ml-0.5 inline size-3" /> : null} · G {n0(s.fat)} g
                    {s.pinned.includes("fat") ? <Lock className="ml-0.5 inline size-3" /> : null}
                    {s.fiber ? ` · fibra ${n0(s.fiber)} g` : ""}
                  </p>
                  {!s.isDefault ? (
                    <p className="text-xs text-ink-3">
                      {s.rule.trainingDay ? "Días de entreno" : ""}
                      {s.rule.trainingDay && s.rule.days?.length ? " · " : ""}
                      {s.rule.days?.length ? s.rule.days.map((d) => DAYS[d - 1]).join(" ") : ""}
                    </p>
                  ) : null}
                </div>
                {ctx.canWrite ? (
                  <>
                    <TargetEditor
                      personId={pid}
                      initial={toSet(s)}
                      trigger={
                        <Button size="icon-sm" variant="ghost" aria-label="Editar">
                          <Pencil />
                        </Button>
                      }
                    />
                    <TargetRowActions personId={pid} id={s.id} canDelete={!s.isDefault} />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-3">«Calculado» se actualiza al cambiar tu perfil o peso. «Adaptativo» usa tu gasto real cuando aceptas la propuesta semanal en Progreso. Los días especiales tienen prioridad sobre el conjunto diario.</p>
        </Card>
        <SportCard personId={pid} base={base} />
      </div>
      <Card>
        <CardHeader title="Micronutrientes" subtitle="Ingestas de referencia de la EFSA para tu perfil" />
        {micros.length ? (
          <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto text-sm">
            {micros.map(([code, r]) => (
              <li key={code} className="flex justify-between gap-2 py-1.5">
                <span>{nutrientName(code)}</span>
                <span className="num text-right text-ink-2">
                  {r.min != null ? nutrient(code, r.min) : ""}
                  {r.max != null ? <span className="text-xs text-ink-3"> {r.min != null ? "· " : ""}máx {nutrient(code, r.max)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Sin datos.</p>
        )}
      </Card>
    </div>
  );
}

const l1 = (x: number) => x.toLocaleString("es-ES", { maximumFractionDigits: 1 });
const l2 = (x: number) => x.toLocaleString("es-ES", { maximumFractionDigits: 2 });

/** Training vs. rest targets and where each number comes from (only with the sport profile on). */
async function SportCard({ personId, base }: { personId: string; base: typeof targetSets.$inferSelect }) {
  const [sport, w, [p], today] = await Promise.all([getSportProfile(db(), personId), latestWeight(db(), personId), db().select({ rate: persons.weeklyRateKg, goal: persons.goalType }).from(persons).where(eq(persons.id, personId)).limit(1), personToday(db(), personId)]);
  if (!sport.active || !w) return null;
  const sp = sport.profile;
  const kg = w.kg;
  const minutes = await averageSessionMin(db(), personId, today);
  const v = sportDayVariants(base, sp);
  const cols = v
    ? [
        { title: `Día de entreno (${sp.trainingDays!.length}/sem)`, t: v.training, water: waterTargetMl({ weightKg: kg, trainingMin: minutes }) },
        { title: `Día de descanso (${7 - sp.trainingDays!.length}/sem)`, t: v.rest, water: waterTargetMl({ weightKg: kg }) },
      ]
    : [{ title: "Cada día", t: base, water: waterTargetMl({ weightKg: kg, trainingMin: sp.trainingDays?.length ? (minutes * sp.trainingDays.length) / 7 : 0 }) }];
  const rate = p?.goal === "gain" ? Math.abs(p.rate ?? 0) : 0;
  return (
    <Card>
      <CardHeader title="Deporte" subtitle={`${{ hypertrophy: "Hipertrofia", strength: "Fuerza", general: "Forma física" }[sp.focus]} · nivel ${sp.level === "competitive" ? "competitivo" : "recreativo"}`} action={<Link href="/ajustes" className="text-sm text-herb">Cambiar</Link>} />
      <div className={`grid gap-3 ${cols.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {cols.map((c) => (
          <div key={c.title} className="rounded-xl bg-paper-2 p-3">
            <p className="text-sm font-medium text-ink-2">{c.title}</p>
            <p className="num font-display text-2xl font-semibold">{n0(c.t.kcal)} kcal</p>
            <p className="num text-sm text-ink-2">
              P {n0(c.t.protein)} g · H {n0(c.t.carbs)} g · G {n0(c.t.fat)} g
            </p>
            <p className="num text-sm text-ink-2">
              Agua {sport.profile.waterAuto ? `${l1(c.water / 1000)} L` : "objetivo fijo"}
            </p>
          </div>
        ))}
      </div>
      {v ? <p className="mt-2 text-xs text-ink-3">Media de la semana: {n0(base.kcal)} kcal (la misma que el objetivo diario). Solo cambian los hidratos.</p> : null}
      <ul className="mt-3 space-y-1 text-sm text-ink-2">
        <li>
          <span className="font-medium text-ink">Proteína:</span> {l1(sportProteinPerKg(sp))} g/kg × {l1(kg)} kg = {n0(sportProteinPerKg(sp) * kg)} g, unos {proteinPerMeal(kg)} g en cada una de 4 comidas.
        </li>
        <li>
          <span className="font-medium text-ink">Grasa:</span> mínimo {sportFatFloor(base.kcal, kg)} g (0,8 g/kg y al menos el 25 % de las kcal).
        </li>
        <li>
          <span className="font-medium text-ink">Hidratos:</span> el resto, {l1(base.carbs / kg)} g/kg{base.carbs / kg < 4 && sp.focus !== "general" ? " — por debajo de los 4 g/kg recomendados para entrenar" : " (recomendado 4–7 g/kg)"}.
        </li>
        {rate > 0 ? (
          <li>
            <span className="font-medium text-ink">Superávit:</span> +{surplusForRate(rate)} kcal/día para ganar {l2(rate)} kg/semana ({l2(ratePctOfWeight(rate, kg))} % de tu peso; lo recomendado es 0,25–0,5 %).
          </li>
        ) : null}
        {sp.waterAuto ? (
          <li>
            <span className="font-medium text-ink">Agua:</span> 35 ml/kg + unos 0,6 L por hora de entreno (tu sesión media: {minutes} min).
          </li>
        ) : null}
      </ul>
    </Card>
  );
}

export default function ObjetivosPage() {
  return (
    <>
      <PageHeader title="Objetivos" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}

import Link from "next/link";
import type { TrainingTimeContext } from "@nutria/core";
import { minutesToClock as hm, type TrainingTimeOption } from "@nutria/nutrition";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const tone = (score: number) => (score >= 0.85 ? "bg-herb" : score >= 0.65 ? "bg-herb/55" : score >= 0.45 ? "bg-warn" : "bg-persimmon/70");

function caffeineText(o: TrainingTimeOption) {
  return o.caffeine.fits
    ? `${o.caffeine.suggestedMg} mg de cafeína (3 mg/kg) a las ${hm(o.caffeine.at)} sin afectar al sueño`
    : o.caffeine.maxMg >= 40
      ? `como mucho ~${o.caffeine.maxMg} mg de cafeína a las ${hm(o.caffeine.at)} (la dosis de rendimiento son ${o.caffeine.suggestedMg} mg)`
      : "sin cafeína: a esa hora cualquier dosis seguiría en el cuerpo al acostarte";
}

function mealText(o: TrainingTimeOption, carbsG: number) {
  if (o.meal.ok) return `comida previa entre las ${hm(o.meal.from)} y las ${hm(o.meal.to)}, con ≈ ${carbsG} g de hidratos`;
  if (o.meal.snackOnly) return `poco margen para comer antes: algo ligero con hidratos (fruta, pan, yogur) en cuanto te levantes`;
  return "no da tiempo a comer antes después de levantarte";
}

/** Best time to train within the gym's opening hours: caffeine without hurting sleep and a pre-workout meal that fits. */
export function TrainingTimeCard({ c }: { c: TrainingTimeContext }) {
  const carbsG = c.weightKg ? Math.round(c.weightKg) : 0;
  const header = (
    <CardHeader
      title="Mejor hora para entrenar"
      subtitle={c.gymHours.length ? `Gimnasio ${c.gymHours.map((w) => `${w.from}–${w.to}`).join(" · ")} · sesiones de ~${c.durationMin} min` : undefined}
    />
  );
  if (!c.gymHours.length || !c.plan?.best) {
    return (
      <Card id="hora-entreno">
        {header}
        <p className="text-sm text-ink-2">
          {!c.gymHours.length ? (
            <>
              Añade el horario de tu gimnasio en{" "}
              <Link href="/ajustes" className="text-herb underline">
                Ajustes › Deporte
              </Link>{" "}
              y te diré a qué hora te conviene entrenar para tomar cafeína sin afectar al sueño y llegar con la comida previa hecha.
            </>
          ) : (
            "Registra tu peso para calcular la dosis de cafeína y los hidratos de antes."
          )}
        </p>
      </Card>
    );
  }
  const best = c.plan.best;
  const usual = c.usualStart != null ? c.plan.options.reduce<TrainingTimeOption | null>((b, o) => (!b || Math.abs(o.start - c.usualStart!) < Math.abs(b.start - c.usualStart!) ? o : b), null) : null;
  const usualFar = usual && c.usualStart != null && Math.abs(usual.start - c.usualStart) > 30;
  return (
    <Card id="hora-entreno">
      {header}
      <div className="space-y-1 text-sm">
        <p>
          Lo mejor: empezar hacia las <strong className="num">{hm(best.start)}</strong> <span className="text-ink-3">(hasta las {hm(best.end)})</span>.
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-ink-2">
          <li>{caffeineText(best)}</li>
          <li>{mealText(best, carbsG)}</li>
          <li>terminas {Math.round(best.bedGapMin / 60)} h antes de acostarte</li>
        </ul>
      </div>

      <div className="mt-4 space-y-3">
        {c.gymHours.map((w, i) => {
          const opts = c.plan!.options.filter((o) => o.start >= clock(w.from) && o.start < clock(w.to));
          const pick = c.plan!.perWindow[i];
          return (
            <div key={i} className="min-w-0">
              <div className="mb-1 flex justify-between text-xs text-ink-3">
                <span className="num">{w.from}</span>
                <span>{i === 0 && c.gymHours.length > 1 ? "Primer tramo" : i === 1 ? "Segundo tramo" : "Tramo"}</span>
                <span className="num">{w.to}</span>
              </div>
              <div className="flex h-5 gap-px overflow-hidden rounded-md" role="img" aria-label={`Horas de inicio de ${w.from} a ${w.to}, de mejor a peor`}>
                {opts.map((o) => (
                  <span key={o.start} title={`${hm(o.start)} · ${Math.round(o.score * 100)} / 100`} className={cn("flex-1", tone(o.score), o.start === best.start ? "ring-2 ring-ink ring-inset" : undefined)} />
                ))}
              </div>
              {pick ? (
                <p className="mt-1 text-xs text-ink-2">
                  Mejor aquí: <span className="num font-medium">{hm(pick.start)}</span> · {pick.caffeine.fits ? `cafeína ✓ ${pick.caffeine.suggestedMg} mg` : `cafeína máx. ~${pick.caffeine.maxMg} mg`} · {pick.meal.ok ? "comida previa ✓" : "comida previa justa"}
                </p>
              ) : null}
            </div>
          );
        })}
        <p className="flex flex-wrap gap-3 text-[11px] text-ink-3">
          <Legend className="bg-herb" text="muy bien" />
          <Legend className="bg-herb/55" text="bien" />
          <Legend className="bg-warn" text="regular" />
          <Legend className="bg-persimmon/70" text="mal" />
        </p>
      </div>

      <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm text-ink-2">
        {c.plan.latestStartForFullCaffeine != null ? <p>Para tomar la dosis completa de cafeína, empieza antes de las {hm(c.plan.latestStartForFullCaffeine)}.</p> : null}
        {usual && c.usualStart != null ? (
          <p>
            Ahora sueles entrenar hacia las {hm(c.usualStart)}
            {usualFar ? " (fuera del horario o lejos de un tramo)" : `: ahí ${usual.caffeine.fits ? "cabe la dosis completa" : `caben ~${usual.caffeine.maxMg} mg de cafeína`}`}.
          </p>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-ink-3">
        Cuento con que te levantas hacia las {hm(c.wake)}
        {c.wakeSource === "default" ? " (supuesto: anota tu sueño para afinarlo)" : ""} y te acuestas hacia las {hm(c.bedtime)}
        {c.morningCaffeine ? `, y con tu café de la mañana (~${c.morningCaffeine.mg} mg hacia las ${hm(c.morningCaffeine.at)})` : ""}. Vida media de la cafeína: {c.halfLifeH} h. La fuerza suele ser algo mayor por la tarde, pero el cuerpo se adapta a la hora a la que entrenas
        habitualmente (Grgic et al., 2019), así que pesa más lo que la hora te deja hacer.
      </p>
    </Card>
  );
}

const clock = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function Legend({ className, text }: { className: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-block size-2.5 rounded-sm", className)} /> {text}
    </span>
  );
}

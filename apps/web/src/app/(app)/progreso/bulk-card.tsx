import { HYPERTROPHY_SETS, MUSCLE_LABEL, setsStatus } from "@nutria/nutrition";
import type { BulkReviewData } from "@nutria/core";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { dateShort, n0, n1 } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BulkApply, BulkClearAdjust, BulkReviewNow } from "./progress-forms";

const VERDICT: Record<BulkReviewData["verdict"], { label: string; tone: "ok" | "warn" | "neutral" }> = {
  on_track: { label: "Vas bien", tone: "ok" },
  slow: { label: "Despacio", tone: "warn" },
  fast: { label: "Deprisa", tone: "warn" },
  no_data: { label: "Faltan datos", tone: "neutral" },
};
const SIGNAL_TONE = { lean: "ok", watch: "warn", fat: "warn", stalled: "warn", unknown: "neutral" } as const;
const SET_SCALE = 25;
const rate = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${n1(Math.abs(v)).replace(/,0$/, "")} kg/sem`);

/** Weekly bulk review (goal «ganar»): rate vs. target, kcal proposal, sets per muscle, strength and waist. */
export function BulkCard({ personId, review, kcalAdjust, canWrite }: { personId: string; review: { id: string; periodEnd: string | null; data: BulkReviewData } | null; kcalAdjust: number; canWrite: boolean }) {
  const d = review?.data;
  const v = d ? VERDICT[d.verdict] : null;
  const maxRate = d ? Math.max(d.targetRateKgWeek * 2, Math.abs(d.observedRateKgWeek ?? 0), 0.1) : 1;
  return (
    <Card id="volumen">
      <CardHeader
        title="Revisión del volumen"
        subtitle={review?.periodEnd ? `Semana hasta el ${dateShort(review.periodEnd)} · tendencia de 4 semanas` : "Cada lunes: ritmo de subida, calorías, series por músculo y fuerza"}
        action={canWrite ? <BulkReviewNow personId={personId} /> : null}
      />
      {!d || !v ? (
        <p className="text-sm text-ink-2">Aún no hay revisión. Se hace sola los lunes; pulsa «Revisar ahora» para verla ya.</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="space-y-2">
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={v.tone}>{v.label}</Badge>
              <span>{d.message}</span>
            </p>
            {d.verdict !== "no_data" ? (
              <div className="grid grid-cols-[5.5rem_1fr_6rem] items-center gap-x-2 gap-y-1 text-xs" aria-label="Ritmo de subida">
                <span className="text-ink-3">Objetivo</span>
                <RateBar value={d.targetRateKgWeek} max={maxRate} color="var(--ink-3)" />
                <span className="num text-right">{rate(d.targetRateKgWeek)}</span>
                <span className="text-ink-3">Real</span>
                <RateBar value={d.observedRateKgWeek ?? 0} max={maxRate} color={d.verdict === "on_track" ? "var(--herb)" : "var(--persimmon)"} />
                <span className="num text-right font-medium">{rate(d.observedRateKgWeek)}</span>
              </div>
            ) : null}
            {d.kcalDelta && !d.appliedAt && canWrite && review ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-herb-soft/60 p-2">
                <span>
                  {d.kcalDelta > 0 ? "Subir" : "Bajar"} {n0(Math.abs(d.kcalDelta))} kcal al día{d.currentKcal ? ` (de ${n0(d.currentKcal)} a ${n0(d.currentKcal + d.kcalDelta)})` : ""}
                </span>
                <BulkApply personId={personId} insightId={review.id} delta={d.kcalDelta} />
              </div>
            ) : d.appliedAt ? (
              <p className="text-xs text-ink-3">Propuesta aplicada el {dateShort(d.appliedAt.slice(0, 10))}. Dale un par de semanas antes de volver a ajustar.</p>
            ) : null}
            {kcalAdjust ? (
              <p className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                Ajuste activo sobre tu gasto: <strong className="num">{kcalAdjust > 0 ? "+" : "−"}{n0(Math.abs(kcalAdjust))} kcal</strong>
                {canWrite ? <BulkClearAdjust personId={personId} /> : null}
              </p>
            ) : null}
          </div>

          <div>
            <p className="mb-1 flex items-center gap-2 font-medium">
              ¿Músculo o grasa? <Badge tone={SIGNAL_TONE[d.signal.kind]}>{d.signal.kind === "lean" ? "buena señal" : d.signal.kind === "unknown" ? "sin datos" : "atención"}</Badge>
            </p>
            <p className="text-ink-2">{d.signal.text}</p>
            <p className="mt-1 text-xs text-ink-3">
              4 semanas: peso {d.weightChangeKg == null ? "—" : `${d.weightChangeKg > 0 ? "+" : ""}${n1(d.weightChangeKg)} kg`} · fuerza {d.strengthChangePct == null ? "—" : `${d.strengthChangePct > 0 ? "+" : ""}${n1(d.strengthChangePct)} %`} · cintura{" "}
              {d.waistChangeCm == null ? "sin medir" : `${d.waistChangeCm > 0 ? "+" : ""}${n1(d.waistChangeCm)} cm`}
            </p>
          </div>

          <div>
            <p className="font-medium">Series por músculo a la semana</p>
            <p className="mb-2 text-xs text-ink-3">
              Media de 4 semanas (la última entre paréntesis). Para ganar músculo suelen funcionar {HYPERTROPHY_SETS.min}–{HYPERTROPHY_SETS.max}; los músculos secundarios cuentan media serie.
            </p>
            {d.trainedSessions ? (
              <ul className="space-y-1.5">
                {d.sets.map((s) => {
                  const st = setsStatus(s.avg4);
                  return (
                    <li key={s.muscle} className="grid grid-cols-[6.5rem_1fr_5.5rem] items-center gap-2 text-xs">
                      <span>{MUSCLE_LABEL[s.muscle]}</span>
                      <SetsBar value={s.avg4} />
                      <span className={cn("num text-right", st === "low" ? "text-persimmon" : st === "high" ? "text-ink-2" : "text-herb")}>
                        {n1(s.avg4).replace(/,0$/, "")} <span className="text-ink-3">({n1(s.week).replace(/,0$/, "")})</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-ink-3">Sin entrenos de openGym con ejercicios del catálogo en las últimas 4 semanas.</p>
            )}
          </div>

          {d.lifts.length ? (
            <div>
              <p className="mb-1 font-medium">Fuerza (1RM estimado)</p>
              <ul className="space-y-0.5 text-xs">
                {d.lifts.map((l) => (
                  <li key={l.name} className="flex justify-between gap-2">
                    <span className="truncate">{l.name}</span>
                    <span className="num shrink-0">
                      {n1(l.e1rm)} kg{l.change != null ? <span className={l.change >= 0 ? "text-herb" : "text-persimmon"}> · {l.change >= 0 ? "+" : ""}{n1(l.change)} en 3 meses</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function RateBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-paper-2" aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: color }} />
    </div>
  );
}

/** Bar with the 10–20 sets band drawn behind it. */
function SetsBar({ value }: { value: number }) {
  const st = setsStatus(value);
  return (
    <div className="relative h-2 rounded-full bg-paper-2" aria-hidden>
      <div className="absolute inset-y-0 rounded-full bg-herb-soft" style={{ left: `${(HYPERTROPHY_SETS.min / SET_SCALE) * 100}%`, width: `${((HYPERTROPHY_SETS.max - HYPERTROPHY_SETS.min) / SET_SCALE) * 100}%` }} />
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (value / SET_SCALE) * 100)}%`, background: st === "low" ? "var(--persimmon)" : "var(--herb)", opacity: 0.85 }} />
    </div>
  );
}

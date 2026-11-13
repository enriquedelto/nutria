import { MIN_IN_BEST_BUCKET, MIN_SESSIONS_FOR_BEST, type BucketStat, type PrePostAnalysis } from "@nutria/nutrition";
import { Card, CardHeader } from "@/components/ui/card";
import { n0 } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "Your best moment": pre-workout meal timing and carbs vs. session performance (openGym), plus post-workout protein. */
export function PrePostCard({ a, weeks }: { a: PrePostAnalysis; weeks: number }) {
  const enough = a.sessions >= MIN_SESSIONS_FOR_BEST;
  const pct = a.post.sessions ? Math.round((a.post.withProtein / a.post.sessions) * 100) : null;
  return (
    <Card id="comida-entreno">
      <CardHeader
        title="Comida y entreno: tu mejor momento"
        subtitle={`Últimas ${weeks} semanas · ${a.sessions} ${a.sessions === 1 ? "sesión" : "sesiones"} con hora de comidas`}
      />
      {enough ? (
        <div className="space-y-2 text-sm">
          <p>
            {a.bestGap ? (
              <>
                Tus mejores sesiones llegan cuando la comida con hidratos es <strong>{a.bestGap.label} antes</strong> (rendimiento {n0(a.bestGap.avg!)} frente a 100 de lo habitual).
              </>
            ) : (
              "Con lo registrado, ninguna franja destaca de verdad: el momento de la comida previa no cambia mucho tu rendimiento."
            )}
          </p>
          {a.bestCarbs ? (
            <p>
              En cantidad, rindes mejor con <strong>{a.bestCarbs.label}</strong> de hidratos en las 4 h previas.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-ink-2">
          Faltan datos: {a.sessions} de {MIN_SESSIONS_FOR_BEST} sesiones con la hora de la comida previa. Registra las comidas con su hora real (o con «Empezar comida») los días de entreno y aquí saldrá tu franja ideal.
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Buckets title="Horas desde la comida con hidratos" rows={a.gap} best={a.bestGap?.key} />
        <Buckets title="Hidratos en las 4 h previas" rows={a.carbs} best={a.bestCarbs?.key} />
      </div>
      <p className="mt-3 text-sm">
        Después de entrenar:{" "}
        {pct == null ? (
          <span className="text-ink-2">sin comidas con hora tras los entrenos.</span>
        ) : (
          <>
            en el <strong className="num">{pct} %</strong> de las sesiones tomaste ≥ 0,3 g/kg de proteína en las 2 h siguientes ({a.post.withProtein} de {a.post.sessions}).
          </>
        )}
      </p>
      <p className="mt-2 text-xs text-ink-3">
        Rendimiento = e1RM de cada ejercicio frente a su mediana de las 8 semanas anteriores (100 = lo habitual). Una franja se da como la mejor con al menos {MIN_IN_BEST_BUCKET} sesiones y más de 2 puntos por encima del resto. Tras entrenar, la hora importa poco si llegas a la proteína del día (Schoenfeld et al., 2013).
      </p>
    </Card>
  );
}

function Buckets({ title, rows, best }: { title: string; rows: BucketStat[]; best?: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium text-ink-3">{title}</p>
      <table className="w-full text-sm">
        <tbody className="num">
          {rows.map((r) => (
            <tr key={r.key} className={cn("border-b border-line/60", r.key === best ? "font-semibold text-herb" : r.n ? undefined : "text-ink-3")}>
              <td className="py-1">{r.label}</td>
              <td className="text-right">{r.n ? `${r.n} ses.` : "—"}</td>
              <td className="w-14 text-right">{r.avg != null ? n0(r.avg) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

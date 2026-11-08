import { Suspense } from "react";
import Link from "next/link";
import { and, asc, dailySummaries, desc, eq, gte, lte, professionalNotes, symptomLogs, user, weightLogs } from "@nutria/db";
import { targetsForDate } from "@nutria/core";
import { todayIn } from "@nutria/nutrition";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { dateLong, dateShort, isDate, kg, n0, n1, nutrient, nutrientName } from "@/lib/format";
import { requireScope } from "@/lib/session";
import { PrintButton } from "./print-button";

export const metadata = { title: "Informe" };

const shift = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function Content({ searchParams }: { searchParams: PageProps<"/informe">["searchParams"] }) {
  const sp = await searchParams;
  const ctx = await requireScope("diary");
  const today = todayIn(ctx.person.timezone);
  const to = isDate(sp.hasta) ? sp.hasta : today;
  const from = isDate(sp.desde) ? sp.desde : shift(to, -13);
  const id = ctx.person.id;
  const [days, target, weights, symptoms, notes] = await Promise.all([
    db().select().from(dailySummaries).where(and(eq(dailySummaries.personId, id), gte(dailySummaries.date, from), lte(dailySummaries.date, to))).orderBy(asc(dailySummaries.date)),
    targetsForDate(db(), id, to),
    ctx.scopes.has("body") ? db().select({ date: weightLogs.date, kg: weightLogs.kg }).from(weightLogs).where(and(eq(weightLogs.personId, id), gte(weightLogs.date, from), lte(weightLogs.date, to))).orderBy(asc(weightLogs.date)) : [],
    ctx.scopes.has("health") ? db().select().from(symptomLogs).where(and(eq(symptomLogs.personId, id), gte(symptomLogs.date, from), lte(symptomLogs.date, to))).orderBy(asc(symptomLogs.date)) : [],
    db().select({ body: professionalNotes.bodyMd, date: professionalNotes.createdAt, author: user.name }).from(professionalNotes).innerJoin(user, eq(user.id, professionalNotes.authorId)).where(eq(professionalNotes.personId, id)).orderBy(desc(professionalNotes.createdAt)).limit(5),
  ]);
  const logged = days.filter((d) => d.entries > 0);
  const macro = { kcal: avg(logged.map((d) => d.kcal)), protein: avg(logged.map((d) => d.protein)), carbs: avg(logged.map((d) => d.carbs)), fat: avg(logged.map((d) => d.fat)), fiber: avg(logged.map((d) => d.fiber)) };
  const micros = Object.entries(target?.micros ?? {})
    .filter(([, t]) => t.min || t.max)
    .map(([code, t]) => {
      const mean = avg(logged.map((d) => d.nutrients[code] ?? 0));
      return { code, mean, min: t.min, max: t.max, pct: t.min ? (mean / t.min) * 100 : null };
    })
    .sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));
  const upf = logged.filter((d) => d.upfKcalPct != null);
  const w0 = weights[0];
  const w1 = weights.at(-1);

  return (
    <article className="mx-auto max-w-3xl space-y-6 text-sm print:max-w-none print:text-[11pt]">
      <form className="no-print flex flex-wrap items-end gap-2">
        <label className="text-xs text-ink-3">
          Desde
          <input name="desde" type="date" defaultValue={from} className="mt-1 block rounded-lg border border-line bg-card px-2 py-1.5" />
        </label>
        <label className="text-xs text-ink-3">
          Hasta
          <input name="hasta" type="date" defaultValue={to} className="mt-1 block rounded-lg border border-line bg-card px-2 py-1.5" />
        </label>
        <Button type="submit" size="sm" variant="outline">
          Aplicar
        </Button>
        <PrintButton />
      </form>

      <header className="border-b border-line pb-3">
        <h1 className="font-display text-2xl font-semibold">Informe de alimentación · {ctx.person.name}</h1>
        <p className="text-ink-2">
          Del {dateLong(from)} al {dateLong(to)} · {logged.length} de {days.length || Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1} días con registro
        </p>
      </header>

      <section>
        <h2 className="mb-2 text-base font-semibold">Energía y macronutrientes (media diaria)</h2>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-3">
              <th className="py-1 font-medium">Nutriente</th>
              <th className="text-right font-medium">Media</th>
              <th className="text-right font-medium">Objetivo</th>
              <th className="text-right font-medium">%</th>
            </tr>
          </thead>
          <tbody className="num">
            {(
              [
                ["Energía", macro.kcal, target?.kcal, "kcal"],
                ["Proteína", macro.protein, target?.protein, "g"],
                ["Hidratos", macro.carbs, target?.carbs, "g"],
                ["Grasas", macro.fat, target?.fat, "g"],
                ["Fibra", macro.fiber, target?.fiber, "g"],
              ] as const
            ).map(([name, v, t, u]) => (
              <tr key={name} className="border-b border-line/60">
                <td className="py-1">{name}</td>
                <td className="text-right">
                  {n0(v)} {u}
                </td>
                <td className="text-right">{t ? `${n0(t)} ${u}` : "—"}</td>
                <td className="text-right">{t ? `${n0((v / t) * 100)} %` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {upf.length ? <p className="mt-2 text-ink-2">Ultraprocesados (NOVA 4): {n0(avg(upf.map((d) => d.upfKcalPct!)))} % de las kcal de media.</p> : null}
      </section>

      {micros.length ? (
        <section>
          <h2 className="mb-2 text-base font-semibold">Micronutrientes frente a la ingesta de referencia (EFSA)</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="py-1 font-medium">Nutriente</th>
                <th className="text-right font-medium">Media</th>
                <th className="text-right font-medium">Referencia</th>
                <th className="text-right font-medium">Cobertura</th>
              </tr>
            </thead>
            <tbody className="num">
              {micros.map((m) => (
                <tr key={m.code} className="border-b border-line/60">
                  <td className="py-1">{nutrientName(m.code)}</td>
                  <td className="text-right">{nutrient(m.code, m.mean)}</td>
                  <td className="text-right">{m.min ? nutrient(m.code, m.min) : m.max ? `máx. ${nutrient(m.code, m.max)}` : "—"}</td>
                  <td className={`text-right ${m.pct != null && m.pct < 70 ? "font-semibold text-persimmon" : m.max && m.mean > m.max ? "font-semibold text-danger" : ""}`}>{m.pct != null ? `${n0(m.pct)} %` : m.max && m.mean > m.max ? "por encima" : "ok"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-ink-3">Solo cuenta lo registrado (alimentos y suplementos). La vitamina D depende además de la exposición solar.</p>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-base font-semibold">Día a día</h2>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-3">
              <th className="py-1 font-medium">Día</th>
              <th className="text-right font-medium">kcal</th>
              <th className="text-right font-medium">Prot.</th>
              <th className="text-right font-medium">HC</th>
              <th className="text-right font-medium">Grasa</th>
              <th className="text-right font-medium">Agua</th>
              <th className="text-right font-medium">Ejercicio</th>
            </tr>
          </thead>
          <tbody className="num">
            {days.map((d) => (
              <tr key={d.date} className="border-b border-line/60">
                <td className="py-1">
                  {dateShort(d.date)} {d.complete ? "✓" : ""}
                </td>
                <td className="text-right">{n0(d.kcal)}</td>
                <td className="text-right">{n0(d.protein)}</td>
                <td className="text-right">{n0(d.carbs)}</td>
                <td className="text-right">{n0(d.fat)}</td>
                <td className="text-right">{d.waterMl ? `${n1(d.waterMl / 1000)} L` : "—"}</td>
                <td className="text-right">{d.exerciseKcal ? n0(d.exerciseKcal) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-ink-3">✓ = día marcado como registrado por completo.</p>
      </section>

      {weights.length ? (
        <section>
          <h2 className="mb-2 text-base font-semibold">Peso</h2>
          <p>
            {kg(w0!.kg)} ({dateShort(w0!.date)}) → {kg(w1!.kg)} ({dateShort(w1!.date)}) · cambio {w1!.kg - w0!.kg >= 0 ? "+" : ""}
            {n1(w1!.kg - w0!.kg)} kg en {weights.length} pesajes
          </p>
        </section>
      ) : null}

      {symptoms.length ? (
        <section>
          <h2 className="mb-2 text-base font-semibold">Síntomas registrados</h2>
          <ul className="list-disc pl-5">
            {symptoms.map((s) => (
              <li key={s.id}>
                {dateShort(s.date)}: {s.symptom} ({s.intensity}/5){s.note ? ` — ${s.note}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {notes.length ? (
        <section className="break-inside-avoid">
          <h2 className="mb-2 text-base font-semibold">Notas</h2>
          {notes.map((n, i) => (
            <p key={i} className="mb-2 whitespace-pre-line">
              <span className="text-xs text-ink-3">
                {n.author} · {dateShort(n.date.toISOString().slice(0, 10))}
              </span>
              <br />
              {n.body}
            </p>
          ))}
        </section>
      ) : null}

      <footer className="border-t border-line pt-2 text-xs text-ink-3">
        Generado con Nutria el {dateLong(today)}. Información orientativa: no sustituye el criterio de un profesional sanitario.{" "}
        <Link href="/diario" className="no-print underline">
          Volver al diario
        </Link>
      </footer>
    </article>
  );
}

export default function InformePage(props: PageProps<"/informe">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}

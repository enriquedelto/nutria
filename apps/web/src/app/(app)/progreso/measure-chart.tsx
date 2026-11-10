"use client";
import { useState } from "react";
import { SeriesChart } from "@/components/charts/weight-chart";
import { cn } from "@/lib/utils";

type Series = { key: string; label: string; unit: string; points: { date: string; value: number }[] };

/** One line chart with a chip per series (measurement sites, body fat, lean and fat mass). */
export function MeasureChart({ series, label }: { series: Series[]; label: string }) {
  const withData = series.filter((s) => s.points.length >= 2);
  const [key, setKey] = useState(withData[0]?.key ?? "");
  const cur = withData.find((s) => s.key === key) ?? withData[0];
  if (!cur) return null;
  const first = cur.points[0]!;
  const last = cur.points.at(-1)!;
  const diff = Math.round((last.value - first.value) * 10) / 10;
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {withData.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={s.key === cur.key}
            onClick={() => setKey(s.key)}
            className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", s.key === cur.key ? "border-herb bg-herb-soft text-herb" : "border-line text-ink-2 hover:bg-paper-2")}
          >
            {s.label}
          </button>
        ))}
      </div>
      <SeriesChart data={cur.points} kind="line" unit={cur.unit} fit />
      <p className="num mt-1 text-xs text-ink-3">
        {cur.label}: {diff > 0 ? "+" : ""}
        {diff.toLocaleString("es-ES")} {cur.unit} desde el primer registro ({cur.points.length} medidas)
      </p>
    </div>
  );
}

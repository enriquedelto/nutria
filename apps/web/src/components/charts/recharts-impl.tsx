"use client";
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";

export type WeightPoint = { date: string; kg?: number | null; trend?: number | null; forecast?: number | null };

const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });

/** Raw weigh-ins (dots), smoothed trend (line), forecast (dashed) and goal (reference line). */
export function WeightChart({ data, goal }: { data: WeightPoint[]; goal?: number | null }) {
  const values = data.flatMap((d) => [d.kg, d.trend, d.forecast]).filter((v): v is number => v != null);
  if (goal) values.push(goal);
  const min = Math.floor(Math.min(...values) - 1);
  const max = Math.ceil(Math.max(...values) + 1);
  return (
    <div className="h-64 w-full" role="img" aria-label="Evolución del peso">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11, fill: "var(--ink-3)" }} minTickGap={24} axisLine={false} tickLine={false} />
          <YAxis domain={[min, max]} tick={{ fontSize: 11, fill: "var(--ink-3)" }} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, fontSize: 12 }}
            labelFormatter={(d) => fmtDate(String(d))}
            formatter={(v, name) => [`${Number(v).toLocaleString("es-ES", { maximumFractionDigits: 1 })} kg`, name === "kg" ? "Pesaje" : name === "trend" ? "Tendencia" : "Previsión"]}
          />
          {goal ? <ReferenceLine y={goal} stroke="var(--persimmon)" strokeDasharray="6 4" label={{ value: "Meta", fill: "var(--persimmon)", fontSize: 11, position: "insideTopRight" }} /> : null}
          <Scatter dataKey="kg" fill="var(--ink-3)" shape="circle" r={2.5} isAnimationActive={false} />
          <Line dataKey="trend" stroke="var(--herb)" strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
          <Line dataKey="forecast" stroke="var(--herb)" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Generic daily series chart (kcal, steps, sleep hours…) with an optional target line. */
export function SeriesChart({ data, color = "var(--herb)", target, unit, kind = "bar", fit = false }: { data: { date: string; value: number | null }[]; color?: string; target?: number | null; unit?: string; kind?: "bar" | "line"; /** Y axis fitted to the data instead of starting at 0. */ fit?: boolean }) {
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11, fill: "var(--ink-3)" }} minTickGap={24} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "var(--ink-3)" }} axisLine={false} tickLine={false} width={44} domain={fit ? [(min: number) => Math.floor(min - 1), (max: number) => Math.ceil(max + 1)] : undefined} />
          <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, fontSize: 12 }} labelFormatter={(d) => fmtDate(String(d))} formatter={(v) => [`${Number(v).toLocaleString("es-ES", { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ""}`, ""]} />
          {target ? <ReferenceLine y={target} stroke="var(--persimmon)" strokeDasharray="6 4" /> : null}
          {kind === "bar" ? (
            <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          ) : (
            <Line dataKey="value" stroke={color} strokeWidth={2.5} dot={fit ? { r: 3 } : false} connectNulls isAnimationActive={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export type CaffeinePoint = { t: number; logged: number; plan?: number };

const fmtClock = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Caffeine in the body (mg) over the day: logged doses (area), with the simulated dose (dashed), training, bedtime and the sleep threshold. */
export function CaffeineChart({ data, training, bedtime, threshold }: { data: CaffeinePoint[]; training: number | null; bedtime: number; threshold: number }) {
  const ticks = data.filter((d) => d.t % 240 === 0).map((d) => d.t);
  const hasPlan = data.some((d) => d.plan != null);
  return (
    <div className="h-56 w-full" role="img" aria-label="Cafeína en el cuerpo a lo largo del día">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} ticks={ticks} tickFormatter={fmtClock} tick={{ fontSize: 11, fill: "var(--ink-3)" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "var(--ink-3)" }} axisLine={false} tickLine={false} width={44} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, fontSize: 12 }}
            labelFormatter={(t) => fmtClock(Number(t))}
            formatter={(v, name) => [`${Math.round(Number(v))} mg`, name === "plan" ? "Con la toma simulada" : "Registrado"]}
          />
          <ReferenceLine y={threshold} stroke="var(--persimmon)" strokeDasharray="6 4" label={{ value: `${threshold} mg`, fill: "var(--persimmon)", fontSize: 11, position: "insideTopLeft" }} />
          {training != null ? <ReferenceLine x={training} stroke="var(--herb)" label={{ value: "Entreno", fill: "var(--herb)", fontSize: 11, position: "top" }} /> : null}
          <ReferenceLine x={bedtime} stroke="var(--ink-3)" label={{ value: "Dormir", fill: "var(--ink-3)", fontSize: 11, position: "top" }} />
          <Area dataKey="logged" stroke="var(--kcal)" fill="var(--kcal)" fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} />
          {hasPlan ? <Line dataKey="plan" stroke="var(--kcal)" strokeWidth={2} strokeDasharray="5 5" dot={false} isAnimationActive={false} /> : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export type MealTimingPoint = { t: number; carbs: number; protein: number; approx: boolean; label: string };

/** Meals of a training day as carb/protein bars on a time axis, with the session and the before/after windows. */
export function MealTimingChart({ data, session, pre, post }: { data: MealTimingPoint[]; session: { start: number; end: number }; pre: [number, number]; post: [number, number] }) {
  // A 15-min grid on a category axis: bars get a real width and the windows snap to it.
  const STEP = 15;
  const snap = (m: number) => Math.round(m / STEP) * STEP;
  const lo = Math.floor((Math.min(pre[0], ...data.map((d) => d.t)) - 30) / 60) * 60;
  const hi = Math.ceil((Math.max(post[1], ...data.map((d) => d.t)) + 30) / 60) * 60;
  const byT = new Map<number, MealTimingPoint>();
  for (const d of data) {
    const k = snap(d.t);
    const cur = byT.get(k);
    byT.set(k, cur ? { ...d, t: k, carbs: cur.carbs + d.carbs, protein: cur.protein + d.protein, label: `${cur.label}, ${d.label}` } : { ...d, t: k });
  }
  const grid = Array.from({ length: (hi - lo) / STEP + 1 }, (_, i) => {
    const t = lo + i * STEP;
    return byT.get(t) ?? { t, carbs: 0, protein: 0, approx: false, label: "" };
  });
  const ticks = grid.filter((g) => (g.t - lo) % 120 === 0).map((g) => g.t);
  return (
    <div className="h-48 w-full" role="img" aria-label="Comidas alrededor del entreno">
      <ResponsiveContainer>
        <ComposedChart data={grid} margin={{ top: 16, right: 18, bottom: 0, left: -8 }} barGap={0} barCategoryGap={0}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" ticks={ticks} interval={0} tickFormatter={(t) => fmtClock(Number(t))} tick={{ fontSize: 11, fill: "var(--ink-3)" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "var(--ink-3)" }} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
          <ReferenceArea x1={snap(pre[0])} x2={snap(pre[1])} fill="var(--carbs)" fillOpacity={0.12} label={{ value: "Antes", fill: "var(--ink-3)", fontSize: 11, position: "insideTop" }} />
          <ReferenceArea x1={snap(session.start)} x2={snap(session.end)} fill="var(--persimmon)" fillOpacity={0.18} label={{ value: "Entreno", fill: "var(--persimmon)", fontSize: 11, position: "insideTop" }} />
          <ReferenceArea x1={snap(post[0])} x2={snap(post[1])} fill="var(--protein)" fillOpacity={0.12} label={{ value: "Después", fill: "var(--ink-3)", fontSize: 11, position: "insideTop" }} />
          <Tooltip
            contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, fontSize: 12 }}
            labelFormatter={(t, p) => {
              const d = p?.[0]?.payload as MealTimingPoint | undefined;
              return d?.label ? `${fmtClock(Number(t))}${d.approx ? " (hora aprox.)" : ""} · ${d.label}` : fmtClock(Number(t));
            }}
            formatter={(v, name) => [`${Math.round(Number(v))} g`, name === "carbs" ? "Hidratos" : "Proteína"]}
          />
          <Legend formatter={(v) => (v === "carbs" ? "Hidratos (g)" : "Proteína (g)")} wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="carbs" fill="var(--carbs)" isAnimationActive={false}>
            {grid.map((d) => <Cell key={`c${d.t}`} fillOpacity={d.approx ? 0.45 : 1} />)}
          </Bar>
          <Bar dataKey="protein" fill="var(--protein)" isAnimationActive={false}>
            {grid.map((d) => <Cell key={`p${d.t}`} fillOpacity={d.approx ? 0.45 : 1} />)}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

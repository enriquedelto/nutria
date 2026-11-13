"use client";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";

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

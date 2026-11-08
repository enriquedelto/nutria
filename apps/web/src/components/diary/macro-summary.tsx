import { Bar, Ring } from "@/components/ui/progress";
import { energy, n0, nutrient, nutrientName, type EnergyUnit } from "@/lib/format";
import type { NutrientMap } from "@nutria/nutrition";

type Target = { kcal: number; protein: number; carbs: number; fat: number; fiber: number | null } | null;

const MACROS = [
  { code: "protein", label: "Proteína", color: "var(--protein)" },
  { code: "carbs", label: "Hidratos", color: "var(--carbs)" },
  { code: "fat", label: "Grasa", color: "var(--fat)" },
  { code: "fiber", label: "Fibra", color: "var(--fiber)" },
] as const;

export function MacroSummary({ totals, target, exerciseKcal = 0, unit = "kcal" }: { totals: NutrientMap; target: Target; exerciseKcal?: number; unit?: EnergyUnit }) {
  const kcal = totals.energy_kcal ?? 0;
  const goal = target ? target.kcal + Math.round(exerciseKcal * 0.5) : null; // eat back half of exercise
  const left = goal != null ? goal - kcal : null;
  return (
    <div className="grid items-center gap-5 sm:grid-cols-[auto_1fr]">
      <div className="flex justify-center">
        <Ring value={kcal} max={goal}>
          <div>
            <p className="num font-display text-3xl font-semibold leading-none">{n0(unit === "kj" ? kcal * 4.184 : kcal)}</p>
            <p className="text-xs text-ink-2">{unit === "kj" ? "kJ" : "kcal"} comidas</p>
            {left != null ? (
              <p className={`mt-1 text-sm font-medium ${left < 0 ? "text-persimmon" : "text-herb"}`}>
                {left < 0 ? `${energy(-left, unit)} de más` : `quedan ${energy(left, unit)}`}
              </p>
            ) : null}
          </div>
        </Ring>
      </div>
      <div className="space-y-3">
        {MACROS.map((m) => {
          const v = totals[m.code] ?? 0;
          const t = target ? (target[m.code] ?? null) : null;
          return (
            <div key={m.code}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <span className="size-2.5 rounded-full" style={{ background: m.color }} aria-hidden />
                  {m.label}
                </span>
                <span className="num text-ink-2">
                  {n0(v)} {t ? `/ ${n0(t)}` : ""} g
                </span>
              </div>
              <Bar value={v} max={t} color={m.color} label={m.label} />
            </div>
          );
        })}
        {exerciseKcal > 0 ? <p className="text-xs text-ink-3">Incluye +{n0(exerciseKcal * 0.5)} kcal por ejercicio (la mitad de lo quemado).</p> : null}
      </div>
    </div>
  );
}

export function MicroList({ totals, codes, targets }: { totals: NutrientMap; codes: string[]; targets: Record<string, { min?: number; max?: number; target?: number }> }) {
  return (
    <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {codes.map((c) => {
        const v = totals[c] ?? 0;
        const t = targets[c];
        const goal = t?.target ?? t?.min ?? null;
        const over = t?.max != null && v > t.max;
        return (
          <li key={c}>
            <div className="mb-1 flex justify-between text-sm">
              <span>{nutrientName(c)}</span>
              <span className={`num ${over ? "text-danger" : "text-ink-2"}`}>
                {nutrient(c, v)}
                {goal ? <span className="text-ink-3"> / {nutrient(c, goal)}</span> : null}
              </span>
            </div>
            <Bar value={v} max={goal} color={over ? "var(--danger)" : "var(--herb)"} label={nutrientName(c)} />
          </li>
        );
      })}
    </ul>
  );
}

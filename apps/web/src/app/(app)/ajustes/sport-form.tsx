"use client";
import { errorText } from "@/lib/errors";
import Link from "next/link";
import { useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { Dumbbell } from "lucide-react";
import { toast } from "sonner";
import { saveSport } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SportValues = {
  active: boolean;
  focus: "hypertrophy" | "strength" | "general";
  level: "recreational" | "competitive";
  proteinPerKg: number;
  trainingDays: number[];
  trainingDaysSource: "manual" | "opengym";
  cycleCarbs: boolean;
  waterAuto: boolean;
};

const DAYS = ["L", "M", "X", "J", "V", "S", "D"];
const DAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const PROTEIN_DEFAULT = { recreational: 1.8, competitive: 2.0 } as const;

export function SportForm({ personId, initial, openGymDays, weightKg }: { personId: string; initial: SportValues; openGymDays: number[]; weightKg: number | null }) {
  const [v, setV] = useState(initial);
  const [pending, start] = useSafeTransition();
  const set = <K extends keyof SportValues>(k: K, val: SportValues[K]) => setV((x) => ({ ...x, [k]: val }));
  const toggleDay = (d: number) => setV((x) => ({ ...x, trainingDaysSource: "manual", trainingDays: x.trainingDays.includes(d) ? x.trainingDays.filter((y) => y !== d) : [...x.trainingDays, d].sort() }));
  const proteinG = weightKg ? Math.round(v.proteinPerKg * weightKg) : null;
  const sameAsOpenGym = openGymDays.length > 0 && openGymDays.join() === v.trainingDays.join();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          try {
            await saveSport(personId, v);
            toast.success(v.active ? "Perfil deportivo guardado. Objetivos recalculados." : "Perfil deportivo desactivado.");
          } catch (err) {
            toast.error(errorText(err, "Error"));
          }
        });
      }}
    >
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={v.active} onChange={(e) => set("active", e.target.checked)} className="mt-1 size-4 accent-[var(--herb)]" />
        <span>
          <span className="flex items-center gap-1.5 font-medium">
            <Dumbbell className="size-4 text-ink-3" /> Entreno de fuerza o hipertrofia
          </span>
          <span className="block text-sm text-ink-2">Ajusta la proteína, la grasa mínima, los hidratos según el día y el agua a tu entreno.</span>
        </span>
      </label>

      {v.active ? (
        <div className="space-y-4 border-l-2 border-herb/40 pl-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Enfoque">
              <Select value={v.focus} onChange={(e) => set("focus", e.target.value as SportValues["focus"])}>
                <option value="hypertrophy">Hipertrofia (ganar músculo)</option>
                <option value="strength">Fuerza</option>
                <option value="general">Forma física general</option>
              </Select>
            </Field>
            <Field label="Nivel">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["recreational", "Recreativo", "Entrenas por salud y progreso"],
                    ["competitive", "Competitivo", "Buscas el máximo, compites o vas a ello"],
                  ] as const
                ).map(([k, label, hint]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={v.level === k}
                    onClick={() => setV((x) => ({ ...x, level: k, proteinPerKg: x.proteinPerKg === PROTEIN_DEFAULT[x.level] ? PROTEIN_DEFAULT[k] : x.proteinPerKg }))}
                    className={cn("rounded-xl border p-2 text-left text-sm", v.level === k ? "border-herb bg-herb-soft" : "border-line hover:bg-paper-2")}
                  >
                    <span className="font-semibold">{label}</span>
                    <span className="mt-0.5 block text-xs text-ink-3">{hint}</span>
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <Field
            label={`Proteína: ${v.proteinPerKg.toLocaleString("es-ES", { minimumFractionDigits: 1 })} g/kg${proteinG ? ` ≈ ${proteinG} g al día` : ""}`}
            hint="La evidencia sitúa el máximo beneficio entre 1,6 y 2,2 g/kg; más no añade músculo. Repártela en 3–5 comidas."
          >
            <input type="range" min={1.6} max={2.2} step={0.1} value={v.proteinPerKg} onChange={(e) => set("proteinPerKg", Number(e.target.value))} className="w-full accent-[var(--herb)]" aria-label="Proteína por kilo" />
          </Field>

          <Field
            label="Días de entreno"
            hint={
              sameAsOpenGym && v.trainingDaysSource === "opengym"
                ? "Vienen de tu plan semanal de openGym y se actualizan solos. Si los cambias aquí, dejan de sincronizarse."
                : "Un día cuenta como de entreno si está aquí o si registras un entreno ese día."
            }
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {DAYS.map((d, i) => (
                <button key={d} type="button" aria-label={DAY_NAMES[i]} aria-pressed={v.trainingDays.includes(i + 1)} onClick={() => toggleDay(i + 1)} className={cn("size-9 rounded-full border text-sm font-medium", v.trainingDays.includes(i + 1) ? "border-persimmon bg-persimmon-soft text-persimmon" : "border-line hover:bg-paper-2")}>
                  {d}
                </button>
              ))}
              {openGymDays.length && !sameAsOpenGym ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setV((x) => ({ ...x, trainingDays: openGymDays, trainingDaysSource: "opengym" }))}>
                  Usar los de openGym ({openGymDays.map((d) => DAYS[d - 1]).join(" ")})
                </Button>
              ) : null}
            </div>
          </Field>

          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={v.cycleCarbs} onChange={(e) => set("cycleCarbs", e.target.checked)} className="mt-1 size-4 accent-[var(--herb)]" />
            <span>
              <span className="font-medium">Más hidratos los días de entreno</span>
              <span className="block text-sm text-ink-2">Los días de descanso bajan un poco los hidratos y los de entreno suben; la media de la semana es la misma.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={v.waterAuto} onChange={(e) => set("waterAuto", e.target.checked)} className="mt-1 size-4 accent-[var(--herb)]" />
            <span>
              <span className="font-medium">Agua según tu peso y tu entreno</span>
              <span className="block text-sm text-ink-2">35 ml por kilo y unos 0,6 L más por hora de entreno, en lugar del objetivo fijo.</span>
            </span>
          </label>
          <p className="text-sm text-ink-2">
            Suplementos con evidencia (creatina, cafeína…) y los que no hacen falta en{" "}
            <Link href="/salud/suplementos" className="text-herb underline">
              Salud › Suplementos
            </Link>
            .
          </p>
        </div>
      ) : null}

      <Button type="submit" disabled={pending}>
        Guardar deporte
      </Button>
    </form>
  );
}

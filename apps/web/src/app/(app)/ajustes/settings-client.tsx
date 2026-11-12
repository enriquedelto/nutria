"use client";
import { errorText } from "@/lib/errors";
import { useState, useSyncExternalStore } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { ArrowDown, ArrowUp, Monitor, Moon, Plus, Sun, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { saveMealSlots, updatePersonSettings } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/* -------------------------------- theme -------------------------------- */

const THEME_EVENT = "nutria-theme";
const subscribeTheme = (cb: () => void) => {
  window.addEventListener(THEME_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(THEME_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
};
const readTheme = () => {
  try {
    return localStorage.getItem("theme") ?? "system";
  } catch {
    return "system";
  }
};

export function ThemePicker() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "system");
  const apply = (t: string) => {
    try {
      localStorage.setItem("theme", t);
    } catch {}
    window.dispatchEvent(new Event(THEME_EVENT));
    const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  };
  return (
    <div className="flex gap-2">
      {[
        ["light", "Claro", Sun],
        ["dark", "Oscuro", Moon],
        ["system", "Sistema", Monitor],
      ].map(([k, label, Icon]) => {
        const I = Icon as typeof Sun;
        return (
          <button key={k as string} type="button" aria-pressed={theme === k} onClick={() => apply(k as string)} className={cn("flex flex-1 flex-col items-center gap-1 rounded-xl border p-3 text-sm", theme === k ? "border-herb bg-herb-soft" : "border-line hover:bg-paper-2")}>
            <I className="size-5" /> {label as string}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------- display prefs ----------------------------- */

type Display = { homeCards: string[]; trackedMicros: string[]; units: "metric" | "imperial"; energyUnit: "kcal" | "kj"; waterGoalMl: number };

export function DisplaySettings({ personId, initial, cards, micros, canEdit, waterAuto = false }: { personId: string; initial: Display; cards: { code: string; name: string }[]; micros: { code: string; name: string }[]; canEdit: boolean; waterAuto?: boolean }) {
  const [v, setV] = useState(initial);
  const [pending, start] = useSafeTransition();
  const move = (i: number, d: -1 | 1) =>
    setV((x) => {
      const a = [...x.homeCards];
      const j = i + d;
      if (j < 0 || j >= a.length) return x;
      [a[i], a[j]] = [a[j]!, a[i]!];
      return { ...x, homeCards: a };
    });
  const toggleCard = (c: string) => setV((x) => ({ ...x, homeCards: x.homeCards.includes(c) ? x.homeCards.filter((y) => y !== c) : [...x.homeCards, c] }));
  const toggleMicro = (c: string) => setV((x) => ({ ...x, trackedMicros: x.trackedMicros.includes(c) ? x.trackedMicros.filter((y) => y !== c) : [...x.trackedMicros, c] }));
  const name = new Map(cards.map((c) => [c.code, c.name]));
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await updatePersonSettings(personId, v);
          toast.success("Guardado");
        });
      }}
    >
      <fieldset disabled={!canEdit} className="space-y-2">
        <legend className="mb-1 font-display text-lg font-semibold">Tarjetas de «Hoy»</legend>
        <ol className="space-y-1">
          {v.homeCards.map((c, i) => (
            <li key={c} className="flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 text-sm">
              <span className="flex-1">{name.get(c) ?? c}</span>
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Subir" onClick={() => move(i, -1)}>
                <ArrowUp />
              </Button>
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Bajar" onClick={() => move(i, 1)}>
                <ArrowDown />
              </Button>
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Quitar" onClick={() => toggleCard(c)}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-1.5">
          {cards
            .filter((c) => !v.homeCards.includes(c.code))
            .map((c) => (
              <Button key={c.code} type="button" size="sm" variant="outline" onClick={() => toggleCard(c.code)}>
                <Plus /> {c.name}
              </Button>
            ))}
        </div>
      </fieldset>

      <fieldset disabled={!canEdit}>
        <legend className="mb-2 font-display text-lg font-semibold">Micronutrientes que sigues</legend>
        <div className="flex flex-wrap gap-1.5">
          {micros.map((m) => (
            <button key={m.code} type="button" aria-pressed={v.trackedMicros.includes(m.code)} onClick={() => toggleMicro(m.code)} className={cn("rounded-full border px-3 py-1 text-sm", v.trackedMicros.includes(m.code) ? "border-herb bg-herb-soft text-herb" : "border-line hover:bg-paper-2")}>
              {m.name}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 font-display text-lg font-semibold">Unidades</legend>
        <Field label="Sistema">
          <Select value={v.units} onChange={(e) => setV((x) => ({ ...x, units: e.target.value as Display["units"] }))}>
            <option value="metric">Métrico (kg, cm)</option>
            <option value="imperial">Imperial (lb, in)</option>
          </Select>
        </Field>
        <Field label="Energía">
          <Select value={v.energyUnit} onChange={(e) => setV((x) => ({ ...x, energyUnit: e.target.value as Display["energyUnit"] }))}>
            <option value="kcal">kcal</option>
            <option value="kj">kJ</option>
          </Select>
        </Field>
        <Field label="Meta de agua (ml)" hint={waterAuto ? "Ahora se calcula sola según tu peso y tu entreno (Perfil › Deporte). Esta meta se usa si lo desactivas." : undefined}>
          <Input type="number" min={500} max={8000} step={50} value={v.waterGoalMl} onChange={(e) => setV((x) => ({ ...x, waterGoalMl: Number(e.target.value) }))} />
        </Field>
      </fieldset>
      {canEdit ? (
        <Button type="submit" disabled={pending}>
          Guardar
        </Button>
      ) : null}
    </form>
  );
}

/* ------------------------------ meal slots ------------------------------ */

type Slot = { key: string; label: string; defaultTime: string | null; kcalShare: number | null };

export function MealSlotsEditor({ personId, initial }: { personId: string; initial: Slot[] }) {
  const [slots, setSlots] = useState(initial);
  const [pending, start] = useSafeTransition();
  const share = slots.reduce((a, s) => a + (s.kcalShare ?? 0), 0);
  const set = (i: number, p: Partial<Slot>) => setSlots((xs) => xs.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const slug = (l: string) =>
    l
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 30) || "comida";
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {slots.map((s, i) => (
          <li key={i} className="grid grid-cols-[1fr_7rem_5rem_auto] items-end gap-2">
            <Field label={i === 0 ? "Nombre" : undefined}>
              <Input value={s.label} maxLength={30} onChange={(e) => set(i, { label: e.target.value, key: initial.some((x) => x.key === s.key) ? s.key : slug(e.target.value) })} />
            </Field>
            <Field label={i === 0 ? "Hora" : undefined}>
              <Input type="time" value={s.defaultTime?.slice(0, 5) ?? ""} onChange={(e) => set(i, { defaultTime: e.target.value || null })} />
            </Field>
            <Field label={i === 0 ? "% kcal" : undefined}>
              <Input type="number" min={0} max={100} value={s.kcalShare != null ? Math.round(s.kcalShare * 100) : ""} onChange={(e) => set(i, { kcalShare: e.target.value ? Number(e.target.value) / 100 : null })} />
            </Field>
            <Button type="button" size="icon" variant="ghost" aria-label="Quitar" disabled={slots.length <= 1} onClick={() => setSlots((xs) => xs.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <p className={cn("text-xs", share > 0 && Math.abs(share - 1) > 0.02 ? "text-persimmon" : "text-ink-3")}>
        El reparto suma {Math.round(share * 100)} %. Se usa para repartir raciones en los planes y avisarte a la hora de cada comida.
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={slots.length >= 10} onClick={() => setSlots((xs) => [...xs, { key: `extra_${xs.length + 1}`, label: "Otra comida", defaultTime: null, kcalShare: null }])}>
          <Plus /> Añadir
        </Button>
        <span className="flex-1" />
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                await saveMealSlots(personId, slots.map((s) => ({ ...s, defaultTime: s.defaultTime?.slice(0, 5) ?? null })));
                toast.success("Comidas guardadas");
              } catch (e) {
                toast.error(errorText(e, "Error"));
              }
            })
          }
        >
          Guardar
        </Button>
      </div>
    </div>
  );
}

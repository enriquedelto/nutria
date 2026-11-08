"use client";
import { errorText } from "@/lib/errors";
import { useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { X } from "lucide-react";
import { toast } from "sonner";
import { updateProfile } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ProfileValues = {
  displayName: string;
  avatarColor: string;
  sex: "female" | "male" | null;
  birthDate: string | null;
  heightCm: number | null;
  weightKg: number | null;
  activityLevel: "sedentary" | "light" | "moderate" | "active" | "very_active";
  goalType: "lose" | "maintain" | "gain";
  weeklyRateKg: number;
  pregnancy: "trimester1" | "trimester2" | "trimester3" | "lactation" | null;
  dietPattern: string | null;
  allergens: string[];
  dislikes: string[];
  preferencesMd: string;
  timezone: string;
};

const COLORS = ["#22c55e", "#0ea5e9", "#a855f7", "#f97316", "#ef4444", "#eab308", "#14b8a6", "#ec4899", "#64748b"];
const ACTIVITY: [ProfileValues["activityLevel"], string, string][] = [
  ["sedentary", "Sedentaria", "Trabajo sentado, sin ejercicio"],
  ["light", "Ligera", "Caminas algo o 1–3 entrenos/semana"],
  ["moderate", "Moderada", "3–5 entrenos/semana"],
  ["active", "Activa", "6–7 entrenos o trabajo físico"],
  ["very_active", "Muy activa", "Doble sesión o trabajo muy físico"],
];
const DIETS = [
  ["", "Omnívora"],
  ["vegetarian", "Vegetariana"],
  ["vegan", "Vegana"],
  ["pescatarian", "Pescetariana"],
  ["mediterranean", "Mediterránea"],
  ["keto", "Keto"],
  ["low_carb", "Baja en hidratos"],
] as const;

export function ProfileForm({ personId, initial, allergens, timezones, isChild }: { personId: string; initial: ProfileValues; allergens: { code: string; name: string }[]; timezones: string[]; isChild: boolean }) {
  const [v, setV] = useState(initial);
  const [dislike, setDislike] = useState("");
  const [pending, start] = useSafeTransition();
  const set = <K extends keyof ProfileValues>(k: K, val: ProfileValues[K]) => setV((x) => ({ ...x, [k]: val }));
  const toggleAllergen = (c: string) => set("allergens", v.allergens.includes(c) ? v.allergens.filter((x) => x !== c) : [...v.allergens, c]);
  const addDislike = () => {
    const d = dislike.trim();
    if (d && !v.dislikes.includes(d)) set("dislikes", [...v.dislikes, d]);
    setDislike("");
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          try {
            const r = await updateProfile(personId, v);
            if (r.missing.length) toast.warning(`Perfil guardado. Para calcular tus objetivos falta: ${r.missing.join(", ")}.`);
            else toast.success("Perfil guardado. Objetivos recalculados.");
          } catch (err) {
            toast.error(errorText(err, "Error"));
          }
        });
      }}
    >
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-display text-lg font-semibold">Datos básicos</legend>
        <Field label="Nombre">
          <Input value={v.displayName} onChange={(e) => set("displayName", e.target.value)} required maxLength={40} />
        </Field>
        <Field label="Color">
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={c} aria-pressed={v.avatarColor === c} onClick={() => set("avatarColor", c)} className={cn("size-8 rounded-full border-2", v.avatarColor === c ? "border-ink" : "border-transparent")} style={{ background: c }} />
            ))}
          </div>
        </Field>
        <Field label="Sexo (para los cálculos)">
          <Select value={v.sex ?? ""} onChange={(e) => set("sex", (e.target.value || null) as ProfileValues["sex"])}>
            <option value="">Prefiero no decirlo</option>
            <option value="female">Mujer</option>
            <option value="male">Hombre</option>
          </Select>
        </Field>
        <Field label="Fecha de nacimiento">
          <Input type="date" value={v.birthDate ?? ""} onChange={(e) => set("birthDate", e.target.value || null)} />
        </Field>
        <Field label="Altura (cm)">
          <Input type="number" inputMode="numeric" min={40} max={250} value={v.heightCm ?? ""} onChange={(e) => set("heightCm", e.target.value ? Number(e.target.value) : null)} />
        </Field>
        <Field label="Peso actual (kg)" hint="Se guarda como pesaje de hoy si cambia; el historial está en Progreso">
          <Input type="number" inputMode="decimal" min={2} max={400} step={0.1} value={v.weightKg ?? ""} onChange={(e) => set("weightKg", e.target.value ? Number(e.target.value) : null)} />
        </Field>
        <Field label="Zona horaria">
          <Select value={v.timezone} onChange={(e) => set("timezone", e.target.value)}>
            {timezones.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        {v.sex === "female" && !isChild ? (
          <Field label="Embarazo o lactancia">
            <Select value={v.pregnancy ?? ""} onChange={(e) => set("pregnancy", (e.target.value || null) as ProfileValues["pregnancy"])}>
              <option value="">No</option>
              <option value="trimester1">Embarazo, 1.er trimestre</option>
              <option value="trimester2">Embarazo, 2.º trimestre</option>
              <option value="trimester3">Embarazo, 3.er trimestre</option>
              <option value="lactation">Lactancia</option>
            </Select>
          </Field>
        ) : null}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 font-display text-lg font-semibold">Actividad y objetivo</legend>
        <div className="grid gap-2 sm:grid-cols-5">
          {ACTIVITY.map(([k, label, hint]) => (
            <button key={k} type="button" aria-pressed={v.activityLevel === k} onClick={() => set("activityLevel", k)} className={cn("rounded-xl border p-2.5 text-left text-sm", v.activityLevel === k ? "border-herb bg-herb-soft" : "border-line hover:bg-paper-2")}>
              <span className="font-semibold">{label}</span>
              <span className="mt-0.5 block text-xs text-ink-3">{hint}</span>
            </button>
          ))}
        </div>
        {!isChild ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Objetivo">
              <Select value={v.goalType} onChange={(e) => set("goalType", e.target.value as ProfileValues["goalType"])}>
                <option value="lose">Perder grasa</option>
                <option value="maintain">Mantener</option>
                <option value="gain">Ganar músculo/peso</option>
              </Select>
            </Field>
            {v.goalType !== "maintain" ? (
              <Field label={`Ritmo: ${Math.abs(v.weeklyRateKg || (v.goalType === "lose" ? 0.5 : 0.25)).toLocaleString("es-ES")} kg/semana`} hint={v.goalType === "lose" ? "0,25–0,75 kg/semana es sostenible para la mayoría" : "0,1–0,3 kg/semana minimiza la grasa ganada"}>
                <input type="range" min={0.1} max={v.goalType === "lose" ? 1 : 0.5} step={0.05} value={Math.abs(v.weeklyRateKg || (v.goalType === "lose" ? 0.5 : 0.25))} onChange={(e) => set("weeklyRateKg", Number(e.target.value) * (v.goalType === "lose" ? -1 : 1))} className="w-full accent-[var(--herb)]" />
              </Field>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 font-display text-lg font-semibold">Alimentación</legend>
        <Field label="Patrón">
          <Select value={v.dietPattern ?? ""} onChange={(e) => set("dietPattern", e.target.value || null)}>
            {DIETS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Alergias e intolerancias" hint="Te avisaremos al escanear o registrar">
          <div className="flex flex-wrap gap-1.5">
            {allergens.map((a) => (
              <button key={a.code} type="button" aria-pressed={v.allergens.includes(a.code)} onClick={() => toggleAllergen(a.code)} className={cn("rounded-full border px-3 py-1 text-sm", v.allergens.includes(a.code) ? "border-persimmon bg-persimmon-soft text-persimmon" : "border-line hover:bg-paper-2")}>
                {a.name}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Alimentos que no te gustan">
          <div className="flex gap-2">
            <Input value={dislike} onChange={(e) => setDislike(e.target.value)} onKeyDown={(e) => (e.key === "Enter" ? (e.preventDefault(), addDislike()) : undefined)} placeholder="coliflor, cilantro…" />
            <Button type="button" variant="outline" onClick={addDislike}>
              Añadir
            </Button>
          </div>
          {v.dislikes.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {v.dislikes.map((d) => (
                <span key={d} className="inline-flex items-center gap-1 rounded-full bg-paper-2 px-2.5 py-1 text-sm">
                  {d}
                  <button type="button" aria-label={`Quitar ${d}`} onClick={() => set("dislikes", v.dislikes.filter((x) => x !== d))}>
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </Field>
        <Field label="Preferencias (texto libre)" hint="Lo leen el coach y el planificador: horarios, presupuesto, cocina favorita, tiempo para cocinar…">
          <Textarea rows={4} value={v.preferencesMd} onChange={(e) => set("preferencesMd", e.target.value)} maxLength={4000} />
        </Field>
      </fieldset>

      <Button type="submit" size="lg" disabled={pending}>
        Guardar perfil
      </Button>
    </form>
  );
}

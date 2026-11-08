"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Play, Plus, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteExercise,
  deleteMedication,
  deleteSymptom,
  endFast,
  endPeriod,
  logCycleSymptom,
  logExercise,
  logPeriod,
  logSleep,
  logSteps,
  logSymptom,
  runCorrelationsNow,
  saveMedication,
  setCondition,
  setMedicationActive,
  startFast,
} from "@/actions/health";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/* ------------------------------- exercise ------------------------------- */

export function ExerciseForm({ personId, today, activities }: { personId: string; today: string; activities: { code: string; nameEs: string; category: string; met: number }[] }) {
  const [pending, start] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  const cats = [...new Set(activities.map((a) => a.category))];
  return (
    <form
      ref={ref}
      className="grid gap-2 sm:grid-cols-[1fr_6rem_9rem_auto] sm:items-end"
      action={(fd) =>
        start(async () => {
          await logExercise(personId, { date: String(fd.get("date")), activityCode: String(fd.get("activity")), minutes: Number(fd.get("minutes")), kcal: fd.get("kcal") ? Number(fd.get("kcal")) : null });
          toast.success("Ejercicio guardado");
          ref.current?.reset();
        })
      }
    >
      <Field label="Actividad">
        <Select name="activity" required>
          {cats.map((c) => (
            <optgroup key={c} label={c}>
              {activities
                .filter((a) => a.category === c)
                .map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.nameEs}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
      </Field>
      <Field label="Minutos">
        <Input name="minutes" type="number" min={1} max={1440} required inputMode="numeric" />
      </Field>
      <Field label="Fecha">
        <Input name="date" type="date" defaultValue={today} max={today} />
      </Field>
      <Button type="submit" disabled={pending}>
        <Plus /> Añadir
      </Button>
      <input type="hidden" name="kcal" />
    </form>
  );
}

export function DeleteExercise({ personId, id }: { personId: string; id: string }) {
  const [, start] = useTransition();
  return (
    <button type="button" aria-label="Borrar" className="rounded-full p-1 text-ink-3 hover:bg-paper-2" onClick={() => start(() => deleteExercise(personId, id))}>
      <Trash2 className="size-4" />
    </button>
  );
}

export function StepsForm({ personId, today, current }: { personId: string; today: string; current: number | null }) {
  const [pending, start] = useTransition();
  return (
    <form className="flex items-end gap-2" action={(fd) => start(async () => void (await logSteps(personId, String(fd.get("date")), Number(fd.get("steps")))))}>
      <Field label="Pasos" className="flex-1">
        <Input name="steps" type="number" min={0} max={150000} defaultValue={current ?? undefined} inputMode="numeric" required />
      </Field>
      <Field label="Fecha">
        <Input name="date" type="date" defaultValue={today} max={today} />
      </Field>
      <Button type="submit" variant="outline" disabled={pending}>
        Guardar
      </Button>
    </form>
  );
}

/* -------------------------------- fasting -------------------------------- */

const PHASES: Record<string, string> = { anabolic: "Digestión", catabolic: "Glucógeno", fat_burning: "Quema de grasa", ketosis: "Cetosis", deep_ketosis: "Cetosis profunda" };

export function FastingTimer({ personId, active, protocols, canWrite }: { personId: string; active: { startedAt: string; targetHours: number; protocol: string } | null; protocols: { code: string; nameEs: string; fastHours: number | null; description: string }[]; canWrite: boolean }) {
  const [pending, start] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const [proto, setProto] = useState("16:8");
  const [hours, setHours] = useState(16);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  if (active) {
    const el = Math.max(0, (now - Date.parse(active.startedAt)) / 3_600_000);
    const pct = Math.min(1, el / active.targetHours);
    const phase = el < 4 ? "anabolic" : el < 12 ? "catabolic" : el < 18 ? "fat_burning" : el < 24 ? "ketosis" : "deep_ketosis";
    const r = 88, c = 2 * Math.PI * r;
    const h = Math.floor(el), m = Math.floor((el - h) * 60), s = Math.floor(((el - h) * 60 - m) * 60);
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="relative grid size-52 place-items-center">
          <svg viewBox="0 0 200 200" className="absolute inset-0 -rotate-90">
            <circle cx="100" cy="100" r={r} stroke="var(--paper-2)" strokeWidth="14" fill="none" />
            <circle cx="100" cy="100" r={r} stroke={pct >= 1 ? "var(--ok)" : "var(--herb)"} strokeWidth="14" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
          </svg>
          <div className="text-center">
            <p className="num font-display text-4xl font-semibold">
              {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}
              <span className="text-lg text-ink-3">:{String(s).padStart(2, "0")}</span>
            </p>
            <p className="text-sm text-ink-2">de {active.targetHours} h · {active.protocol}</p>
            <p className="mt-1 text-xs font-medium text-herb">{PHASES[phase]}</p>
          </div>
        </div>
        {canWrite ? (
          <Button variant="accent" disabled={pending} onClick={() => start(() => endFast(personId))}>
            <Square /> Terminar ayuno
          </Button>
        ) : null}
      </div>
    );
  }
  if (!canWrite) return <p className="text-ink-2">Sin ayuno en curso.</p>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {protocols.filter((p) => p.code !== "5:2").map((p) => (
          <button
            key={p.code}
            type="button"
            onClick={() => {
              setProto(p.code);
              if (p.fastHours) setHours(p.fastHours);
            }}
            className={cn("rounded-xl border p-3 text-left text-sm", proto === p.code ? "border-herb bg-herb-soft" : "border-line hover:bg-paper-2")}
          >
            <span className="font-semibold">{p.nameEs}</span>
            <span className="mt-0.5 block text-xs text-ink-3">{p.description}</span>
          </button>
        ))}
      </div>
      {proto === "custom" ? (
        <Field label="Horas">
          <Input type="number" min={1} max={168} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
        </Field>
      ) : null}
      <Button size="lg" disabled={pending} onClick={() => start(() => startFast(personId, proto, hours))}>
        <Play /> Empezar ayuno de {hours} h
      </Button>
    </div>
  );
}

/* --------------------------------- sleep --------------------------------- */

export function SleepForm({ personId, today }: { personId: string; today: string }) {
  const [pending, start] = useTransition();
  const [quality, setQuality] = useState(3);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      action={(fd) =>
        start(async () => {
          const date = String(fd.get("date"));
          const prev = new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
          const bed = String(fd.get("bed"));
          const wake = String(fd.get("wake"));
          // Bedtime after noon belongs to the previous evening.
          const bedDate = Number(bed.slice(0, 2)) >= 12 ? prev : date;
          await logSleep(personId, { date, bedtime: new Date(`${bedDate}T${bed}:00`).toISOString(), wakeTime: new Date(`${date}T${wake}:00`).toISOString(), quality, note: String(fd.get("note") || "") || null });
          toast.success("Sueño guardado");
        })
      }
    >
      <Field label="Noche que termina el">
        <Input name="date" type="date" defaultValue={today} max={today} required />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Me acosté">
          <Input name="bed" type="time" defaultValue="23:30" required />
        </Field>
        <Field label="Me levanté">
          <Input name="wake" type="time" defaultValue="07:30" required />
        </Field>
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-sm font-medium text-ink-2">Calidad</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-pressed={quality === n} onClick={() => setQuality(n)} className={cn("h-10 flex-1 rounded-xl border text-lg", quality === n ? "border-herb bg-herb-soft" : "border-line")}>
              {["😫", "😕", "😐", "🙂", "😴"][n - 1]}
            </button>
          ))}
        </div>
      </fieldset>
      <Field label="Nota" className="sm:col-span-2">
        <Input name="note" maxLength={300} placeholder="Cené tarde, café a las 18 h…" />
      </Field>
      <Button type="submit" disabled={pending} className="sm:col-span-2">
        Guardar
      </Button>
    </form>
  );
}

/* --------------------------------- cycle --------------------------------- */

const CYCLE_SYMPTOMS = [
  ["cramps", "Dolor"],
  ["bloating", "Hinchazón"],
  ["cravings", "Antojos"],
  ["fatigue", "Cansancio"],
  ["mood", "Ánimo bajo"],
  ["headache", "Dolor de cabeza"],
  ["acne", "Acné"],
  ["breast", "Pecho sensible"],
] as const;

export function PeriodControls({ personId, today, open }: { personId: string; today: string; open: { id: string; startDate: string } | null }) {
  const [pending, start] = useTransition();
  return open ? (
    <Button variant="outline" disabled={pending} onClick={() => start(() => endPeriod(personId, open.id, today))}>
      Terminó la regla (hoy)
    </Button>
  ) : (
    <form className="flex items-end gap-2" action={(fd) => start(() => logPeriod(personId, { startDate: String(fd.get("start")), flow: fd.get("flow") ? Number(fd.get("flow")) : null }))}>
      <Field label="Empezó la regla">
        <Input name="start" type="date" defaultValue={today} max={today} required />
      </Field>
      <Field label="Flujo">
        <Select name="flow" defaultValue="2">
          <option value="1">Ligero</option>
          <option value="2">Medio</option>
          <option value="3">Abundante</option>
        </Select>
      </Field>
      <Button type="submit" disabled={pending}>
        Guardar
      </Button>
    </form>
  );
}

export function CycleSymptoms({ personId, today }: { personId: string; today: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      {CYCLE_SYMPTOMS.map(([code, label]) => (
        <Button key={code} size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
          await logCycleSymptom(personId, today, code, 3);
          toast.success(`${label} anotado`);
        })}>
          {label}
        </Button>
      ))}
    </div>
  );
}

/* -------------------------------- symptoms -------------------------------- */

const COMMON_SYMPTOMS = ["Hinchazón", "Gases", "Ardor", "Dolor de barriga", "Diarrea", "Estreñimiento", "Dolor de cabeza", "Cansancio", "Picor", "Náuseas"];

export function SymptomForm({ personId }: { personId: string }) {
  const [pending, start] = useTransition();
  const [symptom, setSymptom] = useState("");
  const [intensity, setIntensity] = useState(3);
  const nowLocal = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };
  return (
    <form
      className="space-y-3"
      action={(fd) =>
        start(async () => {
          await logSymptom(personId, { occurredAt: new Date(String(fd.get("at"))).toISOString(), symptom, intensity, note: String(fd.get("note") || "") || null });
          toast.success("Síntoma anotado");
          setSymptom("");
        })
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {COMMON_SYMPTOMS.map((s) => (
          <button key={s} type="button" onClick={() => setSymptom(s)} className={cn("rounded-full border px-3 py-1 text-sm", symptom === s ? "border-herb bg-herb-soft text-herb" : "border-line hover:bg-paper-2")}>
            {s}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
        <Field label="Síntoma">
          <Input value={symptom} onChange={(e) => setSymptom(e.target.value)} required maxLength={60} />
        </Field>
        <Field label="Cuándo">
          <Input name="at" type="datetime-local" defaultValue={nowLocal()} required />
        </Field>
      </div>
      <Field label={`Intensidad: ${intensity}/5`}>
        <input type="range" min={1} max={5} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} className="w-full accent-[var(--herb)]" />
      </Field>
      <Field label="Nota">
        <Input name="note" maxLength={300} />
      </Field>
      <Button type="submit" disabled={pending || !symptom}>
        Anotar
      </Button>
    </form>
  );
}

export function DeleteSymptom({ personId, id }: { personId: string; id: string }) {
  const [, start] = useTransition();
  return (
    <button type="button" aria-label="Borrar" className="rounded-full p-1 text-ink-3 hover:bg-paper-2" onClick={() => start(() => deleteSymptom(personId, id))}>
      <Trash2 className="size-4" />
    </button>
  );
}

export function RunCorrelations({ personId }: { personId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="soft" disabled={pending} onClick={() => start(async () => {
      await runCorrelationsNow(personId);
      toast("Analizando… los resultados aparecerán en unos minutos");
    })}>
      Buscar relaciones ahora
    </Button>
  );
}

/* ------------------------------- medication ------------------------------- */

type Med = { id: string; name: string; activeIngredient: string | null; dose: string | null; times: string[]; daysOfWeek: number[]; withFood: string; startDate: string | null; endDate: string | null; note: string | null; active: boolean };
const DAYS = ["L", "M", "X", "J", "V", "S", "D"];

export function MedicationDialog({ personId, med, trigger }: { personId: string; med?: Med; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [times, setTimes] = useState<string[]>(med?.times ?? ["08:00"]);
  const [days, setDays] = useState<number[]>(med?.daysOfWeek ?? []);
  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent title={med ? "Editar medicamento" : "Nuevo medicamento"} description="Recibirás un aviso a cada hora. Las alertas con alimentos son orientativas.">
            <form
              className="space-y-3"
              action={(fd) =>
                start(async () => {
                  await saveMedication(
                    personId,
                    {
                      name: String(fd.get("name")),
                      activeIngredient: String(fd.get("ingredient") || "") || null,
                      dose: String(fd.get("dose") || "") || null,
                      times: times.filter(Boolean),
                      daysOfWeek: days,
                      withFood: String(fd.get("withFood")) as "any",
                      startDate: String(fd.get("start") || "") || null,
                      endDate: String(fd.get("end") || "") || null,
                      note: String(fd.get("note") || "") || null,
                    },
                    med?.id,
                  );
                  setOpen(false);
                })
              }
            >
              <div className="grid grid-cols-2 gap-2">
                <Field label="Nombre" className="col-span-2">
                  <Input name="name" required defaultValue={med?.name} maxLength={80} placeholder="Eutirox" />
                </Field>
                <Field label="Principio activo">
                  <Input name="ingredient" defaultValue={med?.activeIngredient ?? ""} placeholder="levotiroxina" />
                </Field>
                <Field label="Dosis">
                  <Input name="dose" defaultValue={med?.dose ?? ""} placeholder="50 µg" />
                </Field>
              </div>
              <Field label="Horas">
                <div className="flex flex-wrap gap-2">
                  {times.map((t, i) => (
                    <Input key={i} type="time" value={t} className="w-28" onChange={(e) => setTimes((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} />
                  ))}
                  <Button type="button" size="icon" variant="outline" onClick={() => setTimes((xs) => [...xs, "20:00"])} aria-label="Añadir hora">
                    <Plus />
                  </Button>
                </div>
              </Field>
              <Field label="Días (vacío = todos)">
                <div className="flex gap-1">
                  {DAYS.map((d, i) => (
                    <button key={d} type="button" aria-pressed={days.includes(i + 1)} onClick={() => setDays((xs) => (xs.includes(i + 1) ? xs.filter((x) => x !== i + 1) : [...xs, i + 1]))} className={cn("size-9 rounded-full border text-sm", days.includes(i + 1) ? "border-herb bg-herb text-herb-ink" : "border-line")}>
                      {d}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Con comida">
                <Select name="withFood" defaultValue={med?.withFood ?? "any"}>
                  <option value="any">Indiferente</option>
                  <option value="with">Con comida</option>
                  <option value="without">En ayunas</option>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Desde">
                  <Input name="start" type="date" defaultValue={med?.startDate ?? ""} />
                </Field>
                <Field label="Hasta">
                  <Input name="end" type="date" defaultValue={med?.endDate ?? ""} />
                </Field>
              </div>
              <Field label="Nota">
                <Textarea name="note" rows={2} defaultValue={med?.note ?? ""} />
              </Field>
              <Button type="submit" className="w-full" disabled={pending}>
                Guardar
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export function MedicationActions({ personId, id, active }: { personId: string; id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => setMedicationActive(personId, id, !active))}>
        {active ? "Pausar" : "Reanudar"}
      </Button>
      <Button size="icon-sm" variant="ghost" disabled={pending} aria-label="Borrar" onClick={() => start(() => deleteMedication(personId, id))}>
        <Trash2 />
      </Button>
    </div>
  );
}

/* ------------------------------- conditions ------------------------------- */

export function ConditionToggle({ personId, code, active }: { personId: string; code: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={pending}
      onClick={() => start(() => setCondition(personId, code, !active))}
      className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", active ? "bg-herb" : "bg-line")}
    >
      <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform", active ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}

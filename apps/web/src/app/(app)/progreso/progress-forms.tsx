"use client";
import { submitForm } from "@/lib/forms";
import { errorText } from "@/lib/errors";
import { useRef, useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { acceptTdee, applyBulkReviewAction, clearKcalAdjust, deleteWeight, logMeasurements, logWeight, reviewBulkNow, setGoal } from "@/actions/health";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { MEASURE_SITES } from "@nutria/nutrition";
import { fileToJpeg } from "@/lib/image";
import { dateShort, kg, sourceLabel } from "@/lib/format";

export function WeightForm({ personId, today }: { personId: string; today: string }) {
  const [pending, start] = useSafeTransition();
  return (
    <form
      className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 sm:grid-cols-[9rem_7rem_7rem_auto]"
      onSubmit={submitForm((fd, form) =>
        start(async () => {
          await logWeight(personId, { date: String(fd.get("date")), kg: Number(fd.get("kg")), bodyFatPct: fd.get("bf") ? Number(fd.get("bf")) : null });
          toast.success("Peso guardado");
          form.reset();
        })
      )}
    >
      <Field label="Fecha" className="col-span-3 sm:col-span-1">
        <Input name="date" type="date" defaultValue={today} max={today} required />
      </Field>
      <Field label="Peso (kg)">
        <Input name="kg" type="number" inputMode="decimal" step="0.1" min={2} max={400} required />
      </Field>
      <Field label="% grasa">
        <Input name="bf" type="number" inputMode="decimal" step="0.1" min={2} max={70} />
      </Field>
      <Button type="submit" disabled={pending}>
        <Plus /> Guardar
      </Button>
    </form>
  );
}

export function WeightList({ personId, items, canWrite }: { personId: string; items: { id: string; date: string; kg: number; bodyFatPct: number | null; source: string }[]; canWrite: boolean }) {
  const [, start] = useSafeTransition();
  return (
    <ul className="divide-y divide-line text-sm">
      {items.map((w) => (
        <li key={w.id} className="flex items-center gap-3 py-2">
          <span className="w-20 text-ink-3">{dateShort(w.date)}</span>
          <span className="num flex-1 font-medium">
            {kg(w.kg)}
            {w.bodyFatPct ? <span className="ml-2 text-ink-3">{w.bodyFatPct} % grasa</span> : null}
            {w.source !== "manual" ? <span className="ml-2 text-xs text-ink-3">({sourceLabel(w.source)})</span> : null}
          </span>
          {canWrite ? (
            <button type="button" aria-label="Borrar" className="rounded-full p-1 text-ink-3 hover:bg-paper-2" onClick={() => start(() => deleteWeight(personId, w.id))}>
              <Trash2 className="size-4" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function AcceptTdee({ personId, estimateId, kcal }: { personId: string; estimateId: string; kcal: number }) {
  const [pending, start] = useSafeTransition();
  return (
    <Button size="sm" disabled={pending} onClick={() => start(async () => {
      await acceptTdee(personId, estimateId);
      toast.success("Objetivos actualizados");
    })}>
      Usar {kcal} kcal
    </Button>
  );
}

export function BulkApply({ personId, insightId, delta }: { personId: string; insightId: string; delta: number }) {
  const [pending, start] = useSafeTransition();
  return (
    <Button size="sm" disabled={pending} onClick={() => start(async () => {
      await applyBulkReviewAction(personId, insightId);
      toast.success(`Objetivo de calorías ${delta > 0 ? "subido" : "bajado"} ${Math.abs(delta)} kcal`);
    })}>
      Aplicar
    </Button>
  );
}

export function BulkClearAdjust({ personId }: { personId: string }) {
  const [pending, start] = useSafeTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
      await clearKcalAdjust(personId);
      toast.success("Ajuste quitado");
    })}>
      Quitar ajuste
    </Button>
  );
}

export function BulkReviewNow({ personId }: { personId: string }) {
  const [pending, start] = useSafeTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
      await reviewBulkNow(personId);
      toast.success("Revisión actualizada");
    })}>
      {pending ? <Loader2 className="animate-spin" /> : null} Revisar ahora
    </Button>
  );
}

export function GoalForm({ personId, current }: { personId: string; current: { targetValue: number; targetDate: string | null } | null }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useSafeTransition();
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {current ? "Cambiar meta" : "Poner una meta"}
      </Button>
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent title="Meta de peso" description="La previsión te dirá cuándo llegarías al ritmo actual.">
            <form className="space-y-3" onSubmit={submitForm((fd) => start(async () => {
              await setGoal(personId, { type: "weight", targetValue: Number(fd.get("kg")), targetDate: (fd.get("date") as string) || null });
              setOpen(false);
            }))}>
              <Field label="Peso objetivo (kg)">
                <Input name="kg" type="number" step="0.1" min={20} max={300} required defaultValue={current?.targetValue} />
              </Field>
              <Field label="Fecha objetivo (opcional)">
                <Input name="date" type="date" defaultValue={current?.targetDate ?? ""} />
              </Field>
              <Button type="submit" className="w-full" disabled={pending}>Guardar</Button>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

const SITES = MEASURE_SITES.map((s) => [s.key, s.label] as const);


export function MeasurementsForm({ personId, today }: { personId: string; today: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useSafeTransition();
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus /> Medidas
      </Button>
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent title="Medidas (cm)" description="Con cuello y cintura (y cadera en mujeres) se estima tu % de grasa. Mide siempre igual: por la mañana, relajado.">
            <form className="space-y-3" onSubmit={submitForm((fd) => start(async () => {
              const sites: Record<string, number> = {};
              for (const [k] of SITES) if (fd.get(k)) sites[k] = Number(fd.get(k));
              await logMeasurements(personId, String(fd.get("date")), sites);
              setOpen(false);
            }))}>
              <Field label="Fecha"><Input name="date" type="date" defaultValue={today} max={today} /></Field>
              <div className="grid grid-cols-2 gap-3">
                {SITES.map(([k, label]) => (
                  <Field key={k} label={label}><Input name={k} type="number" step="0.1" min={10} max={250} inputMode="decimal" /></Field>
                ))}
              </div>
              <Button type="submit" className="w-full" disabled={pending}>Guardar</Button>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export function PhotoUpload({ personId, today }: { personId: string; today: string }) {
  const [busy, setBusy] = useState(false);
  const [pose, setPose] = useState("front");
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const img = await fileToJpeg(f, 1600, 0.85);
      const blob = await (await fetch(img.preview)).blob();
      const fd = new FormData();
      fd.append("personId", personId);
      fd.append("date", today);
      fd.append("pose", pose);
      fd.append("file", blob, "foto.jpg");
      const res = await fetch("/api/photos", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Foto guardada (cifrada)");
      router.refresh();
    } catch (e) {
      toast.error(errorText(e, "No se pudo subir"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <Select value={pose} onChange={(e) => setPose(e.target.value)} className="h-9 w-28 text-sm" aria-label="Pose">
        <option value="front">Frente</option>
        <option value="side">Perfil</option>
        <option value="back">Espalda</option>
      </Select>
      <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Camera />} Foto
      </Button>
      <input ref={input} type="file" accept="image/*" capture="user" hidden onChange={(e) => void upload(e.target.files?.[0])} />
    </div>
  );
}

export function PhotoCompare({ photos }: { photos: { id: string; date: string; pose: string; kg?: number | null }[] }) {
  const [a, setA] = useState(photos.at(-1)?.id ?? "");
  const [b, setB] = useState(photos[0]?.id ?? "");
  const router = useRouter();
  if (!photos.length) return <p className="text-sm text-ink-3">Sin fotos. Son privadas: solo tú (y quien tenga permiso de fotos) las ve.</p>;
  const opt = photos.map((p) => (
    <option key={p.id} value={p.id}>
      {dateShort(p.date)} · {p.pose === "front" ? "frente" : p.pose === "side" ? "perfil" : "espalda"}
    </option>
  ));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {[
          [a, setA],
          [b, setB],
        ].map(([id, set], i) => (
          <div key={i} className="space-y-1">
            <Select value={id as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} className="h-9 text-sm">
              {opt}
            </Select>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {id ? <img src={`/api/photos/${id}`} alt="Foto de progreso" className="aspect-[3/4] w-full rounded-xl bg-paper-2 object-cover" loading="lazy" /> : null}
            {(() => {
              const ph = photos.find((x) => x.id === id);
              return ph ? (
                <p className="num text-center text-xs text-ink-2">
                  {dateShort(ph.date)}
                  {ph.kg != null ? ` · ${kg(ph.kg)}` : ""}
                </p>
              ) : null;
            })()}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="text-xs text-danger hover:underline"
        onClick={async () => {
          if (!a) return;
          await fetch(`/api/photos/${a}`, { method: "DELETE" });
          router.refresh();
        }}
      >
        Borrar la foto de la izquierda
      </button>
    </div>
  );
}

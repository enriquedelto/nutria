"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Clock, Loader2, Sparkles, Trash2, Utensils } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { errorText } from "@/lib/errors";
import { photoTakenAt } from "@/lib/exif";
import { fileToJpeg } from "@/lib/image";
import { fromLocal, localDateTime, slotForTime } from "@/lib/slots";
import { cn } from "@/lib/utils";

export type Draft = {
  id: string;
  date: string;
  mealSlot: string | null;
  startedAt: string;
  text: string;
  status: "open" | "pending";
  photos: { n: number; phase: "before" | "after" }[];
};

type Slots = { key: string; label: string; time?: string | null }[];

/** Photos → JPEG for upload, with each photo's own time (EXIF/file) when it has one. */
async function toUpload(files: File[]) {
  return Promise.all(
    files.map(async (f) => {
      const at = await photoTakenAt(f);
      const img = await fileToJpeg(f);
      return { mediaType: "image/jpeg" as const, data: img.data, takenAt: at ? fromLocal(at.date, at.time).toISOString() : null };
    }),
  );
}

async function api<T>(url: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "No se pudo guardar");
  return d as T;
}

/** «Foto antes de comer»: starts a meal draft at the photo's time. */
export function StartMeal({ personId, slots }: { personId: string; slots: Slots }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const start = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const images = await toUpload([...files].slice(0, 4));
      const at = images[0]?.takenAt ? new Date(images[0].takenAt) : new Date();
      const [date, time] = localDateTime(at);
      await api("/api/meal-drafts", "POST", { personId, date, mealSlot: slotForTime(slots, time), startedAt: at.toISOString(), images });
      toast.success(`Comida empezada a las ${time}. Al terminar, haz la foto de lo que sobró.`);
      router.refresh();
    } catch (e) {
      toast.error(errorText(e, "No se pudo guardar la foto"));
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };
  return (
    <>
      <Button type="button" variant="soft" size="lg" className="w-full" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <Utensils />} Empezar comida (foto antes de comer)
      </Button>
      <input ref={ref} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void start(e.target.files)} />
    </>
  );
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const dayOf = (iso: string) => localDateTime(new Date(iso))[0];

/** Meals in progress and saved for later, with their actions. */
export function DraftList({ drafts, slots, today, busyId, onAnalyze }: { drafts: Draft[]; slots: Slots; today: string; busyId: string | null; onAnalyze: (d: Draft) => void }) {
  if (!drafts.length) return null;
  return (
    <div className="space-y-2">
      {drafts.map((d) => (
        <DraftCard key={d.id} d={d} slots={slots} today={today} busy={busyId === d.id} onAnalyze={() => onAnalyze(d)} />
      ))}
    </div>
  );
}

function DraftCard({ d, slots, today, busy, onAnalyze }: { d: Draft; slots: Slots; today: string; busy: boolean; onAnalyze: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const after = d.photos.filter((p) => p.phase === "after").length;
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setWorking(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error(errorText(e, "No se pudo guardar"));
    } finally {
      setWorking(false);
    }
  };
  const slotLabel = slots.find((s) => s.key === d.mealSlot)?.label ?? "Comida";
  const day = dayOf(d.startedAt);
  return (
    <Card className={cn("space-y-3", d.status === "open" ? "border-herb/50 bg-herb-soft/30" : undefined)}>
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 size-5 shrink-0 text-ink-3" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">
            {d.status === "open" ? "Comida en curso" : "Pendiente de analizar"} · {slotLabel}
          </p>
          <p className="text-ink-2">
            {day === today ? "Hoy" : new Date(`${day}T12:00:00`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })} a las {clock(d.startedAt)}
            {d.text ? ` · ${d.text}` : ""}
          </p>
        </div>
      </div>
      {d.photos.length ? (
        <ul className="flex flex-wrap gap-2">
          {d.photos.map((p) => (
            <li key={p.n} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/meal-drafts/${d.id}/photos/${p.n}`} alt={p.phase === "before" ? "Antes" : "Lo que sobró"} className="size-16 rounded-xl object-cover" />
              <span className="absolute bottom-0.5 left-0.5 rounded bg-ink/70 px-1 text-[10px] text-paper">{p.phase === "before" ? "antes" : "sobras"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {after < 4 ? (
          <Button type="button" size="sm" variant="outline" disabled={working || busy} onClick={() => ref.current?.click()}>
            <Camera /> {after ? "Otra foto de lo que sobró" : "Foto de lo que sobró"}
          </Button>
        ) : null}
        <Button type="button" size="sm" disabled={working || busy} onClick={onAnalyze}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {after ? "Analizar" : "Me lo comí todo · Analizar"}
        </Button>
        {d.status === "open" ? (
          <Button type="button" size="sm" variant="ghost" disabled={working || busy} onClick={() => run(() => api(`/api/meal-drafts/${d.id}`, "PATCH", { status: "pending" }), "Guardada para analizar más tarde")}>
            Más tarde
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant={confirmDiscard ? "danger" : "ghost"}
          className={confirmDiscard ? undefined : "text-danger"}
          disabled={working || busy}
          onClick={() => (confirmDiscard ? run(() => api(`/api/meal-drafts/${d.id}`, "DELETE"), "Descartada") : setConfirmDiscard(true))}
        >
          <Trash2 /> {confirmDiscard ? "¿Seguro?" : "Descartar"}
        </Button>
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])].slice(0, 4 - after);
          e.target.value = "";
          if (files.length) void run(async () => api(`/api/meal-drafts/${d.id}`, "PATCH", { phase: "after", images: await toUpload(files) }), "Foto de lo que sobró guardada");
        }}
      />
    </Card>
  );
}

/** After an AI failure (no quota, no connection): keep photos, note and time to analyse later. */
export async function saveAsPending(input: { personId: string; date: string; time: string; mealSlot: string; text: string; images: { data: string }[] }) {
  return api<Draft>("/api/meal-drafts", "POST", {
    personId: input.personId,
    date: input.date,
    mealSlot: input.mealSlot,
    startedAt: fromLocal(input.date, input.time).toISOString(),
    text: input.text,
    status: "pending",
    images: input.images.slice(0, 4).map((i) => ({ mediaType: "image/jpeg", data: i.data, takenAt: null })),
  });
}

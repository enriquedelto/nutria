"use client";
import { errorText } from "@/lib/errors";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Camera, HelpCircle, ImagePlus, Loader2, ScanText, Search, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { missingFrom, scaleNutrients, type NutrientMap } from "@nutria/nutrition";
import { learnPortions } from "@/actions/ai";
import { WhatIf, type DayContext } from "@/components/food/add-food-dialog";
import { FoodPicker } from "@/components/food/food-picker";
import { VoiceInput } from "@/components/voice-input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { fileToJpeg, type B64Image } from "@/lib/image";
import { n0 } from "@/lib/format";
import { newClientId, sendOrQueue } from "@/lib/offline-queue";
import { cn } from "@/lib/utils";
import { photoTakenAt } from "@/lib/exif";
import { defaultEntryTime, fromLocal, slotForTime } from "@/lib/slots";

type Estimate = {
  estimateId: string;
  mealSlot: string | null;
  notes: string | null;
  questions: string[];
  items: {
    name: string;
    grams: number;
    servingLabel?: string | null;
    confidence: number;
    nova?: number | null;
    per100: { code: string; amount: number }[];
    nutrients: NutrientMap;
    match: { foodId: string; name: string; brand: string | null; source: string } | null;
    candidates: { foodId: string; name: string; brand: string | null; kcal: number | null }[];
  }[];
};

type Row = {
  key: string;
  name: string;
  grams: number;
  aiGrams: number;
  servingLabel: string | null;
  per100: NutrientMap;
  foodId: string | null;
  matchName: string | null;
  candidates: Estimate["items"][number]["candidates"];
  confidence: number;
  nova: number | null;
  /** The AI's own per 100 g: fills nutrients the chosen food lacks (e.g. caffeine). */
  aiPer100: NutrientMap;
};

export function RegisterClient({ ctx, aiEnabled, sharedImages, voice = false }: { ctx: DayContext; aiEnabled: boolean; sharedImages: string[]; voice?: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const [text, setText] = useState(params.get("texto") ?? "");
  const [mode, setMode] = useState<"text" | "voice" | "photo">("text");
  const [images, setImages] = useState<B64Image[]>([]);
  const [slot, setSlot] = useState(ctx.slot);
  // When it was eaten: today → now; another day → that meal's usual time. Photos can override it (EXIF).
  const [date, setDate] = useState(ctx.date);
  const [time, setTime] = useState(() => defaultEntryTime(ctx.date, ctx.today, ctx.slots.find((s) => s.key === ctx.slot)?.time));
  const [est, setEst] = useState<Estimate | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [saving, start] = useSafeTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  // Photos shared from Android ("Compartir con Nutria").
  useEffect(() => {
    if (!sharedImages.length) return;
    void (async () => {
      const blobs = await Promise.all(sharedImages.map(async (u) => (await fetch(u)).blob()));
      // Shared from the gallery, often hours later: the photo's own time is the meal's.
      const at = blobs[0] ? await photoTakenAt(blobs[0]) : null;
      if (at?.source === "exif" && Math.abs(fromLocal(at.date, at.time).getTime() - Date.now()) >= 30 * 60_000) {
        setDate(at.date);
        setTime(at.time);
        setSlot(slotForTime(ctx.slots, at.time));
        toast(`Hora tomada de la foto: ${dayLabel(at.date, ctx.today)}, ${at.time}`);
      }
      setImages(await Promise.all(blobs.map((b) => fileToJpeg(b))));
      setMode("photo");
    })();
  }, [sharedImages, ctx.slots, ctx.today]);

  /** Photo taken at another time than the form says (e.g. eaten out, logged later): use its time. */
  const adoptPhotoTime = async (file: File) => {
    const at = await photoTakenAt(file);
    if (!at) return;
    const delta = Math.abs(fromLocal(at.date, at.time).getTime() - fromLocal(date, time).getTime());
    if (delta < 30 * 60_000) return;
    setDate(at.date);
    setTime(at.time);
    setSlot(slotForTime(ctx.slots, at.time));
    toast(`Hora tomada de la foto: ${dayLabel(at.date, ctx.today)}, ${at.time}`, { description: "Cámbiala abajo si no es la de la comida." });
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    if (!images.length && files[0]) await adoptPhotoTime(files[0]);
    const next = await Promise.all([...files].slice(0, 6 - images.length).map((f) => fileToJpeg(f)));
    setImages((xs) => [...xs, ...next].slice(0, 6));
    setMode("photo");
  };

  const analyze = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/ai/meal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personId: ctx.personId, text: text.trim() || undefined, images: images.length ? images.map(({ mediaType, data }) => ({ mediaType, data })) : undefined, mode: images.length ? "photo" : mode, mealSlot: slot, date, time }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Error de la IA");
      const e = d as Estimate;
      setEst(e);
      if (e.mealSlot && ctx.slots.some((s) => s.key === e.mealSlot) && !params.get("comida")) setSlot(e.mealSlot);
      setRows(
        e.items.map((it, i) => ({
          key: `${i}`,
          name: it.match?.name ?? it.name,
          grams: Math.round(it.grams),
          aiGrams: Math.round(it.grams),
          servingLabel: it.servingLabel ?? null,
          per100: it.grams > 0 ? scaleNutrients(it.nutrients, 10_000 / it.grams) : it.nutrients,
          foodId: it.match?.foodId ?? null,
          matchName: it.match ? [it.match.name, it.match.brand].filter(Boolean).join(" · ") : null,
          candidates: it.candidates,
          confidence: it.confidence,
          nova: it.nova ?? null,
          aiPer100: Object.fromEntries(it.per100.map((x) => [x.code, x.amount])),
        })),
      );
    } catch (e) {
      toast.error(errorText(e, "No se pudo analizar"));
    } finally {
      setBusy(false);
    }
  };

  const switchFood = async (key: string, foodId: string | null, rename = false) => {
    if (!foodId) return setRows((rs) => rs.map((r) => (r.key === key ? { ...r, foodId: null, matchName: null } : r)));
    const res = await fetch(`/api/foods/${foodId}?personId=${ctx.personId}`);
    if (!res.ok) return toast.error("No se pudo cargar el alimento");
    const d = await res.json();
    const f = d.food;
    const name = f.nameEs ?? f.name;
    setRows((rs) =>
      rs.map((r) =>
        r.key === key
          ? {
              ...r,
              ...(rename ? { name } : {}),
              foodId,
              matchName: [name, f.brand].filter(Boolean).join(" · "),
              // Keep the picked food in the dropdown so it can be chosen again after switching away.
              candidates: r.candidates.some((c) => c.foodId === foodId) ? r.candidates : [{ foodId, name, brand: f.brand, kcal: f.kcal }, ...r.candidates],
              per100: { ...missingFrom(f.nutrients, r.aiPer100), ...f.nutrients, energy_kcal: f.kcal ?? 0, protein: f.protein ?? 0, carbs: f.carbs ?? 0, fat: f.fat ?? 0, fiber: f.fiber ?? 0 },
            }
          : r,
      ),
    );
  };

  const itemNutrients = useMemo(() => rows.map((r) => scaleNutrients(r.per100, r.grams)), [rows]);
  const sum = useMemo(() => itemNutrients.reduce<NutrientMap>((a, m) => {
    for (const [k, v] of Object.entries(m)) a[k] = (a[k] ?? 0) + v;
    return a;
  }, {}), [itemNutrients]);

  const confirm = () =>
    start(async () => {
      if (!est || !rows.length) return;
      const origin = images.length ? "ai_photo" : mode === "voice" ? "ai_voice" : "ai_text";
      const eatenAt = fromLocal(date, time).toISOString();
      const res = await sendOrQueue<{ actionId?: string | null }>("/api/diary", {
        personId: ctx.personId,
        date,
        mealSlot: slot,
        origin,
        estimateId: est.estimateId,
        items: rows.map((r) => (r.foodId ? { foodId: r.foodId, grams: r.grams, servingLabel: r.servingLabel, fillPer100: r.aiPer100, nova: r.nova, eatenAt, clientId: newClientId() } : { name: r.name, grams: r.grams, per100: r.per100, servingLabel: r.servingLabel, nova: r.nova, eatenAt, clientId: newClientId() })),
      });
      const corrections = rows.filter((r) => r.servingLabel && Math.abs(r.grams - r.aiGrams) / Math.max(1, r.aiGrams) > 0.15).map((r) => ({ phrase: `${r.servingLabel} ${r.name}`, grams: r.grams, foodId: r.foodId }));
      if (corrections.length) void learnPortions(ctx.personId, corrections).catch(() => undefined);
      const actionId = res.data?.actionId;
      toast.success(res.queued ? "Guardado sin conexión" : `${rows.length} alimento(s) registrados`, {
        action: actionId
          ? {
              label: "Deshacer",
              onClick: async () => {
                await fetch("/api/ai/undo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actionId }) });
                toast("Registro deshecho");
                router.refresh();
              },
            }
          : undefined,
        duration: 8000,
      });
      if (res.queued) {
        // Offline: stay here (navigating would force a full reload onto the offline page).
        setEst(null);
        setRows([]);
        return;
      }
      router.push(date === ctx.today ? "/hoy" : `/diario?fecha=${date}`);
      router.refresh();
    });

  if (!aiEnabled) {
    return (
      <Card>
        <p className="text-ink-2">La IA no está disponible para esta persona (sin permiso de IA o sin configurar en el servidor). Puedes registrar desde <Link className="text-herb underline" href="/buscar">Buscar</Link>.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {!est ? (
        <Card className="space-y-4">
          <Field label="¿Qué has comido?" hint="Cuanto más concreto, mejor: cantidades, marcas, cómo estaba cocinado.">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Un plato de lentejas con chorizo, un trozo de pan y una naranja" rows={3} maxLength={2000} />
          </Field>
          {images.length ? (
            <ul className="flex flex-wrap gap-2">
              {images.map((im, i) => (
                <li key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.preview} alt={`Foto ${i + 1}`} className="size-20 rounded-xl object-cover" />
                  <button type="button" onClick={() => setImages((xs) => xs.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 rounded-full bg-ink p-0.5 text-paper" aria-label="Quitar foto">
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <VoiceInput
              autoStart={voice}
              onText={(t) => {
                setText(t);
                setMode("voice");
              }}
            />
            <Button type="button" variant="outline" size="lg" onClick={() => camRef.current?.click()}>
              <Camera /> Foto
            </Button>
            <Button type="button" variant="outline" size="lg" onClick={() => fileRef.current?.click()}>
              <ImagePlus /> Galería
            </Button>
            <Button type="button" variant="ghost" size="lg" asChild>
              <Link href="/buscar/nuevo?etiqueta=1">
                <ScanText /> Etiqueta
              </Link>
            </Button>
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void addFiles(e.target.files)} />
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void addFiles(e.target.files)} />
          </div>
          <WhenFields date={date} time={time} today={ctx.today} onDate={setDate} onTime={(t) => {
            setTime(t);
            if (t) setSlot(slotForTime(ctx.slots, t));
          }} />
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <Field label="Comida">
              <Select value={slot} onChange={(e) => setSlot(e.target.value)}>
                {ctx.slots.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button size="lg" variant="accent" onClick={analyze} disabled={busy || (!text.trim() && !images.length)}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ? "Analizando…" : "Analizar"}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {est.questions.length ? (
            <Card className="flex gap-3 bg-herb-soft/50">
              <HelpCircle className="mt-0.5 size-5 shrink-0 text-herb" />
              <div className="text-sm">
                <p className="font-medium">Para afinar:</p>
                <ul className="list-disc pl-4 text-ink-2">
                  {est.questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
                <button type="button" className="mt-1 text-herb underline" onClick={() => setEst(null)}>
                  Añadir detalles y volver a analizar
                </button>
              </div>
            </Card>
          ) : null}
          <ul className="space-y-2">
            {rows.map((r, i) => {
              const m = itemNutrients[i]!;
              return (
                <li key={r.key} className="rounded-card border border-line bg-card p-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{r.name}</p>
                      <p className={cn("text-xs", r.confidence < 0.5 ? "text-persimmon" : "text-ink-3")}>
                        {r.matchName ? `Base de datos: ${r.matchName}` : "Estimación de la IA"} · confianza {Math.round(r.confidence * 100)} %
                      </p>
                    </div>
                    <button type="button" className="rounded-full p-1.5 text-ink-3 hover:bg-paper-2" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Quitar ${r.name}`}>
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-[6rem_1fr_auto] gap-2">
                    <Input type="number" inputMode="decimal" min={0} value={r.grams} aria-label="Gramos" onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, grams: Number(e.target.value) } : x)))} />
                    <Select value={r.foodId ?? ""} onChange={(e) => void switchFood(r.key, e.target.value || null)} aria-label="Alimento de la base de datos">
                      <option value="">Usar estimación de la IA</option>
                      {r.candidates.map((c) => (
                        <option key={c.foodId} value={c.foodId}>
                          {c.name}
                          {c.brand ? ` · ${c.brand}` : ""} ({n0(c.kcal)} kcal/100 g)
                        </option>
                      ))}
                    </Select>
                    <Button type="button" variant={picking === r.key ? "soft" : "outline"} size="icon" className="size-11" aria-label={`Buscar otro alimento para ${r.name}`} onClick={() => setPicking((k) => (k === r.key ? null : r.key))}>
                      <Search />
                    </Button>
                  </div>
                  {picking === r.key ? (
                    <div className="mt-2">
                      <FoodPicker
                        personId={ctx.personId}
                        initialQuery={r.name}
                        onPick={(f) => {
                          setPicking(null);
                          void switchFood(r.key, f.id, true);
                        }}
                      />
                    </div>
                  ) : null}
                  <p className="num mt-2 text-xs text-ink-2">
                    {r.servingLabel ? `${r.servingLabel} · ` : ""}
                    {n0(m.energy_kcal)} kcal · P {n0(m.protein)} · H {n0(m.carbs)} · G {n0(m.fat)}
                  </p>
                </li>
              );
            })}
          </ul>
          {est.notes ? <p className="text-sm text-ink-2">{est.notes}</p> : null}
          {date === ctx.date ? <WhatIf ctx={ctx} item={sum} /> : null}
          <WhenFields date={date} time={time} today={ctx.today} onDate={setDate} onTime={setTime} />
          <div className="flex flex-wrap items-center gap-2">
            <Field label="Comida" className="min-w-40 flex-1">
              <Select value={slot} onChange={(e) => setSlot(e.target.value)}>
                {ctx.slots.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="ghost" size="lg" className="self-end" onClick={() => setEst(null)}>
              Volver
            </Button>
            <Button size="lg" className="self-end" onClick={confirm} disabled={saving || !rows.length}>
              {saving ? <Loader2 className="animate-spin" /> : null} Registrar {n0(sum.energy_kcal)} kcal
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

const dayLabel = (d: string, today: string) => {
  const diff = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`)) / 86_400_000);
  if (diff === 0) return "hoy";
  if (diff === 1) return "ayer";
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};

/** When it was eaten: entries go to that day and keep that time (for timing: caffeine, training…). */
function WhenFields({ date, time, today, onDate, onTime }: { date: string; time: string; today: string; onDate: (d: string) => void; onTime: (t: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Día">
        <Input type="date" value={date} max={today} onChange={(e) => e.target.value && onDate(e.target.value)} />
      </Field>
      <Field label="Hora">
        <Input type="time" value={time} onChange={(e) => onTime(e.target.value)} />
      </Field>
    </div>
  );
}

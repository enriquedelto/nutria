"use client";
import { errorText } from "@/lib/errors";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Camera, HelpCircle, ImagePlus, Loader2, Minus, Plus, ScanText, Search, Sparkles, Trash2, Wand2, X } from "lucide-react";
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
import { defaultEntryTime, fromLocal, localDateTime, slotForTime } from "@/lib/slots";
import { DraftList, saveAsPending, StartMeal, type Draft } from "./meal-drafts";
import type { PendingMeal } from "@/lib/meal-estimates";

type Estimate = {
  estimateId: string;
  mealSlot: string | null;
  notes: string | null;
  questions: string[];
  /** One-tap answers to the question. */
  answers?: string[];
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
    /** A likely add-on nobody mentioned (frying oil): offered, not counted until added. */
    optional?: boolean | null;
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
  /** Counted and saved (optional add-ons start out of the meal). */
  include: boolean;
};

const toRows = (e: Estimate): Row[] =>
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
    include: !it.optional,
  }));

/** Whole-plate size, relative to what the AI saw. */
const PLATE = [
  { f: 0.75, label: "¾" },
  { f: 1, label: "1" },
  { f: 1.25, label: "1¼" },
  { f: 1.5, label: "1½" },
];

export function RegisterClient({ ctx, aiEnabled, sharedImages, drafts, pending = [], voice = false }: { ctx: DayContext; aiEnabled: boolean; sharedImages: string[]; drafts: Draft[]; pending?: PendingMeal[]; voice?: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const [text, setText] = useState(params.get("texto") ?? "");
  const [mode, setMode] = useState<"text" | "voice" | "photo">("text");
  const [images, setImages] = useState<B64Image[]>([]);
  const [slot, setSlot] = useState(ctx.slot);
  // When it was eaten: today → now; another day → that meal's usual time. Photos can override it (EXIF).
  const [date, setDate] = useState(ctx.date);
  const [time, setTime] = useState(() => defaultEntryTime(ctx.date, ctx.today, ctx.slots.find((s) => s.key === ctx.slot)?.time, ctx.nowTime));
  const [est, setEst] = useState<Estimate | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  /** The meal draft being analysed (its entries take its day and start time; it is deleted on save). */
  const [draftId, setDraftId] = useState<string | null>(null);
  const [aiFailed, setAiFailed] = useState(false);
  const [parking, setParking] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  /** Plate size chip in use (grams already carry it). */
  const [factor, setFactor] = useState(1);
  const [correction, setCorrection] = useState("");
  const [refining, setRefining] = useState(false);
  /** The estimate left with «Volver»: a new analysis replaces it in «Seguir revisando». */
  const [prevEst, setPrevEst] = useState<string | null>(null);
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

  const runEstimate = async (body: Record<string, unknown>, fromDraft: boolean) => {
    setBusy(true);
    setAiFailed(false);
    try {
      const res = await fetch("/api/ai/meal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Error de la IA");
      const e = d as Estimate;
      setEst(e);
      if (!fromDraft && e.mealSlot && ctx.slots.some((s) => s.key === e.mealSlot) && !params.get("comida")) setSlot(e.mealSlot);
      setRows(toRows(e));
      setFactor(1);
      setPrevEst(null);
    } catch (e) {
      toast.error(errorText(e, "No se pudo analizar"));
      // No quota or no connection: the photos and the time can be kept for later.
      if (!fromDraft) setAiFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const analyze = () => {
    setDraftId(null);
    return runEstimate({ personId: ctx.personId, text: text.trim() || undefined, images: images.length ? images.map(({ mediaType, data }) => ({ mediaType, data })) : undefined, mode: images.length ? "photo" : mode, mealSlot: slot, date, time, supersedes: prevEst ?? undefined }, false);
  };

  const analyzeDraft = (d: Draft) => {
    const [dd, tt] = localDateTime(new Date(d.startedAt));
    setDate(dd);
    setTime(tt);
    if (d.mealSlot && ctx.slots.some((s) => s.key === d.mealSlot)) setSlot(d.mealSlot);
    setDraftId(d.id);
    return runEstimate({ personId: ctx.personId, draftId: d.id, text: text.trim() || undefined, mode: "photo", mealSlot: d.mealSlot ?? slot }, true);
  };

  /** Fix the list in words ("sin queso", "el doble de arroz"): the AI revises it without the photos. */
  const refine = async (what: string) => {
    if (!est || !what.trim()) return;
    setRefining(true);
    try {
      const res = await fetch("/api/ai/meal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          personId: ctx.personId,
          refineOf: est.estimateId,
          correction: what.trim(),
          items: rows.filter((r) => r.include).map((r) => ({ name: r.name, grams: r.grams, servingLabel: r.servingLabel, kcalPer100: r.per100.energy_kcal ?? null })),
          mealSlot: slot,
          date,
          time,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Error de la IA");
      setEst(d as Estimate);
      setRows(toRows(d as Estimate));
      setFactor(1);
      setCorrection("");
      toast.success("Corregido");
    } catch (e) {
      toast.error(errorText(e, "No se pudo corregir"));
    } finally {
      setRefining(false);
    }
  };

  /** Keep the review with the estimate so it can be resumed from «Seguir revisando». */
  const reviewState = useRef<{ id: string; body: string } | null>(null);
  useEffect(() => {
    reviewState.current = est ? { id: est.estimateId, body: JSON.stringify({ review: { rows, slot, date, time, factor } }) } : null;
  }, [est, rows, slot, date, time, factor]);
  const saveReview = (keepalive = false) => {
    const r = reviewState.current;
    if (!r) return Promise.resolve();
    return fetch(`/api/ai/estimates/${r.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: r.body, keepalive }).then(
      () => undefined,
      () => undefined,
    );
  };
  // Leaving the app mid-review (a call, the camera, another app) keeps it.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      const r = reviewState.current;
      if (r) void fetch(`/api/ai/estimates/${r.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: r.body, keepalive: true }).catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  const goBack = () => {
    void saveReview().then(() => router.refresh());
    setPrevEst(est?.estimateId ?? null);
    setEst(null);
  };

  const resume = (p: PendingMeal) => {
    const e = p.estimate as Estimate;
    setEst(e);
    setRows((p.review?.rows as Row[] | undefined) ?? toRows(e));
    setFactor(p.review?.factor ?? 1);
    const s = p.review?.slot ?? p.input.mealSlot;
    if (s && ctx.slots.some((x) => x.key === s)) setSlot(s);
    const d = p.review?.date ?? p.input.date;
    if (d) setDate(d);
    const t = p.review?.time ?? p.input.time;
    if (t) setTime(t);
    setPrevEst(null);
  };

  const discard = async (id: string) => {
    await fetch(`/api/ai/estimates/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ discard: true }) }).catch(() => undefined);
    router.refresh();
  };

  const scalePlate = (f: number) => {
    const ratio = f / factor;
    setRows((rs) => rs.map((r) => ({ ...r, grams: Math.max(0, Math.round(r.grams * ratio)) })));
    setFactor(f);
  };
  const nudge = (key: string, d: 1 | -1) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, grams: Math.max(0, Math.round(r.grams * (1 + d * 0.1))) } : r)));

  const parkForLater = async () => {
    setParking(true);
    try {
      await saveAsPending({ personId: ctx.personId, date, time, mealSlot: slot, text: text.trim(), images });
      toast.success("Guardada en pendientes: analízala cuando vuelva la IA");
      setImages([]);
      setText("");
      setAiFailed(false);
      router.refresh();
    } catch (e) {
      toast.error(errorText(e, "No se pudo guardar"));
    } finally {
      setParking(false);
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
  const sum = useMemo(() => itemNutrients.reduce<NutrientMap>((a, m, i) => {
    if (!rows[i]?.include) return a;
    for (const [k, v] of Object.entries(m)) a[k] = (a[k] ?? 0) + v;
    return a;
  }, {}), [itemNutrients, rows]);
  const included = rows.filter((r) => r.include);

  const confirm = () =>
    start(async () => {
      if (!est || !included.length) return;
      const origin = images.length ? "ai_photo" : mode === "voice" ? "ai_voice" : "ai_text";
      const eatenAt = fromLocal(date, time).toISOString();
      const res = await sendOrQueue<{ actionId?: string | null }>("/api/diary", {
        personId: ctx.personId,
        date,
        mealSlot: slot,
        origin,
        estimateId: est.estimateId,
        draftId,
        items: included.map((r) => (r.foodId ? { foodId: r.foodId, grams: r.grams, servingLabel: r.servingLabel, fillPer100: r.aiPer100, nova: r.nova, eatenAt, clientId: newClientId() } : { name: r.name, grams: r.grams, per100: r.per100, servingLabel: r.servingLabel, nova: r.nova, eatenAt, clientId: newClientId() })),
      });
      const corrections = included.filter((r) => r.servingLabel && Math.abs(r.grams - r.aiGrams) / Math.max(1, r.aiGrams) > 0.15).map((r) => ({ phrase: `${r.servingLabel} ${r.name}`, grams: r.grams, foodId: r.foodId }));
      if (corrections.length) void learnPortions(ctx.personId, corrections).catch(() => undefined);
      const actionId = res.data?.actionId;
      toast.success(res.queued ? "Guardado sin conexión" : `${included.length} alimento(s) registrados`, {
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
      setDraftId(null);
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
      {!est ? <PendingList pending={pending} slots={ctx.slots} onResume={resume} onDiscard={(id) => void discard(id)} /> : null}
      {!est ? <DraftList drafts={drafts} slots={ctx.slots} today={ctx.today} busyId={busy ? draftId : null} onAnalyze={(d) => void analyzeDraft(d)} /> : null}
      {!est ? <StartMeal personId={ctx.personId} slots={ctx.slots} /> : null}
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
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
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
          {aiFailed && (images.length || text.trim()) ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper-2 px-3 py-2 text-sm">
              <span className="text-ink-2">Guarda las fotos, la nota y la hora y analízala más tarde.</span>
              <Button type="button" size="sm" variant="outline" disabled={parking} onClick={() => void parkForLater()}>
                {parking ? <Loader2 className="animate-spin" /> : null} Guardar para más tarde
              </Button>
            </div>
          ) : null}
        </Card>
      ) : (
        <>
          {est.questions[0] ? (
            <Card className="flex gap-3 bg-herb-soft/50">
              <HelpCircle className="mt-0.5 size-5 shrink-0 text-herb" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">{est.questions[0]}</p>
                {est.answers?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {est.answers.map((a) => (
                      <Button key={a} type="button" size="sm" variant="outline" disabled={refining} onClick={() => void refine(`${est.questions[0]} ${a}`)}>
                        {a}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-ink-2">Respóndelo abajo, en «Corregir».</p>
                )}
              </div>
            </Card>
          ) : null}
          <div className="flex items-center gap-2" role="group" aria-label="Tamaño del plato">
            <span className="text-sm text-ink-2">Tamaño del plato</span>
            {PLATE.map((p) => (
              <button key={p.f} type="button" aria-pressed={factor === p.f} onClick={() => scalePlate(p.f)} className={cn("num min-w-11 rounded-full border px-3 py-1.5 text-sm", factor === p.f ? "border-herb bg-herb-soft font-semibold text-herb" : "border-line hover:bg-paper-2")} aria-label={`Plato ×${p.f}`}>
                {p.label}
              </button>
            ))}
          </div>
          <ul className={cn("space-y-2", refining && "opacity-60")}>
            {rows.map((r, i) => {
              const m = itemNutrients[i]!;
              if (!r.include)
                return (
                  <li key={r.key} className="flex items-center gap-3 rounded-card border border-dashed border-line px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 text-ink-2">
                      ¿Sumar <span className="font-medium text-ink">{r.name}</span>? <span className="num">{r.servingLabel ? `${r.servingLabel} · ` : ""}{n0(r.grams)} g · {n0(m.energy_kcal)} kcal</span>
                    </span>
                    <Button type="button" size="sm" variant="outline" onClick={() => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, include: true } : x)))} aria-label={`Sumar ${r.name}`}>
                      <Plus /> Sumar
                    </Button>
                  </li>
                );
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
                  <div className="mt-2 flex items-center gap-1.5">
                    <Button type="button" variant="outline" size="icon" className="size-11 shrink-0" aria-label={`Menos ${r.name}`} onClick={() => nudge(r.key, -1)}>
                      <Minus />
                    </Button>
                    <Input type="number" inputMode="decimal" min={0} value={r.grams} aria-label="Gramos" className="w-20 text-center" onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, grams: Number(e.target.value) } : x)))} />
                    <Button type="button" variant="outline" size="icon" className="size-11 shrink-0" aria-label={`Más ${r.name}`} onClick={() => nudge(r.key, 1)}>
                      <Plus />
                    </Button>
                    <span className="text-sm text-ink-3">g</span>
                  </div>
                  <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
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
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void refine(correction);
            }}
          >
            <Field label="Corregir" hint="Dilo con tus palabras: «sin queso», «el doble de arroz», «era media ración». No vuelve a mirar las fotos.">
              <Input value={correction} onChange={(e) => setCorrection(e.target.value)} maxLength={500} placeholder="El doble de arroz y sin pan" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <VoiceInput onText={(t, final) => (final ? void refine(t) : setCorrection(t))} />
              <Button type="submit" variant="outline" size="lg" disabled={refining || correction.trim().length < 2}>
                {refining ? <Loader2 className="animate-spin" /> : <Wand2 />} {refining ? "Corrigiendo…" : "Corregir"}
              </Button>
            </div>
          </form>
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
            <Button variant="ghost" size="lg" className="self-end" onClick={goBack}>
              Volver
            </Button>
            <Button size="lg" className="self-end" onClick={confirm} disabled={saving || refining || !included.length}>
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

/** Analysed meals not saved yet: resume the review where it was left, or discard it. */
function PendingList({ pending, slots, onResume, onDiscard }: { pending: PendingMeal[]; slots: { key: string; label: string }[]; onResume: (p: PendingMeal) => void; onDiscard: (id: string) => void }) {
  if (!pending.length) return null;
  return (
    <Card className="space-y-2">
      <p className="font-display text-lg font-semibold">Seguir revisando</p>
      <ul className="space-y-2">
        {pending.map((p) => {
          const rows = (p.review?.rows ?? (p.estimate.items as { name: string; match?: { name: string } | null }[]).map((i) => ({ name: i.match?.name ?? i.name, include: true }))) as { name?: unknown; include?: unknown }[];
          const names = rows.filter((r) => r.include !== false).map((r) => String(r.name ?? "")).filter(Boolean);
          const slot = slots.find((s) => s.key === (p.review?.slot ?? p.input.mealSlot))?.label ?? "Comida";
          const mins = p.minutesAgo;
          const ago = mins < 60 ? `hace ${mins} min` : `hace ${Math.round(mins / 60)} h`;
          return (
            <li key={p.id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{names.join(", ") || "Comida analizada"}</p>
                <p className="text-xs text-ink-3">
                  {slot} · {ago}
                </p>
              </div>
              <Button type="button" size="sm" onClick={() => onResume(p)}>
                Seguir
              </Button>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Descartar ${names[0] ?? "comida analizada"}`} onClick={() => onDiscard(p.id)}>
                <X />
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

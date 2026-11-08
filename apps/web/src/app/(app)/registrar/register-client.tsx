"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Camera, HelpCircle, ImagePlus, Loader2, ScanText, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { scaleNutrients, type NutrientMap } from "@nutria/nutrition";
import { learnPortions } from "@/actions/ai";
import { WhatIf, type DayContext } from "@/components/food/add-food-dialog";
import { VoiceInput } from "@/components/voice-input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { fileToJpeg, type B64Image } from "@/lib/image";
import { n0 } from "@/lib/format";
import { newClientId, sendOrQueue } from "@/lib/offline-queue";
import { cn } from "@/lib/utils";

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
};

export function RegisterClient({ ctx, aiEnabled, sharedImages }: { ctx: DayContext; aiEnabled: boolean; sharedImages: string[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const [text, setText] = useState(params.get("texto") ?? "");
  const [mode, setMode] = useState<"text" | "voice" | "photo">("text");
  const [images, setImages] = useState<B64Image[]>([]);
  const [slot, setSlot] = useState(ctx.slot);
  const [est, setEst] = useState<Estimate | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  // Photos shared from Android ("Compartir con Nutria").
  useEffect(() => {
    if (!sharedImages.length) return;
    void (async () => {
      const imgs = await Promise.all(sharedImages.map(async (u) => fileToJpeg(await (await fetch(u)).blob())));
      setImages(imgs);
      setMode("photo");
    })();
  }, [sharedImages]);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
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
        body: JSON.stringify({ personId: ctx.personId, text: text.trim() || undefined, images: images.length ? images.map(({ mediaType, data }) => ({ mediaType, data })) : undefined, mode: images.length ? "photo" : mode, mealSlot: slot, date: ctx.date }),
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
        })),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo analizar");
    } finally {
      setBusy(false);
    }
  };

  const switchFood = async (key: string, foodId: string | null) => {
    if (!foodId) return setRows((rs) => rs.map((r) => (r.key === key ? { ...r, foodId: null, matchName: null } : r)));
    const res = await fetch(`/api/foods/${foodId}?personId=${ctx.personId}`);
    if (!res.ok) return toast.error("No se pudo cargar el alimento");
    const d = await res.json();
    const f = d.food;
    setRows((rs) =>
      rs.map((r) =>
        r.key === key ? { ...r, foodId, matchName: [f.nameEs ?? f.name, f.brand].filter(Boolean).join(" · "), per100: { ...f.nutrients, energy_kcal: f.kcal ?? 0, protein: f.protein ?? 0, carbs: f.carbs ?? 0, fat: f.fat ?? 0, fiber: f.fiber ?? 0 } } : r,
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
      const res = await sendOrQueue<{ actionId?: string | null }>("/api/diary", {
        personId: ctx.personId,
        date: ctx.date,
        mealSlot: slot,
        origin,
        estimateId: est.estimateId,
        items: rows.map((r) => (r.foodId ? { foodId: r.foodId, grams: r.grams, servingLabel: r.servingLabel, clientId: newClientId() } : { name: r.name, grams: r.grams, per100: r.per100, servingLabel: r.servingLabel, clientId: newClientId() })),
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
      router.push(`/hoy`);
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
                  <div className="mt-2 grid grid-cols-[6rem_1fr] gap-2">
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
                  </div>
                  <p className="num mt-2 text-xs text-ink-2">
                    {r.servingLabel ? `${r.servingLabel} · ` : ""}
                    {n0(m.energy_kcal)} kcal · P {n0(m.protein)} · H {n0(m.carbs)} · G {n0(m.fat)}
                  </p>
                </li>
              );
            })}
          </ul>
          {est.notes ? <p className="text-sm text-ink-2">{est.notes}</p> : null}
          <WhatIf ctx={ctx} item={sum} />
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

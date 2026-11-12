"use client";
import { errorText } from "@/lib/errors";
import { useEffect, useMemo, useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import Link from "next/link";
import { AlertTriangle, ChevronRight, Heart, Info, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { scaleNutrients, type NutrientMap } from "@nutria/nutrition";
import { toggleFavorite } from "@/actions/diary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Bar } from "@/components/ui/progress";
import { n0, nutrient, nutrientName } from "@/lib/format";
import { newClientId, sendOrQueue } from "@/lib/offline-queue";
import { cn } from "@/lib/utils";
import type { FoodBrief } from "@/lib/data/foods";

export type DayContext = {
  personId: string;
  date: string;
  slot: string;
  slots: { key: string; label: string }[];
  totals: { kcal: number; protein: number; carbs: number; fat: number };
  target: { kcal: number; protein: number; carbs: number; fat: number } | null;
  favoriteIds: string[];
};

type Detail = {
  food: { id: string; name: string; nameEs: string | null; brand: string | null; imageUrl: string | null; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null; fiber: number | null; nutrients: NutrientMap; nutriscore: string | null; nova: number | null; quantityLabel: string | null; ingredientsText: string | null };
  servings: { id: string; label: string; grams: number }[];
  additives: { code: string; name: string; risk: string | null; descriptionEs: string | null }[];
  alerts: { level: "info" | "caution" | "avoid"; message: string; kind: string }[];
  alternatives: FoodBrief[];
};

const NUTRISCORE_COLORS: Record<string, string> = { a: "#038141", b: "#85bb2f", c: "#fecb02", d: "#ee8100", e: "#e63e11" };
const NOVA_TEXT: Record<number, string> = { 1: "Sin procesar", 2: "Ingrediente culinario", 3: "Procesado", 4: "Ultraprocesado" };

export function NutriBadges({ nutriscore, nova }: { nutriscore: string | null; nova: number | null }) {
  return (
    <span className="inline-flex items-center gap-1">
      {nutriscore && NUTRISCORE_COLORS[nutriscore] ? (
        <span className="rounded px-1.5 text-xs font-bold uppercase text-white" style={{ background: NUTRISCORE_COLORS[nutriscore] }} title="Nutri-Score">
          {nutriscore}
        </span>
      ) : null}
      {nova ? (
        <span className={cn("rounded px-1.5 text-xs font-semibold", nova === 4 ? "bg-persimmon-soft text-persimmon" : "bg-paper-2 text-ink-2")} title={NOVA_TEXT[nova]}>
          NOVA {nova}
        </span>
      ) : null}
    </span>
  );
}

export function AddFoodDialog({ foodId, ctx, defaultGrams, onClose, onAdded }: { foodId: string; ctx: DayContext; defaultGrams?: number; onClose: () => void; onAdded?: () => void }) {
  const [currentId, setCurrentId] = useState(foodId);
  // Keyed by food id so switching to an alternative shows the spinner without resetting state in the effect.
  const [loaded, setLoaded] = useState<{ id: string; detail: Detail } | null>(null);
  const detail = loaded?.id === currentId ? loaded.detail : null;
  const [error, setError] = useState<string | null>(null);
  const [serving, setServing] = useState<string>("g");
  const [qty, setQty] = useState<number>(defaultGrams ?? 100);
  const [slot, setSlot] = useState(ctx.slot);
  const [fav, setFav] = useState(ctx.favoriteIds.includes(foodId));
  const [pending, start] = useSafeTransition();

  useEffect(() => {
    let alive = true;
    fetch(`/api/foods/${currentId}?personId=${ctx.personId}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error))))
      .then((d: Detail) => {
        if (!alive) return;
        setLoaded({ id: currentId, detail: d });
        const def = d.servings[0];
        if (def && !defaultGrams) {
          setServing(def.id);
          setQty(1);
        }
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [currentId, ctx.personId, defaultGrams]);

  const sv = detail?.servings.find((s) => s.id === serving);
  const grams = sv ? sv.grams * qty : qty;
  const per100 = useMemo<NutrientMap>(
    () => (detail ? { ...detail.food.nutrients, energy_kcal: detail.food.kcal ?? 0, protein: detail.food.protein ?? 0, carbs: detail.food.carbs ?? 0, fat: detail.food.fat ?? 0, fiber: detail.food.fiber ?? 0 } : {}),
    [detail],
  );
  const item = useMemo(() => scaleNutrients(per100, grams), [per100, grams]);
  const highlights = useMemo(
    () =>
      Object.entries(item)
        .filter(([c]) => !["energy_kcal", "energy_kj", "protein", "carbs", "fat", "fiber", "sugars", "sat_fat", "salt", "sodium"].includes(c))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6),
    [item],
  );

  const add = () =>
    start(async () => {
      if (!detail || grams <= 0) return;
      try {
        const res = await sendOrQueue("/api/diary", {
          personId: ctx.personId,
          date: ctx.date,
          mealSlot: slot,
          origin: "manual",
          items: [{ foodId: detail.food.id, grams, servingLabel: sv ? `${qty} × ${sv.label}` : null, servingQty: sv ? qty : null, clientId: newClientId() }],
        });
        toast.success(res.queued ? "Guardado sin conexión; se enviará luego" : `${detail.food.nameEs ?? detail.food.name} añadido`);
        // Queued (offline): nothing changed on the server yet, and a refresh would force a full reload.
        if (!res.queued) onAdded?.();
        onClose();
      } catch (e) {
        toast.error(errorText(e, "No se pudo añadir"));
      }
    });

  const name = detail ? (detail.food.nameEs ?? detail.food.name) : "Cargando…";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={name} description={detail ? [detail.food.brand, detail.food.quantityLabel].filter(Boolean).join(" · ") || undefined : undefined}>
        {error ? <p className="text-danger">{error}</p> : null}
        {!detail && !error ? (
          <div className="grid h-40 place-items-center text-ink-3">
            <Loader2 className="animate-spin" />
          </div>
        ) : null}
        {detail ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              {detail.food.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={detail.food.imageUrl} alt="" className="size-16 rounded-xl border border-line bg-white object-contain" loading="lazy" />
              ) : null}
              <div className="flex-1 space-y-1">
                <NutriBadges nutriscore={detail.food.nutriscore} nova={detail.food.nova} />
                <p className="num text-sm text-ink-2">
                  Por 100 g: {n0(detail.food.kcal)} kcal · P {n0(detail.food.protein)} · H {n0(detail.food.carbs)} · G {n0(detail.food.fat)}
                </p>
                <Link href={`/alimentos/${detail.food.id}`} className="inline-flex items-center text-sm font-medium text-herb">
                  Ficha completa <ChevronRight className="size-4" />
                </Link>
              </div>
              <button
                type="button"
                aria-pressed={fav}
                aria-label="Favorito"
                className="rounded-full p-2 hover:bg-paper-2"
                onClick={() => start(async () => setFav(await toggleFavorite(ctx.personId, detail.food.id)))}
              >
                <Heart className={cn("size-5", fav ? "fill-persimmon text-persimmon" : "text-ink-3")} />
              </button>
            </div>

            {detail.alerts.length ? (
              <ul className="space-y-1.5">
                {detail.alerts.map((a, i) => (
                  <li key={i} className={cn("flex gap-2 rounded-xl px-3 py-2 text-sm", a.level === "avoid" ? "bg-danger/10 text-danger" : a.level === "caution" ? "bg-warn/20" : "bg-paper-2")}>
                    {a.level === "avoid" ? <ShieldAlert className="mt-0.5 size-4 shrink-0" /> : a.level === "caution" ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
                    <span>
                      <span className="font-medium capitalize">{a.kind}:</span> {a.message}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="grid grid-cols-[1fr_1.4fr] gap-3">
              <Field label="Cantidad">
                <Input type="number" inputMode="decimal" min={0} step="any" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
              </Field>
              <Field label="Unidad">
                <Select value={serving} onChange={(e) => {
                  const next = e.target.value;
                  const s = detail.servings.find((x) => x.id === next);
                  setQty(s ? 1 : Math.round(grams));
                  setServing(next);
                }}>
                  <option value="g">gramos</option>
                  {detail.servings.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} ({n0(s.grams)} g)
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Comida">
              <Select value={slot} onChange={(e) => setSlot(e.target.value)}>
                {ctx.slots.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>

            <WhatIf ctx={ctx} item={item} />

            {highlights.length ? (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-3">Destaca en micronutrientes</p>
                <p className="text-sm text-ink-2">{highlights.map(([c, v]) => `${nutrientName(c)} ${nutrient(c, v)}`).join(" · ")}</p>
              </div>
            ) : null}

            {detail.additives.length ? (
              <details className="rounded-xl bg-paper-2 px-3 py-2 text-sm">
                <summary className="cursor-pointer font-medium">{detail.additives.length} aditivo(s)</summary>
                <ul className="mt-2 space-y-1">
                  {detail.additives.map((a) => (
                    <li key={a.code}>
                      <span className="font-medium uppercase">{a.code.replace("en:", "")}</span> {a.name}
                      {a.risk && a.risk !== "none" ? <Badge tone={a.risk === "high" ? "danger" : a.risk === "moderate" ? "warn" : "neutral"} className="ml-1">riesgo {a.risk === "high" ? "alto" : a.risk === "moderate" ? "moderado" : "bajo"}</Badge> : null}
                      {a.descriptionEs ? <span className="block text-xs text-ink-3">{a.descriptionEs}</span> : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {detail.alternatives.length ? (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-3">Alternativas más sanas</p>
                <ul className="flex gap-2 overflow-x-auto pb-1">
                  {detail.alternatives.map((a) => (
                    <li key={a.id}>
                      <button type="button" onClick={() => setCurrentId(a.id)} className="w-36 shrink-0 rounded-xl border border-line p-2 text-left text-xs hover:bg-paper-2">
                        <span className="line-clamp-2 font-medium">{a.name}</span>
                        <span className="mt-1 flex items-center justify-between">
                          <NutriBadges nutriscore={a.nutriscore} nova={a.nova} />
                          <span className="num text-ink-3">{n0(a.kcal)} kcal</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Button size="lg" className="w-full" onClick={add} disabled={pending || grams <= 0}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Añadir {n0(grams)} g · {n0(item.energy_kcal)} kcal
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** "What if?": how the day looks against the targets if this item is added. */
export function WhatIf({ ctx, item }: { ctx: DayContext; item: NutrientMap }) {
  if (!ctx.target) return null;
  const rows = [
    { k: "kcal", label: "kcal", now: ctx.totals.kcal, add: item.energy_kcal ?? 0, t: ctx.target.kcal, color: "var(--kcal)" },
    { k: "protein", label: "Proteína", now: ctx.totals.protein, add: item.protein ?? 0, t: ctx.target.protein, color: "var(--protein)" },
    { k: "carbs", label: "Hidratos", now: ctx.totals.carbs, add: item.carbs ?? 0, t: ctx.target.carbs, color: "var(--carbs)" },
    { k: "fat", label: "Grasa", now: ctx.totals.fat, add: item.fat ?? 0, t: ctx.target.fat, color: "var(--fat)" },
  ];
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">¿Y si lo añado?</p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.k} className="grid grid-cols-[5rem_1fr_6.5rem] items-center gap-2 text-sm">
            <span className="text-ink-2">{r.label}</span>
            <Bar value={r.now + r.add} max={r.t} color={r.color} label={r.label} />
            <span className={cn("num text-right", r.now + r.add > r.t * 1.05 ? "text-persimmon" : "text-ink-2")}>
              {n0(r.now + r.add)} / {n0(r.t)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

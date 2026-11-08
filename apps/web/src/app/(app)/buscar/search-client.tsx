"use client";
import { submitForm } from "@/lib/forms";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Barcode, Loader2, Plus, Search, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import { AddFoodDialog, NutriBadges, type DayContext } from "@/components/food/add-food-dialog";
import { Scanner } from "@/components/food/scanner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Field, Input, Select } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { n0 } from "@/lib/format";
import { newClientId, sendOrQueue } from "@/lib/offline-queue";
import type { FoodBrief } from "@/lib/data/foods";

type Listed = FoodBrief & { lastGrams?: number };

export function SearchClient({ ctx, lists }: { ctx: DayContext; lists: { recent: Listed[]; frequent: Listed[]; favorites: Listed[] } }) {
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<FoodBrief[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<{ id: string; grams?: number } | null>(() => (params.get("abrir") ? { id: params.get("abrir")! } : null));
  const [scan, setScan] = useState(params.get("escanear") === "1");
  const [quick, setQuick] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const search = useCallback(
    async (text: string) => {
      abort.current?.abort();
      if (text.trim().length < 2) return setResults(null);
      const ac = (abort.current = new AbortController());
      setLoading(true);
      try {
        const r = await fetch(`/api/foods?personId=${ctx.personId}&q=${encodeURIComponent(text)}`, { signal: ac.signal });
        const d = (await r.json()) as { items: FoodBrief[] };
        setResults(d.items);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setResults([]);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    [ctx.personId],
  );

  useEffect(() => {
    const t = setTimeout(() => void search(q), 220);
    return () => clearTimeout(t);
  }, [q, search]);

  const byBarcode = useCallback(
    async (code: string) => {
      setScan(false);
      const t = toast.loading("Buscando producto…");
      try {
        const r = await fetch(`/api/foods/barcode/${code}?personId=${ctx.personId}`);
        const d = await r.json();
        toast.dismiss(t);
        if (!r.ok || !d.found) return setNotFound(code);
        setOpen({ id: d.food.id });
      } catch {
        toast.dismiss(t);
        toast.error("Sin conexión: no se pudo buscar el código");
      }
    },
    [ctx.personId],
  );

  const row = (f: Listed) => (
    <li key={f.id}>
      <button type="button" onClick={() => setOpen({ id: f.id, grams: f.lastGrams })} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-paper-2">
        {f.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={f.imageUrl} alt="" className="size-10 shrink-0 rounded-lg border border-line bg-white object-contain" loading="lazy" />
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-paper-2 text-xs font-semibold uppercase text-ink-3">{f.source === "ciqual" ? "gen" : f.source.slice(0, 3)}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{f.name}</span>
          <span className="flex items-center gap-2 truncate text-xs text-ink-3">
            {f.brand ? <span className="truncate">{f.brand}</span> : null}
            <NutriBadges nutriscore={f.nutriscore} nova={f.nova} />
          </span>
        </span>
        <span className="num text-right text-sm">
          <span className="block font-medium">{n0(f.kcal)}</span>
          <span className="text-[11px] text-ink-3">{f.lastGrams ? `${n0(f.lastGrams)} g` : "kcal/100 g"}</span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const digits = q.replace(/\s/g, "");
          if (/^\d{6,14}$/.test(digits)) void byBarcode(digits); // USB scanners type digits + Enter
          else void search(q);
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar alimento, marca o código" className="pl-9" enterKeyHint="search" aria-label="Buscar alimento" />
          {loading ? <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-3" /> : null}
        </div>
        <Button type="button" size="icon" variant="outline" onClick={() => setScan(true)} aria-label="Escanear código">
          <Barcode />
        </Button>
      </form>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="soft" asChild>
          <Link href={`/registrar?comida=${ctx.slot}&fecha=${ctx.date}`}>
            <Sparkles /> Describir con IA
          </Link>
        </Button>
        <Button size="sm" variant="outline" onClick={() => setQuick(true)}>
          <Zap /> Registro rápido
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link href="/buscar/nuevo">
            <Plus /> Crear alimento
          </Link>
        </Button>
      </div>

      {results ? (
        results.length ? (
          <ul className="rounded-card border border-line bg-card p-1">{results.map(row)}</ul>
        ) : (
          <Empty title="Sin resultados">
            Prueba otra palabra, escanea el código o <Link className="text-herb underline" href={`/registrar?texto=${encodeURIComponent(q)}&comida=${ctx.slot}&fecha=${ctx.date}`}>descríbelo a la IA</Link>.
          </Empty>
        )
      ) : (
        <Tabs defaultValue={lists.recent.length ? "recientes" : "favoritos"}>
          <TabsList>
            <TabsTrigger value="recientes">Recientes</TabsTrigger>
            <TabsTrigger value="frecuentes">Frecuentes</TabsTrigger>
            <TabsTrigger value="favoritos">Favoritos</TabsTrigger>
          </TabsList>
          {(["recientes", "frecuentes", "favoritos"] as const).map((k) => {
            const list = k === "recientes" ? lists.recent : k === "frecuentes" ? lists.frequent : lists.favorites;
            return (
              <TabsContent key={k} value={k} className="mt-3">
                {list.length ? <ul className="rounded-card border border-line bg-card p-1">{list.map(row)}</ul> : <Empty title="Aún no hay nada aquí">Lo que registres aparecerá en esta lista.</Empty>}
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      <Scanner open={scan} onClose={() => setScan(false)} onCode={byBarcode} />
      {open ? <AddFoodDialog foodId={open.id} defaultGrams={open.grams} ctx={ctx} onClose={() => setOpen(null)} onAdded={() => router.refresh()} /> : null}
      {quick ? <QuickAdd ctx={ctx} onClose={() => setQuick(false)} /> : null}
      {notFound ? (
        <Dialog open onOpenChange={() => setNotFound(null)}>
          <DialogContent title="Producto no encontrado" description={`El código ${notFound} no está en Open Food Facts.`}>
            <div className="flex flex-col gap-2">
              <Button asChild>
                <Link href={`/buscar/nuevo?barcode=${notFound}&etiqueta=1`}>Fotografiar la etiqueta</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/buscar/nuevo?barcode=${notFound}`}>Crear a mano</Link>
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function QuickAdd({ ctx, onClose }: { ctx: DayContext; onClose: () => void }) {
  const [pending, start] = useSafeTransition();
  const router = useRouter();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Registro rápido" description="Solo calorías y macros, sin buscar el alimento.">
        <form
          className="space-y-3"
          onSubmit={submitForm((fd) =>
            start(async () => {
              const num = (k: string) => Number(fd.get(k) || 0);
              await sendOrQueue("/api/diary", {
                personId: ctx.personId,
                date: ctx.date,
                mealSlot: String(fd.get("slot")),
                origin: "quick",
                items: [{ name: String(fd.get("name") || "Registro rápido"), grams: 0, absolute: { energy_kcal: num("kcal"), protein: num("p"), carbs: num("c"), fat: num("f") }, clientId: newClientId() }],
              });
              toast.success("Añadido");
              router.refresh();
              onClose();
            })
          )}
        >
          <Field label="Descripción">
            <Input name="name" placeholder="p. ej. Menú del día" maxLength={120} />
          </Field>
          <div className="grid grid-cols-4 gap-2">
            <Field label="kcal">
              <Input name="kcal" type="number" inputMode="numeric" min={0} required />
            </Field>
            <Field label="Prot.">
              <Input name="p" type="number" inputMode="decimal" min={0} step="any" />
            </Field>
            <Field label="Hidr.">
              <Input name="c" type="number" inputMode="decimal" min={0} step="any" />
            </Field>
            <Field label="Grasa">
              <Input name="f" type="number" inputMode="decimal" min={0} step="any" />
            </Field>
          </div>
          <Field label="Comida">
            <Select name="slot" defaultValue={ctx.slot}>
              {ctx.slots.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" className="w-full" disabled={pending}>
            Añadir
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

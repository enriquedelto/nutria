"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Apple, Baby, Bean, Beef, Carrot, Cookie, CookingPot, CupSoda, Droplet, Dumbbell, Egg, Fish, FlaskRound, Ham, Loader2, Milk, Nut, Package, Pizza, Popcorn, Salad, SlidersHorizontal, Soup, Sprout, Wheat, Wine,
  type LucideIcon,
} from "lucide-react";
import { FOOD_GROUP_BY_KEY, FOOD_GROUPS } from "@nutria/nutrition";
import { NutriBadges } from "@/components/food/add-food-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Field, Input, Select } from "@/components/ui/input";
import { n0 } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = { Apple, Baby, Bean, Beef, Carrot, Cookie, CookingPot, CupSoda, Droplet, Dumbbell, Egg, Fish, FlaskRound, Ham, Milk, Nut, Package, Pizza, Popcorn, Salad, Soup, Sprout, Wheat, Wine };

export type ExploreItem = {
  id: string;
  name: string;
  brand: string | null;
  source: string;
  foodGroup: string | null;
  imageUrl: string | null;
  quantityLabel: string | null;
  kcal: number | null;
  protein: number | null;
  nutriscore: string | null;
  nova: number | null;
  price: number | null;
  pricePerKg: number | null;
};

const SORTS = [
  ["popularity", "Más populares"],
  ["relevance", "Relevancia"],
  ["protein_density", "Proteína por kcal"],
  ["protein_price", "Proteína por euro"],
  ["kcal_asc", "Menos kcal"],
  ["kcal_desc", "Más kcal"],
  ["price_kg", "Más barato (€/kg)"],
  ["nutriscore", "Mejor Nutri-Score"],
] as const;
const ORIGINS = [
  ["", "Todo con nutrientes"],
  ["generic", "Genéricos"],
  ["brand", "De marca"],
  ["store", "Supermercado (precios)"],
  ["mine", "Míos"],
] as const;
/** Advanced filters (in the dialog); the quick toggles live outside it. */
const ADVANCED = ["kmin", "kmax", "pmin", "pocoazucar", "pocasal", "ns", "nova", "vegano", "singluten"];
const KEYS = ["grupo", "origen", "orden", "altoprot", "sinalergenos", "precio", ...ADVANCED];

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

export function Explore({ personId, q, hasAllergens, onOpen }: { personId: string; q: string; hasAllergens: boolean; onOpen: (id: string) => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState<ExploreItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState(false);

  // Filter state lives in the URL (shareable, survives back navigation).
  const query = useMemo(() => {
    const sp = new URLSearchParams();
    for (const k of KEYS) {
      const v = params.get(k);
      if (v) sp.set(k, v);
    }
    if (q.trim().length >= 2) sp.set("q", q.trim());
    return sp.toString();
  }, [params, q]);

  // Several quick taps before the URL updates must not drop each other: start from the last one sent.
  // A URL of ours that lands late (a newer one already sent) must not roll the state back;
  // anything else (back button, a link) is adopted.
  const latest = useRef(params.toString());
  const inFlight = useRef<string[]>([]);
  useEffect(() => {
    const cur = params.toString();
    const i = inFlight.current.indexOf(cur);
    if (i >= 0) {
      inFlight.current = inFlight.current.slice(i + 1);
      if (inFlight.current.length) return;
    } else inFlight.current = [];
    latest.current = cur;
  }, [params]);
  const set = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(latest.current);
    for (const [k, v] of Object.entries(patch)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    sp.set("ver", "explorar");
    latest.current = sp.toString();
    inFlight.current.push(latest.current);
    router.replace(`${pathname}?${sp}`, { scroll: false });
  };
  const toggle = (k: string) => set({ [k]: new URLSearchParams(latest.current).get(k) === "1" ? null : "1" });

  const load = async (from: number, signal?: AbortSignal) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/foods/explore?personId=${personId}&${query}${from ? `&desde=${from}` : ""}`, { signal });
      if (!r.ok) throw new Error();
      const d = (await r.json()) as { items: ExploreItem[]; more: boolean };
      setItems((cur) => (from ? [...(cur ?? []), ...d.items] : d.items));
      setMore(d.more);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setItems((cur) => cur ?? []);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const ac = new AbortController();
    const t = setTimeout(() => void load(0, ac.signal), 200);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, personId]);

  const group = params.get("grupo") ?? "";
  const origin = params.get("origen") ?? "";
  const sort = params.get("orden") ?? (q.trim().length >= 2 ? "relevance" : "popularity");
  const advancedCount = ADVANCED.filter((k) => params.get(k)).length;
  const quick = [
    { k: "altoprot", label: "Alto en proteína" },
    ...(hasAllergens ? [{ k: "sinalergenos", label: "Sin mis alérgenos" }] : []),
    { k: "precio", label: "Con precio" },
  ];

  return (
    <div className="space-y-3">
      <ul className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Grupos de alimentos">
        <li>
          <Chip active={!group} onClick={() => set({ grupo: null })}>
            Todo
          </Chip>
        </li>
        {FOOD_GROUPS.map((g) => {
          const Icon = ICONS[g.icon] ?? Package;
          return (
            <li key={g.key}>
              <Chip active={group === g.key} onClick={() => set({ grupo: group === g.key ? null : g.key })}>
                <Icon className="size-4" aria-hidden /> {g.name}
              </Chip>
            </li>
          );
        })}
      </ul>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
        <Select aria-label="Origen" value={origin} onChange={(e) => set({ origen: e.target.value || null })}>
          {ORIGINS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select aria-label="Ordenar por" value={sort} onChange={(e) => set({ orden: e.target.value })}>
          {SORTS.filter(([v]) => v !== "relevance" || q.trim().length >= 2).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Button variant="outline" size="md" onClick={() => setFilters(true)} aria-label={`Más filtros${advancedCount ? ` (${advancedCount} activos)` : ""}`}>
          <SlidersHorizontal />
          {advancedCount ? <span className="num">{advancedCount}</span> : <span className="hidden sm:inline">Filtros</span>}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {quick.map((f) => (
          <Chip key={f.k} active={params.get(f.k) === "1"} onClick={() => toggle(f.k)} small>
            {f.label}
          </Chip>
        ))}
      </div>

      {(sort === "protein_price" || sort === "price_kg" || params.get("precio") === "1") && origin !== "store" ? (
        <p className="text-xs text-ink-3">Solo salen los alimentos con precio guardado (tickets, Open Prices o tus compras).</p>
      ) : null}

      {items === null ? (
        <div className="grid h-32 place-items-center text-ink-3">
          <Loader2 className="animate-spin" />
        </div>
      ) : items.length ? (
        <ul className="rounded-card border border-line bg-card p-1" aria-busy={loading}>
          {items.map((f) => (
            <ExploreRow key={f.id} f={f} sort={sort} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <Empty title="Nada con estos filtros">Quita algún filtro o prueba con otro grupo.</Empty>
      )}
      {more ? (
        <Button variant="outline" className="w-full" disabled={loading} onClick={() => void load(items?.length ?? 0)}>
          {loading ? <Loader2 className="animate-spin" /> : null} Cargar más
        </Button>
      ) : null}

      {filters ? <FiltersDialog params={params} onClose={() => setFilters(false)} onApply={(patch) => {
            set(patch);
            setFilters(false);
          }} /> : null}
    </div>
  );
}

function ExploreRow({ f, sort, onOpen }: { f: ExploreItem; sort: string; onOpen: (id: string) => void }) {
  const group = f.foodGroup ? FOOD_GROUP_BY_KEY[f.foodGroup] : undefined;
  const store = f.source === "store";
  const proteinPerEuro = f.protein != null && f.pricePerKg ? (f.protein * 10) / f.pricePerKg : null;
  const inner = (
    <>
      {f.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={f.imageUrl} alt="" className="size-11 shrink-0 rounded-lg border border-line bg-white object-contain" loading="lazy" />
      ) : (
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-paper-2 text-xs font-semibold uppercase text-ink-3">{f.source === "ciqual" ? "gen" : f.source.slice(0, 3)}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{f.name}</span>
        <span className="flex items-center gap-2 truncate text-xs text-ink-3">
          {f.brand ? <span className="truncate">{f.brand}</span> : group ? <span className="truncate">{group.name}</span> : null}
          <NutriBadges nutriscore={f.nutriscore} nova={f.nova} />
          {f.price != null ? (
            <span className="num shrink-0 text-ink-2">
              {eur.format(f.price)}
              {f.pricePerKg ? ` · ${eur.format(f.pricePerKg)}/kg` : ""}
            </span>
          ) : null}
        </span>
      </span>
      {store ? null : (
        <span className="num shrink-0 text-right text-sm">
          <span className="block font-medium">{n0(f.kcal)} kcal</span>
          <span className="text-[11px] text-ink-3">
            {sort === "protein_price" && proteinPerEuro != null ? `${n0(proteinPerEuro)} g prot/€` : sort === "protein_density" && f.kcal ? `${n0(((f.protein ?? 0) / f.kcal) * 100)} g prot/100 kcal` : `P ${n0(f.protein)} g`}
          </span>
        </span>
      )}
    </>
  );
  const cls = "flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-paper-2";
  return (
    <li>
      {/* Store rows have price but no nutrients: they open the food page, not the add dialog. */}
      {store ? (
        <Link href={`/alimentos/${f.id}`} className={cls}>
          {inner}
        </Link>
      ) : (
        <button type="button" className={cls} onClick={() => onOpen(f.id)}>
          {inner}
        </button>
      )}
    </li>
  );
}

function Chip({ active, onClick, children, small }: { active: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border", small ? "px-3 py-1 text-sm" : "h-9 px-3 text-sm", active ? "border-herb bg-herb-soft font-medium text-herb" : "border-line bg-card text-ink-2 hover:bg-paper-2")}
    >
      {children}
    </button>
  );
}

function FiltersDialog({ params, onClose, onApply }: { params: URLSearchParams | ReturnType<typeof useSearchParams>; onClose: () => void; onApply: (patch: Record<string, string | null>) => void }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(ADVANCED.map((k) => [k, params.get(k) ?? ""])));
  const put = (k: string, val: string) => setV((s) => ({ ...s, [k]: val }));
  const flag = (k: string, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-[var(--herb)]" checked={v[k] === "1"} onChange={(e) => put(k, e.target.checked ? "1" : "")} />
      {label}
    </label>
  );
  const ns = v.ns ?? "";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Filtros" description="Valores por 100 g. Los alérgenos y etiquetas salen del envase (Open Food Facts).">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <Field label="kcal mín.">
              <Input type="number" inputMode="numeric" min={0} value={v.kmin} onChange={(e) => put("kmin", e.target.value)} />
            </Field>
            <Field label="kcal máx.">
              <Input type="number" inputMode="numeric" min={0} value={v.kmax} onChange={(e) => put("kmax", e.target.value)} />
            </Field>
            <Field label="Proteína mín. (g)">
              <Input type="number" inputMode="decimal" min={0} value={v.pmin} onChange={(e) => put("pmin", e.target.value)} />
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Nutri-Score</legend>
            <div className="flex gap-1.5">
              {["a", "b", "c", "d", "e"].map((l) => (
                <Chip key={l} small active={ns.includes(l)} onClick={() => put("ns", ns.includes(l) ? ns.replace(l, "") : [...ns + l].sort().join(""))}>
                  <span className="font-semibold uppercase">{l}</span>
                </Chip>
              ))}
            </div>
          </fieldset>
          <Field label="Procesado (NOVA)">
            <Select value={v.nova} onChange={(e) => put("nova", e.target.value)}>
              <option value="">Cualquiera</option>
              <option value="1">Solo sin procesar (1)</option>
              <option value="2">Hasta ingredientes culinarios (2)</option>
              <option value="3">Sin ultraprocesados (≤ 3)</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {flag("pocoazucar", "Poco azúcar (≤ 5 g)")}
            {flag("pocasal", "Poca sal (≤ 0,3 g)")}
            {flag("vegano", "Vegano")}
            {flag("singluten", "Sin gluten")}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => onApply(Object.fromEntries(ADVANCED.map((k) => [k, null])))}>
              Quitar filtros
            </Button>
            <Button className="flex-1" onClick={() => onApply(Object.fromEntries(ADVANCED.map((k) => [k, v[k] || null])))}>
              Aplicar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

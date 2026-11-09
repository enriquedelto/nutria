"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { n0 } from "@/lib/format";
import type { FoodBrief } from "@/lib/data/foods";
import { NutriBadges } from "./add-food-dialog";

/**
 * Inline food search (same catalogue as /buscar) to pick a replacement: type, tap a result.
 * Starts with `initialQuery` already searched so the closest options show up straight away.
 */
export function FoodPicker({ personId, initialQuery = "", onPick, busyId }: { personId: string; initialQuery?: string; onPick: (food: FoodBrief) => void; busyId?: string | null }) {
  const [q, setQ] = useState(initialQuery);
  const [items, setItems] = useState<FoodBrief[] | null>(null);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setItems(null);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/foods?personId=${personId}&limit=15&q=${encodeURIComponent(q.trim())}`, { signal: ac.signal });
        setItems(r.ok ? ((await r.json()) as { items: FoodBrief[] }).items : []);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setItems([]);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [q, personId]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <Input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar otro alimento…" aria-label="Buscar otro alimento" className="pl-9" />
        {loading ? <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-3" /> : null}
      </div>
      {items ? (
        items.length ? (
          <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {items.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => onPick(f)} disabled={!!busyId} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-paper-2 disabled:opacity-60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{f.name}</span>
                    <span className="block truncate text-xs text-ink-3">{[f.brand, f.quantityLabel].filter(Boolean).join(" · ") || (f.source === "ciqual" ? "Genérico" : "")}</span>
                  </span>
                  <NutriBadges nutriscore={f.nutriscore} nova={f.nova} />
                  <span className="num w-16 shrink-0 text-right text-xs text-ink-2">{n0(f.kcal)} kcal</span>
                  {busyId === f.id ? <Loader2 className="size-4 animate-spin" /> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Sin resultados para «{q}».</p>
        )
      ) : null}
    </div>
  );
}

"use client";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, ExternalLink, Link2, Loader2, Plus, Repeat, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { addShoppingItem, addStaplesToList, autoLinkProducts, deleteShoppingItem, finishShopping, linkStoreProduct, searchStoreProducts, sendToStore, shoppingFromPlanAction, toggleShoppingItem } from "@/actions/kitchen";
import { VoiceInput } from "@/components/voice-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type Item = { id: string; name: string; quantity: number | null; unit: string | null; category: string; checked: boolean; estimatedPrice: number | null; storeProductId: string | null };

const qty = (i: Item) => (i.quantity == null ? "" : i.unit === "g" && i.quantity >= 1000 ? `${(i.quantity / 1000).toLocaleString("es-ES")} kg` : i.unit === "ml" && i.quantity >= 1000 ? `${(i.quantity / 1000).toLocaleString("es-ES")} l` : `${Math.round(i.quantity * 10) / 10} ${i.unit ?? ""}`.trim());
const eur = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });

export function ShoppingClient({ listId, items, categories, planId, store }: { listId: string; items: Item[]; categories: { code: string; name: string }[]; planId: string | null; store: { code: string; name: string } | null }) {
  const router = useRouter();
  const [opt, setOpt] = useOptimistic(items, (state, u: { id: string; checked?: boolean; remove?: boolean }) => (u.remove ? state.filter((i) => i.id !== u.id) : state.map((i) => (i.id === u.id ? { ...i, checked: u.checked ?? i.checked } : i))));
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [linking, setLinking] = useState<Item | null>(null);
  const [cart, setCart] = useState<Awaited<ReturnType<typeof sendToStore>> | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Realtime: someone else ticked or added something.
  useEffect(() => {
    const es = new EventSource(`/api/sse/shopping/${listId}`);
    let t: ReturnType<typeof setTimeout> | undefined;
    es.onmessage = () => {
      clearTimeout(t);
      t = setTimeout(() => router.refresh(), 250);
    };
    return () => {
      clearTimeout(t);
      es.close();
    };
  }, [listId, router]);

  const add = (value: string) =>
    start(async () => {
      for (const part of value.split(/,|\n| y (?=\d)/).map((x) => x.trim()).filter(Boolean)) await addShoppingItem(listId, part);
      setText("");
      input.current?.focus();
    });
  const toggle = (i: Item) =>
    start(async () => {
      setOpt({ id: i.id, checked: !i.checked });
      navigator.vibrate?.(15);
      await toggleShoppingItem(i.id, !i.checked);
    });

  const pendingItems = opt.filter((i) => !i.checked);
  const done = opt.filter((i) => i.checked);
  const total = opt.reduce((a, i) => a + (i.estimatedPrice ?? 0), 0);
  const priced = opt.filter((i) => i.estimatedPrice != null).length;

  return (
    <div className="space-y-4">
      <form
        className="sticky top-14 z-10 -mx-4 flex gap-2 bg-paper/95 px-4 py-2 backdrop-blur"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add(text);
        }}
      >
        <Input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Añadir: 2 kg patatas, leche x3…" aria-label="Añadir a la lista" enterKeyHint="done" />
        <VoiceInput onText={(t, final) => (final ? add(t) : setText(t))} />
        <Button type="submit" size="icon" disabled={pending || !text.trim()} aria-label="Añadir">
          <Plus />
        </Button>
      </form>

      <div className="flex flex-wrap gap-2">
        {planId ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
            const r = await shoppingFromPlanAction(planId);
            toast.success(`${r.added} productos añadidos desde el plan (ya descontada la despensa)`);
          })}>
            <CalendarDays /> Desde el plan
          </Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
          const n = await addStaplesToList(listId);
          toast(n ? `${n} básicos por reponer` : "No falta ningún básico");
        })}>
          <Repeat /> Básicos
        </Button>
        {store ? (
          <>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
              const n = await autoLinkProducts(listId, store.code);
              toast(n ? `${n} productos de ${store.name} asignados` : "Nada nuevo que asignar");
            })}>
              <Link2 /> Asignar productos
            </Button>
            <Button size="sm" variant="soft" disabled={pending} onClick={() => start(async () => setCart(await sendToStore(listId, store.code)))}>
              <ShoppingBag /> Al carrito de {store.name}
            </Button>
          </>
        ) : null}
      </div>

      {priced ? (
        <p className="text-sm text-ink-2">
          Estimado: <b className="num">{eur(total)}</b> ({priced} de {opt.length} con precio)
        </p>
      ) : null}

      {opt.length === 0 ? <p className="py-10 text-center text-ink-3">La lista está vacía.</p> : null}

      {categories
        .filter((c) => pendingItems.some((i) => i.category === c.code))
        .map((c) => (
          <section key={c.code}>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{c.name}</h2>
            <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
              {pendingItems
                .filter((i) => i.category === c.code)
                .map((i) => (
                  <Row key={i.id} item={i} onToggle={() => toggle(i)} onDelete={() => start(async () => { setOpt({ id: i.id, remove: true }); await deleteShoppingItem(i.id); })} onLink={store ? () => setLinking(i) : undefined} />
                ))}
            </ul>
          </section>
        ))}

      {done.length ? (
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">En el carro ({done.length})</h2>
            <Button size="sm" disabled={pending} onClick={() => start(async () => {
              const r = await finishShopping(listId, true);
              toast.success(`Compra terminada: ${r.bought} productos a la despensa${r.moved ? `, ${r.moved} pendientes pasan a la próxima` : ""}`);
            })}>
              <Check /> Terminar compra
            </Button>
          </div>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-card opacity-70">
            {done.map((i) => (
              <Row key={i.id} item={i} onToggle={() => toggle(i)} onDelete={() => start(async () => { setOpt({ id: i.id, remove: true }); await deleteShoppingItem(i.id); })} />
            ))}
          </ul>
        </section>
      ) : null}

      {linking && store ? <LinkDialog item={linking} store={store} onClose={() => setLinking(null)} /> : null}
      {cart ? (
        <Dialog open onOpenChange={() => setCart(null)}>
          <DialogContent title={`Carrito de ${store?.name}`} description={cart.message}>
            {cart.unlinked ? <p className="mb-2 text-sm text-persimmon">{cart.unlinked} producto(s) sin asignar no se incluyen.</p> : null}
            <ol className="max-h-[50vh] space-y-1 overflow-y-auto text-sm">
              {cart.lines.map((l) => (
                <li key={l.productId}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-paper-2">
                    <ExternalLink className="size-4 shrink-0 text-herb" />
                    <span className="flex-1">{cart.names[l.productId] ?? l.productId}</span>
                    <span className="num text-ink-3">×{l.quantity}</span>
                  </a>
                </li>
              ))}
            </ol>
            {cart.url ? (
              <Button asChild className="mt-3 w-full">
                <a href={cart.url} target="_blank" rel="noopener noreferrer">
                  Abrir el carrito
                </a>
              </Button>
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function Row({ item: i, onToggle, onDelete, onLink }: { item: Item; onToggle: () => void; onDelete: () => void; onLink?: () => void }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <button type="button" role="checkbox" aria-checked={i.checked} aria-label={i.name} onClick={onToggle} className={cn("grid size-6 shrink-0 place-items-center rounded-full border-2", i.checked ? "border-herb bg-herb text-herb-ink" : "border-line")}>
        {i.checked ? <Check className="size-4" /> : null}
      </button>
      <button type="button" onClick={onToggle} className={cn("min-w-0 flex-1 text-left", i.checked && "line-through")}>
        <span className="font-medium">{i.name}</span> {qty(i) ? <span className="num text-sm text-ink-3">· {qty(i)}</span> : null}
      </button>
      {i.estimatedPrice != null ? <span className="num text-sm text-ink-2">{eur(i.estimatedPrice)}</span> : null}
      {onLink ? (
        <button type="button" aria-label="Asignar producto de la tienda" onClick={onLink} className={cn("rounded-full p-1 hover:bg-paper-2", i.storeProductId ? "text-herb" : "text-ink-3")}>
          <Link2 className="size-4" />
        </button>
      ) : null}
      <button type="button" aria-label="Quitar" onClick={onDelete} className="rounded-full p-1 text-ink-3 hover:bg-paper-2">
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}

function LinkDialog({ item, store, onClose }: { item: Item; store: { code: string; name: string }; onClose: () => void }) {
  const [q, setQ] = useState(item.name);
  const [res, setRes] = useState<Awaited<ReturnType<typeof searchStoreProducts>> | null>(null);
  const [pending, start] = useTransition();
  const search = () => start(async () => setRes(await searchStoreProducts(store.code, q)));
  useEffect(search, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent title={`«${item.name}» en ${store.name}`} description="Lo recordaré para las próximas listas.">
        <form className="mb-3 flex gap-2" onSubmit={(e) => (e.preventDefault(), search())}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} />
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : "Buscar"}
          </Button>
        </form>
        {res?.length === 0 ? <p className="text-sm text-ink-3">Sin resultados en el catálogo local. El catálogo se actualiza cada semana.</p> : null}
        <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
          {res?.map((p) => (
            <li key={p.productId}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-paper-2"
                onClick={() =>
                  start(async () => {
                    await linkStoreProduct(item.id, store.code, { productId: p.productId, name: p.name, pack: p.pack, price: p.price });
                    onClose();
                  })
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.imageUrl ? <img src={p.imageUrl} alt="" className="size-10 rounded-lg object-cover" referrerPolicy="no-referrer" /> : <span className="size-10 rounded-lg bg-paper-2" />}
                <span className="min-w-0 flex-1 text-sm">
                  {p.name} <span className="text-ink-3">{p.pack}</span>
                  {p.perKg ? <span className="block text-xs text-ink-3">{eur(p.perKg)}/kg</span> : null}
                </span>
                {p.price != null ? <span className="num text-sm font-semibold">{eur(p.price)}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

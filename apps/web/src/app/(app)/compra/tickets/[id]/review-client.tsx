"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, Loader2, MapPin, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { confirmReceiptAction } from "@/actions/receipts";
import { FoodPicker } from "@/components/food/food-picker";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { errorText } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useSafeTransition } from "@/lib/use-safe-transition";

type Place = { osmId: number; osmType: "NODE" | "WAY" | "RELATION"; name: string; displayName: string; lat: number; lon: number };
type Unit = "ud" | "kg" | "l";
export type ReviewLine = { rawText: string; name: string; quantity: number; unit: Unit; unitPrice: number | null; lineTotal: number; discount: number | null; foodId: string | null; foodName: string | null; matchConfidence: number | null };
export type ReviewProps = {
  receiptId: string;
  personId: string;
  date: string | null;
  total: number | null;
  header: { name: string | null; address: string | null; city: string | null };
  storeId: string | null;
  knownStores: { id: string; name: string; address: string | null; osmId: number | null }[];
  candidates: Place[];
  lines: ReviewLine[];
  /** Index of the image to share (last photo) or null for PDFs. */
  shareImage: number | null;
  cropBottom: number | null;
  openPricesConnected: boolean;
  fromList: boolean;
};

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

export function ReceiptReview(p: ReviewProps) {
  const router = useRouter();
  const [pending, start] = useSafeTransition();
  const [store, setStore] = useState(() => (p.storeId ? `existing:${p.storeId}` : p.candidates.length ? "osm:0" : p.header.name ? "manual" : "none"));
  const [manualName, setManualName] = useState(p.header.name ?? "");
  const [date, setDate] = useState(p.date ?? new Date().toISOString().slice(0, 10));
  const [total, setTotal] = useState(p.total != null ? String(p.total) : "");
  const [lines, setLines] = useState<(ReviewLine & { key: number })[]>(() => p.lines.map((l, i) => ({ ...l, key: i })));
  const [toPantry, setToPantry] = useState(!p.fromList);
  const [share, setShare] = useState(false);
  const [crop, setCrop] = useState(Math.round((p.cropBottom ?? 1) * 100));
  const [picking, setPicking] = useState<number | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const nextKey = useRef(p.lines.length);

  const sum = useMemo(() => Math.round(lines.reduce((s, l) => s + (Number.isFinite(l.lineTotal) ? l.lineTotal : 0), 0) * 100) / 100, [lines]);
  const totalNum = num(total);
  const diff = totalNum != null ? Math.round((totalNum - sum) * 100) / 100 : null;
  const storeOk = store.startsWith("osm:") || (store.startsWith("existing:") && p.knownStores.find((s) => `existing:${s.id}` === store)?.osmId != null);
  const canShare = p.openPricesConnected && p.shareImage != null;

  const patch = (key: number, v: Partial<ReviewLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...v } : l)));

  /** The approved part of the photo (top → crop line) as JPEG base64. */
  const croppedImage = async () => {
    const el = img.current;
    if (!el) throw new Error("La imagen no ha cargado");
    if (!el.complete) await el.decode();
    const h = Math.max(1, Math.round(el.naturalHeight * (crop / 100)));
    const c = document.createElement("canvas");
    c.width = el.naturalWidth;
    c.height = h;
    c.getContext("2d")!.drawImage(el, 0, 0, el.naturalWidth, h, 0, 0, el.naturalWidth, h);
    return c.toDataURL("image/jpeg", 0.88).split(",")[1]!;
  };

  const save = () =>
    start(async () => {
      try {
        const [kind, ref] = store.split(":");
        const choice =
          kind === "existing" ? { kind: "existing" as const, storeId: ref! } : kind === "osm" ? { kind: "osm" as const, place: p.candidates[Number(ref)]! } : kind === "manual" && manualName.trim() ? { kind: "manual" as const, name: manualName.trim() } : { kind: "none" as const };
        const bad = lines.find((l) => !l.name.trim() || !(l.quantity > 0) || !Number.isFinite(l.lineTotal));
        if (bad) throw new Error(`Revisa la línea «${bad.name || bad.rawText}»`);
        const shareImage = share && canShare ? await croppedImage() : null;
        await confirmReceiptAction(p.receiptId, {
          store: choice,
          date,
          total: totalNum,
          toPantry,
          shareImage,
          lines: lines.map((l) => ({ rawText: l.rawText || l.name, name: l.name.trim(), quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, lineTotal: l.lineTotal, discount: l.discount, foodId: l.foodId, matchConfidence: l.matchConfidence })),
        });
        toast.success(shareImage ? "Ticket guardado. Se está compartiendo en Open Prices." : "Ticket guardado");
        router.replace(`/compra/tickets/${p.receiptId}`);
        router.refresh();
      } catch (e) {
        toast.error(errorText(e, "No se pudo guardar"));
      }
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Tienda y fecha" />
        <fieldset className="space-y-2">
          <legend className="sr-only">Tienda</legend>
          {p.knownStores.map((s) => (
            <StoreOption key={s.id} value={`existing:${s.id}`} current={store} onChange={setStore} title={s.name} detail={s.address} map={s.osmId != null} />
          ))}
          {p.candidates.map((c, i) => (
            <StoreOption key={`${c.osmType}${c.osmId}`} value={`osm:${i}`} current={store} onChange={setStore} title={c.name} detail={c.displayName} map />
          ))}
          <StoreOption value="manual" current={store} onChange={setStore} title="Otra tienda" detail="Escribe el nombre (sin ubicación en el mapa)" />
          {store === "manual" ? <Input aria-label="Nombre de la tienda" value={manualName} onChange={(e) => setManualName(e.target.value)} maxLength={120} /> : null}
          <StoreOption value="none" current={store} onChange={setStore} title="Sin tienda" />
        </fieldset>
        {p.header.address ? <p className="mt-2 text-xs text-ink-3">El ticket dice: {[p.header.name, p.header.address, p.header.city].filter(Boolean).join(", ")}</p> : null}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Field label="Fecha">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Total del ticket (€)">
            <Input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`Líneas (${lines.length})`}
          subtitle={diff == null ? `Suma ${eur.format(sum)}` : Math.abs(diff) < 0.02 ? `Suma ${eur.format(sum)} · cuadra con el total` : `Suma ${eur.format(sum)} · faltan ${eur.format(diff)} para el total`}
        />
        <ul className="divide-y divide-line">
          {lines.map((l, i) => (
            <li key={l.key} className="space-y-2 py-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <Input aria-label={`Producto, línea ${i + 1}`} value={l.name} onChange={(e) => patch(l.key, { name: e.target.value })} />
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
                    {l.rawText && l.rawText !== l.name ? <span className="font-mono">{l.rawText}</span> : null}
                    {l.foodId ? (
                      <Link href={`/alimentos/${l.foodId}`} className={cn("font-medium", (l.matchConfidence ?? 1) < 0.7 ? "text-persimmon" : "text-herb")}>
                        {l.foodName}
                        {(l.matchConfidence ?? 1) < 0.7 ? " (¿seguro?)" : ""}
                      </Link>
                    ) : (
                      <span>Sin vincular a un alimento</span>
                    )}
                    <button type="button" className="inline-flex items-center gap-1 font-medium text-herb" onClick={() => setPicking(l.key)} aria-label={`${l.foodId ? "Cambiar" : "Vincular"} alimento: ${l.name}`}>
                      <Link2 className="size-3" /> {l.foodId ? "Cambiar" : "Vincular"}
                    </button>
                    {l.foodId ? (
                      <button type="button" className="text-ink-3 underline" onClick={() => patch(l.key, { foodId: null, foodName: null, matchConfidence: null })}>
                        Desvincular
                      </button>
                    ) : null}
                  </p>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={`Quitar línea: ${l.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                  <Trash2 />
                </Button>
              </div>
              <div className="grid grid-cols-[1fr_1fr_1.2fr] gap-2">
                <Field label="Cantidad">
                  <Input inputMode="decimal" defaultValue={String(l.quantity)} onChange={(e) => patch(l.key, { quantity: num(e.target.value) ?? 0 })} />
                </Field>
                <Field label="Unidad">
                  <Select value={l.unit} onChange={(e) => patch(l.key, { unit: e.target.value as Unit })}>
                    <option value="ud">ud</option>
                    <option value="kg">kg</option>
                    <option value="l">l</option>
                  </Select>
                </Field>
                <Field label="Importe (€)">
                  <Input inputMode="decimal" defaultValue={String(l.lineTotal)} onChange={(e) => patch(l.key, { lineTotal: num(e.target.value) ?? Number.NaN, unitPrice: null })} />
                </Field>
              </div>
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => {
            const key = nextKey.current++;
            setLines((ls) => [...ls, { key, rawText: "", name: "", quantity: 1, unit: "ud", unitPrice: null, lineTotal: 0, discount: null, foodId: null, foodName: null, matchConfidence: null }]);
          }}
        >
          <Plus /> Añadir línea
        </Button>
      </Card>

      <Card className="space-y-3">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--herb)]" checked={toPantry} onChange={(e) => setToPantry(e.target.checked)} />
          <span>
            Añadir a la despensa
            <span className="block text-xs text-ink-3">Solo las líneas vinculadas a un alimento.{p.fromList ? " Si ya lo pasaste al terminar la compra, déjalo sin marcar." : ""}</span>
          </span>
        </label>
        {canShare ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--herb)]" checked={share} onChange={(e) => setShare(e.target.checked)} disabled={!storeOk} />
            <span>
              Compartir en Open Prices
              <span className="block text-xs text-ink-3">{storeOk ? "Base de datos abierta de precios. La foto que subas será pública." : "Elige la tienda del mapa para poder compartir."}</span>
            </span>
          </label>
        ) : p.shareImage != null ? (
          <p className="text-xs text-ink-3">
            Puedes compartir estos precios en Open Prices (base de datos abierta) conectando tu cuenta en{" "}
            <Link href="/ajustes/integraciones" className="text-herb underline">
              Integraciones
            </Link>
            .
          </p>
        ) : null}
        {p.shareImage != null ? (
          <div className={cn("space-y-2", !(share && canShare) && "hidden")}>
            <p className="text-sm">
              Se publicará <strong>solo la parte clara</strong> de la foto, la tienda, la fecha y el precio de los productos con código de barras. Baja la línea hasta justo debajo del total para dejar fuera el pago y la tarjeta de cliente.
            </p>
            <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={img} src={`/api/receipts/${p.receiptId}/file/${p.shareImage}`} alt="Ticket que se compartirá" className="block w-full" />
              <div className="absolute inset-x-0 bottom-0 grid place-items-center bg-ink/80 text-sm font-medium text-paper" style={{ top: `${crop}%` }}>
                No se comparte
              </div>
            </div>
            <Field label={`Cortar a ${crop} % de la altura`}>
              <input type="range" min={20} max={100} value={crop} onChange={(e) => setCrop(Number(e.target.value))} className="w-full accent-[var(--herb)]" />
            </Field>
          </div>
        ) : null}
      </Card>

      <Button size="lg" className="w-full" onClick={save} disabled={pending || !lines.length}>
        {pending ? <Loader2 className="animate-spin" /> : null} Guardar ticket
      </Button>

      {picking != null ? (
        <Dialog open onOpenChange={(o) => !o && setPicking(null)}>
          <DialogContent title="Vincular alimento" description="Busca el producto: su precio quedará en su ficha.">
            <FoodPicker
              personId={p.personId}
              initialQuery={lines.find((l) => l.key === picking)?.name ?? ""}
              onPick={(f) => {
                patch(picking, { foodId: f.id, foodName: f.name, matchConfidence: 1 });
                setPicking(null);
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function StoreOption({ value, current, onChange, title, detail, map }: { value: string; current: string; onChange: (v: string) => void; title: string; detail?: string | null; map?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 text-sm", current === value ? "border-herb bg-herb-soft" : "border-line")}>
      <input type="radio" name="store" className="mt-1 accent-[var(--herb)]" checked={current === value} onChange={() => onChange(value)} />
      <span className="min-w-0">
        <span className="flex items-center gap-1 font-medium">
          {title}
          {map ? <MapPin className="size-3.5 text-ink-3" aria-label="En el mapa" /> : null}
        </span>
        {detail ? <span className="block truncate text-xs text-ink-3">{detail}</span> : null}
      </span>
    </label>
  );
}

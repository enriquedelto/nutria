"use client";
import { submitForm } from "@/lib/forms";
import { errorText } from "@/lib/errors";
import { useRef, useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { Camera, Loader2, Minus, Plus, ScanBarcode, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { addPantryItem, confirmPantryDraft, deletePantryItem, discardBatch, eatFromBatch, pantryFromBarcode, pantryPhotoDraft, updatePantryItem } from "@/actions/kitchen";
import { Scanner } from "@/components/food/scanner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { fileToJpeg } from "@/lib/image";
import { cn } from "@/lib/utils";

type Loc = "nevera" | "congelador" | "despensa";

export function AddPantry({ defaultLocation = "despensa" }: { defaultLocation?: Loc }) {
  const [pending, start] = useSafeTransition();
  const [scan, setScan] = useState(false);
  const [loc, setLoc] = useState<Loc>(defaultLocation);
  const [draft, setDraft] = useState<{ estimateId: string; items: { name: string; quantity: number; unit: "g" | "ml" | "ud"; location: Loc; expiresInDays: number | null }[] } | null>(null);
  const photo = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);

  return (
    <div className="space-y-3">
      <form
        ref={form}
        className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_5rem_5rem_8rem_8rem_auto] sm:items-end"
        onSubmit={submitForm((fd) =>
          start(async () => {
            try {
              await addPantryItem({ name: String(fd.get("name")), quantity: Number(fd.get("qty") || 1), unit: String(fd.get("unit")) as "ud", location: loc, expires: String(fd.get("exp") || "") || null });
              form.current?.reset();
            } catch (e) {
              toast.error(errorText(e, "Error"));
            }
          })
        )}
      >
        <Field label="Producto" className="col-span-2 sm:col-span-1">
          <Input name="name" required maxLength={120} placeholder="Yogures naturales" />
        </Field>
        <Field label="Cant.">
          <Input name="qty" type="number" min={0} step="any" defaultValue={1} />
        </Field>
        <Field label="Unidad">
          <Select name="unit" defaultValue="ud">
            <option value="ud">ud</option>
            <option value="g">g</option>
            <option value="ml">ml</option>
          </Select>
        </Field>
        <Field label="Dónde">
          <Select value={loc} onChange={(e) => setLoc(e.target.value as Loc)}>
            <option value="nevera">Nevera</option>
            <option value="congelador">Congelador</option>
            <option value="despensa">Despensa</option>
          </Select>
        </Field>
        <Field label="Caduca" hint="+5d, +1m, 1231">
          <Input name="exp" placeholder="+1w" autoComplete="off" />
        </Field>
        <Button type="submit" disabled={pending} className="col-span-2 sm:col-span-1">
          <Plus /> Añadir
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setScan(true)}>
          <ScanBarcode /> Escanear
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => photo.current?.click()}>
          {pending && !draft ? <Loader2 className="animate-spin" /> : <Camera />} Foto de la nevera
        </Button>
        <input
          ref={photo}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])].slice(0, 4);
            e.target.value = "";
            if (!files.length) return;
            start(async () => {
              try {
                const imgs = await Promise.all(files.map(async (f) => {
                  const j = await fileToJpeg(f, 1600, 0.8);
                  return { mediaType: j.mediaType as "image/jpeg", data: j.data };
                }));
                const r = await pantryPhotoDraft(imgs);
                setDraft({ estimateId: r.estimateId, items: r.items });
              } catch (err) {
                toast.error(errorText(err, "Error de la IA"));
              }
            });
          }}
        />
      </div>
      <Scanner
        open={scan}
        onClose={() => setScan(false)}
        onCode={(code) => {
          setScan(false);
          start(async () => {
            const r = await pantryFromBarcode(code, loc);
            if (r.found) toast.success(`${r.name} añadido`);
            else toast.error("Producto no encontrado; añádelo a mano");
          });
        }}
      />
      {draft ? (
        <Dialog open onOpenChange={() => setDraft(null)}>
          <DialogContent title="¿Esto es lo que hay?" description="Revisa lo que ha visto la IA antes de guardarlo.">
            <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
              {draft.items.map((it, i) => (
                <li key={i} className="grid grid-cols-[1fr_4.5rem_4rem_auto] items-center gap-1.5">
                  <Input value={it.name} onChange={(e) => setDraft((d) => d && { ...d, items: d.items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} className="h-9" />
                  <Input type="number" value={it.quantity} onChange={(e) => setDraft((d) => d && { ...d, items: d.items.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)) })} className="h-9" />
                  <span className="text-xs text-ink-3">{it.unit} · {it.location}</span>
                  <button type="button" aria-label="Quitar" onClick={() => setDraft((d) => d && { ...d, items: d.items.filter((_, j) => j !== i) })}>
                    <Trash2 className="size-4 text-ink-3" />
                  </button>
                </li>
              ))}
            </ul>
            <Button className="mt-3 w-full" disabled={pending} onClick={() => start(async () => {
              await confirmPantryDraft(draft.estimateId, draft.items);
              toast.success(`${draft.items.length} productos guardados`);
              setDraft(null);
            })}>
              Guardar {draft.items.length}
            </Button>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

export function PantryRow({ item, status, label }: { item: { id: string; name: string; quantity: number; unit: string; staple: boolean; expiresOn: string | null; openedOn: string | null }; status: "expired" | "soon" | "ok" | "none"; label: string }) {
  const [q, setQ] = useState(item.quantity);
  const [, start] = useSafeTransition();
  const step = item.unit === "ud" ? 1 : item.unit === "g" ? 50 : 100;
  const change = (d: number) => {
    const next = Math.max(0, Math.round((q + d) * 100) / 100);
    setQ(next);
    start(() => updatePantryItem(item.id, { quantity: next }));
  };
  return (
    <li className="flex items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {item.name} {item.openedOn ? <span className="text-xs font-normal text-ink-3">(abierto)</span> : null}
        </p>
        <p className={cn("text-xs", status === "expired" ? "font-semibold text-danger" : status === "soon" ? "font-semibold text-persimmon" : "text-ink-3")}>{label}</p>
      </div>
      <button type="button" aria-label={item.staple ? "Quitar de básicos" : "Marcar como básico"} title="Básico: se repone en la lista" onClick={() => start(() => updatePantryItem(item.id, { staple: !item.staple }))}>
        <Star className={cn("size-4", item.staple ? "fill-herb text-herb" : "text-line")} />
      </button>
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="outline" aria-label="Menos" onClick={() => change(-step)}>
          <Minus />
        </Button>
        <span className="num w-14 text-center text-sm">
          {q} {item.unit}
        </span>
        <Button size="icon-sm" variant="outline" aria-label="Más" onClick={() => change(step)}>
          <Plus />
        </Button>
      </div>
      <Button size="icon-sm" variant="ghost" aria-label="Borrar" onClick={() => start(() => deletePantryItem(item.id))}>
        <Trash2 />
      </Button>
    </li>
  );
}

export function BatchDone({ id }: { id: string }) {
  const [pending, start] = useSafeTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => discardBatch(id))}>
      Ya no queda
    </Button>
  );
}

export function EatBatch({ id, personId, personName, date, slot }: { id: string; personId: string; personName: string; date: string; slot: string }) {
  const [pending, start] = useSafeTransition();
  return (
    <Button
      size="sm"
      variant="soft"
      disabled={pending}
      title={`Registra 1 ración en el diario de ${personName}`}
      onClick={() =>
        start(async () => {
          const r = await eatFromBatch(id, { personId, date, mealSlot: slot, portions: 1 });
          toast.success(`Registrado en el diario · quedan ${r.left}`);
        })
      }
    >
      Comer 1 ración
    </Button>
  );
}

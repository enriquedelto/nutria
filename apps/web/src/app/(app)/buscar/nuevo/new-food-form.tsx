"use client";
import { errorText } from "@/lib/errors";
import { useRef, useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createFood } from "@/actions/foods";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { fileToJpeg } from "@/lib/image";
import { submitForm } from "@/lib/forms";
import { nutrientName } from "@/lib/format";

const MAIN = ["energy_kcal", "protein", "carbs", "sugars", "fat", "sat_fat", "fiber", "salt"] as const;

export function NewFoodForm({ personId, barcode, label, aiEnabled }: { personId: string; barcode: string | null; label: boolean; aiEnabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useSafeTransition();
  const [reading, setReading] = useState(false);
  const [per100, setPer100] = useState<Record<string, number>>({});
  const [meta, setMeta] = useState({ name: "", brand: "", barcode: barcode ?? "", ingredients: "", servingLabel: "", servingGrams: "", estimateId: null as string | null, allergens: [] as string[] });
  const cam = useRef<HTMLInputElement>(null);

  const readLabel = async (files: FileList | null) => {
    if (!files?.length) return;
    setReading(true);
    try {
      const images = await Promise.all([...files].slice(0, 3).map((f) => fileToJpeg(f, 2000, 0.85)));
      const res = await fetch("/api/ai/label", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ personId, images: images.map(({ mediaType, data }) => ({ mediaType, data })) }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setPer100(d.per100 ?? {});
      setMeta((m) => ({
        ...m,
        name: m.name || d.name || "",
        brand: m.brand || d.brand || "",
        barcode: m.barcode || d.barcode || "",
        ingredients: d.ingredientsText ?? m.ingredients,
        servingGrams: d.servingGrams ? String(d.servingGrams) : m.servingGrams,
        servingLabel: d.servingGrams && !m.servingLabel ? "1 ración" : m.servingLabel,
        estimateId: d.estimateId,
        allergens: d.allergens ?? [],
      }));
      toast.success(d.confidence < 0.6 ? "Etiqueta leída con dudas: revisa los valores" : "Etiqueta leída");
    } catch (e) {
      toast.error(errorText(e, "No se pudo leer la etiqueta"));
    } finally {
      setReading(false);
    }
  };

  const submit = (fd: FormData) =>
    start(async () => {
      const values: Record<string, number> = { ...per100 };
      for (const k of MAIN) {
        const v = fd.get(k);
        if (v !== null && v !== "") values[k] = Number(v);
        else delete values[k];
      }
      if (values.energy_kcal == null) return void toast.error("Indica al menos las kcal por 100 g");
      const sg = Number(meta.servingGrams);
      const id = await createFood(personId, {
        name: meta.name,
        brand: meta.brand || null,
        barcode: meta.barcode || null,
        kind: String(fd.get("kind")) as "food",
        per100: values,
        serving: sg > 0 ? { label: meta.servingLabel || "1 ración", grams: sg } : null,
        ingredientsText: meta.ingredients || null,
        allergens: meta.allergens,
        estimateId: meta.estimateId,
      });
      toast.success("Alimento creado");
      router.push(`/buscar?abrir=${id}`);
    });

  return (
    <form onSubmit={submitForm(submit)} className="space-y-4">
      {aiEnabled ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 bg-herb-soft/40">
          <p className="text-sm">Haz una foto de la tabla nutricional y la IA rellena el formulario.</p>
          <Button type="button" variant={label ? "accent" : "outline"} onClick={() => cam.current?.click()} disabled={reading}>
            {reading ? <Loader2 className="animate-spin" /> : <Camera />} {reading ? "Leyendo…" : "Foto de la etiqueta"}
          </Button>
          <input ref={cam} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void readLabel(e.target.files)} />
        </Card>
      ) : null}
      <Card className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre" className="sm:col-span-2">
          <Input required value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} maxLength={160} />
        </Field>
        <Field label="Marca">
          <Input value={meta.brand} onChange={(e) => setMeta({ ...meta, brand: e.target.value })} maxLength={80} />
        </Field>
        <Field label="Código de barras">
          <Input value={meta.barcode} inputMode="numeric" pattern="\d{6,14}" onChange={(e) => setMeta({ ...meta, barcode: e.target.value.replace(/\D/g, "") })} />
        </Field>
        <Field label="Tipo">
          <Select name="kind" defaultValue="food">
            <option value="food">Alimento</option>
            <option value="drink">Bebida</option>
            <option value="supplement">Suplemento</option>
            <option value="alcohol">Bebida alcohólica</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ración">
            <Input value={meta.servingLabel} placeholder="1 yogur" onChange={(e) => setMeta({ ...meta, servingLabel: e.target.value })} />
          </Field>
          <Field label="g por ración">
            <Input value={meta.servingGrams} type="number" inputMode="decimal" min={0} step="any" onChange={(e) => setMeta({ ...meta, servingGrams: e.target.value })} />
          </Field>
        </div>
      </Card>
      <Card>
        <p className="mb-3 font-medium">Valores por 100 g</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {MAIN.map((k) => (
            <Field key={`${k}-${per100[k] ?? ""}`} label={k === "energy_kcal" ? "kcal" : `${nutrientName(k)} (g)`}>
              <Input name={k} type="number" inputMode="decimal" min={0} step="any" defaultValue={per100[k] ?? ""} required={k === "energy_kcal"} />
            </Field>
          ))}
        </div>
        {Object.keys(per100).filter((k) => !(MAIN as readonly string[]).includes(k)).length ? (
          <p className="mt-3 text-xs text-ink-3">
            También se guardarán de la etiqueta: {Object.keys(per100).filter((k) => !(MAIN as readonly string[]).includes(k)).map(nutrientName).join(", ")}.
          </p>
        ) : null}
      </Card>
      <Field label="Ingredientes">
        <Textarea value={meta.ingredients} onChange={(e) => setMeta({ ...meta, ingredients: e.target.value })} rows={3} />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null} Guardar alimento
      </Button>
      <p className="text-xs text-ink-3">Los alimentos que creas los ve toda tu casa.</p>
    </form>
  );
}

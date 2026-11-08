"use client";
import { submitForm } from "@/lib/forms";
import { errorText } from "@/lib/errors";
import { useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveRecipeAction, type RecipeIn } from "@/actions/recipes";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";

/** Ingredient lines; "## Para la salsa" starts a section. Steps: one per line/paragraph. */
const toLines = (d: RecipeIn) => {
  const out: string[] = [];
  let section: string | null | undefined = null;
  for (const i of d.ingredients) {
    if ((i.section ?? null) !== section) {
      section = i.section ?? null;
      if (section) out.push(`## ${section}`);
    }
    out.push(i.optional ? `${i.rawText} (opcional)` : i.rawText);
  }
  return out.join("\n");
};

export function RecipeForm({ initial, recipeId, estimateId }: { initial?: RecipeIn; recipeId?: string; estimateId?: string }) {
  const d: RecipeIn = initial ?? { title: "", servings: 4, ingredients: [], steps: [], tags: [] };
  const [ings, setIngs] = useState(toLines(d));
  const [steps, setSteps] = useState(d.steps.map((s) => s.text).join("\n\n"));
  const [pending, start] = useSafeTransition();
  const router = useRouter();
  return (
    <form
      className="space-y-4"
      onSubmit={submitForm((fd) =>
        start(async () => {
          let section: string | null = null;
          const ingredients: RecipeIn["ingredients"] = [];
          for (const raw of ings.split("\n").map((l) => l.trim()).filter(Boolean)) {
            if (raw.startsWith("#")) {
              section = raw.replace(/^#+\s*/, "").slice(0, 60) || null;
              continue;
            }
            const optional = /\(opcional\)\s*$/i.test(raw);
            ingredients.push({ rawText: raw.replace(/^[-•*]\s*/, "").replace(/\s*\(opcional\)\s*$/i, ""), section, optional });
          }
          const stepList = steps
            .split(/\n\s*\n|\n(?=\d+[.)]\s)/)
            .map((s) => s.replace(/^\d+[.)]\s*/, "").trim())
            .filter(Boolean)
            .map((text, i) => ({ text, timerSec: d.steps[i]?.text === text ? (d.steps[i]?.timerSec ?? null) : null }));
          const num = (k: string) => (fd.get(k) ? Number(fd.get(k)) : null);
          try {
            const r = await saveRecipeAction(
              {
                title: String(fd.get("title")),
                description: String(fd.get("description") || "") || null,
                servings: Number(fd.get("servings")),
                prepMin: num("prep"),
                cookMin: num("cook"),
                imageUrl: String(fd.get("image") || "") || null,
                sourceUrl: d.sourceUrl ?? null,
                sourceType: d.sourceType ?? "manual",
                tags: String(fd.get("tags") || "").split(",").map((t) => t.trim()).filter(Boolean),
                freezable: fd.get("freezable") === "on",
                fridgeDays: num("fridge"),
                totalWeightG: num("weight"),
                ingredients,
                steps: stepList,
              },
              recipeId,
              estimateId,
            );
            toast.success(r.missing ? `Receta guardada. ${r.missing} ingrediente(s) sin cantidad o sin alimento: revisa la nutrición.` : "Receta guardada");
            router.push(`/recetas/${r.id}`);
          } catch (e) {
            toast.error(errorText(e, "No se pudo guardar"));
          }
        })
      )}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_7rem_7rem_7rem]">
        <Field label="Título">
          <Input name="title" required maxLength={200} defaultValue={d.title} />
        </Field>
        <Field label="Raciones">
          <Input name="servings" type="number" min={0.5} max={100} step={0.5} required defaultValue={d.servings} />
        </Field>
        <Field label="Prep. (min)">
          <Input name="prep" type="number" min={0} defaultValue={d.prepMin ?? ""} />
        </Field>
        <Field label="Cocción (min)">
          <Input name="cook" type="number" min={0} defaultValue={d.cookMin ?? ""} />
        </Field>
      </div>
      <Field label="Descripción">
        <Textarea name="description" rows={2} maxLength={2000} defaultValue={d.description ?? ""} />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Ingredientes" hint="Uno por línea con cantidad: «200 g de garbanzos cocidos», «2 dientes de ajo». «## Para la salsa» abre una sección.">
          <Textarea rows={14} value={ings} onChange={(e) => setIngs(e.target.value)} required className="font-mono text-sm" />
        </Field>
        <Field label="Pasos" hint="Separa los pasos con una línea en blanco o numéralos.">
          <Textarea rows={14} value={steps} onChange={(e) => setSteps(e.target.value)} className="text-sm" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Etiquetas" className="sm:col-span-2" hint="Separadas por comas">
          <Input name="tags" defaultValue={(d.tags ?? []).join(", ")} placeholder="legumbres, rápida, táper" />
        </Field>
        <Field label="Peso final (g)" hint="Opcional, mejora la nutrición por 100 g">
          <Input name="weight" type="number" min={1} defaultValue={d.totalWeightG ?? ""} />
        </Field>
        <Field label="Días en nevera">
          <Input name="fridge" type="number" min={0} max={30} defaultValue={d.fridgeDays ?? 3} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Imagen (URL)">
          <Input name="image" type="url" defaultValue={d.imageUrl ?? ""} />
        </Field>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" name="freezable" defaultChecked={d.freezable ?? false} className="accent-[var(--herb)]" /> Se puede congelar
        </label>
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Calculando nutrición…" : "Guardar receta"}
      </Button>
    </form>
  );
}

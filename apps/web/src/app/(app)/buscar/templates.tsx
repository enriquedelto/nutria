"use client";
import { Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { deleteTemplate, logTemplateAction } from "@/actions/diary";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { useSafeTransition } from "@/lib/use-safe-transition";

export type TemplateBrief = { id: string; name: string; mealSlot: string | null; useCount: number; items: { name: string; grams: number }[] };

/** Saved meals: one tap logs all their foods in the meal being edited. */
export function Templates({ personId, date, slot, slotLabel, templates }: { personId: string; date: string; slot: string; slotLabel: string; templates: TemplateBrief[] }) {
  const [pending, start] = useSafeTransition();
  if (!templates.length)
    return (
      <Empty title="Aún no tienes plantillas">
        Abre el menú «Más opciones» de una comida ya registrada y elige «Guardar como plantilla». Después la registras aquí en un toque.
      </Empty>
    );
  return (
    <ul className="divide-y divide-line rounded-card border border-line bg-card">
      {templates.map((t) => (
        <li key={t.id} className="flex items-center gap-2 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{t.name}</p>
            <p className="truncate text-xs text-ink-3">
              {t.items.map((i) => `${i.name} ${Math.round(i.grams)} g`).join(" · ")}
              {t.useCount ? ` · usada ${t.useCount} ${t.useCount === 1 ? "vez" : "veces"}` : ""}
            </p>
          </div>
          <Button
            size="sm"
            disabled={pending}
            aria-label={`Registrar ${t.name} en ${slotLabel}`}
            onClick={() =>
              start(async () => {
                const n = await logTemplateAction(personId, t.id, date, slot);
                toast.success(`${t.name}: ${n} ${n === 1 ? "alimento registrado" : "alimentos registrados"} en ${slotLabel.toLowerCase()}`);
              })
            }
          >
            <Zap /> Registrar
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={pending}
            aria-label={`Borrar la plantilla ${t.name}`}
            onClick={() =>
              start(async () => {
                await deleteTemplate(personId, t.id);
                toast("Plantilla borrada");
              })
            }
          >
            <Trash2 />
          </Button>
        </li>
      ))}
    </ul>
  );
}

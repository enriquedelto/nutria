"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BookmarkPlus } from "lucide-react";
import { toast } from "sonner";
import { saveMealTemplate, setDayStatus } from "@/actions/diary";
import { Button } from "@/components/ui/button";
import { useSafeTransition } from "@/lib/use-safe-transition";

const KINDS: Record<string, "usual" | "yesterday" | "shake"> = { siempre: "usual", ayer: "yesterday", batido: "shake" };

/** App shortcuts: /hoy?rapido=batido | ayer | siempre log in one tap and clean the URL. */
export function QuickParam() {
  const params = useSearchParams();
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    const kind = KINDS[params.get("rapido") ?? ""];
    if (!kind || done.current) return;
    done.current = true;
    void (async () => {
      try {
        const r = (await (await fetch("/api/diary/quick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) })).json()) as { ok: boolean; message: string };
        if (r.ok) toast.success(r.message);
        else toast.error(r.message);
      } catch {
        toast.error("Sin conexión: no se pudo registrar");
      }
      router.replace("/hoy");
      router.refresh();
    })();
  }, [params, router]);
  return null;
}

/** «You have eaten this three times: save it as a template?» */
export function TemplateSuggestion({ personId, slot, slotLabel, date, times, names }: { personId: string; slot: string; slotLabel: string; date: string; times: number; names: string[] }) {
  const [pending, start] = useSafeTransition();
  const name = `${slotLabel}: ${names.slice(0, 2).join(" y ")}`.slice(0, 80);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-dashed border-herb/50 bg-herb-soft/40 px-4 py-3 text-sm">
      <p className="min-w-0">
        Has repetido <strong>{names.slice(0, 3).join(", ")}</strong>
        {names.length > 3 ? ` y ${names.length - 3} más` : ""} en {slotLabel.toLowerCase()} {times} veces en dos semanas. Guárdalo y regístralo en un toque.
      </p>
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await saveMealTemplate(personId, date, slot, name);
            toast.success("Plantilla guardada. La tienes en Buscar › Plantillas");
          })
        }
      >
        <BookmarkPlus /> Guardar plantilla
      </Button>
    </div>
  );
}

/** Yesterday looks partly logged: ask, so averages and the report do not take it as under-eating. */
export function YesterdayCheck({ personId, date, kcal }: { personId: string; date: string; kcal: number }) {
  const [pending, start] = useSafeTransition();
  const mark = (status: "complete" | "incomplete") =>
    start(async () => {
      await setDayStatus(personId, date, status);
      toast.success(status === "complete" ? "Ayer, marcado como completo" : "Ayer, marcado como incompleto: no contará en las medias");
    });
  return (
    <div className="rounded-card border border-dashed border-line bg-paper-2 px-4 py-3 text-sm">
      <p>
        Ayer registraste <strong className="num">{Math.round(kcal)} kcal</strong>, menos de la mitad de tu objetivo. ¿Fue un día completo?
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={() => mark("complete")}>
          Sí, comí eso
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => mark("incomplete")}>
          No, falta algo
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link href={`/diario?fecha=${date}`}>Añadir lo que falta</Link>
        </Button>
      </div>
    </div>
  );
}

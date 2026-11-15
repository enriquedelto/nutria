"use client";
import { useEffect, useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { Link2, Loader2, Sparkles, Video } from "lucide-react";
import { toast } from "sonner";
import { importRecipe, recipeFromText, videoImportStatus, type ImportResult } from "@/actions/recipes";
import { RecipeForm } from "@/components/kitchen/recipe-form";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";

export function ImportClient({ initialUrl, estimateId }: { initialUrl?: string; estimateId?: string }) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [text, setText] = useState("");
  const [res, setRes] = useState<ImportResult | null>(estimateId ? { kind: "pending", estimateId } : null);
  const [pending, start] = useSafeTransition();

  const run = (fn: () => Promise<ImportResult>) =>
    start(async () => {
      const r = await fn();
      if (r.kind === "error") toast.error(r.message);
      setRes(r.kind === "error" ? null : r);
    });

  // Auto-start when opened from the share target (?url=).
  useEffect(() => {
    if (initialUrl && !estimateId) run(() => importRecipe(initialUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll background video imports.
  useEffect(() => {
    if (res?.kind !== "pending") return;
    const t = setInterval(async () => {
      const r = await videoImportStatus(res.estimateId);
      if (r.kind !== "pending") {
        if (r.kind === "error") toast.error(r.message);
        setRes(r.kind === "error" ? null : r);
      }
    }, 4000);
    return () => clearInterval(t);
  }, [res]);

  if (res?.kind === "draft")
    return (
      <Card>
        <CardHeader title="Revisa la receta" subtitle={res.via === "jsonld" ? "Leída de los datos estructurados de la web" : "Estructurada por la IA: comprueba cantidades y pasos"} action={<Button variant="ghost" size="sm" onClick={() => setRes(null)}>Otra</Button>} />
        <RecipeForm initial={res.draft} estimateId={res.estimateId} />
      </Card>
    );

  if (res?.kind === "pending")
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Video className="size-10 text-herb" />
          <p className="font-display text-xl font-semibold">Procesando el vídeo…</p>
          <p className="max-w-md text-sm text-ink-2">Descargo el audio, lo transcribo y la IA extrae la receta. Tarda uno o dos minutos; puedes salir, te avisaré cuando esté lista.</p>
          <Loader2 className="animate-spin text-ink-3" />
        </div>
      </Card>
    );

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader title="Desde un enlace" subtitle="Webs de recetas, YouTube, TikTok o Instagram" />
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => importRecipe(url));
          }}
        >
          <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" required />
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Link2 />} Importar
          </Button>
        </form>
        <p className="mt-2 text-xs text-ink-3">En Android también puedes «Compartir → Nutria» desde el navegador o la app del vídeo.</p>
      </Card>
      <Card>
        <CardHeader title="Pegar texto" subtitle="De un mensaje, una foto con texto copiado o tu libreta" />
        <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Lentejas de la abuela: 300 g de lentejas, 1 cebolla…" />
        <Button className="mt-2" variant="soft" disabled={pending || text.trim().length < 20} onClick={() => run(() => recipeFromText(text))}>
          <Sparkles /> Estructurar con IA
        </Button>
      </Card>
    </div>
  );
}

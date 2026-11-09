"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/errors";
import { fileToBase64, fileToJpeg } from "@/lib/image";

/** Photo(s) or the PDF of a digital receipt → AI reading → review page. */
export function ReceiptScan({ listId }: { listId: string | null }) {
  const [busy, setBusy] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      const all = [...list];
      const pdf = all.find((f) => f.type === "application/pdf");
      const body: Record<string, unknown> = { listId };
      if (pdf) {
        if (pdf.size > 10 * 1024 * 1024) throw new Error("PDF demasiado grande (máx. 10 MB)");
        body.pdf = await fileToBase64(pdf);
      } else {
        // Long receipts read better with more pixels on the long side.
        body.images = await Promise.all(all.slice(0, 4).map(async (f) => {
          const j = await fileToJpeg(f, 2400, 0.86);
          return { mediaType: j.mediaType, data: j.data };
        }));
      }
      const res = await fetch("/api/receipts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error ?? "No se pudo leer el ticket");
      toast.success(`${out.lines} líneas leídas. Revísalas antes de guardar.`);
      router.push(`/compra/tickets/${out.id}`);
    } catch (e) {
      toast.error(errorText(e, "No se pudo leer el ticket"));
      setBusy(false);
    } finally {
      for (const r of [camera, files]) if (r.current) r.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => camera.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Camera />} {busy ? "Leyendo el ticket…" : "Escanear ticket"}
        </Button>
        <Button variant="outline" onClick={() => files.current?.click()} disabled={busy}>
          <FileUp /> Subir foto o PDF
        </Button>
      </div>
      <p className="text-xs text-ink-3">Si es largo, haz varias fotos de arriba abajo. La IA lee las líneas y tú lo revisas antes de guardar; los datos de pago no se guardan.</p>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void upload(e.target.files)} aria-label="Foto del ticket" />
      <input ref={files} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => void upload(e.target.files)} aria-label="Archivo del ticket" />
    </div>
  );
}

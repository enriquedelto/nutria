"use client";
import { useEffect, useRef, useState } from "react";
import { Flashlight } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

type Detector = { detect(src: HTMLVideoElement): Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => Detector;
  }
}

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];

/** Camera barcode scanner: native BarcodeDetector when available, @zxing/browser otherwise. */
export function Scanner({ open, onClose, onCode }: { open: boolean; onClose: () => void; onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState<null | ((on: boolean) => void)>(null);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stop = () => {};
    let cancelled = false;
    const done = (code: string) => {
      if (cancelled) return;
      cancelled = true;
      navigator.vibrate?.(60);
      stop();
      onCode(code);
    };
    (async () => {
      try {
        if (window.BarcodeDetector && video.current) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
          const v = video.current;
          v.srcObject = stream;
          await v.play();
          const track = stream.getVideoTracks()[0];
          const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
          if (caps.torch) setTorch(() => (on: boolean) => void track!.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }));
          const det = new window.BarcodeDetector({ formats: FORMATS });
          let raf = 0;
          const tick = async () => {
            if (cancelled) return;
            try {
              const [hit] = await det.detect(v);
              if (hit?.rawValue) return done(hit.rawValue);
            } catch {
              /* frame not ready */
            }
            raf = requestAnimationFrame(() => void tick());
          };
          void tick();
          stop = () => {
            cancelAnimationFrame(raf);
            stream.getTracks().forEach((t) => t.stop());
          };
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, video.current!, (res) => {
            if (res) done(res.getText());
          });
          stop = () => controls.stop();
        }
      } catch (e) {
        setError(e instanceof Error && e.name === "NotAllowedError" ? "Necesito permiso para usar la cámara." : "No se pudo abrir la cámara.");
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, onCode]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Escanear código de barras" description="Apunta al código; se detecta solo.">
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video ref={video} className="aspect-[4/3] w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
          {torch ? (
            <button
              type="button"
              className="absolute bottom-3 right-3 rounded-full bg-black/60 p-2 text-white"
              onClick={() => {
                torch(!torchOn);
                setTorchOn(!torchOn);
              }}
              aria-label="Linterna"
            >
              <Flashlight className="size-5" />
            </button>
          ) : null}
        </div>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : <p className="mt-3 text-xs text-ink-3">También funciona un lector USB: escribe el código en el buscador y pulsa Intro.</p>}
      </DialogContent>
    </Dialog>
  );
}

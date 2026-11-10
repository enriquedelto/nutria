"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type SR = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void; onend: () => void; onerror: (e: { error: string }) => void };
declare global {
  interface Window {
    SpeechRecognition?: new () => SR;
    webkitSpeechRecognition?: new () => SR;
  }
}

/**
 * Dictation: Web Speech API when available (Chrome/Android), otherwise records audio and sends
 * it to /api/ai/transcribe (faster-whisper on the NUC).
 */
export function VoiceInput({ onText, className, autoStart = false }: { onText: (text: string, final: boolean) => void; className?: string; /** Start listening on mount (from the «Dictar» notification action). Browsers may still ask for a tap. */ autoStart?: boolean }) {
  const [state, setState] = useState<"idle" | "listening" | "recording" | "transcribing">("idle");
  const rec = useRef<SR | null>(null);
  const media = useRef<MediaRecorder | null>(null);
  useEffect(() => () => rec.current?.stop(), []);

  const start = async () => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (Ctor) {
      const r = new Ctor();
      r.lang = "es-ES";
      r.interimResults = true;
      r.continuous = true;
      r.onresult = (e) => {
        let text = "";
        let final = true;
        for (let i = 0; i < e.results.length; i++) {
          text += e.results[i]![0]!.transcript;
          final &&= e.results[i]!.isFinal;
        }
        onText(text.trim(), final);
      };
      r.onend = () => setState("idle");
      r.onerror = (e) => {
        if (e.error !== "aborted" && e.error !== "no-speech") toast.error("No se pudo usar el micrófono");
        setState("idle");
      };
      rec.current = r;
      r.start();
      setState("listening");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("transcribing");
        const fd = new FormData();
        fd.append("audio", new Blob(chunks, { type: mr.mimeType }), "voz.webm");
        const res = await fetch("/api/ai/transcribe", { method: "POST", body: fd });
        const d = await res.json().catch(() => ({}));
        if (res.ok) onText(d.text ?? "", true);
        else toast.error(d.error ?? "No se pudo transcribir");
        setState("idle");
      };
      media.current = mr;
      mr.start();
      setState("recording");
    } catch {
      toast.error("Necesito permiso para el micrófono");
    }
  };

  const stop = () => {
    rec.current?.stop();
    if (media.current?.state === "recording") media.current.stop();
  };

  const busy = state === "listening" || state === "recording";
  const auto = useRef(autoStart);
  useEffect(() => {
    if (!auto.current) return;
    auto.current = false;
    void start().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Button type="button" variant={busy ? "accent" : "outline"} size="lg" className={className} onClick={busy ? stop : start} disabled={state === "transcribing"} aria-pressed={busy}>
      {state === "transcribing" ? <Loader2 className="animate-spin" /> : busy ? <Square /> : <Mic />}
      {state === "transcribing" ? "Transcribiendo…" : busy ? "Parar" : "Dictar"}
    </Button>
  );
}

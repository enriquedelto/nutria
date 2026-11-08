"use client";
import { errorText } from "@/lib/errors";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Check, ImagePlus, Loader2, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "@/components/markdown";
import { VoiceInput } from "@/components/voice-input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { fileToJpeg, type B64Image } from "@/lib/image";
import { cn } from "@/lib/utils";

export type ChatProposal = { kind: string; summary: string; status?: string };
export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; proposals: ChatProposal[]; tools?: string[] };

const TOOL_LABELS: Record<string, string> = {
  search_foods: "buscando alimentos",
  get_food: "mirando un alimento",
  nutrient_ranking: "comparando nutrientes",
  get_diary: "leyendo tu diario",
  get_targets: "revisando objetivos",
  get_profile: "leyendo tu perfil",
  get_weight: "mirando tu peso",
  get_forecast: "calculando la previsión",
  get_exercise: "mirando el ejercicio",
  get_sleep: "mirando el sueño",
  get_cycle: "mirando el ciclo",
  get_symptoms: "revisando síntomas",
  get_labs: "leyendo analíticas",
  get_medications: "revisando medicación",
  get_pantry: "mirando la despensa",
  get_recipes: "buscando recetas",
};

const SUGGESTIONS = ["¿Qué como ahora con lo que me queda hoy?", "¿Cómo voy esta semana con la proteína?", "Dame ideas de cena rápida y con hierro", "¿Por qué no bajo de peso?"];

export function Chat({ personId, conversationId: initialId, initial, personName, prompt }: { personId: string; conversationId: string | null; initial: ChatMessage[]; personName: string; prompt?: string }) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(initialId);
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [input, setInput] = useState(prompt ?? "");
  const [images, setImages] = useState<B64Image[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const files = useRef<HTMLInputElement>(null);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages, tool]);

  const send = async (text: string) => {
    if (!text.trim() || streaming) return;
    const userMsg: ChatMessage = { id: `u${Date.now()}`, role: "user", content: text, proposals: [] };
    const draft: ChatMessage = { id: "draft", role: "assistant", content: "", proposals: [] };
    setMessages((m) => [...m, userMsg, draft]);
    setInput("");
    const imgs = images;
    setImages([]);
    setStreaming(true);
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personId, conversationId: conversationId ?? undefined, message: text, images: imgs.length ? imgs.map(({ mediaType, data }) => ({ mediaType, data })) : undefined }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? "No se pudo contactar con el coach");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const l of lines) {
          if (!l.trim()) continue;
          const ev = JSON.parse(l) as { type: string; d?: string; name?: string; error?: string; conversationId?: string; messageId?: string; text?: string; proposals?: ChatProposal[] };
          if (ev.type === "text") {
            setTool(null);
            setMessages((m) => m.map((x) => (x.id === "draft" ? { ...x, content: x.content + ev.d } : x)));
          } else if (ev.type === "tool") setTool(ev.name!);
          else if (ev.type === "done") {
            setTool(null);
            if (!conversationId) {
              setConversationId(ev.conversationId!);
              window.history.replaceState(null, "", `/coach?c=${ev.conversationId}`);
            }
            setMessages((m) => m.map((x) => (x.id === "draft" ? { ...x, id: ev.messageId!, content: ev.text || x.content, proposals: ev.proposals ?? [] } : x)));
          } else if (ev.type === "error") throw new Error(ev.error);
        }
      }
    } catch (e) {
      toast.error(errorText(e, "Error del coach"));
      setMessages((m) => m.filter((x) => x.id !== "draft" || x.content));
    } finally {
      setStreaming(false);
      setTool(null);
      router.refresh();
    }
  };

  const act = async (messageId: string, index: number, action: "apply" | "dismiss") => {
    const res = await fetch("/api/ai/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId, index, action }) });
    const d = await res.json();
    if (!res.ok) return toast.error(d.error ?? "No se pudo aplicar");
    setMessages((m) => m.map((x) => (x.id === messageId ? { ...x, proposals: x.proposals.map((p, i) => (i === index ? { ...p, status: action === "apply" ? "applied" : "dismissed" } : p)) } : x)));
    if (action === "apply") toast.success("Hecho");
    router.refresh();
  };

  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col">
      <div className="flex-1 space-y-4 pb-4">
        {!messages.length ? (
          <div className="space-y-4 py-6 text-center">
            <p className="font-display text-2xl">¿En qué te ayudo{personName ? `, ${personName.split(" ")[0]}` : ""}?</p>
            <p className="mx-auto max-w-md text-sm text-ink-2">El coach ve tu diario, objetivos y salud (según los permisos) y puede proponer cambios que tú confirmas.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-line bg-card px-3 py-1.5 text-sm hover:bg-paper-2">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[88%] rounded-3xl px-4 py-3", m.role === "user" ? "rounded-br-md bg-herb text-herb-ink" : "rounded-bl-md border border-line bg-card")}>
              {m.role === "assistant" ? (
                m.content ? <Markdown text={m.content} /> : <Loader2 className="size-4 animate-spin text-ink-3" />
              ) : (
                <p className="whitespace-pre-wrap">{m.content}</p>
              )}
              {m.proposals.length ? (
                <ul className="mt-3 space-y-2">
                  {m.proposals.map((p, i) => (
                    <li key={i} className="rounded-2xl bg-paper-2 p-3 text-sm">
                      <p className="font-medium">{p.summary}</p>
                      {p.status === "applied" ? (
                        <p className="mt-1 flex items-center gap-1 text-ok">
                          <Check className="size-4" /> Aplicado
                        </p>
                      ) : p.status === "dismissed" ? (
                        <p className="mt-1 text-ink-3">Descartado</p>
                      ) : (
                        <div className="mt-2 flex gap-2">
                          <Button size="sm" onClick={() => void act(m.id, i, "apply")} disabled={m.id === "draft"}>
                            <Check /> Aplicar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void act(m.id, i, "dismiss")} disabled={m.id === "draft"}>
                            Descartar
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ))}
        {tool ? (
          <p className="flex items-center gap-2 text-sm text-ink-3">
            <Wrench className="size-4" /> {TOOL_LABELS[tool] ?? tool}…
          </p>
        ) : null}
        <div ref={bottom} />
      </div>

      <form
        className="sticky bottom-20 rounded-3xl border border-line bg-card p-2 shadow-lg lg:bottom-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        {images.length ? (
          <div className="mb-2 flex gap-2 px-1">
            {images.map((im, i) => (
              <span key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.preview} alt="" className="size-14 rounded-xl object-cover" />
                <button type="button" className="absolute -right-1 -top-1 rounded-full bg-ink p-0.5 text-paper" onClick={() => setImages((xs) => xs.filter((_, j) => j !== i))} aria-label="Quitar">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <button type="button" className="grid size-10 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-paper-2" onClick={() => files.current?.click()} aria-label="Adjuntar foto">
            <ImagePlus className="size-5" />
          </button>
          <input
            ref={files}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={async (e) => {
              const fs = [...(e.target.files ?? [])].slice(0, 4);
              setImages(await Promise.all(fs.map((f) => fileToJpeg(f))));
            }}
          />
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder="Pregunta al coach…"
            className="max-h-40 min-h-10 flex-1 resize-none border-0 bg-transparent py-2 focus:ring-0"
            aria-label="Mensaje"
          />
          <VoiceInput onText={(t) => setInput(t)} className="hidden h-10 px-3 sm:inline-flex" />
          <Button type="submit" size="icon" disabled={streaming || !input.trim()} aria-label="Enviar">
            {streaming ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
      </form>
      <p className="mt-2 text-center text-[11px] text-ink-3">Orientativo; no sustituye el consejo de un profesional sanitario.</p>
    </div>
  );
}

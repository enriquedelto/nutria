"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { History, Loader2, MessageSquarePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ConversationItem = { id: string; title: string | null; date: string };

/** Past coach conversations: open one, or delete it (asking first, inside the list). */
export function ConversationList({ convs, current, onNavigate }: { convs: ConversationItem[]; current: string | null; onNavigate?: () => void }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const remove = async (id: string) => {
    setDeleting(id);
    try {
      const res = await fetch("/api/ai/coach", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: id }) });
      if (!res.ok) throw new Error();
      toast.success("Conversación borrada");
      if (id === current) {
        onNavigate?.();
        router.push("/coach");
      } else router.refresh();
    } catch {
      toast.error("No se pudo borrar la conversación");
    } finally {
      setDeleting(null);
      setConfirming(null);
    }
  };

  if (!convs.length) return <p className="px-3 py-2 text-sm text-ink-3">Aún no hay conversaciones.</p>;
  return (
    <ul className="space-y-0.5" aria-label="Conversaciones anteriores">
      {convs.map((c) => {
        const title = c.title ?? "Conversación";
        return (
          <li key={c.id} className={cn("group flex items-center gap-1 rounded-xl hover:bg-paper-2", c.id === current && "bg-paper-2")}>
            {confirming === c.id ? (
              <div className="flex flex-1 items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">¿Borrar «{title}»?</span>
                <Button size="sm" variant="danger" disabled={deleting === c.id} onClick={() => void remove(c.id)}>
                  {deleting === c.id ? <Loader2 className="animate-spin" /> : null} Borrar
                </Button>
                <Button size="sm" variant="ghost" disabled={deleting === c.id} onClick={() => setConfirming(null)}>
                  No
                </Button>
              </div>
            ) : (
              <>
                <Link href={`/coach?c=${c.id}`} onClick={onNavigate} className={cn("min-w-0 flex-1 px-3 py-2 text-sm", c.id === current && "font-medium")} aria-current={c.id === current ? "page" : undefined}>
                  <span className="block truncate">{title}</span>
                  <span className="text-xs text-ink-3">{c.date}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => setConfirming(c.id)}
                  className="mr-1 grid size-9 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-card hover:text-danger lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
                  aria-label={`Borrar conversación «${title}»`}
                >
                  <Trash2 className="size-4" />
                </button>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Phones: the list lives in a sheet opened from the coach header. */
export function ConversationsSheet({ convs, current }: { convs: ConversationItem[]; current: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <History /> Conversaciones{convs.length ? ` (${convs.length})` : ""}
        </Button>
      </DialogTrigger>
      <DialogContent title="Conversaciones">
        <Button asChild className="mb-3 w-full" variant="soft">
          <Link href="/coach" onClick={() => setOpen(false)}>
            <MessageSquarePlus /> Nueva conversación
          </Link>
        </Button>
        <ConversationList convs={convs} current={current} onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

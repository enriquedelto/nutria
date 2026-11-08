import { Suspense } from "react";
import Link from "next/link";
import { Brain, MessageSquarePlus } from "lucide-react";
import { aiConversations, aiMessages, and, asc, desc, eq } from "@nutria/db";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { aiConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { dateShort } from "@/lib/format";
import { getPersonContext } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Chat, type ChatMessage, type ChatProposal } from "./chat";

export const metadata = { title: "Coach" };

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getPersonContext();
  if (!aiConfigured() || !ctx.scopes.has("ai")) {
    return <Card>El coach necesita la IA configurada en el servidor y permiso de IA para {ctx.person.name}.</Card>;
  }
  const convs = await db()
    .select({ id: aiConversations.id, title: aiConversations.title, updatedAt: aiConversations.updatedAt })
    .from(aiConversations)
    .where(and(eq(aiConversations.personId, ctx.person.id), eq(aiConversations.userId, ctx.user.id), eq(aiConversations.kind, "coach")))
    .orderBy(desc(aiConversations.updatedAt))
    .limit(30);
  const current = sp.c && convs.some((c) => c.id === sp.c) ? sp.c : null;
  const msgs = current ? await db().select().from(aiMessages).where(eq(aiMessages.conversationId, current)).orderBy(asc(aiMessages.createdAt)) : [];
  const initial: ChatMessage[] = msgs
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      proposals: ((m.parts ?? []) as { type: string; kind?: string; summary?: string; status?: string }[]).filter((p) => p.type === "proposal").map((p) => ({ kind: p.kind!, summary: p.summary!, status: p.status }) satisfies ChatProposal),
    }));
  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
      <aside className="hidden space-y-2 lg:block">
        <Button asChild className="w-full" variant="soft">
          <Link href="/coach">
            <MessageSquarePlus /> Nueva conversación
          </Link>
        </Button>
        <Link href="/coach/memoria" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-2 hover:bg-paper-2">
          <Brain className="size-4" /> Lo que recuerda
        </Link>
        <ul className="space-y-0.5">
          {convs.map((c) => (
            <li key={c.id}>
              <Link href={`/coach?c=${c.id}`} className={cn("block rounded-xl px-3 py-2 text-sm hover:bg-paper-2", c.id === current && "bg-paper-2 font-medium")}>
                <span className="block truncate">{c.title ?? "Conversación"}</span>
                <span className="text-xs text-ink-3">{dateShort(c.updatedAt.toISOString().slice(0, 10))}</span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <div>
        <div className="mb-3 flex items-center justify-between lg:hidden">
          <Link href="/coach/memoria" className="flex items-center gap-1 text-sm text-ink-2">
            <Brain className="size-4" /> Memoria
          </Link>
          {current ? (
            <Link href="/coach" className="text-sm text-herb">
              Nueva conversación
            </Link>
          ) : null}
        </div>
        <Chat key={current ?? "new"} personId={ctx.person.id} conversationId={current} initial={initial} personName={ctx.person.isSelf ? ctx.user.name : ctx.person.name} prompt={!current && sp.q ? sp.q.slice(0, 500) : undefined} />
      </div>
    </div>
  );
}

export default function CoachPage({ searchParams }: PageProps<"/coach">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Content searchParams={searchParams as Promise<Record<string, string | undefined>>} />
    </Suspense>
  );
}

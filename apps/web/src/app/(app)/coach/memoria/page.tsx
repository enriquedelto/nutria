import { Suspense } from "react";
import { aiConversations, aiMemories, and, desc, eq, groups } from "@nutria/db";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { requireScope } from "@/lib/session";
import { MemoryClient } from "./memory-client";

export const metadata = { title: "Memoria del coach" };

async function Content() {
  const ctx = await requireScope("ai");
  const [mems, last, group] = await Promise.all([
    db().select().from(aiMemories).where(eq(aiMemories.personId, ctx.person.id)).orderBy(desc(aiMemories.createdAt)),
    db().select({ id: aiConversations.id }).from(aiConversations).where(and(eq(aiConversations.personId, ctx.person.id), eq(aiConversations.userId, ctx.user.id))).orderBy(desc(aiConversations.updatedAt)).limit(1),
    ctx.person.groupId ? db().select().from(groups).where(eq(groups.id, ctx.person.groupId)).limit(1) : Promise.resolve([]),
  ]);
  return (
    <MemoryClient
      personId={ctx.person.id}
      memories={mems.map((m) => ({ id: m.id, category: m.category, contentMd: m.contentMd, source: m.source }))}
      groupId={group[0]?.id ?? null}
      household={group[0]?.preferencesMd ?? ""}
      lastConversationId={last[0]?.id ?? null}
      canWrite={ctx.canWrite}
    />
  );
}

export default function MemoryPage() {
  return (
    <>
      <PageHeader title="Lo que recuerda el coach" subtitle="Preferencias y datos que usa en cada conversación. Puedes editarlos o borrarlos." />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}

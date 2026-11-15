import { Suspense } from "react";
import { AdminLink, BottomTabs, Sidebar } from "@/components/nav";
import { HIDEABLE_SECTIONS } from "@/lib/sections";
import { PersonSwitcher } from "@/components/person-switcher";
import { QueueBadge } from "@/components/queue-badge";
import { getPersonContext } from "@/lib/session";

async function Switcher() {
  const ctx = await getPersonContext();
  return <PersonSwitcher persons={ctx.persons} activeId={ctx.person.id} userName={ctx.user.name} />;
}

async function MaybeAdmin() {
  const ctx = await getPersonContext();
  return ctx.user.role === "admin" ? <AdminLink /> : null;
}

async function UserSidebar({ admin }: { admin: React.ReactNode }) {
  const ctx = await getPersonContext();
  return <Sidebar admin={admin} hidden={ctx.hiddenSections} />;
}

/** Static chrome; everything session-dependent streams behind Suspense. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      {/* While the hidden sections load, show only the fixed ones: items appear, never vanish. */}
      <Suspense fallback={<Sidebar hidden={HIDEABLE_SECTIONS} />}>
        <UserSidebar
          admin={
            <Suspense>
              <MaybeAdmin />
            </Suspense>
          }
        />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-paper/90 px-4 py-2.5 backdrop-blur lg:px-8">
          <a href="/hoy" className="flex items-center gap-2 lg:invisible">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon.svg" alt="" className="size-7" />
            <span className="font-display text-lg font-semibold">Nutria</span>
          </a>
          <div className="flex items-center gap-2">
            <QueueBadge />
            <Suspense fallback={<div className="h-9 w-32 animate-pulse rounded-full bg-paper-2" />}>
              <Switcher />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-4 lg:px-8 lg:pb-10">{children}</main>
      </div>
      <BottomTabs />
    </div>
  );
}

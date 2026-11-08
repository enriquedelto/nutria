"use client";
import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BookOpen,
  CalendarDays,
  ChefHat,
  HeartPulse,
  Home,
  LineChart,
  MessageCircle,
  Package,
  Plus,
  Search,
  Settings,
  Shield,
  ShoppingCart,
  Trophy,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const SECTIONS = [
  { href: "/hoy", label: "Hoy", icon: Home },
  { href: "/diario", label: "Diario", icon: BookOpen },
  { href: "/buscar", label: "Buscar", icon: Search },
  { href: "/registrar", label: "Registrar", icon: Plus },
  { href: "/coach", label: "Coach", icon: MessageCircle },
  { href: "/progreso", label: "Progreso", icon: LineChart },
  { href: "/salud", label: "Salud", icon: HeartPulse },
  { href: "/recetas", label: "Recetas", icon: ChefHat },
  { href: "/planes", label: "Planes", icon: CalendarDays },
  { href: "/despensa", label: "Despensa", icon: Package },
  { href: "/compra", label: "Compra", icon: ShoppingCart },
  { href: "/familia", label: "Familia", icon: Users },
  { href: "/retos", label: "Retos", icon: Trophy },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
] as const;

const isActive = (path: string, href: string) => path === href || path.startsWith(href + "/");

/** usePathname is request-time data: render inactive links in the static shell, then the live one. */
export function Sidebar({ admin }: { admin?: React.ReactNode }) {
  return (
    <Suspense fallback={<SidebarView path="" admin={admin} />}>
      <LiveSidebar admin={admin} />
    </Suspense>
  );
}

function LiveSidebar({ admin }: { admin?: React.ReactNode }) {
  return <SidebarView path={usePathname()} admin={admin} />;
}

function SidebarView({ path, admin }: { path: string; admin?: React.ReactNode }) {
  return (
    <nav aria-label="Secciones" className="no-print sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line px-3 py-5 lg:flex">
      <Link href="/hoy" className="mb-4 flex items-center gap-2 px-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon.svg" alt="" className="size-8" />
        <span className="font-display text-xl font-semibold">Nutria</span>
      </Link>
      {SECTIONS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-ink-2 hover:bg-paper-2", isActive(path, href) && "bg-herb-soft text-herb")}
        >
          <Icon className="size-4" /> {label}
        </Link>
      ))}
      {admin}
    </nav>
  );
}

export function AdminLink() {
  return (
    <Suspense fallback={<AdminLinkView path="" />}>
      <LiveAdminLink />
    </Suspense>
  );
}

function LiveAdminLink() {
  return <AdminLinkView path={usePathname()} />;
}

function AdminLinkView({ path }: { path: string }) {
  return (
    <Link href="/admin" className={cn("mt-2 flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-ink-2 hover:bg-paper-2", isActive(path, "/admin") && "bg-herb-soft text-herb")}>
      <Shield className="size-4" /> Administración
    </Link>
  );
}

const TABS = [
  { href: "/hoy", label: "Hoy", icon: Home },
  { href: "/diario", label: "Diario", icon: BookOpen },
  { href: "/registrar", label: "Registrar", icon: Plus, primary: true },
  { href: "/coach", label: "Coach", icon: MessageCircle },
  { href: "/mas", label: "Más", icon: Activity },
] as const;

export function BottomTabs() {
  return (
    <Suspense fallback={<BottomTabsView path="" />}>
      <LiveBottomTabs />
    </Suspense>
  );
}

function LiveBottomTabs() {
  return <BottomTabsView path={usePathname()} />;
}

function BottomTabsView({ path }: { path: string }) {
  return (
    <nav aria-label="Principal" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 backdrop-blur safe-bottom lg:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.href === "/mas" ? !TABS.some((x) => x.href !== "/mas" && isActive(path, x.href)) : isActive(path, t.href);
          return (
            <li key={t.href}>
              <Link href={t.href} className={cn("flex flex-col items-center gap-0.5 pb-1 pt-2 text-[11px] font-medium text-ink-3", active && "text-herb")} aria-current={active ? "page" : undefined}>
                {"primary" in t ? (
                  <span className="-mt-5 grid size-12 place-items-center rounded-full bg-persimmon text-white shadow-lg">
                    <Icon className="size-6" />
                  </span>
                ) : (
                  <Icon className="size-5" />
                )}
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Mobile "Más" grid: every section not in the bottom tabs. */
export function MoreGrid({ admin }: { admin?: boolean }) {
  const items = [...SECTIONS.filter((s) => !TABS.some((t) => t.href === s.href)), ...(admin ? [{ href: "/admin", label: "Administración", icon: Shield }] : [])];
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
      {items.map(({ href, label, icon: Icon }) => (
        <li key={href}>
          <Link href={href} className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-card p-4 text-sm font-medium hover:bg-paper-2">
            <Icon className="size-6 text-herb" /> {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

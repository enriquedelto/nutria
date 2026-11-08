"use client";
import { useTransition } from "react";
import { DropdownMenu } from "radix-ui";
import { Check, ChevronDown, LogOut, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { switchPerson } from "@/actions/person";
import { authClient } from "@/lib/auth-client";
import type { PersonSummary } from "@/lib/session";
import { cn } from "@/lib/utils";

const ROLE: Record<string, string> = { owner: "Tú", manager: "Gestionas", viewer: "Solo ver", professional: "Profesional" };

export function Avatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-semibold text-white" style={{ background: color, width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function PersonSwitcher({ persons, activeId, userName }: { persons: PersonSummary[]; activeId: string; userName: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const active = persons.find((p) => p.id === activeId) ?? persons[0]!;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={cn("flex items-center gap-2 rounded-full border border-line bg-card py-1 pl-1 pr-3 text-sm font-medium", pending && "opacity-60")}>
        <Avatar name={active.name} color={active.color} size={28} />
        <span className="max-w-28 truncate">{active.name}</span>
        <ChevronDown className="size-4 text-ink-3" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-60 rounded-2xl border border-line bg-card p-1.5 shadow-xl">
          <DropdownMenu.Label className="px-2 py-1 text-xs text-ink-3">Ver datos de</DropdownMenu.Label>
          {persons.map((p) => (
            <DropdownMenu.Item
              key={p.id}
              onSelect={() => start(() => switchPerson(p.id))}
              className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-sm outline-none data-[highlighted]:bg-paper-2"
            >
              <Avatar name={p.name} color={p.color} size={26} />
              <span className="flex-1">
                {p.name}
                <span className="block text-xs text-ink-3">{p.isChild ? "Peque" : (ROLE[p.role] ?? p.role)}</span>
              </span>
              {p.id === active.id ? <Check className="size-4 text-herb" /> : null}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item asChild className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-sm outline-none data-[highlighted]:bg-paper-2">
            <a href="/ajustes">
              <Settings className="size-4" /> Ajustes de {userName.split(" ")[0]}
            </a>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={async () => {
              await authClient.signOut();
              router.replace("/login");
              router.refresh();
            }}
            className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-sm text-danger outline-none data-[highlighted]:bg-paper-2"
          >
            <LogOut className="size-4" /> Cerrar sesión
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

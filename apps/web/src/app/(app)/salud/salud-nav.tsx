"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  ["/salud", "Resumen"],
  ["/salud/medicacion", "Medicación"],
  ["/salud/sintomas", "Síntomas"],
  ["/salud/analiticas", "Analíticas"],
  ["/salud/ayuno", "Ayuno"],
  ["/salud/ejercicio", "Ejercicio"],
  ["/salud/sueno", "Sueño"],
  ["/salud/ciclo", "Ciclo"],
  ["/salud/condiciones", "Condiciones"],
] as const;

export function SaludNav() {
  const path = usePathname();
  return (
    <nav aria-label="Salud" className="-mx-4 mb-4 overflow-x-auto px-4 print:hidden">
      <ul className="flex w-max gap-1.5">
        {ITEMS.map(([href, label]) => {
          const active = href === "/salud" ? path === href : path.startsWith(href);
          return (
            <li key={href}>
              <Link href={href} aria-current={active ? "page" : undefined} className={cn("block rounded-full border px-3 py-1.5 text-sm whitespace-nowrap", active ? "border-herb bg-herb text-herb-ink" : "border-line hover:bg-paper-2")}>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

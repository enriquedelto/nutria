"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Horizontal pill navigation for a section's subpages. The first item is the section root. */
export function SubNav({ label, items }: { label: string; items: readonly (readonly [string, string])[] }) {
  const path = usePathname();
  const root = items[0]?.[0];
  return (
    <nav aria-label={label} className="-mx-4 mb-4 overflow-x-auto px-4 print:hidden">
      <ul className="flex w-max gap-1.5">
        {items.map(([href, text]) => {
          const active = href === root ? path === href : path === href || path.startsWith(href + "/");
          return (
            <li key={href}>
              <Link href={href} aria-current={active ? "page" : undefined} className={cn("block whitespace-nowrap rounded-full border px-3 py-1.5 text-sm", active ? "border-herb bg-herb text-herb-ink" : "border-line hover:bg-paper-2")}>
                {text}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

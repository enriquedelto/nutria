"use client";
import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Horizontal pill navigation for a section's subpages. The first item is the section root. */
type Items = readonly (readonly [string, string])[];

export function SubNav({ label, items }: { label: string; items: Items }) {
  return (
    <Suspense fallback={<SubNavView label={label} items={items} path="" />}>
      <LiveSubNav label={label} items={items} />
    </Suspense>
  );
}

function LiveSubNav(p: { label: string; items: Items }) {
  return <SubNavView {...p} path={usePathname()} />;
}

function SubNavView({ label, items, path }: { label: string; items: Items; path: string }) {
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

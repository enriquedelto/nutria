"use client";
import { Tabs as T } from "radix-ui";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...p }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn("inline-flex max-w-full overflow-x-auto rounded-full bg-paper-2 p-1", className)} {...p} />;
}

export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof T.Trigger>) {
  return <T.Trigger className={cn("whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-ink-2 data-[state=active]:bg-card data-[state=active]:text-ink data-[state=active]:shadow-sm", className)} {...p} />;
}

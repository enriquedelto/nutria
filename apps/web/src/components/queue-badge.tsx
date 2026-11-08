"use client";
import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { pendingCount } from "@/lib/offline-queue";

/** Shows how many diary writes are waiting to sync; refreshes the page once they land. */
export function QueueBadge() {
  const [n, setN] = useState(0);
  const router = useRouter();
  useEffect(() => {
    const update = () => void pendingCount().then(setN);
    const synced = (e: Event) => {
      toast.success(`Sincronizado: ${(e as CustomEvent<number>).detail} registro(s) pendientes`);
      router.refresh();
    };
    update();
    window.addEventListener("nutria-queue", update);
    window.addEventListener("nutria-synced", synced);
    return () => {
      window.removeEventListener("nutria-queue", update);
      window.removeEventListener("nutria-synced", synced);
    };
  }, [router]);
  if (!n) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warn/20 px-2.5 py-1 text-xs font-medium" title="Pendiente de enviar">
      <CloudOff className="size-3.5" /> {n}
    </span>
  );
}

import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = { title: "No encontrado" };

/** 404 for notFound() and unmatched URLs (renders inside the root layout). */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon.svg" alt="" className="size-12" />
      <h1 className="font-display text-xl font-semibold">Esta página no existe</h1>
      <p className="text-sm text-ink-2">Puede que el enlace sea antiguo o que lo que buscabas se haya borrado.</p>
      <Button asChild>
        <Link href="/hoy">Volver a Hoy</Link>
      </Button>
    </main>
  );
}

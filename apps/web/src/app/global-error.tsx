"use client";
import "./globals.css";

/** Replaces the root layout when it fails: own <html>/<body>, theme from the OS (no app styles beyond globals). */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="es">
      <body className="min-h-dvh bg-paper text-ink">
        <title>Algo ha fallado · Nutria</title>
        <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon.svg" alt="" className="size-12" />
          <h1 className="font-display text-xl font-semibold">Nutria no ha podido arrancar</h1>
          <p className="text-sm text-ink-2">Puede ser un corte momentáneo del servidor. Prueba otra vez en unos segundos.</p>
          <button type="button" onClick={() => retry()} className="rounded-full bg-herb px-5 py-2 text-sm font-medium text-white">
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}

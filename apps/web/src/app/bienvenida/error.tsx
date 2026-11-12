"use client";
import { RouteError } from "@/components/route-error";

export default function WelcomeError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-xl px-5 py-10">
      <RouteError error={error} retry={retry} />
    </main>
  );
}

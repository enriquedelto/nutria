export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 py-10">
      <div className="mb-8 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon.svg" alt="" className="size-11" />
        <div>
          <p className="font-display text-2xl font-semibold leading-none">Nutria</p>
          <p className="text-sm text-ink-2">Comer bien, en casa y en familia</p>
        </div>
      </div>
      {children}
    </main>
  );
}

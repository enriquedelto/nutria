import { SaludNav } from "./salud-nav";

export default function SaludLayout({ children }: LayoutProps<"/salud">) {
  return (
    <>
      <SaludNav />
      {children}
      <p className="mt-8 text-xs text-ink-3">Nutria no sustituye a tu médico. Las alertas, análisis y correlaciones son orientativos.</p>
    </>
  );
}

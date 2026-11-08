import { SubNav } from "@/components/sub-nav";

const ITEMS = [
  ["/ajustes", "Perfil"],
  ["/ajustes/objetivos", "Objetivos"],
  ["/ajustes/comidas", "Comidas"],
  ["/ajustes/pantalla", "Pantalla"],
  ["/ajustes/notificaciones", "Avisos"],
  ["/ajustes/seguridad", "Seguridad"],
  ["/ajustes/integraciones", "Integraciones"],
  ["/ajustes/datos", "Datos"],
] as const;

export default function AjustesLayout({ children }: LayoutProps<"/ajustes">) {
  return (
    <>
      <SubNav label="Ajustes" items={ITEMS} />
      {children}
    </>
  );
}

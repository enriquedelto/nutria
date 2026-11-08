import { SubNav } from "@/components/sub-nav";

const ITEMS = [
  ["/salud", "Resumen"],
  ["/salud/medicacion", "Medicación"],
  ["/salud/sintomas", "Síntomas"],
  ["/salud/analiticas", "Analíticas"],
  ["/salud/ayuno", "Ayuno"],
  ["/salud/ejercicio", "Ejercicio"],
  ["/salud/sueno", "Sueño"],
  ["/salud/ciclo", "Ciclo"],
  ["/salud/condiciones", "Condiciones"],
] as const;

export function SaludNav() {
  return <SubNav label="Salud" items={ITEMS} />;
}

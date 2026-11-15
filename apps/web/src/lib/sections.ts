/** Sections that can be hidden from the menu (Ajustes › Pantalla). Hoy, Diario, Buscar, Registrar, Coach and Ajustes always show. */
export const HIDEABLE_SECTIONS = ["progreso", "salud", "recetas", "planes", "despensa", "compra", "familia", "retos"] as const;
export type HideableSection = (typeof HIDEABLE_SECTIONS)[number];

export const SECTION_LABELS: Record<HideableSection, string> = {
  progreso: "Progreso",
  salud: "Salud",
  recetas: "Recetas",
  planes: "Planes",
  despensa: "Despensa",
  compra: "Compra",
  familia: "Familia",
  retos: "Retos",
};

/** "/retos" or "/retos/x" → hidden when "retos" is in the list. */
export const isHidden = (href: string, hidden: readonly string[]) => hidden.includes(href.split("/")[1] ?? "");

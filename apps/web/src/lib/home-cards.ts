export const HOME_CARDS = ["calorias", "comidas", "agua", "micros", "peso", "racha", "ayuno", "medicacion", "suplementos", "actividad"] as const;
export const HOME_CARD_NAMES: Record<(typeof HOME_CARDS)[number], string> = {
  calorias: "Calorías y macros",
  comidas: "Comidas del día",
  agua: "Agua",
  micros: "Micronutrientes",
  peso: "Peso",
  racha: "Racha",
  ayuno: "Ayuno",
  medicacion: "Medicación",
  suplementos: "Suplementos",
  actividad: "Actividad",
};

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Nutria",
    short_name: "Nutria",
    description: "Diario de comidas, coach con IA y salud para toda la casa.",
    start_url: "/hoy",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f3ea",
    theme_color: "#1f6b58",
    lang: "es",
    categories: ["health", "food", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [
      { name: "Registrar comida", short_name: "Registrar", url: "/registrar", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Como ayer", short_name: "Como ayer", url: "/hoy?rapido=ayer", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Batido de proteína", short_name: "Batido", url: "/hoy?rapido=batido", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Escanear código", short_name: "Escanear", url: "/buscar?escanear=1", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Añadir agua", short_name: "Agua", url: "/hoy?agua=250", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Coach", short_name: "Coach", url: "/coach", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
    // Android "Compartir con…": recipe URLs, videos and photos land in /api/share-target.
    share_target: {
      action: "/api/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{ name: "files", accept: ["image/*", "application/pdf"] }],
      },
    },
  } as MetadataRoute.Manifest;
}

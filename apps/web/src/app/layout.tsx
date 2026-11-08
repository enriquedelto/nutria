import type { Metadata, Viewport } from "next";
import { Fraunces, Figtree } from "next/font/google";
import { Toaster } from "sonner";
import { ServiceWorker } from "@/components/sw-register";
import "./globals.css";

const display = Fraunces({ variable: "--font-display", subsets: ["latin"], axes: ["opsz", "SOFT"] });
const body = Figtree({ variable: "--font-body", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Nutria", template: "%s · Nutria" },
  description: "Diario de comidas, coach con IA y salud para toda la casa.",
  applicationName: "Nutria",
  appleWebApp: { capable: true, title: "Nutria", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f3ea" },
    { media: "(prefers-color-scheme: dark)", color: "#151c1a" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Theme before paint: localStorage("theme") = light | dark | system.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        {children}
        <Toaster position="top-center" richColors closeButton />
        <ServiceWorker />
      </body>
    </html>
  );
}

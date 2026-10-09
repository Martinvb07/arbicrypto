import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "./market.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "ArbiCrypto",
  description: "Arbitraje P2P y Spot en Binance, en vivo, para ti y tu equipo.",
  applicationName: "ArbiCrypto",
  manifest: "/icons/site.webmanifest",
  icons: {
    // PNG primero y sin SVG: Chrome prefiere el SVG si existe, y la pestaña debe mostrar el PNG
    icon: [
      // marca recortada al borde: llena la pestaña como los demás sitios (el favicon original trae mucho margen)
      { url: "/icons/tab-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/tab-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/tab-96.png", sizes: "96x96", type: "image/png" },
      { url: "/icons/tab-192.png", sizes: "192x192", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "ArbiCrypto", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#07090d" },
    { media: "(prefers-color-scheme: light)", color: "#f4f5f8" },
  ],
};

// Aplica el tema guardado antes de pintar, para que no parpadee
const themeScript = `try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

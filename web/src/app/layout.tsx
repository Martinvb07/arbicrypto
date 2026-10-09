import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "./market.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

// El sitio se compila una vez y corre en cualquier dominio: el servidor cambia este origen por el
// dominio real al entregar cada página, así las vistas previas (WhatsApp, Telegram, X) traen URLs absolutas.
const SITE = "https://arbicrypto.local";
const TITLE = "ArbiCrypto · Arbitraje P2P y Spot en Binance";
const DESCRIPTION =
  "Panel privado de arbitraje en Binance: P2P en pesos colombianos y Spot en tiempo real, con comisiones y 4x1000 incluidos y avisos al instante para tu equipo.";
const SHARE = "Arbitraje P2P y Spot en Binance, en pesos y en vivo. Panel privado para tu equipo.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: TITLE, template: "%s · ArbiCrypto" },
  description: DESCRIPTION,
  applicationName: "ArbiCrypto",
  category: "finance",
  // Panel privado: no aparece en buscadores, pero el link se ve bien al compartirlo
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
  openGraph: {
    type: "website",
    locale: "es_CO",
    siteName: "ArbiCrypto",
    url: "/",
    title: TITLE,
    description: SHARE,
    images: [{ url: "/brand/og.png", width: 1200, height: 630, type: "image/png", alt: "ArbiCrypto: arbitraje P2P y Spot en Binance, en pesos y en vivo" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: SHARE, images: ["/brand/og.png"] },
  formatDetection: { telephone: false, email: false, address: false },
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
    <html lang="es-CO" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

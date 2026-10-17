import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "ArbiCrypto Wallet",
  description: "Contabilidad de criptoactivos para la declaración de renta ante la DIAN",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0e13",
};

// Aplica el tema guardado antes de pintar, para que no parpadee.
const THEME = `try{var t=localStorage.getItem("acw-theme");if(t==="light")document.documentElement.dataset.theme="light";if(localStorage.getItem("acw-side")==="mini")document.documentElement.dataset.side="mini"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

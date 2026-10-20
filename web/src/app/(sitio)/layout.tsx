import { Inter_Tight } from "next/font/google";
import "./sitio.css";
import { SiteShell } from "./sitio";

// Titulares en Inter Tight: apretada y limpia; el resto en la Inter del sitio
const display = Inter_Tight({ subsets: ["latin"], variable: "--font-portada", display: "swap" });

// Todas las páginas públicas (arbicrypto.org) comparten navbar, footer y estilo
export default function SitioLayout({ children }: { children: React.ReactNode }) {
  return <div className={display.variable}><SiteShell>{children}</SiteShell></div>;
}

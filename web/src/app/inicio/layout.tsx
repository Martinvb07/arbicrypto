import type { Metadata } from "next";
import { Newsreader } from "next/font/google";
import "./portada.css";

// Letra de periódico para titulares y artículos; la interfaz sigue en Inter, como el panel
const news = Newsreader({ subsets: ["latin"], variable: "--font-news", display: "swap", style: ["normal", "italic"] });

// La portada (arbicrypto.org) sí sale en los buscadores; el panel y la wallet no.
const TITLE = "ArbiCrypto · El diario del arbitraje en pesos";
const DESCRIPTION =
  "Arbitraje en Binance P2P y Spot leído en pesos colombianos, con comisiones y 4x1000 incluidos, y la contabilidad de tus cripto lista para la DIAN.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true } },
  // Next reemplaza openGraph y twitter completos (no los mezcla con los del layout raíz): van enteros
  openGraph: {
    type: "website",
    locale: "es_CO",
    siteName: "ArbiCrypto",
    url: "/",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/brand/og.png", width: 1200, height: 630, type: "image/png", alt: "ArbiCrypto: arbitraje P2P y Spot en Binance, en pesos y en vivo" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/brand/og.png"] },
};

export default function PortadaLayout({ children }: { children: React.ReactNode }) {
  return <div className={news.variable}>{children}</div>;
}

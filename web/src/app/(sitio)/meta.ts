import type { Metadata } from "next";

// Las páginas públicas sí salen en los buscadores (el layout raíz las oculta por ser del panel privado)
export function pageMeta(path: string, title: string, description: string): Metadata {
  const full = `${title} · ArbiCrypto`;
  return {
    title: { absolute: full },
    description,
    alternates: { canonical: path },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true } },
    // Next reemplaza openGraph y twitter completos (no los mezcla con los del layout raíz): van enteros
    openGraph: {
      type: "website",
      locale: "es_CO",
      siteName: "ArbiCrypto",
      url: path,
      title: full,
      description,
      images: [{ url: "/brand/og.png", width: 1200, height: 630, type: "image/png", alt: "ArbiCrypto: arbitraje P2P y Spot en Binance, en pesos y en vivo" }],
    },
    twitter: { card: "summary_large_image", title: full, description, images: ["/brand/og.png"] },
  };
}

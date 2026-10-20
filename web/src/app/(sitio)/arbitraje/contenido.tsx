"use client";

import { AlertPhone, Cards, EndBand, NumSteps, PageHero, Receipt, SecHead, Split, useMarket } from "../sitio";

export default function Contenido() {
  const { m } = useMarket();
  return (
    <>
      <PageHero kicker="Producto · Arbitraje" title={<>Arbitraje P2P y Spot,<br />ya neto.</>}
        lead="ArbiCrypto mira Binance cada segundo, arma las rutas de comprar barato y vender caro, y te avisa solo cuando de verdad quedan pesos.">
        <div className="wb-glow sm" aria-hidden="true" />
        <AlertPhone />
      </PageHero>

      <section className="wb-sec">
        <div className="wb-wrap">
          <SecHead kicker="Cómo funciona" title="Tres cosas, cada segundo" />
          <NumSteps items={[
            ["Mira el mercado", "Lee los mejores anuncios de Binance P2P en pesos y los libros de Spot, de anunciantes con buena reputación."],
            ["Hace la cuenta", "Con tu capital, tu comisión real, el redondeo de cantidades y el 4x1000 de tu banco."],
            ["Te avisa", "Con sonido, notificación y Telegram, solo si la ruta pasa tu mínimo de ganancia por dólar."],
          ]} />
        </div>
      </section>

      <Split kicker="La cuenta" title={<>La diferencia<br />no es la ganancia</>} art={<Receipt m={m} />}>
        <p>Comprar a un precio y vender a otro parece fácil. Pero entre la comisión de Binance, el redondeo y el 4x1000, la mayoría de
          las veces que &ldquo;parece que da&rdquo;, pierdes.</p>
        <p>Este recibo usa el precio de USDT de ahora mismo. Mueve tu capital y mira cómo cambia: el panel hace esta cuenta con cada ruta.</p>
      </Split>

      <section className="wb-sec">
        <div className="wb-wrap">
          <SecHead kicker="Todo incluido" title="Lo que trae el panel" />
          <Cards items={[
            { ic: "bellRing", h: "Avisos al instante", p: "Si no gana, no avisa. Si gana, te dice cuánto con tu capital." },
            { ic: "listChecks", h: "Paso a paso", p: "A quién comprarle, qué tocar en Spot y a quién venderle, con enlaces directos." },
            { ic: "swap", h: "Rutas en Spot", p: "Entre USDT, BTC, ETH y las demás, medidas con la profundidad real del libro." },
            { ic: "history", h: "Historial hora por hora", p: "Cuántas oportunidades hubo, cuánto duraron y a qué hora se dan más." },
            { ic: "megaphone", h: "Simular anuncios", p: "Cuánto ganarías publicando tus propios anuncios en P2P." },
            { ic: "chat", h: "Chat del equipo", p: "Canal general y privados. Capital y cuenta siguen siendo de cada quien." },
          ]} />
        </div>
      </section>

      <EndBand />
    </>
  );
}

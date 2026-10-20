"use client";

import { Board, CoinCards, EndBand, PageHero, Receipt, Reveal, Split, useMarket } from "../sitio";

export default function Contenido() {
  const { m, hist } = useMarket();
  return (
    <>
      <PageHero kicker="Mercado" title={<>Precios P2P,<br />en pesos y en vivo.</>} cta={false}
        lead="Lo que cuesta comprar y lo que recibes al vender en Binance P2P, del mejor anuncio de cada lado. Se actualiza solo cada 15 segundos." />

      <section className="wb-sec tight">
        <div className="wb-wrap">
          <Reveal><Board m={m} tabs /></Reveal>
          <p className="wb-note center">Mejor anuncio de cada lado, en pesos · antes de comisiones y 4x1000</p>
        </div>
      </section>

      <section className="wb-sec">
        <div className="wb-wrap">
          <CoinCards m={m} hist={hist} assets={["USDT", "BTC", "ETH", "BNB", "SOL", "XRP", "USDC", "FDUSD"]} />
        </div>
      </section>

      <Split id="la-cuenta" kicker="Cómo se hace la cuenta" title={<>Del precio<br />a lo que te queda</>} art={<Receipt m={m} />}>
        <p>La diferencia entre comprar y vender no es tu ganancia. Antes hay que restar:</p>
        <ul className="wb-list">
          <li><b>4x1000</b> de tu banco sobre lo que le pagas al vendedor.</li>
          <li><b>Comisión de Binance</b> en P2P y en Spot, según tu cuenta.</li>
          <li><b>Redondeo</b> de cantidades: Binance no deja vender fracciones muy pequeñas.</li>
        </ul>
        <p>El panel hace esta cuenta con tu capital en cada ruta y solo avisa cuando el total sale en verde.</p>
      </Split>

      <EndBand />
    </>
  );
}

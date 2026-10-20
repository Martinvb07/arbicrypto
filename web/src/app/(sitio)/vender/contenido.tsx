"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/ui";
import { Cards, EASE, EndBand, NumSteps, PageHero, SecHead, Split, coin } from "../sitio";

// Ejemplo fijo de la tabla "Tus dólares": cuántos pesos te dan por cada dólar según el camino
const ROWS = [
  { a: "ETH", per: 3165.89, vs: 24.56, who: "victorcarrasco" },
  { a: "SOL", per: 3160.0, vs: 18.67, who: "divisasfitness" },
  { a: "BTC", per: 3154.66, vs: 13.33, who: "cambiosbog" },
  { a: "USDT", per: 3141.33, vs: 0, who: "p2pexpress" },
];
const money = (v: number) => `$${v.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Tabla de ejemplo: al tocar un camino se despliegan sus pasos, como en el panel. */
function ConvDemo() {
  const [open, setOpen] = useState<string | null>("ETH");
  return (
    <div className="wb-conv">
      <div className="wb-conv-head"><span>Vender tus dólares</span><small>Ejemplo</small></div>
      {ROWS.map((r) => {
        const on = open === r.a;
        const direct = r.a === "USDT";
        return (
          <div key={r.a} className={`wb-conv-row ${r.vs > 0 ? "win" : ""} ${on ? "on" : ""}`}>
            <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : r.a)}>
              <span className="wb-conv-path">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={coin("USDT")} alt="" width={20} height={20} />
                {direct ? <b>Directo en P2P</b> : <>
                  <i>→</i>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={coin(r.a)} alt="" width={20} height={20} /><b>{r.a}</b>
                </>}
              </span>
              <span className="wb-conv-per">{money(r.per)}</span>
              <span className={`wb-conv-vs ${r.vs > 0 ? "up" : ""}`}>{direct ? "—" : `+${money(r.vs)}`}</span>
              <motion.span className="wb-conv-chev" animate={{ rotate: on ? 180 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 28 }}>
                <Icon name="chevronDown" size={16} />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {on && (
                <motion.div className="wb-conv-steps" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  transition={{ height: { duration: 0.34, ease: EASE }, opacity: { duration: 0.22 } }}>
                  <motion.ol initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } } }}>
                    {(direct
                      ? [["Pasa tus USDT de Spot a Fondos", "Billetera → Transferir, gratis"], [`Vende a ${r.who}`, "Un toque y abres su anuncio"]]
                      : [[`Cambia USDT por ${r.a} en Spot`, `${r.a}USDT · Market · Comprar ${r.a}`], [`Pasa el ${r.a} de Spot a Fondos`, "Billetera → Transferir, gratis"], [`Vende el ${r.a} a ${r.who}`, "Un toque y abres su anuncio"]]
                    ).map(([h, p], i) => (
                      <motion.li key={h} variants={{ hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0, transition: { duration: 0.25, ease: EASE } } }}>
                        <span>{i + 1}</span><div><b>{h}</b><small>{p}</small></div>
                      </motion.li>
                    ))}
                  </motion.ol>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

export default function Contenido() {
  return (
    <>
      <PageHero kicker="Producto · Vender" title={<>Vende lo que tienes,<br />sin perder.</>}
        lead="Anotas lo que compraste y a cuánto. El panel vigila a quién venderle, directo o pasando por otra moneda en Spot, y te avisa cuando sales ganando.">
        <ConvDemo />
      </PageHero>

      <section className="wb-sec">
        <div className="wb-wrap">
          <SecHead kicker="Cómo funciona" title="Tú anotas, el panel vigila" />
          <NumSteps items={[
            ["Anota tu moneda", "Qué tienes, cuánto y a cuánto te costó en pesos (o lo trae solo de tus órdenes de Binance)."],
            ["El panel vigila", "Mira cada comprador de P2P y cada camino por Spot, con comisiones y redondeo."],
            ["Te avisa a quién", "Cuando un comprador te deja ganancia: a quién venderle, cuánto recibes y qué tocar."],
          ]} />
        </div>
      </section>

      <Split kicker="Directo o por Spot" title={<>A veces conviene<br />dar una vuelta</>} flip
        art={<Cards cols={2} items={[
          { ic: "handCoins", h: "Directo", p: "Vendes tus USDT tal cual en P2P al mejor comprador." },
          { ic: "swap", h: "Por Spot", p: "Los cambias por ETH, SOL o BTC y vendes esa moneda en P2P." },
        ]} />}>
        <p>Con los mismos dólares, venderlos pasando por otra moneda a veces da más pesos que venderlos directo. La tabla te dice
          cuánto más por cada dólar, ya con la comisión de Spot y la de P2P.</p>
        <p>Toca un camino y te salen los pasos: qué par abrir en Spot, la pestaña Market, qué botón tocar y a quién venderle.</p>
      </Split>

      <EndBand title="Deja de adivinar a quién venderle." />
    </>
  );
}

"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/ui";
import { EASE, EndBand, NAMES, Num, PageHero, PillTabs, Reveal, cop, coin, es, isStable, useMarket } from "../sitio";

// Calculadora pública: con los precios P2P de este momento (mejor anuncio de cada lado), cuánto te quedaría si compras
// por un monto y vendes ya. Comisión y 4x1000 se pueden cambiar; el panel hace esta misma cuenta con tu comisión real.

const FEES = [{ k: "0", t: "0 %" }, { k: "0.0014", t: "0,14 %" }, { k: "0.0035", t: "0,35 %" }] as const;
const AMOUNTS = [200000, 500000, 1000000, 3000000];

/** "1.500.000", "1500000" o "$ 1.500.000" → 1500000. */
const parsePesos = (v: string) => Number(v.replace(/[^\d]/g, "")) || 0;
const qtyTxt = (a: string, q: number) => (isStable(a) ? es(q, 2) : es(q, q >= 1 ? 4 : 6));

function Row({ k, v, neg, sub }: { k: string; v: string; neg?: boolean; sub?: string }) {
  return (
    <div className={`rc-line ${neg ? "neg" : ""}`}>
      <span>{k}{sub && <small className="wb-calc-sub">{sub}</small>}</span>
      <b><Num v={v} /></b>
    </div>
  );
}

export default function Contenido() {
  const { m } = useMarket();
  const [raw, setRaw] = useState("500.000");
  const [asset, setAsset] = useState("USDT");
  const [fee, setFee] = useState<(typeof FEES)[number]["k"]>("0.0014");
  const [gmfOn, setGmfOn] = useState(true);

  const amount = parsePesos(raw);
  const q = m?.rows.find((r) => r.asset === asset);
  const buy = q?.buy ?? null, sell = q?.sell ?? null;
  const f = Number(fee);
  const gmf = gmfOn ? amount * 0.004 : 0;
  const got = buy ? amount / buy : 0;            // lo que te llega del vendedor
  const feeQty = got * f;                        // comisión de Binance al tomar el anuncio
  const left = got - feeQty;
  const back = sell ? left * sell * (1 - f) : 0; // vendes lo que te quedó y otra vez pagas comisión
  const net = buy && sell && amount > 0 ? back - amount - gmf : null;
  const even = left > 0 ? (amount + gmf) / (left * (1 - f)) : null; // precio de venta para salir en cero
  const assets = (m?.rows ?? []).map((r) => r.asset);

  const setAmount = (v: number) => setRaw(es(v));

  return (
    <>
      <PageHero kicker="Calculadora" title={<>¿Cuánto te queda<br />de verdad?</>} cta={false}
        lead="Pon cuánto quieres meter y mira, con los precios de Binance P2P de este momento, qué te queda después de la comisión y el 4x1000." />

      <section className="wb-sec tight">
        <div className="wb-wrap wb-calc">
          <Reveal className="wb-calc-form">
            <label className="wb-calc-field">
              <span>¿Cuánto quieres meter?</span>
              <div className="wb-calc-input">
                <i>$</i>
                <input inputMode="numeric" value={raw} onChange={(e) => setRaw(e.target.value)} onBlur={() => amount && setAmount(amount)} aria-label="Monto en pesos" />
                <small>COP</small>
              </div>
            </label>
            <div className="wb-calc-chips">
              {AMOUNTS.map((v) => (
                <motion.button key={v} type="button" whileTap={{ scale: 0.95 }} className={amount === v ? "on" : ""} onClick={() => setAmount(v)}>{cop(v)}</motion.button>
              ))}
            </div>

            <div className="wb-calc-field">
              <span>¿Con qué moneda?</span>
              <div className="wb-calc-coins">
                {(assets.length ? assets : ["USDT", "BTC", "ETH", "BNB"]).map((a) => (
                  <motion.button key={a} type="button" whileTap={{ scale: 0.95 }} className={asset === a ? "on" : ""} onClick={() => setAsset(a)} title={NAMES[a] ?? a}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={coin(a)} alt="" width={20} height={20} />{a}
                  </motion.button>
                ))}
              </div>
            </div>

            <div className="wb-calc-field">
              <span>Comisión de Binance P2P <small>(depende de tu cuenta y del anuncio)</small></span>
              <PillTabs tabs={FEES} active={fee} onChange={setFee} id="calc-fee" />
            </div>

            <label className="wb-calc-switch">
              <span><b>Pago 4x1000</b><small>Lo cobra tu banco al pagarle al vendedor (0,4 %). Si tu cuenta está exenta, apágalo.</small></span>
              <input type="checkbox" role="switch" checked={gmfOn} onChange={(e) => setGmfOn(e.target.checked)} />
              <i aria-hidden="true" className={gmfOn ? "on" : ""} />
            </label>
          </Reveal>

          <Reveal delay={0.1} className="rc wb-calc-out">
            <p className="rc-sub">Si compras {asset} y vendes ya · precios de este momento</p>
            <Row k={`Compras a ${buy ? cop(buy) : "…"}`} v={buy ? `${qtyTxt(asset, got)} ${asset}` : "…"} />
            <Row k={`Comisión al comprar (${es(f * 100, 2)} %)`} v={buy ? `−${qtyTxt(asset, feeQty)} ${asset}` : "…"} neg />
            <Row k="4x1000 de tu banco" v={`−${cop(gmf)}`} neg />
            <Row k={`Vendes a ${sell ? cop(sell) : "…"}`} v={sell ? cop(back) : "…"} sub="ya sin la comisión al vender" />
            <div className={`rc-total ${net == null ? "" : net >= 0 ? "up" : "down"}`}>
              <span>Te queda</span>
              <b><Num v={net == null ? "…" : `${net >= 0 ? "+" : "−"}${cop(Math.abs(net))}`} /></b>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.p key={net == null ? "x" : net >= 0 ? "si" : "no"} className="rc-verdict" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25, ease: EASE }}>
                {net == null ? "Esperando precios en vivo…"
                  : net >= 0 ? "Hoy esta ruta deja plata. Ojo: los anuncios cambian en segundos."
                  : "Hoy esta ruta pierde: la diferencia no alcanza para la comisión y el 4x1000."}
              </motion.p>
            </AnimatePresence>
            {even && (
              <div className="wb-calc-even">
                <Icon name="target" size={16} />
                <span>Para no perder tendrías que vender a <b><Num v={cop(even)} /></b> por {isStable(asset) ? "dólar" : asset}{sell ? <> · hoy pagan <b>{cop(sell)}</b></> : null}</span>
              </div>
            )}
            <p className="wb-note">Mejor anuncio de cada lado, sin filtrar por monto ni reputación. El panel usa tu comisión real, tus métodos de pago y solo anunciantes con buena reputación.</p>
          </Reveal>
        </div>
      </section>

      <EndBand title="Deja que el panel haga esta cuenta por ti." text="Cada segundo, con tu capital y tu comisión, y solo te avisa cuando de verdad queda plata." />
    </>
  );
}

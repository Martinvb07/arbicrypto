"use client";

import { useState } from "react";
import { adRank, fitsAd, isDollar, MAKER_FEE_REF, perDollar, simulateAds } from "@/lib/calc";
import { money, num, pct, pctPlain, plural, qty, signedMoney, tone } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { Ad, MarketEntry, Side, State } from "@/lib/types";
import { GmfToggle } from "../controls";
import { EmptyBox, Icon, Segmented, Skeleton, Usd } from "../ui";
import { CoinPicker } from "./Market";

type Mode = "mine" | "take";
const MODES = [["mine", "Mi anuncio"], ["take", "Tomar un anuncio"]] as const;
const BEAT = 1; // "superar al 1.º": un peso mejor que él

/** Número escrito en un campo; vacío o inválido = null. */
const parse = (v: string) => (v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

const cryptoQty = (asset: string, v: number) => (isDollar(asset) ? num(v, 2) : qty(v));

// ---------------------------------------------------------------- un lado: comprar o vender

/** side BUY: compras la cripto (tu anuncio compra, o le compras a un anuncio que vende). SELL: la vendes. */
function SideBox({ side, asset, mode, onMode, price, onPrice, rivals, taken, fee, need }: {
  side: Side;
  asset: string;
  mode: Mode;
  onMode: (m: Mode) => void;
  price: string;
  onPrice: (v: string) => void;
  /** Anuncios con los que compite el tuyo (los que compran si el tuyo compra; los que venden si el tuyo vende). */
  rivals: Ad[];
  /** El anuncio que tomarías ya (el mejor que acepta el monto). */
  taken: Ad | undefined;
  fee: number;
  need: string;
}) {
  const buying = side === "BUY";
  const unit = isDollar(asset) ? "por dólar" : `por ${asset}`;
  const top = rivals[0];
  const p = parse(price);
  const r = p ? adRank(rivals, p, side) : null;
  return (
    <div className="sim-side">
      <header className="sim-side-head">
        <span className={`mkt-col-ico ${side}`}><Icon name={buying ? "cart" : "handCoins"} /></span>
        <div>
          <h3>{buying ? `Compras ${asset}` : `Vendes ${asset}`}</h3>
          <p className="sub">
            {mode === "mine"
              ? buying ? "Tu anuncio de compra: te lo toman los que quieren vender" : "Tu anuncio de venta: te lo toman los que quieren comprar"
              : buying ? "Le compras ya al mejor anuncio que acepta tu monto" : "Le vendes ya al mejor comprador que acepta tu monto"}
          </p>
        </div>
      </header>
      <Segmented label={buying ? "Cómo compras" : "Cómo vendes"} value={mode} onChange={onMode} options={MODES} />
      {mode === "mine" ? (
        <>
          <label className="login-field">
            {buying ? "Pagas en tu anuncio" : "Cobras en tu anuncio"}
            <span className="with-unit">
              <input type="number" min={0} step="any" value={price} onChange={(e) => onPrice(e.target.value)} />
              <span>COP {unit}</span>
            </span>
          </label>
          {top && (
            <div className="sim-chips">
              <button type="button" className="btn btn-sm" onClick={() => onPrice(String(top.price))}>Igualar al 1.º · {money(top.price)}</button>
              <button type="button" className="btn btn-sm" onClick={() => onPrice(String(top.price + (buying ? BEAT : -BEAT)))}>
                Superar al 1.º · {money(top.price + (buying ? BEAT : -BEAT))}
              </button>
            </div>
          )}
          {r && (
            !top ? <p className="sim-rank good"><Icon name="checkCircle" size={15} /> No hay otros anuncios: el tuyo sale primero</p>
              : r.pos === 1 ? (
                <p className="sim-rank good">
                  <Icon name="checkCircle" size={15} />
                  <span>Sales <b>de 1.º</b>{r.ties ? <> · empatado con {r.ties} {plural(r.ties, "anuncio", "anuncios")}</> : <> · nadie {buying ? "paga más" : "vende más barato"}</>}</span>
                </p>
              ) : (
                <p className="sim-rank">
                  <Icon name="layers" size={15} />
                  <span>Sales <b>{r.pos}.º</b> de {r.of + 1} · el 1.º {buying ? "paga" : "cobra"} <b>{money(top.price)}</b> ({top.nick})</span>
                </p>
              )
          )}
          <p className="sim-hint">Comisión de anunciante: {pctPlain(fee, 2)}</p>
        </>
      ) : taken ? (
        <div className="sim-taken">
          <span className="sim-taken-price">{money(taken.price)} <small>{unit}</small></span>
          <span className="sub">{buying ? "Te vende" : "Te compra"} <b>{taken.nick}</b> · acepta {money(taken.min, 0)} – {money(taken.max, 0)} · comisión {pctPlain(fee, 2)}</span>
        </div>
      ) : (
        <p className="sim-warn"><Icon name="alert" size={15} /> Ningún anuncio {buying ? "que vende" : "que compra"} acepta {need}.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- simulador de una cripto

function Simulator({ s, asset, m, amount, rounds, makerFee }: { s: State; asset: string; m: MarketEntry; amount: number | null; rounds: number; makerFee: number }) {
  const [buyMode, setBuyMode] = useState<Mode>("mine");
  const [sellMode, setSellMode] = useState<Mode>("mine");
  // null = sin tocar: sigue en vivo al 1.º de los anuncios con los que compite
  const [buyTyped, setBuyTyped] = useState<string | null>(null);
  const [sellTyped, setSellTyped] = useState<string | null>(null);
  const takerFee = s.p2p_fee ?? 0;
  const gmf = s.settings.gmf;

  // compra: tu anuncio compite con los que compran (m.SELL); si tomas uno, le compras a los que venden (m.BUY)
  const buyStr = buyTyped ?? String(m.SELL[0]?.price ?? "");
  const buyTaken = amount ? m.BUY.find((a) => fitsAd(a, amount, amount / a.price)) : undefined;
  const buy = buyMode === "mine" ? parse(buyStr) : buyTaken?.price ?? null;
  const buyFee = buyMode === "mine" ? makerFee : takerFee;
  const got = amount && buy ? (amount / buy) * (1 - buyFee) : null;

  // venta: tu anuncio compite con los que venden (m.BUY); si tomas uno, le vendes a los que compran (m.SELL)
  const sellStr = sellTyped ?? String(m.BUY[0]?.price ?? "");
  const sellTaken = got ? m.SELL.find((a) => fitsAd(a, got * a.price, got)) : undefined;
  const sell = sellMode === "mine" ? parse(sellStr) : sellTaken?.price ?? null;
  const sellFee = sellMode === "mine" ? makerFee : takerFee;

  const sim = amount && buy && sell ? simulateAds(amount, buy, sell, buyFee, sellFee, gmf) : null;
  const day = sim ? sim.profit * rounds : null;
  const seller = m.BUY[0];
  const buyer = m.SELL[0];

  return (
    <>
      <section className="card">
        <div className="sim-sides">
          <SideBox side="BUY" asset={asset} mode={buyMode} onMode={setBuyMode} price={buyStr} onPrice={setBuyTyped}
            rivals={m.SELL} taken={buyTaken} fee={buyFee} need={amount ? money(amount, 0) : "tu monto"} />
          <SideBox side="SELL" asset={asset} mode={sellMode} onMode={setSellMode} price={sellStr} onPrice={setSellTyped}
            rivals={m.BUY} taken={sellTaken} fee={sellFee} need={got ? `${cryptoQty(asset, got)} ${asset}` : "lo que compras"} />
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="mkt-sec-title">
            <span className={`sec-ico ${sim && sim.profit > 0 ? "green" : sim && sim.profit < 0 ? "red" : ""}`}><Icon name="trend" /></span>
            <div>
              <h2>Resultado</h2>
              <p className="sub">{amount ? <>Con {money(amount, 0)} por vuelta · ya descuenta comisiones{gmf > 0 ? " y el 4x1000 de lo que pagas" : " (sin 4x1000)"}</> : "Escribe cuánto usas por vuelta"}</p>
            </div>
          </div>
          {sim && sim.profit > 0 && sim.ratio < s.settings.safe_p2p && (
            <span className="badge warn" title="Gana poco: si un precio cambia mientras esperas, puede volverse pérdida">Justa</span>
          )}
        </div>
        {sim && day != null ? (
          <>
            <div className="kpis">
              <div className={`kpi ${sim.profit > 0 ? "kpi-good" : ""}`}>
                <small>Ganancia por vuelta</small>
                <b className={`val ${tone(sim.profit)}`}>{signedMoney(sim.profit)}</b>
                <span>{pct(sim.ratio)} del monto</span>
              </div>
              <div className="kpi"><small>Por dólar</small><Usd v={perDollar(sim.ratio, s)} /><span>como en Arbitraje</span></div>
              <div className="kpi">
                <small>Al día</small>
                <b className={`val ${tone(day)}`}>{signedMoney(day)}</b>
                <span>{rounds} {plural(rounds, "vuelta", "vueltas")}</span>
              </div>
              <div className="kpi"><small>Al mes</small><b className={`val ${tone(day)}`}>{signedMoney(day * 30)}</b><span>30 días así</span></div>
            </div>
            <div className="facts">
              <div><small>Pagas al vendedor</small><b>{money(amount, 0)}</b></div>
              <div><small>4x1000</small><b>{money(sim.gmf, 0)}</b></div>
              <div><small>Te llegan</small><b>{cryptoQty(asset, sim.qty)} {asset}</b></div>
              <div><small>Recibes al vender</small><b>{money(sim.received, 0)}</b></div>
              <div><small>Diferencia de precios</small><b>{money(sell! - buy!)} <span className="muted">({pct(sell! / buy! - 1)})</span></b></div>
              <div><small>Comisiones</small><b>{money(sim.fees, 0)}</b></div>
              <div><small>Para no perder, vende mínimo a</small><b>{money(sim.breakevenSell)}</b></div>
              <div><small>…o compra máximo a</small><b>{money(sim.breakevenBuy)}</b></div>
            </div>
            {buyMode === "mine" && seller && buy! >= seller.price && (
              <p className="sim-warn"><Icon name="alert" size={15} /> Pagas lo mismo o más que comprarle ya a {seller.nick} ({money(seller.price)}): te conviene tomar su anuncio.</p>
            )}
            {sellMode === "mine" && buyer && sell! <= buyer.price && (
              <p className="sim-warn"><Icon name="alert" size={15} /> {buyer.nick} ya te paga {money(buyer.price)}: te conviene venderle directo.</p>
            )}
          </>
        ) : (
          <EmptyBox icon="sliders" title="Faltan datos">Escribe el monto por vuelta y el precio de cada anuncio.</EmptyBox>
        )}
        <p className="note">
          <Icon name="info" size={14} /> Simulación con los anuncios de ahora. Tu anuncio solo gana cuando alguien lo toma, y mientras esperas los precios
          se mueven. El puesto cuenta los primeros {m.BUY.length || 20} anunciantes con {s.settings.min_orders}+ órdenes.
        </p>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- pestaña

export function AdSim() {
  const { state, prefs, setPrefs } = useLive();
  // null = sin tocar: monto = tu capital, comisión = la tuya (o la de referencia)
  const [amountTyped, setAmountTyped] = useState<string | null>(null);
  const [roundsTyped, setRoundsTyped] = useState("1");
  const [feeTyped, setFeeTyped] = useState<string | null>(null);
  if (!state) return <div className="card"><Skeleton rows={10} /></div>;
  const st = state.settings;
  const asset = st.p2p_assets.includes(prefs.asset) ? prefs.asset : "USDT";
  const m = state.p2p?.market[asset];
  const amountStr = amountTyped ?? String(st.capital);
  const amount = parse(amountStr);
  const rounds = Math.max(1, Math.round(parse(roundsTyped) ?? 1));
  const feeDefault = state.maker_fee ?? MAKER_FEE_REF;
  const feeStr = feeTyped ?? String(+(feeDefault * 100).toFixed(4));
  const fee = Math.min(Math.max((parse(feeStr) ?? 0) / 100, 0), 0.05);

  return (
    <div className="mkt">
      <section className="card mkt-top">
        <div className="mkt-top-row">
          <div className="mkt-sec-title">
            <span className="sec-ico"><Icon name="megaphone" /></span>
            <div>
              <h2>Simular anuncios</h2>
              <p className="sub">Cuánto ganas si publicas tus propios anuncios de compra y venta en P2P</p>
            </div>
          </div>
          <div className="toolbar mkt-tools"><GmfToggle /></div>
        </div>
        <CoinPicker assets={st.p2p_assets} value={asset} onChange={(a) => setPrefs({ asset: a })} />
        <div className="sim-fields">
          <label className="login-field">
            Monto por vuelta
            <span className="with-unit">
              <input type="number" min={0} step={50000} value={amountStr} onChange={(e) => setAmountTyped(e.target.value)} />
              <span>COP</span>
            </span>
          </label>
          <label className="login-field">
            Vueltas al día
            <input type="number" min={1} step={1} value={roundsTyped} onChange={(e) => setRoundsTyped(e.target.value)} />
          </label>
          <label className="login-field">
            Comisión de anunciante
            <span className="with-unit">
              <input type="number" min={0} max={5} step={0.01} value={feeStr} onChange={(e) => setFeeTyped(e.target.value)} />
              <span>%</span>
            </span>
            <small className="sim-hint">
              {state.maker_fee != null ? "La tuya, sacada de tus órdenes como anunciante" : "De referencia: pon la tuya (Binance la cobra en tus anuncios)"}
              {" · "}al tomar un anuncio: {pctPlain(state.p2p_fee ?? 0, 2)}
            </small>
          </label>
        </div>
      </section>

      {m ? (
        <Simulator key={asset} s={state} asset={asset} m={m} amount={amount && amount > 0 ? amount : null} rounds={rounds} makerFee={fee} />
      ) : (
        <div className="card"><Skeleton rows={8} /></div>
      )}
    </div>
  );
}

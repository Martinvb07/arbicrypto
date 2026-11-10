"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { advise, advTick, beats, etaAt, flowOf, FLOW_MIN, hourSpreads, rankIn, rankText, rivalFlow, makerStats, mergeOrders, PLANS, rivalsOf, roomGap, watchState, type Advice, type Combo, type Plan,
  type SideOption } from "@/lib/advisor";
import { api } from "@/lib/api";
import { advertiserUrl, isDollar, simulateAds } from "@/lib/calc";
import { money, num, pct, plural, signedMoney, tone } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { Ad, MarketEntry, Order, PriceAlert, Side, State } from "@/lib/types";
import { ask } from "../overlay";
import { Ago, EmptyBox, GoButton, Icon, Segmented, Toggle } from "../ui";

/** Minutos estimados en palabras. */
function eta(min: number | null | undefined) {
  if (min == null) return "midiendo…";
  if (min === Infinity) return "sin movimiento";
  if (min < 1) return "al instante";
  if (min < 60) return `≈ ${Math.round(min)} min`;
  if (min > 600) return "más de 10 h";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `≈ ${h} h${m ? ` ${m} min` : ""}`;
}
const etaTone = (min: number | null | undefined) => (min == null ? "" : min <= 20 ? "up" : min <= 90 ? "" : "down");

const planOf = (p: Plan) => PLANS.find((x) => x.id === p)!;
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "a. m." : "p. m."}`;
/** Pesos: acepta 3.850, 3850 o 3.850,50. */
const parseCop = (v: string) => Number(v.trim().replace(/[\s$]/g, "").replace(/\./g, "").replace(",", "."));

/** Límites de precio con la otra punta fija: comprar a lo sumo `buy` / vender desde `sell` para no perder, y lo mismo
 *  para dejar al menos el margen seguro. */
function limits(c: Combo, gmf: number, safe: number) {
  return {
    buy: c.sim.breakevenBuy, sell: c.sim.breakevenSell,
    buySafe: (c.sim.breakevenBuy * (1 + gmf)) / (1 + gmf + safe), sellSafe: (c.sim.breakevenSell * (1 + gmf + safe)) / (1 + gmf),
  };
}

/** Qué hacer en un lado, en palabras. */
function sideText(o: SideOption, side: Side, asset: string) {
  const buying = side === "BUY";
  if (o.plan === "take") return o.ad ? `${buying ? "Cómprale" : "Véndele"} ya a ${o.ad.nick} a ${money(o.price)}` : "Sin anuncio que acepte tu monto";
  return `Anuncio de ${buying ? "compra" : "venta"} de ${asset} a ${money(o.price)}`;
}

// ---------------------------------------------------------------- la recomendación

function Verdict({ s, asset, a, c, picked, onReset, onUse, onWatch }: {
  s: State; asset: string; a: Advice;
  /** La combinación que se muestra: la que elegiste o, si no tocaste nada, la recomendada. */
  c: Combo | null; picked: boolean; onReset: () => void;
  onUse: (buy: number | null, sell: number | null) => void; onWatch: () => void;
}) {
  if (!c) {
    const ref = a.combos.filter((x) => x.buy.plan !== "take" && x.sell.plan !== "take").sort((x, y) => y.sim.net - x.sim.net)[0];
    return (
      <section className="card adv-verdict bad">
        <div className="adv-verdict-head">
          <span className="sec-ico red"><Icon name="alert" /></span>
          <div>
            <h2>Hoy no conviene publicar {asset}</h2>
            <p className="sub">Con {money(a.amount, 0)} por vuelta, ninguna combinación de anuncios deja ganancia después de comisiones y 4x1000</p>
          </div>
        </div>
        {ref && (
          <p className="sim-even">
            <Icon name="target" size={15} />
            <span>Lo más cerca: comprar a {money(ref.buy.price)} y vender a {money(ref.sell.price)} deja <b className={tone(ref.sim.net)}>{signedMoney(ref.sim.net)}</b>.
              Para no perder, el de venta tendría que estar en <b>{money(ref.sim.breakevenSell)}</b> o más.</span>
          </p>
        )}
        <p className="note"><Icon name="info" size={14} /> Revisa las <b>mejores horas</b> abajo, o pon una alerta de precio y espera a que el margen se abra.</p>
      </section>
    );
  }
  const direct = c.buy.plan === "take" && c.sell.plan === "take";
  const isBest = c === a.best;
  const lim = limits(c, s.settings.gmf, s.settings.safe_p2p);
  const cls = c.sim.net <= 0 ? "bad" : c.sim.ratio < s.settings.safe_p2p ? "warn" : "good";
  const mineSides = (["BUY", "SELL"] as const).filter((sd) => (sd === "BUY" ? c.buy : c.sell).plan !== "take");
  return (
    <section className={`card adv-verdict ${cls}`}>
      <div className="adv-verdict-head">
        <span className={`sec-ico ${cls === "good" ? "green" : cls === "bad" ? "red" : ""}`}><Icon name={picked ? "sliders" : "sparkle"} /></span>
        <div>
          <h2>{picked ? (isBest ? "Tu elección (es la recomendada)" : "Tu elección") : direct ? "No necesitas publicar: hay arbitraje directo" : "Lo que te recomiendo ahora"}</h2>
          <p className="sub">
            {picked
              ? <>Con {money(a.amount, 0)} por vuelta · toca otro precio abajo para comparar</>
              : <>La forma más rápida que {a.tight ? "gana algo" : `deja al menos ${pct(s.settings.safe_p2p, 1)}`} con {money(a.amount, 0)} por vuelta · toca otro precio abajo para cambiarla</>}
          </p>
        </div>
        {cls === "warn" && <span className="badge warn" title="Gana poco: si un precio cambia mientras esperas, puede volverse pérdida">Justa</span>}
        {cls === "bad" && <span className="badge bad">Pierdes</span>}
      </div>
      <div className="adv-steps">
        {(["BUY", "SELL"] as const).map((sd, i) => {
          const o = sd === "BUY" ? c.buy : c.sell;
          const p = planOf(o.plan);
          const rivals = sd === "BUY" ? a.buyRivals : a.sellRivals;
          const r = o.plan !== "take" && o.price ? rankIn(rivals, o.price, sd) : null;
          return (
            <div key={sd} className={`adv-step ${sd}`}>
              <span className="adv-step-n">{i + 1}</span>
              <div>
                <small>{sd === "BUY" ? "Compras" : "Vendes"} · {p.label}</small>
                <b>{sideText(o, sd, asset)}</b>
                <span className="dim">
                  {r ? <>Sales {rankText(r)}{r.ties ? ` (empatas con ${r.ties})` : ""} en la lista de Binance</> : o.ad ? <>acepta {money(o.ad.min, 0)} – {money(o.ad.max, 0)}</> : null}
                </span>
              </div>
              {o.plan === "take" && o.ad && <GoButton href={advertiserUrl(o.ad)} icon={sd === "BUY" ? "cart" : "handCoins"}>Abrir</GoButton>}
            </div>
          );
        })}
      </div>
      <div className="kpis">
        <div className={`kpi ${c.sim.net > 0 ? "kpi-good" : ""}`}><small>Te queda por vuelta</small><b className={`val ${tone(c.sim.net)}`}>{signedMoney(c.sim.net)}</b><span>{pct(c.sim.ratio)} neto</span></div>
        <div className="kpi"><small>Tarda en llenarse</small><b className={`val ${etaTone(c.eta)}`}>{eta(c.eta)}</b>
          <span>{c.eta == null ? "midiendo cuánto se mueve cada puesto" : `compra ${eta(c.buy.eta).replace("≈ ", "")} + venta ${eta(c.sell.eta).replace("≈ ", "")}`}</span></div>
        <div className="kpi"><small>Compra hasta</small><b className="val">{money(lim.buy)}</b><span>para no perder · {money(lim.buySafe)} para {pct(s.settings.safe_p2p, 1)}</span></div>
        <div className="kpi"><small>Vende desde</small><b className="val">{money(lim.sell)}</b><span>para no perder · {money(lim.sellSafe)} para {pct(s.settings.safe_p2p, 1)}</span></div>
        <div className="kpi"><small>Comisiones</small><b className="val down">−{money(c.sim.fees, 0)}</b><span>{c.sim.gmf ? `+ 4x1000 ${money(c.sim.gmf, 0)}` : "sin 4x1000"}</span></div>
      </div>
      {!picked && a.quick && a.quick !== c && (
        <p className="sim-even">
          <Icon name="timer" size={15} />
          <span>¿Lo quieres más rápido? {planOf(a.quick.buy.plan).label} al comprar y {planOf(a.quick.sell.plan).label.toLowerCase()} al vender se llena
            en <b>{eta(a.quick.eta)}</b> y deja <b className={tone(a.quick.sim.net)}>{signedMoney(a.quick.sim.net)}</b> ({pct(a.quick.sim.ratio)}). Tócala en la tabla para elegirla.</span>
        </p>
      )}
      {picked && a.best && !isBest && (
        <p className="sim-even">
          <Icon name="sparkle" size={15} />
          <span>La recomendada deja <b className={tone(a.best.sim.net)}>{signedMoney(a.best.sim.net)}</b> ({pct(a.best.sim.ratio)}): {
            sideText(a.best.buy, "BUY", asset).toLowerCase()} y {sideText(a.best.sell, "SELL", asset).toLowerCase()}.</span>
        </p>
      )}
      <div className="sim-chips">
        {picked && <button type="button" className="btn btn-sm" onClick={onReset}><Icon name="refresh" size={15} /> Volver a la recomendada</button>}
        {!direct && (
          <button type="button" className="btn btn-sm btn-brand" onClick={() => onUse(c.buy.plan === "take" ? null : c.buy.price, c.sell.plan === "take" ? null : c.sell.price)}>
            <Icon name="sliders" size={15} /> Llevar al simulador
          </button>
        )}
        {mineSides.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={onWatch}><Icon name="bellRing" size={15} /> Avisarme cuando el precio se mueva</button>
        )}
        <a className="btn btn-sm" href="https://p2p.binance.com/es/postAd" target="_blank" rel="noopener noreferrer"><Icon name="plus" size={15} /> Publicar en Binance <Icon name="external" size={13} /></a>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- precio por estrategia

function Ladder({ s, side, asset, a, shown, chosen, onPick }: {
  s: State; side: Side; asset: string; a: Advice; shown: Combo | null; chosen: Plan | undefined; onPick: (p: Plan) => void;
}) {
  const buying = side === "BUY";
  const lim = shown ? limits(shown, s.settings.gmf, s.settings.safe_p2p) : null;
  const edge = lim ? (buying ? lim.buy : lim.sell) : null; // pasar de aquí es perder
  const loses = (price: number | null) => edge != null && price != null && (buying ? price > edge : price < edge);
  const opts = buying ? a.buy : a.sell;
  const rivals = buying ? a.buyRivals : a.sellRivals;
  const skipped = buying ? a.skipped.buy : a.skipped.sell;
  const gap = buying ? a.gap.buy : a.gap.sell;
  const top = rivals[0];
  const rec = (buying ? a.best?.buy : a.best?.sell)?.plan;
  return (
    <div className="sim-side">
      <header className="sim-side-head">
        <span className={`mkt-col-ico ${side}`}><Icon name={buying ? "cart" : "handCoins"} /></span>
        <div>
          <h3>Tu anuncio de {buying ? "compra" : "venta"}</h3>
          <p className="sub">{top ? <>El 1.º {buying ? "paga" : "cobra"} <b>{money(top.price)}</b> ({top.nick})</> : "Nadie más compite con tu monto"}</p>
        </div>
      </header>
      {lim && shown && (
        <p className="adv-limit">
          <Icon name="target" size={15} />
          <span>
            {buying ? <>Vendiendo a {money(shown.sell.price)}: compra a <b>{money(lim.buy)}</b> o menos para no perder, y a <b>{money(lim.buySafe)}</b> o menos para ganar {pct(s.settings.safe_p2p, 1)}.</>
              : <>Comprando a {money(shown.buy.price)}: vende a <b>{money(lim.sell)}</b> o más para no perder, y a <b>{money(lim.sellSafe)}</b> o más para ganar {pct(s.settings.safe_p2p, 1)}.</>}
          </span>
        </p>
      )}
      <div className="adv-ladder">
        {opts.map((o) => {
          const p = planOf(o.plan);
          const diff = top && o.price ? o.price - top.price : null;
          const take = o.plan === "take";
          const r = !take && o.price ? rankIn(rivals, o.price, side) : null;
          return (
            <button type="button" key={o.plan} className={`adv-rung ${chosen === o.plan ? "on" : ""}`} disabled={!o.price}
              aria-pressed={chosen === o.plan} onClick={() => onPick(o.plan)}>
              <div><b>{p.label}{rec === o.plan && <span className="adv-rec-dot">Recomendada</span>}{loses(o.price) && <span className="adv-rec-dot bad">Pierdes</span>}</b>
                <small>{take ? (o.ad ? `${buying ? "Le compras" : "Le vendes"} a ${o.ad.nick}` : "Nadie acepta tu monto")
                  : r ? `Sales ${rankText(r)}${r.ties ? ` (empatas con ${r.ties})` : ""}` : p.short}</small></div>
              <span className="adv-rung-price">{money(o.price)}</span>
              <span className="dim">{take ? "sin esperar · comisión de tomar" : diff == null ? "" : diff === 0 ? "igual al 1.º" : `${diff > 0 ? "+" : "−"}${money(Math.abs(diff))} vs. 1.º`}
                {!take && <> · <b className={`adv-eta ${etaTone(o.eta)}`}><Icon name="timer" size={12} /> {eta(o.eta)}</b></>}</span>
            </button>
          );
        })}
      </div>
      {gap != null && (
        <p className="sim-warn"><Icon name="info" size={15} /> El 1.º va {money(gap)} por delante del 2.º: quedar 2.º te ahorra eso {isDollar(asset) ? "por dólar" : `por ${asset}`}.</p>
      )}
      <Rivals s={s} side={side} asset={asset} rivals={rivals} price={(opts.find((o) => o.plan === chosen) ?? opts[0])?.price ?? null} />
      <p className="sim-hint">El puesto es el de la lista de Binance (sin escribir monto): cuenta todos los anuncios, también los que no aceptan tu monto.</p>
    </div>
  );
}

// ---------------------------------------------------------------- rivales: quién está cerca y cuánto se mueve

function Rivals({ s, side, asset, rivals, price }: { s: State; side: Side; asset: string; rivals: Ad[]; price: number | null }) {
  const f = flowOf(s, asset, side);
  const measuring = !f || f.window < FLOW_MIN;
  // los 5 más cerca de tu precio (o los 5 primeros)
  const at = price == null ? 0 : Math.max(0, rivals.findIndex((x) => !beats(side, x.price, price)));
  const from = Math.max(0, Math.min(at - 2, rivals.length - 5));
  const near = rivals.slice(from, from + 5);
  if (!near.length) return null;
  const k = f ? 3600 / Math.max(f.window, 1) : 0;
  return (
    <div className="adv-rivals">
      <div className="adv-rivals-head">
        <b>Rivales cerca de tu precio</b>
        <small>{measuring ? "midiendo cuánto venden…" : `última ${f!.window >= 3500 ? "hora" : `${Math.round(f!.window / 60)} min`}`}</small>
      </div>
      {near.map((x) => {
        const r = rivalFlow(f, x);
        const pos = rivals.indexOf(x) + 1;
        return (
          <div key={x.adv ?? x.nick} className="adv-rival">
            <span className="adv-rival-pos">{pos}.º</span>
            <div className="adv-rival-who"><b>{x.nick}</b><small>{num(x.orders, 0)} órdenes/mes · {num(x.finish * 100, 0)} %{x.merchant ? " · comerciante" : ""}</small></div>
            <span className="adv-rival-price">{money(x.price)}</span>
            <span className={`adv-rival-flow ${r && r.perHour > 0 ? "up" : ""}`}>
              {!r ? "—" : r.perHour > 0
                ? <>{num(r.perHour, r.perHour < 10 ? 1 : 0)} órd./h · {money(r.fiatHour, 0)}/h{r.last ? <> · <Ago t={r.last} /></> : null}</>
                : "sin ventas"}
            </span>
          </div>
        );
      })}
      {f && !measuring && (
        <p className="sim-hint">
          {side === "BUY" ? "Les vendieron" : "Les compraron"} por puesto, por hora: {f.buckets.map((b, i) => (
            <span key={b.from}>{i ? " · " : ""}{b.from === b.to ? `${b.from}.º` : `${b.from}-${b.to}`} <b>{money(b.fiat * k, 0)}</b></span>
          ))}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- todas las combinaciones

function Matrix({ a, shown, onPick }: { a: Advice; shown: Combo | null; onPick: (buy: Plan, sell: Plan) => void }) {
  const cell = (b: Plan, v: Plan): Combo | undefined => a.combos.find((c) => c.buy.plan === b && c.sell.plan === v);
  return (
    <section className="card">
      <div className="mkt-sec-title">
        <span className="sec-ico"><Icon name="columns" /></span>
        <div>
          <h2>Todas las combinaciones</h2>
          <p className="sub">Lo que te queda por vuelta según cómo compras (filas) y cómo vendes (columnas). Toca una para elegirla</p>
        </div>
      </div>
      <div className="adv-matrix-wrap">
        <table className="adv-matrix">
          <thead>
            <tr><th>Compras \ Vendes</th>{PLANS.map((p) => <th key={p.id}>{p.label}<small>{p.short}</small></th>)}</tr>
          </thead>
          <tbody>
            {PLANS.map((b) => (
              <tr key={b.id}>
                <th>{b.label}<small>{b.short}</small></th>
                {PLANS.map((v) => {
                  const c = cell(b.id, v.id);
                  const best = a.best === c && !!c;
                  const on = !!c && shown === c;
                  return (
                    <td key={v.id} className={`${c ? tone(c.sim.net) : ""} ${best ? "best" : ""} ${on ? "on" : ""}`}>
                      {c ? (
                        <button type="button" className="adv-cell" aria-pressed={on} onClick={() => onPick(b.id, v.id)}
                          title={`Comprar: ${b.label} · Vender: ${v.label}`}>
                          <b>{pct(c.sim.ratio)}</b><small>{signedMoney(c.sim.net)}</small><small className={etaTone(c.eta)}>{eta(c.eta)}</small>
                          {best && <span className="adv-best-tag">Recomendada</span>}
                          {on && !best && <span className="adv-best-tag mine">Tu elección</span>}
                        </button>
                      ) : <span className="dim">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note"><Icon name="info" size={14} /> Tomar y tomar es el arbitraje directo (pestaña Arbitraje). El tiempo se estima con lo que se movió cada puesto en la última hora
        (el panel ve bajar el saldo de cada anuncio): es aproximado y cambia con la hora del día.</p>
    </section>
  );
}

// ---------------------------------------------------------------- mejores horas

function Hours({ s, asset, makerFee }: { s: State; asset: string; makerFee: number }) {
  const { hist } = useLive();
  const rows = useMemo(() => hourSpreads(hist, asset, makerFee, s.settings.gmf), [hist, asset, makerFee, s.settings.gmf]);
  const have = rows.filter((r) => r.net != null);
  const now = new Date().getHours();
  if (have.length < 2) {
    return (
      <section className="card">
        <EmptyBox icon="clock" title="Mejores horas para publicar">Se llena solo mientras el panel está prendido: vuelve en un par de horas.</EmptyBox>
      </section>
    );
  }
  const vals = have.map((r) => r.net!);
  const max = Math.max(...vals.map(Math.abs), 1e-6);
  const top = [...have].sort((x, y) => y.net! - x.net!).slice(0, 3);
  return (
    <section className="card">
      <div className="mkt-sec-title">
        <span className="sec-ico"><Icon name="clock" /></span>
        <div>
          <h2>Mejores horas para publicar {asset}</h2>
          <p className="sub">Margen entre anuncios en las últimas 24 h, ya sin tu comisión de anunciante{s.settings.gmf ? " y el 4x1000" : ""}</p>
        </div>
      </div>
      <div className="adv-hours" role="img" aria-label={`Mejores horas: ${top.map((t) => hourLabel(t.hour)).join(", ")}`}>
        {rows.map((r) => {
          const h = r.net == null ? 0 : (Math.abs(r.net) / max) * 100;
          return (
            <div key={r.hour} className={`adv-hour ${r.hour === now ? "now" : ""}`} title={r.net == null ? `${hourLabel(r.hour)}: sin datos` : `${hourLabel(r.hour)}: ${pct(r.net)}`}>
              <div className="adv-hour-bar">
                <span className={r.net == null ? "" : r.net > 0 ? "up" : "down"} style={{ height: `${Math.max(h, r.net == null ? 0 : 4)}%` } as CSSProperties} />
              </div>
              <small>{r.hour}</small>
            </div>
          );
        })}
      </div>
      <p className="sim-even">
        <Icon name="target" size={15} />
        <span>Donde más se abrió: {top.map((t, i) => <span key={t.hour}>{i ? ", " : ""}<b>{hourLabel(t.hour)}</b> ({pct(t.net)})</span>)}. La hora de ahora está marcada.</span>
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- lo que dicen tus anuncios

function MyAds({ s, asset }: { s: State; asset: string }) {
  const { hist } = useLive();
  const [saved, setSaved] = useState<Order[]>([]);
  useEffect(() => {
    if (!s.connected) return;
    let alive = true;
    api.orders().then((r) => alive && setSaved(r.orders)).catch(() => undefined);
    return () => { alive = false; };
  }, [s.connected]);
  const orders = useMemo(() => mergeOrders(saved, s.account?.orders ?? []), [saved, s.account?.orders]);
  const st = useMemo(() => makerStats(orders, hist, asset), [orders, hist, asset]);

  const head = (
    <div className="mkt-sec-title">
      <span className="sec-ico"><Icon name="history" /></span>
      <div>
        <h2>Lo que dicen tus anuncios</h2>
        <p className="sub">Tus órdenes de {asset} como anunciante en los últimos {st.days} días</p>
      </div>
    </div>
  );
  if (!s.connected) {
    return <section className="card">{head}<p className="sim-hint adv-gap">Conecta tu Binance en <b>Mi Binance</b> (llave de solo lectura) y aquí verás a qué precio te toman tus anuncios, a qué horas y cuánto mejor que tomar uno.</p></section>;
  }
  if (!st.buy.n && !st.sell.n) {
    return <section className="card">{head}<p className="sim-hint adv-gap">Todavía no tienes órdenes de {asset} que salgan de tus anuncios. Cuando publiques y te tomen, el asesor aprende de ellas.</p></section>;
  }
  const box = (sd: Side) => {
    const x = sd === "BUY" ? st.buy : st.sell;
    return (
      <div className="kpi">
        <small>{sd === "BUY" ? "Te vendieron" : "Te compraron"}</small>
        <b className="val">{x.n} {plural(x.n, "orden", "órdenes")}</b>
        <span>{money(x.fiat, 0)} · promedio {money(x.avgPrice)}</span>
        {x.edge != null && (
          <span className={tone(x.edge)}>{pct(x.edge)} {sd === "BUY" ? "más barato que comprarle ya al 1.º" : "más que venderle ya al 1.º"}{x.edgeN < x.n ? ` (${x.edgeN} de hoy)` : ""}</span>
        )}
      </div>
    );
  };
  return (
    <section className="card">
      {head}
      <div className="kpis">
        {box("BUY")}
        {box("SELL")}
        <div className="kpi">
          <small>Tu margen real</small>
          <b className={`val ${tone(st.spread)}`}>{st.spread == null ? "—" : pct(st.spread)}</b>
          <span>venta promedio vs. compra promedio, antes de comisiones</span>
        </div>
        <div className="kpi">
          <small>Te toman más a las</small>
          <b className="val">{st.hours[0] ? hourLabel(st.hours[0].hour) : "—"}</b>
          <span>{st.hours.slice(1, 3).map((h) => hourLabel(h.hour)).join(" · ") || "aún pocas órdenes"}</span>
        </div>
      </div>
      <p className="note"><Icon name="info" size={14} /> Binance no dice cuánto tardó en llenarse cada anuncio: se compara cada orden con el mercado de ese momento (solo las de las últimas 24 h).</p>
    </section>
  );
}

// ---------------------------------------------------------------- vigilar mi anuncio


function WatchRow({ a, m, amount }: { a: PriceAlert; m: MarketEntry; amount: number | null }) {
  const { toast, refresh } = useLive();
  const [busy, setBusy] = useState(false);
  const amt = a.amount || amount || 0;
  const w = watchState(m, a.side, a.target, amt, a.ahead_ok ?? 0);
  const buying = a.side === "BUY";
  const more = !w.lost && w.ideal != null && w.room >= roomGap(a.target);
  const extra = more ? (amt * w.room) / a.target : 0; // pesos más por vuelta, aprox.
  const where = w.want === 1 ? "1.º" : `en el top ${w.want}`;
  const run = async (f: () => Promise<unknown>, msg?: string) => {
    setBusy(true);
    try {
      await f();
      if (msg) toast(msg, undefined, "good", 2500);
      refresh();
    } catch (e) {
      toast("No se pudo guardar", (e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (await ask({ title: "¿Dejar de vigilar este anuncio?", body: "Ya no te avisaré si te pasan o si puedes ganar más.", confirm: "Quitar", tone: "danger", icon: "trash" })) {
      void run(() => api.deletePriceAlert(a.id));
    }
  };
  return (
    <div className={`pa-row adv-row ${a.on ? (w.lost ? "lost" : more ? "more" : "") : "off"}`}>
      <div className="pa-coin">
        <span className={`mkt-col-ico ${a.side}`}><Icon name={buying ? "cart" : "handCoins"} size={16} /></span>
        <div><b>Mi {buying ? "compra" : "venta"} de {a.asset}</b><small>a {money(a.target)} · quiero {where}</small>
          {a.hits ? <small>avisó {a.hits} {a.hits === 1 ? "vez" : "veces"}{a.last_hit ? <> · <Ago t={a.last_hit} /></> : null}</small> : null}</div>
      </div>
      <div className="pa-cell">
        <small>Puesto ahora</small>
        <b className={w.lost ? "down" : "up"}>{w.pos}.º</b>
        <span className="dim">{w.top ? `1.º ${w.top.nick} · ${money(w.top.price)}` : "nadie compite por tu monto"}</span>
      </div>
      <div className="pa-cell">
        <small>{w.lost ? "Te pasaron" : more ? "Puedes ganar más" : "Estado"}</small>
        <b className={w.lost ? "down" : more ? "up" : ""}>
          {w.lost ? `${buying ? "Súbelo" : "Bájalo"} a ${money(w.ideal)}` : more ? `${buying ? "Bájalo" : "Súbelo"} a ${money(w.ideal)}` : "Bien puesto"}
        </b>
        <span className="dim">
          {w.lost ? `para volver a quedar ${where}` : more ? `sigues ${where} y ganas ≈ ${signedMoney(extra)} más por vuelta`
            : buying ? `no pagas de más para quedar ${where}` : `no cobras de menos para quedar ${where}`}
        </span>
      </div>
      <div className="pa-tags">
        {(w.lost || more) && w.ideal != null && (
          <button className={`btn btn-sm ${more ? "btn-brand" : ""}`} disabled={busy} title="Primero cámbialo en Binance (Mis anuncios)"
            onClick={() => void run(() => api.updatePriceAlert(a.id, { target: w.ideal! }), `Vigilando ${money(w.ideal)}`)}>
            <Icon name="refresh" size={15} /> Ya lo puse en {money(w.ideal)}
          </button>
        )}
      </div>
      <div className="pa-actions">
        <Toggle on={a.on} onChange={(v) => void run(() => api.updatePriceAlert(a.id, { on: v }))} disabled={busy} label={a.on ? "Activa" : "Pausada"} />
        <button className="icon-btn danger" onClick={() => void remove()} title="Quitar" aria-label={`Dejar de vigilar mi anuncio de ${a.asset}`}><Icon name="trash" size={16} /></button>
      </div>
    </div>
  );
}

/** "move" guarda BOTH en side (el tipo dice Side para no tocar las otras alertas). */
type MoveSide = Side | "BOTH";
const moveSide = (a: PriceAlert) => a.side as MoveSide;
const MOVE_SIDES = [
  ["BOTH", "Compra y venta"],
  ["BUY", <span key="b" className="mkt-switch-opt"><Icon name="cart" size={15} />Compra</span>],
  ["SELL", <span key="s" className="mkt-switch-opt"><Icon name="handCoins" size={15} />Venta</span>],
] as const;
const STEPS = [1, 3, 5, 10, 20] as const;

/** El mejor precio de la lista con la que compite tu anuncio de ese lado, por tu monto (sin tu propio anuncio). */
function topFor(m: MarketEntry, side: Side, amount: number) {
  void amount;
  return rivalsOf(m, side)[0]; // el 1.º de la lista, el mismo que ves en Binance
}

function MoveRow({ a, m, amount }: { a: PriceAlert; m: MarketEntry; amount: number }) {
  const { toast, refresh } = useLive();
  const [busy, setBusy] = useState(false);
  const sides: Side[] = moveSide(a) === "BOTH" ? ["BUY", "SELL"] : [a.side];
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await f();
      refresh();
    } catch (e) {
      toast("No se pudo guardar", (e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (await ask({ title: `¿Quitar el aviso de ${a.asset}?`, body: "Ya no te avisaré cuando el precio se mueva.", confirm: "Quitar", tone: "danger", icon: "trash" })) {
      void run(() => api.deletePriceAlert(a.id));
    }
  };
  return (
    <div className={`pa-row adv-row ${a.on ? "" : "off"}`}>
      <div className="pa-coin">
        <span className="sec-ico"><Icon name="activity" size={16} /></span>
        <div>
          <b>{a.asset} · {moveSide(a) === "BOTH" ? "compra y venta" : a.side === "BUY" ? "compra" : "venta"}</b>
          <small>cada vez que se mueva {money(a.target)}</small>
          {a.hits ? <small>avisó {a.hits} {a.hits === 1 ? "vez" : "veces"}{a.last_hit ? <> · <Ago t={a.last_hit} /></> : null}</small> : null}
        </div>
      </div>
      {sides.map((sd) => {
        const now = topFor(m, sd, a.amount || amount)?.price ?? a.last?.now?.[sd];
        const ref = a.ref?.[sd];
        const d = now != null && ref != null ? now - ref : null;
        return (
          <div key={sd} className="pa-cell">
            <small>{sd === "BUY" ? "Los que compran pagan" : "Los que venden cobran"}</small>
            <b>{money(now)}</b>
            <span className={`dim ${d ? (d > 0 ? "up" : "down") : ""}`}>
              {d == null ? "esperando el primer precio" : d === 0 ? `igual que el último aviso` : `${d > 0 ? "+" : "−"}${money(Math.abs(d))} desde el último aviso`}
            </span>
          </div>
        );
      })}
      <div className="pa-actions">
        <Toggle on={a.on} onChange={(v) => void run(() => api.updatePriceAlert(a.id, { on: v }))} disabled={busy} label={a.on ? "Activa" : "Pausada"} />
        <button className="icon-btn danger" onClick={() => void remove()} title="Quitar" aria-label={`Quitar el aviso de ${a.asset}`}><Icon name="trash" size={16} /></button>
      </div>
    </div>
  );
}

function Watch({ s, asset, m, amount }: { s: State; asset: string; m: MarketEntry; amount: number }) {
  const { toast, refresh } = useLive();
  const [side, setSide] = useState<MoveSide>("BOTH");
  const [step, setStep] = useState<number>(isDollar(asset) ? 3 : 0);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const all = s.price_alerts ?? [];
  const moves = all.filter((a) => a.kind === "move" && a.asset === asset);
  const old = all.filter((a) => a.kind === "outbid" && a.asset === asset);
  const ref = topFor(m, "BUY", amount)?.price ?? topFor(m, "SELL", amount)?.price ?? 0;
  // en BTC y otras caras, pasos proporcionales al precio
  const steps = isDollar(asset) || ref < 1e5 ? STEPS.map((v) => v) : STEPS.map((v) => Math.round((ref * v) / 4000 / 1000) * 1000 || 1000);
  const value = typed.trim() ? parseCop(typed) : step || steps[1];
  const add = async () => {
    if (!(value > 0)) return toast("Elige cada cuánto avisar", "Por ejemplo cada $3", "bad");
    setBusy(true);
    try {
      await api.addPriceAlert({ kind: "move", asset, side: side as Side, target: value, mine: false, once: false, amount });
      toast("Aviso creado", `Te aviso cada vez que ${side === "BOTH" ? "la compra o la venta" : side === "BUY" ? "la compra" : "la venta"} de ${asset} se mueva ${money(value)}.`, "good", 3500);
      setTyped("");
      refresh();
    } catch (e) {
      toast("No se pudo guardar", (e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card pa" id="adv-watch">
      <div className="mkt-sec-title">
        <span className="sec-ico"><Icon name="bellRing" /></span>
        <div>
          <h2>Avisarme cuando el precio se mueva</h2>
          <p className="sub">Cada vez que lo que pagan los que compran o lo que cobran los que venden suba o baje lo que elijas, te aviso (campana, notificación y Telegram)
            con el precio nuevo y a cuánto poner tu anuncio para quedar 1.º</p>
        </div>
      </div>
      <div className="adv-watch-form">
        <Segmented label="Qué precio" value={side} onChange={setSide} options={MOVE_SIDES} />
        <span className="adv-keep"><small>Cada</small>
          <Segmented label="Cada cuánto" value={typed.trim() ? -1 : (step || steps[1])} onChange={(v) => { setStep(v); setTyped(""); }}
            options={steps.map((v) => [v, money(v, 0)] as const)} />
        </span>
        <span className="mc-input adv-step-in"><span>$</span><input type="text" inputMode="decimal" value={typed} onChange={(e) => setTyped(e.target.value)}
          placeholder="otro" aria-label="Otro monto" /></span>
        <button className="btn btn-brand" disabled={busy} onClick={() => void add()}><Icon name="bellPlus" size={16} /> Avisarme</button>
      </div>
      {moves.length > 0 && <div className="pa-list">{moves.map((a) => <MoveRow key={a.id} a={a} m={m} amount={amount} />)}</div>}
      {old.length > 0 && (
        <>
          <p className="sim-hint adv-gap">Avisos de puesto que creaste antes (puedes pausarlos o quitarlos):</p>
          <div className="pa-list">{old.map((a) => <WatchRow key={a.id} a={a} m={m} amount={amount} />)}</div>
        </>
      )}
      <p className="note"><Icon name="info" size={14} /> Cuenta el 1.º de la lista de Binance, sin contar tus anuncios:
        si cambias tu propio anuncio no te avisa.</p>
    </section>
  );
}

// ---------------------------------------------------------------- tus anuncios publicados

function Published({ s, asset, m, amount, makerFee, onUse }: {
  s: State; asset: string; m: MarketEntry; amount: number; makerFee: number; onUse: (buy: number | null, sell: number | null) => void;
}) {
  const { saveSettings, toast } = useLive();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = s.my_ads;
  const set = !!(s.settings.p2p_user || s.settings.p2p_nick);
  // anunciantes que están ahora en el mercado (todas las criptos y ambos lados), para que toques el tuyo
  const found = useMemo(() => {
    const q = typed.trim().toLowerCase();
    if (q.length < 2 || q.startsWith("http")) return [];
    const seen = new Map<string, Ad>();
    for (const e of Object.values(s.p2p?.market_all ?? s.p2p?.market ?? {})) {
      for (const l of [e.all?.BUY, e.all?.SELL, e.BUY, e.SELL]) {
        for (const x of l ?? []) if (x.user && x.nick.toLowerCase().includes(q) && !seen.has(x.user)) seen.set(x.user, x);
      }
    }
    return [...seen.values()].sort((x, y) => Number(y.nick.toLowerCase() === q) - Number(x.nick.toLowerCase() === q)).slice(0, 8);
  }, [typed, s.p2p]);
  const pick = async (x: Ad) => {
    setBusy(true);
    const ok = await saveSettings({ p2p_pick: { user: x.user!, nick: x.nick } });
    setBusy(false);
    if (ok) {
      setTyped("");
      toast("Listo", `Leo los anuncios de ${x.nick} en unos segundos.`, "good", 3000);
    }
  };
  const save = async (v: string) => {
    setBusy(true);
    const ok = await saveSettings({ p2p_profile: v });
    setBusy(false);
    if (ok) {
      setTyped("");
      toast(v ? "Perfil guardado" : "Perfil quitado", v ? "Leo tus anuncios en unos segundos." : undefined, "good", 3000);
    }
  };
  const head = (
    <div className="mkt-sec-title">
      <span className="sec-ico"><Icon name="megaphone" /></span>
      <div>
        <h2>Tus anuncios publicados</h2>
        <p className="sub">{set ? <>Leídos de tu perfil de P2P{mine?.nick ? <> (<b>{mine.nick}</b>)</> : null} cada 30 s{mine?.t ? <> · <Ago t={mine.t} /></> : null}</>
          : "Escribe tu apodo de P2P y leo tus anuncios solos: en qué puesto vas, cuánto tardan y a cuánto moverlos"}</p>
      </div>
      {set && <button className="btn btn-sm adv-head-btn" disabled={busy} onClick={() => void save("")}>Cambiar perfil</button>}
    </div>
  );
  if (!set) {
    return (
      <section className="card">
        {head}
        <div className="adv-watch-form">
          <span className="mc-input adv-profile-in"><Icon name="search" size={15} /><input type="text" value={typed} onChange={(e) => setTyped(e.target.value)}
            placeholder="Tu apodo en Binance P2P" aria-label="Tu apodo en Binance P2P" /></span>
          <button className="btn" disabled={busy || !typed.trim()} onClick={() => void save(typed.trim())}><Icon name="check" size={16} /> Guardar apodo</button>
        </div>
        {found.length > 0 && (
          <div className="adv-found">
            <small>¿Eres alguno de estos? Toca el tuyo:</small>
            <div className="sim-chips">
              {found.map((x) => (
                <button key={x.user} type="button" className="btn btn-sm btn-brand" disabled={busy} onClick={() => void pick(x)}>
                  <Icon name="checkCircle" size={14} /> {x.nick} <span className="dim">· {num(x.orders, 0)} órdenes</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {typed.trim().length >= 2 && !found.length && !typed.startsWith("http") && (
          <p className="sim-hint">No veo a nadie con ese nombre en los anuncios de ahora. Revisa que esté igual que en Binance y toca <b>Guardar apodo</b>:
            apenas publiques un anuncio te encuentro solo.</p>
        )}
        <p className="sim-hint">Tu apodo es el nombre que ven los demás en tus anuncios (en Binance: P2P → el ícono de tu perfil). No hace falta ninguna llave:
          tus anuncios se leen de tu perfil público.</p>
      </section>
    );
  }
  const ads = (mine?.ads ?? []).filter((x) => x.asset === asset);
  const want = s.settings.ads_pos ?? 1;
  const gmf = s.settings.gmf;
  /** Lo que deja comprar con tu anuncio a `b` y vender con tu anuncio a `v`. */
  const marginOf = (b: number, v: number) => simulateAds(1e6, b, v, makerFee, makerFee, gmf, true).ratio;
  const alertOn = s.settings.ads_alert !== false;
  const setAlert = async (p: { ads_alert?: boolean; ads_pos?: number }) => {
    if (await saveSettings(p)) toast("Guardado", undefined, "good", 1800);
  };
  const others = (mine?.ads ?? []).length - ads.length;
  const buyAd = ads.find((x) => x.side === "BUY");
  const sellAd = ads.find((x) => x.side === "SELL");
  const pair = buyAd && sellAd ? simulateAds(amount, buyAd.price, sellAd.price, makerFee, makerFee, s.settings.gmf, true) : null;
  return (
    <section className="card">
      {head}
      <div className="adv-alert-bar">
        <Toggle on={alertOn} onChange={(v) => void setAlert({ ads_alert: v })} label="Avisarme cuando deba mover mis anuncios" />
        <span className="adv-keep"><small>Los quiero</small>
          <Segmented label="Puesto que quiero" value={want} onChange={(v) => void setAlert({ ads_pos: v })}
            options={[[1, "1.º"], [3, "Top 3"], [5, "Top 5"]] as const} />
        </span>
        <small className="dim">Te aviso (campana, notificación y Telegram) si te pasan, con el precio para volver y si todavía ganas, o si puedes ajustarlo y ganar más.</small>
      </div>
      {mine?.error && <p className="sim-warn"><Icon name="alert" size={15} /> {mine.error}</p>}
      {!mine && <p className="sim-hint adv-gap">Leyendo tus anuncios…</p>}
      {mine && !ads.length && !mine.error && (
        <p className="sim-hint adv-gap">No tienes anuncios de {asset} publicados ahora{others ? ` (tienes ${others} de otras criptos)` : ""}. Usa la recomendación de abajo para publicar.</p>
      )}
      {ads.length > 0 && (
        <div className="pa-list">
          {ads.map((x) => {
            const buys = x.side === "BUY";
            const rivals = rivalsOf(m, x.side);
            const r = rankIn(rivals, x.price, x.side);
            const top = rivals[0];
            // precio justo para el puesto que quieres: un paso mejor que el que hoy está en ese puesto
            const at = rivals[want - 1];
            const ideal = at ? at.price + (buys ? 1 : -1) * advTick(at.price) : rivals[rivals.length - 1]?.price ?? null;
            const lost = r.pos > want;
            const room = ideal != null && !lost ? (buys ? x.price - ideal : ideal - x.price) : 0;
            const more = room >= roomGap(x.price);
            // contra qué se gana: tu anuncio del otro lado, o publicar uno un paso mejor que el 1.º de ese lado
            const own = ads.find((y) => y.side !== x.side);
            const otherTop = rivalsOf(m, buys ? "SELL" : "BUY")[0];
            const counter = own?.price ?? (otherTop ? otherTop.price + (buys ? -1 : 1) * advTick(otherTop.price) : null);
            const how = own ? `con tu ${buys ? "venta" : "compra"} a ${money(own.price)}` : `si ${buys ? "vendes" : "compras"} con anuncio a ${money(counter)}`;
            const margin = (p: number | null) => (p == null || counter == null ? null : buys ? marginOf(p, counter) : marginOf(counter, p));
            const mNew = margin(ideal);
            const mNow = margin(x.price);
            const left = x.available * x.price;
            const t = etaAt(flowOf(s, asset, x.side), r.pos, Math.min(amount, left || amount));
            const where = want === 1 ? "1.º" : `en el top ${want}`;
            const noGo = lost && mNew != null && mNew <= 0;
            return (
              <div key={x.adv ?? x.side} className={`pa-row adv-row adv-pub ${lost ? (noGo ? "off-ish" : "lost") : more ? "more" : "ok"}`}>
                <div className="pa-coin">
                  <span className={`mkt-col-ico ${x.side}`}><Icon name={buys ? "cart" : "handCoins"} size={16} /></span>
                  <div><b>{buys ? "Compras" : "Vendes"} {asset} a {money(x.price)}</b>
                    <small>quedan {isDollar(asset) ? num(x.available, 2) : num(x.available, 6)} {asset} (≈ {money(left, 0)}) · {money(x.min, 0)} – {money(x.max, 0)}</small>
                    {mNow != null && <small>hoy te deja <b className={tone(mNow)}>{pct(mNow)}</b> {how}</small>}</div>
                </div>
                <div className="pa-cell">
                  <small>Puesto ahora</small>
                  <b className={lost ? "down" : "up"}>{rankText(r)}</b>
                  <span className="dim">{top ? `mejor rival: ${top.nick} · ${money(top.price)}` : "nadie más en la lista"}</span>
                </div>
                <div className="pa-cell">
                  <small>{lost ? (noGo ? `Para quedar ${where} ya no da` : `Para quedar ${where}`) : more ? "Puedes ganar más" : "Bien puesto"}</small>
                  <b className={noGo ? "down" : lost ? "" : "up"}>
                    {lost ? (noGo ? "No la muevas" : `${buys ? "Súbela" : "Bájala"} a ${money(ideal)}`)
                      : more ? `${buys ? "Bájala" : "Súbela"} a ${money(ideal)}` : "No la toques"}
                  </b>
                  <span className="dim">
                    {(lost || more) && mNew != null ? <>{noGo ? `en ${money(ideal)} perderías ` : "con eso te queda "}<b className={tone(mNew)}>{pct(mNew)}</b> · </> : null}
                    <Icon name="timer" size={12} /> se llena {eta(t)}
                  </span>
                </div>
                <div className="pa-tags">
                  <a className="btn btn-sm" href="https://p2p.binance.com/es/myads" target="_blank" rel="noopener noreferrer"><Icon name="pencil" size={14} /> Editar <Icon name="external" size={12} /></a>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {pair && (
        <p className="sim-even">
          <Icon name="trend" size={15} />
          <span>Entre tus dos anuncios (compras a {money(buyAd!.price)} y vendes a {money(sellAd!.price)}), con {money(amount, 0)} por vuelta te
            quedan <b className={tone(pair.net)}>{signedMoney(pair.net)}</b> ({pct(pair.ratio)}).{" "}
            <button type="button" className="btn btn-sm" onClick={() => onUse(buyAd!.price, sellAd!.price)}><Icon name="sliders" size={14} /> Simular</button></span>
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- vista

export function AdAdvisor({ s, asset, m: book, amount, makerFee, onUse }: {
  s: State; asset: string; m: MarketEntry; amount: number | null; makerFee: number;
  onUse: (buy: number | null, sell: number | null) => void;
}) {
  // tus propios anuncios no son rivales: sin ellos se calcula todo
  const me = s.my_ads?.user ?? s.settings.p2p_user;
  const m = useMemo(() => {
    if (!me) return book;
    const not = (l?: Ad[]) => l?.filter((x) => x.user !== me);
    return { ...book, BUY: not(book.BUY)!, SELL: not(book.SELL)!, all: book.all && { BUY: not(book.all.BUY), SELL: not(book.all.SELL) } };
  }, [book, me]);
  const a = useMemo(() => (amount ? advise(s, asset, m, amount, makerFee) : null), [s, asset, m, amount, makerFee]);
  // lo que elegiste en cada lado (undefined = el de la recomendada); se queda aunque el mercado se mueva
  const [pick, setPick] = useState<{ buy?: Plan; sell?: Plan }>({});
  useEffect(() => setPick({}), [asset]);
  if (!a) return <div className="card"><EmptyBox icon="sliders" title="Falta el monto">Escribe cuánto usas por vuelta.</EmptyBox></div>;
  const picked = pick.buy != null || pick.sell != null;
  const bp = pick.buy ?? a.best?.buy.plan ?? "fast";
  const sp = pick.sell ?? a.best?.sell.plan ?? "fast";
  const shown = picked ? a.combos.find((c) => c.buy.plan === bp && c.sell.plan === sp) ?? null : a.best;
  const watch = () => document.getElementById("adv-watch")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <>
      <Published s={s} asset={asset} m={m} amount={a.amount} makerFee={makerFee} onUse={onUse} />
      <Verdict s={s} asset={asset} a={a} c={shown} picked={picked} onReset={() => setPick({})} onUse={onUse} onWatch={watch} />
      <section className="card">
        <div className="sim-sides">
          <Ladder s={s} shown={shown} side="BUY" asset={asset} a={a} chosen={shown ? bp : undefined} onPick={(p) => setPick((x) => ({ ...x, buy: p, sell: x.sell ?? sp }))} />
          <Ladder s={s} shown={shown} side="SELL" asset={asset} a={a} chosen={shown ? sp : undefined} onPick={(p) => setPick((x) => ({ ...x, sell: p, buy: x.buy ?? bp }))} />
        </div>
      </section>
      <Matrix a={a} shown={shown} onPick={(b, v) => setPick({ buy: b, sell: v })} />
      <Hours s={s} asset={asset} makerFee={makerFee} />
      <MyAds s={s} asset={asset} />
      <Watch key={asset} s={s} asset={asset} m={m} amount={a.amount} />
    </>
  );
}

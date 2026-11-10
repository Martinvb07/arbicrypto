"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { advise, hourSpreads, makerStats, mergeOrders, PLANS, rivalsOf, roomGap, watchState, type Advice, type Combo, type Plan,
  type SideOption } from "@/lib/advisor";
import { api } from "@/lib/api";
import { advertiserUrl, adRank, isDollar } from "@/lib/calc";
import { money, num, pct, plural, signedMoney, tone } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { MarketEntry, Order, PriceAlert, Side, State } from "@/lib/types";
import { ask } from "../overlay";
import { Ago, EmptyBox, GoButton, Icon, Segmented, Toggle } from "../ui";

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
          const r = o.plan !== "take" && o.price ? adRank(rivals, o.price, sd) : null;
          return (
            <div key={sd} className={`adv-step ${sd}`}>
              <span className="adv-step-n">{i + 1}</span>
              <div>
                <small>{sd === "BUY" ? "Compras" : "Vendes"} · {p.label}</small>
                <b>{sideText(o, sd, asset)}</b>
                <span className="dim">
                  {r ? <>Sales {r.pos}.º{r.ties ? ` · empatado con ${r.ties}` : ""} de {r.of + 1}</> : o.ad ? <>acepta {money(o.ad.min, 0)} – {money(o.ad.max, 0)}</> : null}
                </span>
              </div>
              {o.plan === "take" && o.ad && <GoButton href={advertiserUrl(o.ad)} icon={sd === "BUY" ? "cart" : "handCoins"}>Abrir</GoButton>}
            </div>
          );
        })}
      </div>
      <div className="kpis">
        <div className={`kpi ${c.sim.net > 0 ? "kpi-good" : ""}`}><small>Te queda por vuelta</small><b className={`val ${tone(c.sim.net)}`}>{signedMoney(c.sim.net)}</b><span>{pct(c.sim.ratio)} neto</span></div>
        <div className="kpi"><small>Compra hasta</small><b className="val">{money(lim.buy)}</b><span>para no perder vendiendo a {money(c.sell.price)} · {money(lim.buySafe)} para ganar {pct(s.settings.safe_p2p, 1)}</span></div>
        <div className="kpi"><small>Vende desde</small><b className="val">{money(lim.sell)}</b><span>para no perder comprando a {money(c.buy.price)} · {money(lim.sellSafe)} para ganar {pct(s.settings.safe_p2p, 1)}</span></div>
        <div className="kpi"><small>Comisiones</small><b className="val down">−{money(c.sim.fees, 0)}</b><span>{c.sim.gmf ? `+ 4x1000 ${money(c.sim.gmf, 0)}` : "sin 4x1000"}</span></div>
      </div>
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
          <button type="button" className="btn btn-sm" onClick={onWatch}><Icon name="bellRing" size={15} /> Ya lo publiqué: avisarme si me pasan</button>
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
          <p className="sub">{top ? <>El 1.º {buying ? "paga" : "cobra"} <b>{money(top.price)}</b> ({top.nick}) · {rivals.length} {plural(rivals.length, "rival", "rivales")} para tu monto</> : "Nadie más compite con tu monto"}</p>
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
          const r = !take && o.price ? adRank(rivals, o.price, side) : null;
          return (
            <button type="button" key={o.plan} className={`adv-rung ${chosen === o.plan ? "on" : ""}`} disabled={!o.price}
              aria-pressed={chosen === o.plan} onClick={() => onPick(o.plan)}>
              <div><b>{p.label}{rec === o.plan && <span className="adv-rec-dot">Recomendada</span>}{loses(o.price) && <span className="adv-rec-dot bad">Pierdes</span>}</b>
                <small>{take ? (o.ad ? `${buying ? "Le compras" : "Le vendes"} a ${o.ad.nick}` : "Nadie acepta tu monto")
                  : r ? `Sales ${r.pos}.º de ${r.of + 1}${r.ties ? ` · empatado con ${r.ties}` : ""}` : p.short}</small></div>
              <span className="adv-rung-price">{money(o.price)}</span>
              <span className="dim">{take ? "sin esperar · comisión de tomar" : diff == null ? "" : diff === 0 ? "igual al 1.º" : `${diff > 0 ? "+" : "−"}${money(Math.abs(diff))} vs. 1.º`}</span>
            </button>
          );
        })}
      </div>
      {gap != null && (
        <p className="sim-warn"><Icon name="info" size={15} /> El 1.º va {money(gap)} por delante del 2.º: quedar 2.º te ahorra eso {isDollar(asset) ? "por dólar" : `por ${asset}`}.</p>
      )}
      {skipped > 0 && <p className="sim-hint">No cuento {skipped} {plural(skipped, "anuncio", "anuncios")} que no compiten por tu monto (límites muy distintos o sin saldo).</p>}
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
                          <b>{pct(c.sim.ratio)}</b><small>{signedMoney(c.sim.net)}</small>
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
      <p className="note"><Icon name="info" size={14} /> Tomar y tomar es el arbitraje directo (pestaña Arbitraje). Con tu anuncio ganas más, pero solo cuando alguien lo toma, y mientras esperas los precios se mueven.</p>
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

const KEEP = [[0, "1.º"], [2, "Top 3"], [4, "Top 5"]] as const;

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
    <div className={`pa-row ${(w.lost || more) && a.on ? "hit" : ""} ${a.on ? "" : "off"}`}>
      <div className="pa-coin">
        <span className={`mkt-col-ico ${a.side}`}><Icon name={buying ? "cart" : "handCoins"} size={16} /></span>
        <div><b>Mi {buying ? "compra" : "venta"} de {a.asset}</b><small>a {money(a.target)} · quiero {where}</small>
          {a.hits ? <small>avisó {a.hits} {a.hits === 1 ? "vez" : "veces"}{a.last_hit ? <> · <Ago t={a.last_hit} /></> : null}</small> : null}</div>
      </div>
      <div className="pa-cell">
        <small>Puesto ahora</small>
        <b className={w.lost ? "down" : "up"}>{w.pos}.º <span className="dim">de {w.rivals + 1}</span></b>
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

function Watch({ s, asset, m, seed, amount }: {
  s: State; asset: string; m: MarketEntry; seed: { BUY: number | null; SELL: number | null }; amount: number;
}) {
  const { toast, refresh } = useLive();
  const [side, setSide] = useState<Side>("BUY");
  const [typed, setTyped] = useState<string | null>(null);
  const [keep, setKeep] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const rows = (s.price_alerts ?? []).filter((a) => a.kind === "outbid" && a.asset === asset);
  const price = typed ?? (seed[side] != null ? String(seed[side]).replace(".", ",") : "");
  const add = async () => {
    const t = parseCop(price);
    if (!(t > 0)) return toast("Escribe el precio de tu anuncio", "El mismo que pusiste en Binance", "bad");
    setBusy(true);
    try {
      await api.addPriceAlert({ kind: "outbid", asset, side, target: t, mine: false, once: false, ahead_ok: keep, amount });
      toast("Vigilando tu anuncio", `Te aviso si te pasan o si puedes ${side === "BUY" ? "pagar menos" : "cobrar más"} sin perder tu puesto.`, "good", 3500);
      setTyped(null);
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
          <h2>Vigilar mi anuncio</h2>
          <p className="sub">Escribe el precio con el que lo publicaste y en qué puesto lo quieres. Te aviso (campana, notificación y Telegram) si te pasan,
            y también si puedes {side === "BUY" ? "pagar menos" : "cobrar más"} sin perder el puesto: así ganas más por vuelta</p>
        </div>
      </div>
      <div className="adv-watch-form">
        <Segmented label="Mi anuncio" value={side} onChange={(v) => { setSide(v); setTyped(null); }}
          options={[["BUY", <span key="b" className="mkt-switch-opt"><Icon name="cart" size={15} />De compra</span>],
            ["SELL", <span key="s" className="mkt-switch-opt"><Icon name="handCoins" size={15} />De venta</span>]] as const} />
        <span className="mc-input"><span>$</span><input type="text" inputMode="decimal" value={price} onChange={(e) => setTyped(e.target.value)}
          placeholder={num(rivalsOf(m, side)[0]?.price, 2)} aria-label="Precio de mi anuncio" /></span>
        <span className="adv-keep"><small>Lo quiero</small><Segmented label="Puesto que quiero" value={keep} onChange={setKeep} options={KEEP} /></span>
        <button className="btn btn-brand" disabled={busy} onClick={() => void add()}><Icon name="bellPlus" size={16} /> Vigilar</button>
      </div>
      {rows.length > 0 && <div className="pa-list">{rows.map((a) => <WatchRow key={a.id} a={a} m={m} amount={amount} />)}</div>}
      <p className="note"><Icon name="info" size={14} /> Solo cuentan los anuncios que compiten por tu monto ({money(amount, 0)}), igual que arriba. El panel solo lee:
        cambiar el precio se hace en Binance (Mis anuncios); cuando lo cambies allá, toca «Ya lo puse» para que vigile el nuevo.</p>
    </section>
  );
}

// ---------------------------------------------------------------- vista

export function AdAdvisor({ s, asset, m, amount, makerFee, onUse }: {
  s: State; asset: string; m: MarketEntry; amount: number | null; makerFee: number;
  onUse: (buy: number | null, sell: number | null) => void;
}) {
  const a = useMemo(() => (amount ? advise(s, asset, m, amount, makerFee) : null), [s, asset, m, amount, makerFee]);
  // lo que elegiste en cada lado (undefined = el de la recomendada); se queda aunque el mercado se mueva
  const [pick, setPick] = useState<{ buy?: Plan; sell?: Plan }>({});
  useEffect(() => setPick({}), [asset]);
  if (!a) return <div className="card"><EmptyBox icon="sliders" title="Falta el monto">Escribe cuánto usas por vuelta.</EmptyBox></div>;
  const picked = pick.buy != null || pick.sell != null;
  const bp = pick.buy ?? a.best?.buy.plan ?? "fast";
  const sp = pick.sell ?? a.best?.sell.plan ?? "fast";
  const shown = picked ? a.combos.find((c) => c.buy.plan === bp && c.sell.plan === sp) ?? null : a.best;
  const seed = { BUY: shown && shown.buy.plan !== "take" ? shown.buy.price : null, SELL: shown && shown.sell.plan !== "take" ? shown.sell.price : null };
  const watch = () => document.getElementById("adv-watch")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <>
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
      <Watch key={asset} s={s} asset={asset} m={m} seed={seed} amount={a.amount} />
    </>
  );
}

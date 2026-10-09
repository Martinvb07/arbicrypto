"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { advertiserUrl, COIN_NAMES, dayStats, effBuy, isDollar, perDollar, roundTrip, series } from "@/lib/calc";
import { money, num, pct, pctPlain, perUsd, qty, signedMoney, tone } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { Ad, P2PStep, Route, Side, State } from "@/lib/types";
import { p2pRow, RouteStatus, Steps } from "./Home";
import { PriceChart } from "../PriceChart";
import { Ago, Coin, EmptyBox, ExtLink, Icon, Segmented, Skeleton, Usd, type IconName } from "../ui";
import { CapitalField, CostsNote, GmfToggle } from "../controls";

// Verde: precio casi igual al mejor y anunciante confiable. Rojo: lo contrario.
const NEAR_BEST = 0.001; // hasta 0,1 % peor que el mejor precio (unos $3 por dólar)
const MIN_ORDERS = 50;
const MIN_FINISH = 0.97;

function judge(ad: Ad, best: number, side: Side, s: State) {
  const gap = Math.max(0, side === "BUY" ? ad.price / best - 1 : 1 - ad.price / best);
  const usd = perDollar(gap, s);
  const ordersOk = ad.orders >= MIN_ORDERS;
  const finishOk = ad.finish >= MIN_FINISH;
  const priceOk = gap <= NEAR_BEST;
  let label: string;
  if (gap === 0) label = "Mejor precio";
  else label = `${side === "BUY" ? "Pagas" : "Recibes"} ${perUsd(usd).replace(/^[+−]/, "")} ${side === "BUY" ? "más" : "menos"} por dólar`;
  if (priceOk && !finishOk) label = "Cancela seguido";
  else if (priceOk && !ordersOk) label = "Pocas órdenes";
  return { good: priceOk && ordersOk && finishOk, priceOk, ordersOk, finishOk, label };
}

/** Cada cuánto se revisa el P2P, en palabras. */
const every = (sec: number) => (sec >= 60 ? `${num(sec / 60, sec % 60 ? 1 : 0)} min` : `${sec} s`);

// ---------------------------------------------------------------- selector de moneda

/** Fichas de monedas que se deslizan de lado en celular; los bordes se difuminan cuando hay más. */
function CoinPicker({ assets, value, onChange }: { assets: string[]; value: string; onChange: (a: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ l: false, r: false });

  const measure = () => {
    const el = box.current;
    if (!el) return;
    setFade({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // la moneda elegida siempre a la vista
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(".mkt-coin.on");
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [value]);

  return (
    <div className={`mkt-coins ${fade.l ? "fade-l" : ""} ${fade.r ? "fade-r" : ""}`}>
      <div className="mkt-coins-in" ref={box} onScroll={measure} role="radiogroup" aria-label="Moneda">
        {assets.map((a) => (
          <button key={a} type="button" role="radio" aria-checked={a === value} className={`mkt-coin ${a === value ? "on" : ""}`}
            onClick={() => onChange(a)} title={COIN_NAMES[a] ?? a}>
            <Coin s={a} size={26} />
            <span className="mkt-coin-txt">
              <b>{a}</b>
              <small>{COIN_NAMES[a] ?? "Cripto"}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- indicadores

function Kpi({ icon, kind, label, value, hint, i }: { icon: IconName; kind: string; label: string; value: ReactNode; hint?: ReactNode; i: number }) {
  return (
    <div className={`mkt-kpi ${kind}`} style={{ ["--i" as string]: i } as CSSProperties}>
      <div className="mkt-kpi-top">
        <span className="mkt-kpi-ico"><Icon name={icon} size={17} /></span>
        <small>{label}</small>
      </div>
      <div className="mkt-kpi-val">{value}</div>
      {hint && <div className="mkt-kpi-hint">{hint}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- comprar y vender ya

/** Ruta directa de tu capital: comprar y vender la misma cripto en P2P (la calcula el servidor con comisiones y el 4x1000 de lo que pagas). */
const directRoute = (s: State, asset: string) => s.p2p?.routes?.find((r) => r.id === `${asset}>${asset}`);

/** Cuando comprar y vender gana: el paso a paso, igual que en Inicio. Abajo, las otras criptos que también ganan. */
function WinCard({ s, asset, onCoin }: { s: State; asset: string; onCoin: (a: string) => void }) {
  const r = directRoute(s, asset);
  const others = (s.p2p?.routes ?? [])
    .filter((x) => x.steps.length === 2 && x.profit_fiat > 0 && x.id !== `${asset}>${asset}`)
    .sort((a, b) => b.per_usd - a.per_usd);
  const wins = r && r.profit_fiat > 0;
  if (!wins && !others.length) return null;
  const row = r && p2pRow(s, r);
  return (
    <section className={`card mkt-win ${wins ? "on" : ""}`}>
      {wins && row ? (
        <>
          <div className="mkt-sec-head">
            <div className="mkt-sec-title">
              <span className="sec-ico green"><Icon name="trend" /></span>
              <div>
                <h2>Gana ahora con {asset}: <span className="up">{signedMoney(r.profit_fiat)}</span></h2>
                <p className="sub">Con {money(s.settings.capital, 0)} · ya descuenta comisión P2P y el 4x1000 de lo que pagas</p>
              </div>
            </div>
            <RouteStatus r={row} />
          </div>
          <Steps row={row} s={s} />
        </>
      ) : (
        <div className="mkt-win-none"><Icon name="info" size={16} /> Comprar y vender {asset} ya no gana con {money(s.settings.capital, 0)}.</div>
      )}
      {others.length > 0 && (
        <div className="mkt-win-others">
          <small>{wins ? "También gana:" : "Sí gana con:"}</small>
          {others.slice(0, 6).map((o) => {
            const a = o.id.split(">")[0];
            return (
              <button key={a} type="button" className="mkt-win-chip" onClick={() => onCoin(a)}>
                <Coin s={a} size={18} /> {a} <b className="up">{signedMoney(o.profit_fiat)}</b>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- anuncio P2P

function AdRow({ ad, asset, best, side, s, i }: { ad: Ad; asset: string; best: number; side: Side; s: State; i: number }) {
  const j = judge(ad, best, side, s);
  const top = ad.price === best;
  const capital = s.settings.capital;
  const fits = ad.min <= capital && capital <= ad.max;
  const unit = isDollar(asset) ? "por dólar" : `por ${asset}`;
  const url = advertiserUrl(ad);
  return (
    <article className={`ad ${j.good ? "good" : "bad"} ${top ? "top" : ""}`} style={{ ["--i" as string]: Math.min(i, 12) } as CSSProperties}>
      <header className="ad-head">
        <span className="ad-avatar" aria-hidden="true">
          {ad.nick.slice(0, 1).toUpperCase()}
          {ad.merchant && <span className="ad-avatar-badge"><Icon name="badgeCheck" size={13} /></span>}
        </span>
        <div className="ad-who">
          <ExtLink href={url}>{ad.nick}</ExtLink>
          {ad.merchant && <span className="ad-merchant" title="Comerciante verificado por Binance"><Icon name="shield" size={13} /> Comerciante</span>}
        </div>
        <span className={`verdict ${j.good ? "good" : "bad"}`}>
          <Icon name={j.good ? "check" : "x"} size={12} /> {j.label}
        </span>
      </header>

      <div className="ad-price-row">
        <span className="ad-price">{money(ad.price)}</span>
        <span className="ad-unit">{unit}</span>
        {side === "BUY" && s.settings.gmf > 0 && <span className="ad-gmf">con 4x1000: <b>{money(effBuy(ad.price, s))}</b></span>}
      </div>

      <dl className="ad-stats">
        <div className={j.ordersOk ? "" : "warn"}><dt><Icon name="listChecks" size={13} />Órdenes (30 d)</dt><dd>{num(ad.orders, 0)}</dd></div>
        <div className={j.finishOk ? "" : "warn"}><dt><Icon name="checkCircle" size={13} />Completadas</dt><dd>{num(ad.finish * 100, 0)} %</dd></div>
        <div><dt><Icon name="timer" size={13} />Para pagar</dt><dd>{ad.minutes ? `${ad.minutes} min` : "—"}</dd></div>
        <div><dt><Icon name="layers" size={13} />Disponible</dt><dd>{isDollar(asset) ? num(ad.available, 2) : qty(ad.available)} {asset}</dd></div>
      </dl>

      <footer className="ad-foot">
        <span className={`ad-limit ${fits ? "ok" : "no"}`} title={fits ? "Acepta tu capital" : "Tu capital está fuera de su límite"}>
          <Icon name={fits ? "checkCircle" : "alert"} size={15} />
          <span className="ad-limit-txt">
            <small>{fits ? "Acepta tu capital" : "Fuera de tu capital"}</small>
            {money(ad.min, 0)} – {money(ad.max, 0)}
          </span>
        </span>
        <div className="ad-methods" aria-label="Medios de pago">
          <Icon name="card" size={14} />
          {ad.methods.map((m) => <span key={m} className="tag">{m}</span>)}
        </div>
      </footer>

      {url && (
        <a className={`btn ad-go ${top ? "btn-brand" : ""}`} href={url} target="_blank" rel="noopener noreferrer"
          title={`Abre el perfil de ${ad.nick} en Binance P2P para ${side === "BUY" ? "comprarle" : "venderle"} ${asset}`}>
          <Icon name={side === "BUY" ? "cart" : "handCoins"} size={16} />
          <span className="ad-go-txt">{side === "BUY" ? "Comprar" : "Vender"} {asset} a <b>{ad.nick}</b></span>
          <Icon name="external" size={14} />
        </a>
      )}
    </article>
  );
}

// ---------------------------------------------------------------- gráfico

function CoinChart({ asset, s }: { asset: string; s: State }) {
  const { hist, prefs, setPrefs } = useLive();
  const all = useMemo(() => series(hist, asset), [hist, asset]);
  const day = useMemo(() => dayStats(all, s.now), [all, s.now]);
  const pts = useMemo(() => all.filter((p) => p.t >= s.now - prefs.range), [all, s.now, prefs.range]);
  return (
    <section className="card mkt-chart">
      <div className="mkt-sec-head">
        <div className="mkt-sec-title">
          <span className="sec-ico blue"><Icon name="chart" /></span>
          <div>
            <h2>Precio de {asset}</h2>
            <p className="sub">El mejor anuncio de cada lado, de cualquier monto (antes de costos)</p>
          </div>
        </div>
        <Segmented label="Rango del gráfico" value={prefs.range} onChange={(r) => setPrefs({ range: r })}
          options={[[3600, "1 h"], [21600, "6 h"], [86400, "24 h"]] as const} />
      </div>
      <div className="mkt-series">
        <span className="mkt-serie" style={{ ["--c" as string]: "var(--s1)" } as CSSProperties}>
          <i className="key" />
          <b>Compra</b>
          {day && <small>hoy {money(day.buyMin)} a {money(day.buyMax)}</small>}
        </span>
        <span className="mkt-serie" style={{ ["--c" as string]: "var(--s2)" } as CSSProperties}>
          <i className="key" />
          <b>Venta</b>
          {day && <small>hoy {money(day.sellMin)} a {money(day.sellMax)}</small>}
        </span>
      </div>
      <PriceChart points={pts} gapSeconds={Math.max(120, 3 * s.settings.p2p_interval)} label={asset} />
    </section>
  );
}

// ---------------------------------------------------------------- pestaña

export function Market() {
  const { state, prefs, setPrefs } = useLive();
  // en celular y tablet se ve un lado del libro a la vez
  const [view, setView] = useState<Side>("BUY");
  if (!state) return <div className="card"><Skeleton rows={10} /></div>;
  const st = state.settings;
  const asset = st.p2p_assets.includes(prefs.asset) ? prefs.asset : "USDT";
  const m = state.p2p?.market[asset];
  const buyAd = m?.BUY[0];
  const sellAd = m?.SELL[0];
  const buy = buyAd?.price;
  const sell = sellAd?.price;
  // precios netos con tu capital: lo que de verdad pagas y recibes por cada unidad (comisión P2P incluida)
  const route: Route | undefined = directRoute(state, asset);
  const [bStep, sStep] = (route?.steps ?? []) as P2PStep[];
  const netBuy = route && bStep ? (route.paid + route.costs.gmf) / bStep.qty : effBuy(buy, state); // con su 4x1000
  const netSell = route && sStep ? route.received / sStep.qty : sell;
  const rt = route ? route.per_usd : roundTrip(state, asset);
  const cap = money(st.capital, 0);
  const side = (k: Side) => (k === "BUY" ? `Comprar ${asset}` : `Vender ${asset}`);

  return (
    <div className="mkt">
      <section className="card mkt-top">
        <div className="mkt-top-row">
          <div className="mkt-sec-title">
            <span className="sec-ico"><Icon name="coins" /></span>
            <div>
              <h2>Precios P2P</h2>
              <p className="sub">Los anuncios de Binance P2P en pesos, en vivo</p>
            </div>
          </div>
          <div className="toolbar mkt-tools"><CapitalField /><GmfToggle /></div>
        </div>
        <CoinPicker assets={st.p2p_assets} value={asset} onChange={(a) => setPrefs({ asset: a })} />
      </section>

      {!m ? (
        <div className="card"><Skeleton rows={8} /></div>
      ) : (
        <>
          <div className="mkt-kpis" key={asset}>
            <Kpi i={0} icon="cart" kind="buy" label="Te cuesta comprar" value={money(netBuy)}
              hint={bStep ? <>Te vende <b>{bStep.ad.nick}</b>{netBuy !== bStep.price && <> · anuncio {money(bStep.price)}</>}</>
                : buyAd ? <>Ninguno acepta {cap} · mejor: <b>{buyAd.nick}</b></> : "Sin anuncios"} />
            <Kpi i={1} icon="handCoins" kind="sell" label="Recibes al vender" value={money(netSell)}
              hint={sStep ? <>Te compra <b>{sStep.ad.nick}</b>{netSell !== sStep.price && <> · anuncio {money(sStep.price)}</>}</>
                : sellAd ? <>Ninguno acepta {cap} · mejor: <b>{sellAd.nick}</b></> : "Sin anuncios"} />
            <Kpi i={2} icon="swap" kind={`rt ${tone(rt)}`} label="Comprar y vender ya" value={<Usd v={rt} suffix="por dólar" />}
              hint={route ? <>Con {cap}: <b className={tone(route.profit_fiat) === "up" ? "up" : "down"}>{signedMoney(route.profit_fiat)}</b> neto</>
                : buy && sell ? <>Comprar y vender: <b className={sell > buy ? "up" : sell < buy ? "down" : ""}>{pct(sell / buy - 1)}</b> (antes de costos)</> : undefined} />
            <Kpi i={3} icon="clock" kind="ago" label="Actualizado" value={<span className="mkt-ago"><span className="pulse" /><Ago t={state.p2p?.t} /></span>}
              hint={`Se revisa cada ${every(st.p2p_interval)}`} />
          </div>

          <p className="mkt-net-note"><Icon name="info" size={14} /> Precios netos con tu capital: incluyen comisión P2P{(state.p2p_fee ?? 0) > 0 ? ` (${pctPlain(state.p2p_fee, 2)})` : " (hoy 0 %)"} y {state.settings.gmf > 0 ? `el 4x1000 de lo que pagas (${money(state.settings.capital * state.settings.gmf, 0)} con tu capital)` : "sin 4x1000 (apagado)"}.</p>

          <WinCard s={state} asset={asset} onCoin={(a) => setPrefs({ asset: a })} />

          <CoinChart asset={asset} s={state} />

          <section className={`card mkt-book show-${view}`}>
            <div className="mkt-book-bar">
              <div className="mkt-switch">
                <Segmented label="Lado del libro" value={view} onChange={setView}
                  options={[["BUY", <span key="b" className="mkt-switch-opt"><Icon name="cart" size={15} />Comprar</span>],
                    ["SELL", <span key="s" className="mkt-switch-opt"><Icon name="handCoins" size={15} />Vender</span>]] as const} />
              </div>
              <div className="mkt-legend">
                <span><i className="sw good" /><span><b>Verde</b>: buen precio y anunciante confiable</span></span>
                <span><i className="sw bad" /><span><b>Rojo</b>: precio peor que el mejor, o anunciante con pocas órdenes o que cancela</span></span>
              </div>
            </div>
            <div className="book">
              {(["BUY", "SELL"] as const).map((k) => {
                const best = k === "BUY" ? buy : sell;
                const ads = m[k];
                return (
                  <div key={k} className={`mkt-col ${k}`}>
                    <header className="mkt-col-head">
                      <span className={`mkt-col-ico ${k}`}><Icon name={k === "BUY" ? "cart" : "handCoins"} /></span>
                      <div>
                        <h3>{side(k)}</h3>
                        <p className="sub">{k === "BUY" ? "Te venden · más bajo es mejor" : "Te compran · más alto es mejor"}</p>
                      </div>
                      <span className="mkt-count">{ads.length} {ads.length === 1 ? "anuncio" : "anuncios"}</span>
                    </header>
                    <div className="mkt-ads" key={asset}>
                      {ads.length && best ? (
                        ads.map((ad, i) => <AdRow key={`${ad.nick}-${i}`} ad={ad} asset={asset} best={best} side={k} s={state} i={i} />)
                      ) : (
                        <EmptyBox icon="filter" title="Ningún anuncio cumple tus filtros." />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <CostsNote s={state} />
          </section>
        </>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "@/lib/api";
import { COIN_NAMES, isDollar, series } from "@/lib/calc";
import { hhmm, money, num, pct, perUsd, signedMoney, tone } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { State } from "@/lib/types";
import type { TabId } from "../Header";
import { AreaChart, Donut, GainBars, Sparkline } from "../charts";
import { Sheet } from "../overlay";
import { Coin, Icon, Segmented } from "../ui";

const DAY = 86400;
const COINS_KEY = "dash-coins";
const DEFAULT_COINS = ["BTC", "ETH", "BNB", "SOL"];
// colores de la dona: validados para daltonismo y contraste (tema oscuro y claro en globals.css)
const SLICES = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)"];
const dayFmt = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" });
const shortDay = (t: number) => dayFmt.format(t * 1000).replace(".", "");

/** Precio por tramos (mediana de cada tramo): quita los picos de anuncios sueltos que duran segundos. */
function smooth(pts: { t: number; buy: number; sell: number }[], from: number, to: number, n = 72) {
  const step = (to - from) / n;
  const out: { t: number; buy: number; sell: number }[] = [];
  const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  for (let i = 0; i < n; i++) {
    const a = from + i * step, b = a + step;
    const part = pts.filter((p) => p.t >= a && p.t < b);
    if (part.length) out.push({ t: (a + b) / 2, buy: med(part.map((p) => p.buy)), sell: med(part.map((p) => p.sell)) });
  }
  return out;
}

const SPANS = [[3600, "1 h"], [6 * 3600, "6 h"], [DAY, "24 h"]] as const;
const spanTxt = (x: number) => (x === 3600 ? "en 1 h" : x === 6 * 3600 ? "en 6 h" : "en 24 h");
/** El tono (sube / baja / igual) de una variación relativa. */
const toneOf = (ch: number | null) => tone(ch == null ? null : ch * 100);

/** Variación en el rango: del primer al último punto. */
function change(vs: number[]) {
  if (vs.length < 2 || !vs[0]) return null;
  return (vs[vs.length - 1] - vs[0]) / vs[0];
}

function Delta({ v, money: m }: { v: number | null; money?: number | null }) {
  if (v == null) return <span className="delta flat">—</span>;
  const t = tone(v * 100);
  return (
    <span className={`delta ${t}`}>
      <Icon name={t === "down" ? "trend" : "trend"} size={13} className={t === "down" ? "flip" : ""} />
      {pct(v)}{m != null && <small> · {signedMoney(m)}</small>}
    </span>
  );
}

function useCoins(): [string[], (c: string[]) => void] {
  const [coins, setCoins] = useState<string[]>(DEFAULT_COINS);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COINS_KEY) || "null");
      if (Array.isArray(saved) && saved.length) setCoins(saved.filter((x) => typeof x === "string"));
    } catch {
      /* sin almacenamiento */
    }
  }, []);
  const save = (c: string[]) => {
    setCoins(c);
    try {
      localStorage.setItem(COINS_KEY, JSON.stringify(c));
    } catch {
      /* sin almacenamiento */
    }
  };
  return [coins, save];
}

// ---------------------------------------------------------------- capital en Binance

function Capital({ s, onTab }: { s: State; onTab: (t: TabId) => void }) {
  const { hist } = useLive();
  const [pts, setPts] = useState<{ t: number; fiat: number; usdt: number }[] | null>(null);
  const [range, setRange] = useState<number>(DAY);
  const acc = s.account;
  const estimate = useMemo(() => {
    if (!acc) return null;
    const qty = new Map<string, number>(), fixed = { v: 0 };
    for (const r of [...acc.spot, ...acc.funding]) {
      if (!r.fiat) continue;
      if (hist.some((h) => h.p[r.asset])) qty.set(r.asset, (qty.get(r.asset) ?? 0) + r.qty);
      else fixed.v += r.fiat; // sin precio guardado: se deja con su valor de hoy
    }
    const series_ = [...qty.keys()].map((a) => [a, smooth(series(hist, a), s.now - DAY, s.now, 48)] as const);
    const times = series_.find(([, p]) => p.length)?.[1].map((p) => p.t) ?? [];
    return times.map((t) => {
      let v = fixed.v;
      for (const [a, p] of series_) {
        const near = p.reduce((b, x) => (Math.abs(x.t - t) < Math.abs(b.t - t) ? x : b), p[0]);
        if (near) v += (qty.get(a) ?? 0) * near.sell;
      }
      return { t, fiat: v, usdt: acc.total_usdt };
    });
  }, [acc, hist, s.now]);
  useEffect(() => {
    if (!s.connected) return;
    let alive = true;
    const load = () => api.balanceHistory().then((r) => alive && setPts(r.points), () => alive && setPts([]));
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, [s.connected]);

  if (!s.connected) {
    return (
      <section className="card dash-capital dash-connect">
        <span className="dash-connect-ico"><Icon name="wallet" size={26} /></span>
        <div>
          <h2>Conecta tu Binance</h2>
          <p className="sub">Con tu llave de solo lectura ves aquí tu capital, si va de subida y cómo está repartido.</p>
        </div>
        <button className="btn btn-brand" onClick={() => onTab("cuenta")}><Icon name="key" size={16} /> Conectar</button>
      </section>
    );
  }
  const now = s.now;
  const shown = (pts ?? []).filter((p) => p.t >= now - range);
  // el punto de ahora, en vivo, al final de la gráfica
  const real = acc?.total_fiat ? [...shown, { t: now, fiat: acc.total_fiat, usdt: acc.total_usdt }] : shown;
  // antes de tu primer punto guardado va el estimado (tus saldos con el precio de cada momento de las últimas 24 h),
  // ajustado para que empalme justo con tu valor real; desde ahí, tu historial real
  const anchor = real[0];
  const before = (estimate ?? []).filter((p) => p.t < (anchor?.t ?? now) - 60 && p.t >= now - range);
  const near = anchor && before.length ? (estimate ?? []).reduce((b, x) => (Math.abs(x.t - anchor.t) < Math.abs(b.t - anchor.t) ? x : b)) : null;
  const k = anchor && near?.fiat ? anchor.fiat / near.fiat : 1;
  const estimated = before.length > 1 ? before.map((p) => ({ ...p, fiat: p.fiat * k })) : null;
  const live = estimated ? [...estimated, ...real] : real;
  const first = pts?.[0]?.t;
  const ch = change(live.map((p) => p.fiat));
  const diff = live.length > 1 ? live[live.length - 1].fiat - live[0].fiat : null;
  const t = tone(diff);
  return (
    <section className="card dash-capital">
      <div className="dash-head">
        <div>
          <small className="dash-label"><Icon name="wallet" size={14} /> Tu capital en Binance</small>
          <div className="dash-big">{money(acc?.total_fiat, 0)}</div>
          <div className="dash-meta">
            <span className="dim">≈ {num(acc?.total_usdt, 2)} USDT</span>
            <Delta v={ch} money={diff} />
            <span className="dim">{estimated && range !== DAY && (live[0]?.t ?? now) > now - range + 3600 ? "desde que hay datos" : range === DAY ? "en 24 h" : range === 7 * DAY ? "en 7 días" : "en 30 días"}</span>
          </div>
        </div>
        <Segmented label="Rango" value={range} onChange={setRange} options={[[DAY, "24 h"], [7 * DAY, "7 d"], [30 * DAY, "30 d"]] as const} />
      </div>
      <AreaChart points={live.map((p) => ({ t: p.t, v: p.fiat }))} tone={t === "down" ? "down" : t === "up" ? "up" : "brand"}
        fmt={(v) => money(v, 0)} fmtT={(x) => (range === DAY ? hhmm(x) : `${shortDay(x)} ${hhmm(x)}`)}
        empty={<span className="cap-empty">
          <Icon name="clock" size={20} />
          <b>{range === DAY ? "La gráfica se arma sola" : `Todavía no hay ${range === 7 * DAY ? "7" : "30"} días guardados`}</b>
          <span>{first ? `Tu historial empezó el ${shortDay(first)} a las ${hhmm(first)}: guardamos tu capital cada 15 minutos.` : "Guardamos tu capital cada 15 minutos desde que conectas tu Binance."}</span>
          {range !== DAY && <button className="btn btn-sm" onClick={() => setRange(DAY)}>Ver 24 h</button>}
        </span>} />
      {estimated && (
        <p className="dash-note"><Icon name="info" size={13} /> {first ? `Antes del ${shortDay(first)} ${hhmm(first)}` : "Hasta ahora"}: estimado con tus saldos y el precio de cada momento. Desde ahí, tu historial real (se guarda cada 15 minutos).</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- dólar

function Dollar({ s, span, onSpan }: { s: State; span: number; onSpan: (x: number) => void }) {
  const { hist } = useLive();
  const pts = useMemo(() => smooth(series(hist, "USDT"), s.now - span, s.now, span === 3600 ? 30 : 72), [hist, s.now, span]);
  const m = s.p2p?.market.USDT;
  const buy = m?.BUY?.[0]?.price ?? pts[pts.length - 1]?.buy ?? null;
  const sell = m?.SELL?.[0]?.price ?? pts[pts.length - 1]?.sell ?? null;
  const chB = change(pts.map((p) => p.buy));
  const chS = change(pts.map((p) => p.sell));
  const tb = toneOf(chB);
  return (
    <section className="card dash-dollar">
      <div className="dash-head">
        <small className="dash-label"><Coin s="USDT" size={18} /> Dólar hoy · USDT en P2P</small>
        <Segmented label="Rango del dólar" value={span} onChange={onSpan} options={SPANS} />
      </div>
      <div className="dollar-sides">
        <div>
          <small>Compras a</small>
          <b>{money(buy)}</b>
          <Delta v={chB} />
        </div>
        <div>
          <small>Te pagan</small>
          <b>{money(sell)}</b>
          <Delta v={chS} />
        </div>
      </div>
      <AreaChart points={pts.map((p) => ({ t: p.t, v: p.buy }))} tone={tb === "down" ? "down" : tb === "up" ? "up" : "brand"} height={170}
        fmt={(v) => money(v)} fmtT={hhmm} empty="Juntando precios…" />
      <div className="dollar-foot">
        <span>Diferencia <b>{buy && sell ? perUsd(buy - sell) : "—"}</b></span>
        <span className="dim">precio de compra {spanTxt(span).replace("en ", "· últimas ")}</span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- monedas que sigues

function CoinsPicker({ all, value, onChange, onClose }: { all: string[]; value: string[]; onChange: (c: string[]) => void; onClose: () => void }) {
  return (
    <Sheet title="Monedas en Inicio" onClose={onClose}>
      <p className="sub" style={{ marginTop: 0 }}>Elige cuáles ver (precio P2P en pesos y cómo van en 24 h).</p>
      <div className="dash-pick">
        {all.map((a) => {
          const on = value.includes(a);
          return (
            <button key={a} className={`chip-toggle ${on ? "on" : ""}`} onClick={() => onChange(on ? value.filter((x) => x !== a) : [...value, a])}>
              <Coin s={a} size={18} /> {a}
              {on && <Icon name="check" size={14} />}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

function Coins({ s, span, onSpan }: { s: State; span: number; onSpan: (x: number) => void }) {
  const { hist } = useLive();
  const [coins, setCoins] = useCoins();
  const [pick, setPick] = useState(false);
  const all = [...new Set([...s.settings.p2p_assets, ...Object.keys(s.p2p?.market ?? {})])].filter((a) => a !== s.settings.fiat);
  const shown = coins.filter((c) => all.includes(c));
  return (
    <section className="dash-coins">
      <div className="dash-sec-head">
        <h2>Tus monedas</h2>
        <div className="dash-sec-act">
          <Segmented label="Rango de las monedas" value={span} onChange={onSpan} options={SPANS} />
          <button className="btn btn-sm btn-ghost" onClick={() => setPick(true)}><Icon name="pencil" size={14} /> Elegir</button>
        </div>
      </div>
      <div className="coin-cards">
        {shown.map((a, i) => {
          const pts = smooth(series(hist, a), s.now - span, s.now, span === 3600 ? 30 : 60);
          const price = s.p2p?.market[a]?.BUY?.[0]?.price ?? pts[pts.length - 1]?.buy ?? null;
          const ch = change(pts.map((p) => p.buy));
          return (
            <div key={a} className="coin-card" style={{ ["--i" as string]: i } as CSSProperties}>
              <div className="coin-card-top">
                <Coin s={a} size={34} />
                <div className="coin-card-name"><b>{a}</b><small>{COIN_NAMES[a] ?? a}</small></div>
                <Delta v={ch} />
              </div>
              <div className="coin-card-price">{money(price, isDollar(a) || (price ?? 0) < 1e5 ? 2 : 0)}</div>
              <Sparkline values={pts.map((p) => p.buy)} tone={toneOf(ch)} />
            </div>
          );
        })}
        {!shown.length && <button className="coin-card add" onClick={() => setPick(true)}><Icon name="plus" size={20} /> Agrega monedas</button>}
      </div>
      {pick && <CoinsPicker all={all} value={coins} onChange={setCoins} onClose={() => setPick(false)} />}
    </section>
  );
}

// ---------------------------------------------------------------- rendimiento

type Perf = Awaited<ReturnType<typeof api.performance>>;

function Performance({ s, onTab }: { s: State; onTab: (t: TabId) => void }) {
  const gmf = s.settings.gmf ?? 0;
  const [days, setDays] = useState(30);
  const [perf, setPerf] = useState<Perf | null>(null);
  const lastOrder = s.account?.orders?.[0]?.id;
  useEffect(() => {
    let alive = true;
    api.performance(days).then((p) => alive && setPerf(p), () => alive && setPerf(null));
    return () => { alive = false; };
  }, [days, lastOrder]);
  const bars = (perf?.days ?? []).map((d) => ({ k: String(d.t), label: shortDay(d.t + DAY / 2), v: d.gain, n: d.n }));
  const live = (s.watches ?? []).filter((w) => w.status === "vigilando" || w.status === "lista");
  const open = live.reduce((a, w) => a + (w.last?.best?.profit ?? 0), 0);
  const cost = live.reduce((a, w) => a + w.cost * (1 + gmf), 0);
  const won = perf?.won ?? 0;
  return (
    <section className="card dash-perf">
      <div className="dash-head">
        <div>
          <small className="dash-label"><Icon name="trend" size={14} /> Mi rendimiento</small>
          <h2>Ganancia de tus ventas P2P</h2>
        </div>
        <Segmented label="Días" value={days} onChange={setDays} options={[[7, "7 d"], [30, "30 d"], [90, "90 d"]] as const} />
      </div>
      <div className="perf-tiles">
        <div className="perf-tile"><small>Ganado en ventas</small><b className={tone(won)}>{perf ? signedMoney(won) : "…"}</b>
          <span>{perf ? `${perf.sales} venta${perf.sales === 1 ? "" : "s"} en ${days} días` : "calculando"}</span></div>
        <div className="perf-tile"><small>Vendiste</small><b>{perf ? money(perf.sold, 0) : "…"}</b>
          <span>{perf && perf.sold > 0 ? `rinde ${pct(won / perf.sold)} sobre lo vendido` : "en pesos, en P2P"}</span></div>
        <div className="perf-tile"><small>Si vendes todo ahora</small><b className={tone(open)}>{live.length ? signedMoney(open) : "—"}</b>
          <span>{live.length ? `${cost > 0 ? pct(open / cost) : ""} · ${live.length} moneda${live.length === 1 ? "" : "s"}` : <button className="link-btn" onClick={() => onTab("vender")}>Anota tus monedas</button>}</span></div>
      </div>
      {perf && perf.sales === 0 ? (
        <div className="chart-empty" style={{ height: 230 }}>{s.connected ? `Sin ventas en los últimos ${days} días.` : "Conecta tu Binance para ver tu rendimiento."}</div>
      ) : (
        <>
          <GainBars items={bars} fmt={signedMoney} height={230} />
          <div className="gbars-axis"><span>{bars[0]?.label}</span><span>hoy</span></div>
        </>
      )}
      <p className="dash-note"><Icon name="info" size={13} />
        {perf?.source === "wallet" ? "Igual que Resultados en tu wallet: lo que te quedó libre de comisión y 4x1000, con tus ajustes."
          : "Con tus órdenes P2P de Binance: cada venta contra lo primero que compraste, libre de comisión y 4x1000."}
        {perf?.unknown ? ` ${perf.unknown} venta${perf.unknown === 1 ? "" : "s"} sin compra registrada.` : ""}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- reparto

function Split({ s }: { s: State }) {
  const acc = s.account;
  const items = useMemo(() => {
    const by = new Map<string, number>();
    for (const r of [...(acc?.spot ?? []), ...(acc?.funding ?? [])]) {
      if (r.asset.startsWith("LD") || !r.fiat || r.fiat < 1) continue;
      by.set(r.asset, (by.get(r.asset) ?? 0) + r.fiat);
    }
    const sorted = [...by.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 4);
    const rest = sorted.slice(4).reduce((a, [, v]) => a + v, 0);
    const out = top.map(([a, v], i) => ({ label: a, v, color: SLICES[i], icon: <Coin s={a} size={16} /> }));
    if (rest > 0) out.push({ label: "Otras", v: rest, color: SLICES[4], icon: <Icon name="coins" size={14} /> });
    return out;
  }, [acc]);
  if (!s.connected) return null;
  return (
    <section className="card dash-split">
      <div className="dash-head">
        <div>
          <small className="dash-label"><Icon name="layers" size={14} /> Cómo está repartido</small>
          <h2>Tus criptos en Binance</h2>
        </div>
      </div>
      {items.length ? (
        <Donut items={items} fmt={(v) => money(v, 0)} center={<><small>Total</small><b>{money(acc?.total_fiat, 0)}</b><small>{items.length} {items.length === 1 ? "cripto" : "criptos"}</small></>} />
      ) : <div className="chart-empty">Sin saldos con valor en Binance</div>}
    </section>
  );
}

// ---------------------------------------------------------------- oportunidad y avisos

function Now({ s, onTab }: { s: State; onTab: (t: TabId) => void }) {
  const best = s.opps[0];
  const alerts = s.alerts.slice(0, 4);
  return (
    <div className="dash-now">
      <section className={`card dash-opp ${best ? "on" : ""}`}>
        <small className="dash-label"><Icon name="bolt" size={14} /> Mejor oportunidad ahora</small>
        {best ? (
          <>
            <div className="dash-big up">{perUsd(best.per_usd)} <small>por dólar</small></div>
            <p className="sub">{best.kind === "p2p" ? ["COP", ...best.route.steps.flatMap((x) => (x.venue === "Spot" ? [x.to] : x.kind === "buy" ? [x.asset] : [])), "COP"].join(" → ") : best.tri.path.join(" → ")} · con tu capital ganas {signedMoney(best.profit)}</p>
            <button className="btn btn-brand btn-sm" onClick={() => onTab("inicio")}>Ver los pasos <Icon name="arrowRight" size={14} /></button>
          </>
        ) : (
          <>
            <div className="dash-big dim">Nada por ahora</div>
            <p className="sub">Te avisamos apenas aparezca una con ganancia.</p>
            <button className="btn btn-sm" onClick={() => onTab("inicio")}>Ver arbitraje</button>
          </>
        )}
      </section>
      <section className="card dash-alerts">
        <div className="dash-head"><small className="dash-label"><Icon name="bell" size={14} /> Últimos avisos</small></div>
        {alerts.length ? (
          <ul>
            {alerts.map((a) => (
              <li key={a.id}>
                <span className={`dash-alert-ico ${a.kind}`}><Icon name={a.kind === "sell" ? "target" : a.kind === "price" ? "bellRing" : a.kind === "system" ? "alert" : "bolt"} size={14} /></span>
                <div><b>{a.title}</b><small>{hhmm(a.t)}</small></div>
              </li>
            ))}
          </ul>
        ) : <p className="sub">Sin avisos todavía.</p>}
      </section>
    </div>
  );
}

/** Inicio: tu capital, el dólar, tus monedas, tu rendimiento y lo mejor de ahora, de un vistazo. */
export function Dashboard({ onTab }: { onTab: (t: TabId) => void }) {
  const { state } = useLive();
  const [span, setSpan] = useState<number>(DAY);
  if (!state) return null;
  return (
    <div className="dash">
      <div className="dash-row hero">
        <Capital s={state} onTab={onTab} />
        <Dollar s={state} span={span} onSpan={setSpan} />
      </div>
      <Coins s={state} span={span} onSpan={setSpan} />
      <div className={`dash-row ${state.connected ? "perf" : ""}`}>
        <Performance s={state} onTab={onTab} />
        <Split s={state} />
      </div>
      <Now s={state} onTab={onTab} />
    </div>
  );
}

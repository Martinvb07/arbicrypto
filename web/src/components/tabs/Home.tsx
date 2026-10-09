"use client";

import { Fragment, useState } from "react";
import { advertiserUrl, COIN_NAMES, effBuy, isDollar, isMine, roundTrip, spotUrl, usdtPrices } from "@/lib/calc";
import { money, num, perUsd, qty, signedMoney, tone } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { Conversion, Route, State, Triangle } from "@/lib/types";
import { CapitalField, CostsNote, GmfToggle } from "../controls";
import type { TabId } from "../Header";
import { Select, Sheet } from "../overlay";
import { Ago, Asset, Coin, CoinPath, ExtLink, Icon, Segmented, Skeleton, Usd } from "../ui";

/** COP → BTC → USDT → COP: el camino de la plata en una ruta P2P. */
function routePath(r: Route): string[] {
  const coins = r.steps.flatMap((s) => (s.venue === "Spot" ? [s.to] : s.kind === "buy" ? [s.asset] : []));
  return ["COP", ...coins, "COP"];
}

export function Home({ onTab }: { onTab: (t: TabId) => void }) {
  const { state } = useLive();
  if (!state) return <Skeleton rows={8} />;
  return (
    <div className="stack">
      <Kpis s={state} />
      <Arbitrage s={state} />
      <YourDollars s={state} />
      <div className="grid-main">
        <PricesTable s={state} onTab={onTab} />
        <AlertsCard s={state} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- indicadores

function Kpis({ s }: { s: State }) {
  const { soundReady, prefs } = useLive();
  const { buy, sell } = usdtPrices(s);
  const n = s.opps.length;
  const ref = s.usd_ref ?? 0;
  const candidates = [
    ...(s.p2p?.routes ?? []).map((r) => r.per_usd),
    ...(s.spot?.top ?? []).filter((t) => t.profit <= s.settings.max_profit).map((t) => t.profit * ref),
  ];
  const best = candidates.length ? Math.max(...candidates) : null;
  return (
    <div className="kpis">
      <div className={`kpi ${n ? "kpi-good" : ""}`}>
        <small>Estado</small>
        <b className={n ? "up" : ""}>{n ? `${n} oportunidad${n > 1 ? "es" : ""}` : "Sin oportunidades"}</b>
        <span>{prefs.sound && !soundReady ? "Toca la página para activar el sonido" : <>Avisa desde {perUsd(s.settings.min_per_usd)} por dólar</>}</span>
      </div>
      <div className="kpi">
        <small>Mejor ruta ahora</small>
        <Usd v={best} />
        <span>por dólar</span>
      </div>
      <div className="kpi">
        <small>Dólar compra</small>
        <b>{money(buy)}</b>
        <span>precio del anuncio</span>
      </div>
      <div className="kpi">
        <small>Dólar venta</small>
        <b>{money(sell)}</b>
        <span>revisado <Ago t={Math.max(s.spot?.t ?? 0, s.p2p?.t ?? 0)} /></span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- arbitraje en vivo

/** Una ruta de arbitraje: P2P (con o sin Spot) o 3 cambios dentro de Spot. */
type Row =
  | { id: string; kind: "p2p"; route: Route; per_usd: number; gain: number; opp: boolean; tight: boolean; since?: number }
  | { id: string; kind: "spot"; tri: Triangle; per_usd: number; gain: number; opp: boolean; tight: boolean; since?: number };

/** Todas las rutas, rentables o no, ordenadas de mejor a peor. Las rentables vienen confirmadas por el servidor. */
function arbitrageRows(s: State): Row[] {
  const since = new Map(s.opps.map((o) => [o.id, o.since]));
  const ref = s.usd_ref ?? 0;
  const rows: Row[] = [
    ...(s.p2p?.routes ?? []).map((r) => {
      const id = `p2p:${r.id}`;
      return { id, kind: "p2p" as const, route: r, per_usd: r.per_usd, gain: r.profit_fiat, opp: since.has(id), tight: r.profit < s.settings.safe_p2p, since: since.get(id) };
    }),
    ...(s.spot?.top ?? [])
      .filter((t) => t.profit <= s.settings.max_profit) // lo demasiado bueno casi siempre es un precio viejo
      .map((t) => {
        const id = `spot:${t.path.join(">")}`;
        const amount = ref ? Math.min(s.settings.capital / ref, t.liquidity) : 0;
        const profit = t.real ?? t.profit; // precio real segun tu monto cuando se midio el libro completo
        return { id, kind: "spot" as const, tri: t, per_usd: profit * ref, gain: amount * profit * ref, opp: since.has(id), tight: profit < s.settings.safe_spot, since: since.get(id) };
      }),
  ];
  return rows.sort((a, b) => Number(b.opp) - Number(a.opp) || b.per_usd - a.per_usd);
}

/** Lo que el cálculo ya descuenta y lo que hay que hacer para que salga igual en la vida real. */
const pctTxt = (v: number) => `${num(v * 100, v * 100 < 1 ? 2 : 1).replace(/,?0+$/, "")} %`;

/** Costos que el panel está descontando ahora, en una línea. */
function CostBar({ s }: { s: State }) {
  const gmf = s.settings.gmf > 0;
  const items: [string, string, boolean, string][] = [
    ["Comisión Spot", pctTxt(s.fee), true, s.account ? "Tu comisión real de Binance" : "Comisión estándar (conecta tu cuenta para usar la tuya)"],
    ["Redondeo Binance", "", true, "Binance redondea las cantidades hacia abajo; el sobrante queda suelto"],
    ["Colchón", pctTxt(s.settings.spot_slippage), true, "Por si el precio se mueve mientras haces el cambio en Spot"],
    ["Comisión P2P", pctTxt(s.p2p_fee ?? 0), (s.p2p_fee ?? 0) > 0, "Tomada de tus órdenes P2P; Binance normalmente no cobra al que toma un anuncio"],
    ["4x1000", gmf ? "sobre la ganancia" : "apagado", gmf, "Solo sobre lo que ganas al llegar a Nequi"],
  ];
  return (
    <div className="cost-bar" aria-label="Costos incluidos">
      <span className="cost-bar-title">Costos incluidos</span>
      {items.map(([name, val, on, tip]) => (
        <span key={name} className={`cost-chip ${on ? "on" : ""}`} title={tip}>
          <Icon name={on ? "check" : "x"} size={12} /> {name}{val && <b>{val}</b>}
        </span>
      ))}
    </div>
  );
}

/** Desglose en pesos de una ruta P2P: pagas, en qué se va, cuánto te queda. */
function Breakdown({ route }: { route: Route }) {
  const c = route.costs;
  if (!c) return null;
  const parts: [string, number][] = [
    ["Comisión Spot", c.spot_fee], ["Redondeo", c.rounding], ["Colchón", c.buffer], ["Comisión P2P", c.p2p_fee], ["4x1000", c.gmf],
  ];
  const shown = parts.filter(([, v]) => v >= 0.5);
  return (
    <div className="breakdown">
      <div><small>Pagas</small><b>{money(route.paid, 0)}</b></div>
      <div><small>Recibes</small><b>{money(route.received, 0)}</b></div>
      {shown.map(([k, v]) => <div key={k} className="cost"><small>{k}</small><b>−{money(v, 0)}</b></div>)}
      <div className="net"><small>Te queda</small><b className={`val ${tone(route.profit_fiat)}`}>{signedMoney(route.profit_fiat)}</b></div>
    </div>
  );
}

function SafetyNote() {
  return (
    <p className="note">
      <Icon name="check" size={14} />
      <span>
        En Spot usa orden de <b>Mercado</b>, no Convertir · confirma cada precio antes de pagar
      </span>
    </p>
  );
}

function Steps({ row, s }: { row: Row; s: State }) {
  if (row.kind === "spot") {
    const t = row.tri;
    return (
      <>
        <ol className="steps-list">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <div className="step-main">Cambia <Asset s={t.path[i]} size={18} /> por <Asset s={t.path[i + 1]} size={18} /> · <ExtLink href={spotUrl(t.pairs?.[i])}>{t.symbols[i]}</ExtLink></div>
            </li>
          ))}
        </ol>
        <SafetyNote />
      </>
    );
  }
  const steps = row.route.steps;
  // Dólares que mueve la ruta (USDT, USDC o FDUSD), para decir a cuánto queda cada dólar al vender otra cripto
  const dollarStep = steps.find((st) => isDollar(st.venue === "Spot" ? st.from : st.asset));
  const dollars = dollarStep ? (dollarStep.venue === "Spot" ? steps[steps.indexOf(dollarStep) - 1]?.qty : dollarStep.qty) : undefined;
  return (
    <>
      <ol className="steps-list">
        {steps.map((st, i) => (
          <li key={i}>
            {st.venue === "Spot" ? (
              <div>
                <div className="step-main">
                  Cambia {isDollar(st.from) ? <>tus <b>{num(steps[i - 1]?.qty ?? 0, 2)} dólares</b> <Asset s={st.from} size={18} /></> : <><Asset s={st.from} size={18} /></>}{" "}
                  por {isDollar(st.to) ? <>dólares <Asset s={st.to} size={18} /></> : <Asset s={st.to} size={18} />} en Binance Spot
                </div>
                <div className="step-sub">
                  Par <ExtLink href={spotUrl(st.pair)}>{st.symbol}</ExtLink> · orden de <b>Mercado</b>, <b>NO Convertir</b> · te deben llegar mínimo{" "}
                  <b>{isDollar(st.to) ? `${num(st.qty, 2)} dólares (${st.to})` : `${qty(st.qty)} ${st.to}`}</b> (si llega menos, no vendas)
                </div>
              </div>
            ) : (
              <div>
                <div className="step-main">
                  {st.kind === "buy" ? "Compra" : "Vende"}{" "}
                  {isDollar(st.asset) ? <><b>{num(st.qty, 2)} dólares</b> <Asset s={st.asset} size={18} /> a <b>{money(st.price)}</b> cada dólar</>
                    : <>{qty(st.qty)} <Asset s={st.asset} size={18} /> a <b>{money(st.price)}</b> por cada {st.asset}</>}
                  <span className="muted">
                    {" "}· {st.kind === "buy" ? `pagas ${money(s.settings.capital, 0)} · confirma el precio antes de pagar` : `recibes ${money(st.qty * st.price, 0)}`}
                    {st.kind === "sell" && !isDollar(st.asset) && dollars ? ` · te queda a ${money((st.qty * st.price) / dollars)} por dólar` : ""}
                  </span>
                </div>
                <div className="step-sub">
                  <ExtLink href={advertiserUrl(st.ad)}><b>{st.ad.nick}</b></ExtLink>{" "}
                  <span className="muted">({num(st.ad.orders, 0)} órdenes, {num(st.ad.finish * 100, 0)} %)</span> · {st.ad.methods.slice(0, 3).join(", ")}
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      <Breakdown route={row.route} />
      <SafetyNote />
    </>
  );
}

const SHOWN = 10;

type Filter = "todas" | "p2p" | "directo" | "spot";

function RouteStatus({ r }: { r: Row }) {
  if (r.opp) {
    return r.tight
      ? <span className="badge warn" title="Gana poco: si un precio cambia mientras operas, puede volverse pérdida">Justa · actúa rápido · <Ago t={r.since} /></span>
      : <span className="badge good">Oportunidad · <Ago t={r.since} /></span>;
  }
  return r.gain > 0
    ? <span className="dim small" title="Gana menos que tu mínimo para avisar (botón Avisos)">Debajo de tu mínimo</span>
    : <span className="dim small">Sin ganancia</span>;
}

/** En celular: lo que esconden las columnas (pesos y estado) va debajo de la ruta. */
function MobileMeta({ r }: { r: Row }) {
  return (
    <div className="show-sm row-meta">
      <b className={`val ${tone(r.gain)}`}>{signedMoney(r.gain)}</b>
      <RouteStatus r={r} />
    </div>
  );
}

/** P2P directo: comprar y vender la MISMA cripto en P2P, sin pasar por Spot. Una fila por cripto. */
function DirectTable({ s, rows, coin, open, setOpen }: { s: State; rows: Row[]; coin: string; open: string; setOpen: (id: string) => void }) {
  if (!s.p2p) return <Skeleton rows={6} />;
  // las rutas P2P de 2 pasos son comprar y vender la misma cripto (id "X>X")
  const direct = new Map(rows.filter((r) => r.kind === "p2p" && r.route.steps.length === 2).map((r) => [r.id.slice(4).split(">")[0], r]));
  const list = s.settings.p2p_assets
    .filter((a) => !coin || a === coin)
    .map((a) => ({ a, r: direct.get(a) }))
    .sort((x, y) => (y.r?.per_usd ?? -1e9) - (x.r?.per_usd ?? -1e9));
  return (
    <div className="table-wrap">
      <table className="t">
        <thead>
          <tr>
            <th>Cripto</th><th className="num">Compras a</th><th className="num">Vendes a</th><th className="num">Por dólar</th>
            <th className="num hide-sm">Con {money(s.settings.capital, 0)}</th><th className="hide-sm">Estado</th><th />
          </tr>
        </thead>
        <tbody>
          {list.map(({ a, r }) => {
            if (!r || r.kind !== "p2p") {
              return (
                <tr key={a} className="dim">
                  <td><Asset s={a} size={22} /></td>
                  <td colSpan={6} className="small">Ningún anunciante confiable acepta {money(s.settings.capital, 0)} en las dos puntas ahora</td>
                </tr>
              );
            }
            const [buy, sell] = r.route.steps as [Extract<Route["steps"][number], { venue: "P2P" }>, Extract<Route["steps"][number], { venue: "P2P" }>];
            const unit = isDollar(a) ? "por dólar" : `por ${a}`;
            return (
              <Fragment key={a}>
                <tr className={r.opp ? "win" : ""} onClick={() => setOpen(open === r.id ? "" : r.id)} style={{ cursor: "pointer" }}>
                  <td><Asset s={a} size={22} /><MobileMeta r={r} /></td>
                  <td className="num"><b>{money(buy.price)}</b><div className="dim small">{buy.ad.nick} · {unit}</div></td>
                  <td className="num"><b>{money(sell.price)}</b><div className="dim small">{sell.ad.nick} · {unit}</div></td>
                  <td className="num"><Usd v={r.per_usd} /></td>
                  <td className="num hide-sm"><b className={`val ${tone(r.gain)}`}>{signedMoney(r.gain)}</b></td>
                  <td className="hide-sm"><RouteStatus r={r} /></td>
                  <td className="num"><span className="link-btn">{open === r.id ? "Ocultar" : "Pasos"}</span></td>
                </tr>
                {open === r.id && <tr className="detail"><td colSpan={7}><Steps row={r} s={s} /></td></tr>}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Sort = "usd" | "cop";
const TYPES = [["todas", "Todas"], ["p2p", "P2P"], ["directo", "P2P directo"], ["spot", "Spot"]] as const;
const rowPath = (r: Row) => (r.kind === "p2p" ? routePath(r.route) : r.tri.path);

/** Controles del filtro: en PC van en la barra; en el celular dentro de la hoja "Filtros". */
function FilterControls({ coins, counts, f, set, stacked }: {
  coins: string[];
  counts: Record<string, number>;
  f: { type: Filter; coin: string; win: boolean; sort: Sort };
  set: (p: Partial<{ type: Filter; coin: string; win: boolean; sort: Sort }>) => void;
  stacked?: boolean;
}) {
  const coinSel = (
    <Select label="Cripto" value={f.coin} onChange={(c) => set({ coin: c })}
      options={[{ value: "", label: "Todas las criptos", icon: <Icon name="filter" size={18} />, hint: `${counts[""] ?? 0} rutas` },
        ...coins.map((c) => ({
          value: c, search: `${c} ${COIN_NAMES[c] ?? ""}`, icon: <Coin s={c} size={22} />,
          label: <span className="opt-coin"><b>{c}</b><small>{COIN_NAMES[c] ?? ""}</small></span>,
          hint: `${counts[c] ?? 0} rutas`,
        }))]} />
  );
  const win = (
    <button type="button" className={`chip-toggle ${f.win ? "on" : ""}`} aria-pressed={f.win} onClick={() => set({ win: !f.win })}>
      <Icon name={f.win ? "check" : "trend"} size={15} /> Solo con ganancia
    </button>
  );
  if (!stacked) {
    return (
      <>
        <Segmented label="Tipo de ruta" value={f.type} onChange={(k) => set({ type: k })} options={TYPES} />
        <div className="filter-coin">{coinSel}</div>
        {win}
      </>
    );
  }
  return (
    <div className="filter-sheet">
      <div className="filter-group"><small>Tipo de ruta</small><Segmented label="Tipo de ruta" value={f.type} onChange={(k) => set({ type: k })} options={TYPES} /></div>
      <div className="filter-group"><small>Cripto</small>{coinSel}</div>
      <div className="filter-group"><small>Ordenar por</small>
        <Segmented label="Ordenar" value={f.sort} onChange={(k) => set({ sort: k })} options={[["usd", "Por dólar"], ["cop", "Más pesos"]] as const} />
      </div>
      <div className="filter-group"><small>Mostrar</small>{win}</div>
      <div className="filter-group"><small>Costos</small><GmfToggle /></div>
    </div>
  );
}

function Arbitrage({ s }: { s: State }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [f, setF] = useState<{ type: Filter; coin: string; win: boolean; sort: Sort }>({ type: "todas", coin: "", win: false, sort: "usd" });
  const [sheet, setSheet] = useState(false);
  const set = (p: Partial<typeof f>) => { setF((x) => ({ ...x, ...p })); setAll(false); };
  const filter = f.type;
  const base = arbitrageRows(s);
  const counts: Record<string, number> = { "": base.length };
  base.forEach((r) => new Set(rowPath(r)).forEach((c) => { counts[c] = (counts[c] ?? 0) + 1; }));
  const coins = [...new Set(base.flatMap(rowPath))].filter((c) => c !== "COP")
    .sort((a, b) => Number(!s.settings.p2p_assets.includes(a)) - Number(!s.settings.p2p_assets.includes(b)) || a.localeCompare(b));
  const everything = base
    .filter((r) => (!f.coin || rowPath(r).includes(f.coin)) && (!f.win || r.gain > 0))
    .sort((a, b) => (f.sort === "cop" ? Number(b.opp) - Number(a.opp) || b.gain - a.gain : 0));
  const active = Number(f.type !== "todas") + Number(!!f.coin) + Number(f.win) + Number(f.sort !== "usd");
  const opps = everything.filter((r) => r.opp).length;
  const rows = filter === "todas" ? everything : filter === "directo" ? [] : everything.filter((r) => r.kind === filter);
  const opened = open ?? (rows[0]?.opp ? rows[0].id : "");
  const shown = all ? rows : rows.slice(0, Math.max(SHOWN, opps));
  return (
    <div className="card">
      <div className="card-head">
        <h2>
          Arbitraje en vivo
          {opps > 0 && <span className="badge good">{opps} con ganancia</span>}
          {s.spot?.live && <span className="badge info" title="Precios de Spot por WebSocket, revisados cada 2 segundos">Tiempo real</span>}
        </h2>
        <div className="toolbar hide-sm">
          <FilterControls coins={coins} counts={counts} f={f} set={set} />
          <CapitalField />
          <GmfToggle />
        </div>
        <div className="toolbar-mobile show-sm-flex">
          <button type="button" className="btn btn-sm filter-btn" onClick={() => setSheet(true)}>
            <Icon name="filter" size={16} /> Filtros{active > 0 && <span className="filter-count">{active}</span>}
          </button>
          <CapitalField />
        </div>
      </div>
      {active > 0 && (
        <div className="filter-chips">
          {f.type !== "todas" && <button onClick={() => set({ type: "todas" })}>{TYPES.find(([k]) => k === f.type)?.[1]} <Icon name="x" size={12} /></button>}
          {f.coin && <button onClick={() => set({ coin: "" })}><Coin s={f.coin} size={14} /> {f.coin} <Icon name="x" size={12} /></button>}
          {f.win && <button onClick={() => set({ win: false })}>Solo con ganancia <Icon name="x" size={12} /></button>}
          {f.sort !== "usd" && <button onClick={() => set({ sort: "usd" })}>Más pesos primero <Icon name="x" size={12} /></button>}
          <button className="clear" onClick={() => set({ type: "todas", coin: "", win: false, sort: "usd" })}>Limpiar</button>
        </div>
      )}
      {sheet && (
        <Sheet title="Filtrar rutas" onClose={() => setSheet(false)}
          footer={<>
            <button className="btn" onClick={() => set({ type: "todas", coin: "", win: false, sort: "usd" })}>Limpiar</button>
            <button className="btn btn-brand" onClick={() => setSheet(false)}>Ver {f.type === "directo" ? "criptos" : `${rows.length} rutas`}</button>
          </>}>
          <FilterControls coins={coins} counts={counts} f={f} set={set} stacked />
        </Sheet>
      )}
      {filter === "directo" ? <DirectTable s={s} rows={everything} coin={f.coin} open={opened} setOpen={setOpen} /> : !rows.length ? <Skeleton rows={6} /> : (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr><th>Ruta</th><th className="hide-md">Mercado</th><th className="num">Por dólar</th><th className="num hide-sm">Con {money(s.settings.capital, 0)}</th><th className="hide-sm">Estado</th><th /></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Fragment key={r.id}>
                  <tr className={r.opp ? "win" : ""} onClick={() => setOpen(opened === r.id ? "" : r.id)} style={{ cursor: "pointer" }}>
                    <td><CoinPath path={r.kind === "p2p" ? routePath(r.route) : r.tri.path} /><MobileMeta r={r} /></td>
                    <td className="hide-md dim">
                      {r.kind === "spot" ? "Spot" : r.route.steps.length === 3 ? "P2P + Spot" : "P2P"}
                      {r.kind === "spot" && r.tri.real != null && <span className="tag" title="Calculado con la profundidad del libro para tu monto"> precio real</span>}
                    </td>
                    <td className="num"><Usd v={r.per_usd} /></td>
                    <td className="num hide-sm"><b className={`val ${tone(r.gain)}`}>{signedMoney(r.gain)}</b></td>
                    <td className="hide-sm"><RouteStatus r={r} /></td>
                    <td className="num"><span className="link-btn">{opened === r.id ? "Ocultar" : "Pasos"}</span></td>
                  </tr>
                  {opened === r.id && (
                    <tr className="detail"><td colSpan={6}><Steps row={r} s={s} /></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown.length || all ? (
        <div className="more">
          <button className="btn btn-ghost btn-sm" onClick={() => setAll(!all)}>{all ? "Ver menos" : `Ver todas las rutas (${rows.length})`}</button>
        </div>
      ) : null}
      <CostBar s={s} />
    </div>
  );
}

// ---------------------------------------------------------------- tus dólares: directo o convirtiendo en Spot

function ConvTable({ rows, side }: { rows: Conversion[]; side: "sell" | "buy" }) {
  return (
    <div className="table-wrap">
      <table className="t">
        <thead>
          <tr>
            <th>Cómo</th>
            <th className="num">{side === "sell" ? "Recibes por dólar" : "Te cuesta por dólar"}</th>
            <th className="num">Vs directo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.asset} className={r.vs_direct != null && r.vs_direct > 0.005 ? "win" : ""}>
              <td>
                {r.asset === "USDT" ? (
                  <span className="asset"><Coin s="USDT" size={18} /> Directo en P2P</span>
                ) : side === "sell" ? (
                  <span className="path"><Coin s="USDT" size={18} /><span className="arrow">→</span><Coin s={r.asset} size={18} />{r.asset}<span className="tag">Spot → P2P</span></span>
                ) : (
                  <span className="path"><Coin s={r.asset} size={18} />{r.asset}<span className="arrow">→</span><Coin s="USDT" size={18} /><span className="tag">P2P → Spot</span></span>
                )}
              </td>
              <td className="num">{money(r.per_usd)}</td>
              <td className="num">{r.asset === "USDT" ? <span className="val flat">—</span> : <Usd v={r.vs_direct} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function YourDollars({ s }: { s: State }) {
  const conv = s.p2p?.conversions;
  if (!conv || (!conv.sell.length && !conv.buy.length)) return null;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Tus dólares: directo o convirtiendo</h2>
      </div>
      <div className="grid-2">
        <div>
          <h3 className="mini-title">Vender dólares</h3>
          <ConvTable rows={conv.sell} side="sell" />
        </div>
        <div>
          <h3 className="mini-title">Comprar dólares</h3>
          <ConvTable rows={conv.buy} side="buy" />
        </div>
      </div>
      <CostsNote s={s} extra="Verde = mejor que hacerlo directo." />
    </div>
  );
}

// ---------------------------------------------------------------- precios por cripto

function PricesTable({ s, onTab }: { s: State; onTab: (t: TabId) => void }) {
  const { setPrefs } = useLive();
  const market = s.p2p?.market;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Precios P2P</h2>
      </div>
      {!market ? <Skeleton rows={6} /> : (
        <div className="table-wrap">
          <table className="t clickable">
            <thead><tr><th>Cripto</th><th className="num">Compras a</th><th className="num">Vendes a</th><th className="num hide-sm">Comprar y vender ya</th></tr></thead>
            <tbody>
              {s.settings.p2p_assets.map((a) => {
                const rt = roundTrip(s, a);
                return (
                  <tr key={a} onClick={() => { setPrefs({ asset: a }); onTab("mercado"); }}>
                    <td><Asset s={a} size={22} /></td>
                    <td className="num">{money(effBuy(market[a]?.BUY[0]?.price, s))}</td>
                    <td className="num">{money(market[a]?.SELL[0]?.price)}</td>
                    <td className="num hide-sm"><Usd v={rt} suffix="por dólar" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <CostsNote s={s} extra="Toca una cripto para ver sus anuncios." />
    </div>
  );
}

// ---------------------------------------------------------------- avisos

const ALERT_ICON: Record<string, Parameters<typeof Icon>[0]["name"]> = { p2p: "bolt", spot: "triangle", system: "alert", test: "check" };

function AlertsCard({ s }: { s: State }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Últimos avisos</h2>
      </div>
      {s.alerts.some((a) => isMine(a, s)) ? (
        s.alerts.filter((a) => isMine(a, s)).slice(0, 5).map((a) => (
          <div key={a.id} className="alert-item">
            <div className={`alert-ico ${a.kind}`}><Icon name={ALERT_ICON[a.kind] ?? "bell"} size={17} /></div>
            <div>
              <div className="alert-title">{a.title}</div>
              <div className="alert-body">{a.body}</div>
            </div>
            <div className="sub"><Ago t={a.t} /></div>
          </div>
        ))
      ) : (
        <p className="muted">Sin avisos todavía.</p>
      )}
    </div>
  );
}

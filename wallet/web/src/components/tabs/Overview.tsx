"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type Kind, type Market, type Movement, type SaleSource } from "@/lib/api";
import { cashValue, currentYear, hourMin, KIND_LABEL, money, num, qty, signedMoney, tone } from "@/lib/format";
import { CostModal } from "../CostModal";
import { LotModal } from "../LotModal";
import { Select, type SelectOption } from "../Select";
import { Asset, Badge, Coin, Empty, Icon, Pager, Pnl, Skeleton } from "../ui";
import { useWallet } from "../wallet";
import { KIND_BADGE } from "./Movements";

/* ---------- días en hora de Colombia ---------- */
const OFF = 5 * 3600;
const DAY = 86400;
/** número de día (desde 1970) en hora de Colombia */
const dayOf = (t: number) => Math.floor((t - OFF) / DAY);
/** lunes de la semana del día d (1970-01-01 fue jueves) */
const mondayOf = (d: number) => d - ((d + 3) % 7);
const dateOf = (d: number) => new Date(d * DAY * 1000);
const monthStart = (d: number) => { const x = dateOf(d); return Math.floor(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1) / 1000 / DAY); };
const monthEnd = (d: number) => { const x = dateOf(d); return Math.floor(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 1) / 1000 / DAY) - 1; };
const dayFromIso = (s: string) => Math.floor(Date.parse(s + "T00:00:00Z") / 1000 / DAY);
const isoOf = (d: number) => dateOf(d).toISOString().slice(0, 10);

const F_DAY = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const F_SHORT = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", day: "numeric", month: "short" });
/** Precio por unidad con centavos: "$ 3.166,56" (en dólares los centavos cuentan). */
const unitPrice = (v: number) => `$ ${num(v, v < 1000 ? 4 : 2)}`;
const F_BUY = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short" });

/** "De tu compra del 14 oct (157,83 USDT por $500.000) · quedan 16,70" o "Del resto de tu compra…" */
function sourceText(o: Op): string {
  const s = o.sources[0];
  const when = F_BUY.format(new Date(s.t * 1000)).replace(/\./g, "");
  const whole = `${s.kind === "compra" ? "tu compra" : "lo que recibiste"} del ${when} (${qty(s.bought_qty)} ${o.asset} por ${money(s.bought_cost)})`;
  const all = s.qty >= s.bought_qty - 1e-9;
  const head = all ? `Toda ${whole}` : s.left <= 1e-9 ? `Lo que quedaba de ${whole}` : `${qty(s.qty)} de ${whole} · quedan ${qty(s.left)}`;
  return o.sources.length > 1 ? `${head} y ${o.sources.length - 1} ${o.sources.length === 2 ? "compra más" : "compras más"}` : head;
}
const F_MONTH = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", month: "long", year: "numeric" });
const clean = (s: string) => s.replace(/\./g, "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Group = "dia" | "semana" | "mes";
const GROUP_LABEL: Record<Group, string> = { dia: "Día", semana: "Semana", mes: "Mes" };

function bucketOf(d: number, g: Group) {
  return g === "dia" ? d : g === "semana" ? mondayOf(d) : monthStart(d);
}
function bucketLabel(b: number, g: Group, long = false) {
  if (g === "dia") return cap(clean(F_DAY.format(dateOf(b))));
  if (g === "semana") return `${long ? "Semana del " : ""}${clean(F_SHORT.format(dateOf(b)))}${long ? ` al ${clean(F_SHORT.format(dateOf(b + 6)))}` : ""}`;
  return cap(F_MONTH.format(dateOf(b)));
}

/** Una venta, cambio o ingreso con lo que te costó y lo que ganaste */
interface Op { key: string; t: number; kind: Kind; asset: string; qty: number; received: string | null; cost: number; gross: number; fee: number; gain: number; missing: boolean;
  /** 4x1000 de lo vendido, ganancia ya sin él y de qué compras salió */
  gmf: number; net: number; sources: SaleSource[];
  /** venta: su movimiento (para elegir de qué compra salió) */
  id?: number;
  /** venta: costo escrito a mano */
  manual?: boolean;
  /** compra: pagaste `cost` y te llegó `qty` (no tiene ganancia; su 4x1000 se reparte en las ventas que salgan de ella) */
  buy?: boolean; method?: string; counterpart?: string;
  /** compra: cuánto queda sin vender, a cuánto vender para no perder y cuánto ganas si lo vendes ya en P2P */
  left?: number; even?: number | null; now?: { profit: number; price: number; nick: string } | null }

type Show = "todas" | "compras" | "gana" | "pierde" | "ocultas";
const PAGE = 50;

/** "Ocultar": aparece al pasar por la fila (en celular siempre). */
function HideBtn({ onClick }: { onClick: () => void }) {
  return (
    <button className="op-hide" onClick={onClick} title="Ocultar: no suma ni resta en tus resultados">
      <Icon name="x" size={12} /><span>Ocultar</span>
    </button>
  );
}

/** Resultados fáciles: elige un periodo y mira cuánto compraste, cuánto ganaste en cada operación y cómo vas ahorita. */
export function Overview({ onDetail }: { onDetail: () => void }) {
  const { report, year, version, refresh, toast } = useWallet();
  const live = year >= currentYear();
  const today = dayOf(Date.now() / 1000);
  const y0 = Math.floor(Date.UTC(year, 0, 1) / 1000 / DAY);
  const y1 = Math.min(Math.floor(Date.UTC(year + 1, 0, 1) / 1000 / DAY) - 1, live ? today : Infinity);

  const [period, setPeriod] = useState(live ? "mes" : "año");
  const [from, setFrom] = useState(isoOf(Math.max(y0, today - 29)));
  const [to, setTo] = useState(isoOf(y1));
  const [group, setGroup] = useState<Group>(live ? "dia" : "mes");
  const [show, setShow] = useState<Show>("todas");
  const [page, setPage] = useState(0);
  const [moves, setMoves] = useState<Movement[] | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  const [marketErr, setMarketErr] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [lotOf, setLotOf] = useState<number | null>(null);
  const [costOf, setCostOf] = useState<Op | null>(null);

  useEffect(() => {
    let alive = true;
    setMarket(null);
    setMarketErr(false);
    api.market(year).then((m) => alive && setMarket(m), () => alive && setMarketErr(true));
    return () => { alive = false; };
  }, [year]);
  useEffect(() => {  // movimientos (con su 4x1000) de nuevo cada vez que algo cambia
    let alive = true;
    api.movements(year).then((r) => alive && setMoves(r.movements), () => alive && setMoves([]));
    return () => { alive = false; };
  }, [year, version]);
  useEffect(() => { setPeriod(live ? "mes" : "año"); setGroup(live ? "dia" : "mes"); setPage(0); }, [year, live]);

  /* ---------- periodos ---------- */
  const presets = useMemo(() => {
    const ws = mondayOf(today), ms = monthStart(today), pm = monthStart(ms - 1);
    const list: { id: string; label: string; a: number; b: number }[] = [];
    if (live) {
      list.push(
        { id: "hoy", label: "Hoy", a: today, b: today },
        { id: "ayer", label: "Ayer", a: today - 1, b: today - 1 },
        { id: "semana", label: "Esta semana", a: ws, b: today },
        { id: "semana-pasada", label: "Semana pasada", a: ws - 7, b: ws - 1 },
        { id: "7d", label: "Últimos 7 días", a: today - 6, b: today },
        { id: "mes", label: "Este mes", a: ms, b: today },
        { id: "mes-pasado", label: "Mes pasado", a: pm, b: ms - 1 },
        { id: "30d", label: "Últimos 30 días", a: today - 29, b: today },
      );
    }
    list.push({ id: "año", label: live ? `Lo que va de ${year}` : `Todo ${year}`, a: y0, b: y1 });
    for (let m = 11; m >= 0; m--) {
      const a = Math.floor(Date.UTC(year, m, 1) / 1000 / DAY);
      if (a > y1) continue;
      if (live && a === monthStart(today)) continue;
      list.push({ id: `m${m}`, label: cap(F_MONTH.format(dateOf(a))), a, b: Math.min(monthEnd(a), y1) });
    }
    return list;
  }, [today, year, live, y0, y1]);

  const custom = period === "rango";
  const cur = presets.find((p) => p.id === period) ?? presets.find((p) => p.id === "año")!;
  const [a, b] = custom ? [Math.max(y0, dayFromIso(from) || y0), Math.min(y1, dayFromIso(to) || y1)] : [cur.a, cur.b];
  const span = b - a + 1;

  function pick(id: string) {
    setPeriod(id);
    const p = presets.find((x) => x.id === id);
    const n = p ? p.b - p.a + 1 : span;
    setGroup(n <= 31 ? "dia" : n <= 120 ? "semana" : "mes");
    setPage(0);
  }

  /* ---------- datos del periodo ---------- */
  const inRange = (t: number) => { const d = dayOf(t); return d >= a && d <= b; };

  const ops = useMemo<Op[]>(() => {
    if (!report) return [];
    const sales = report.disposals.map((d) => ({ key: `d${d.id}-${d.t}`, t: d.t, kind: d.kind, asset: d.asset, qty: d.qty, received: d.received,
      cost: d.cost, gross: d.gross, fee: d.fee, gain: d.gain, missing: d.missing > 1e-9,
      gmf: d.gmf ?? 0, net: d.net ?? d.gain, sources: d.sources ?? [], id: d.id, manual: !!d.manual }));
    const incomes = report.incomes.map((x) => ({ key: `i${x.id}`, t: x.t, kind: x.kind, asset: x.asset, qty: x.qty, received: null,
      cost: 0, gross: x.value, fee: 0, gain: x.value, missing: false, gmf: 0, net: x.value, sources: [] }));
    return [...sales, ...incomes].sort((p, q) => q.t - p.t);
  }, [report]);

  const inPeriod = useMemo(() => ops.filter((o) => inRange(o.t)), [ops, a, b]);
  // las ocultas no suman ni restan en nada
  const mine = useMemo(() => (moves ?? []).filter((m) => !m.tercero), [moves]);
  const buys = useMemo(() => mine.filter((m) => m.kind === "compra" && inRange(m.t)), [mine, a, b]);
  // el 4x1000 de las compras se resta en la venta (su parte en cada una); aquí va solo el de lo demás (gastos, retiros…)
  const gmfOther = useMemo(() => mine.reduce((s, m) => s + (m.kind !== "compra" && inRange(m.t) ? m.gmf_cop || 0 : 0), 0), [mine, a, b]);

  const sum = useMemo(() => {
    const sales = inPeriod.filter((o) => o.kind === "venta" || o.kind === "permuta");
    const gain = inPeriod.reduce((s, o) => s + o.gain, 0);
    const cost = sales.reduce((s, o) => s + o.cost, 0);
    const gmf = inPeriod.reduce((s, o) => s + o.gmf, 0) + gmfOther;
    return {
      gain, cost, gmf,
      sold: sales.reduce((s, o) => s + o.gross - o.fee, 0), nSold: sales.length,
      won: sales.filter((o) => Math.round(o.net) > 0).length,
      bought: buys.reduce((s, m) => s + cashValue(m), 0), nBought: buys.length,
      net: gain - gmf,
      salesNet: sales.reduce((s, o) => s + o.net, 0),
    };
  }, [inPeriod, buys, gmfOther]);

  /* ---------- gráfica por día / semana / mes ---------- */
  const bars = useMemo(() => {
    const map = new Map<number, { gain: number; n: number; bought: number }>();
    for (let d = a; d <= b; d++) {
      const k = bucketOf(d, group);
      if (!map.has(k)) map.set(k, { gain: 0, n: 0, bought: 0 });
    }
    for (const o of inPeriod) { const x = map.get(bucketOf(dayOf(o.t), group)); if (x) { x.gain += o.net; x.n++; } }
    for (const m of buys) { const x = map.get(bucketOf(dayOf(m.t), group)); if (x) x.bought += cashValue(m); }
    return [...map].sort((p, q) => p[0] - q[0]).map(([k, v]) => ({ k, ...v }));
  }, [inPeriod, buys, a, b, group]);
  const maxAbs = Math.max(1, ...bars.map((x) => Math.abs(x.gain)));
  const hasNeg = bars.some((x) => x.gain < -0.5);
  const hasPos = bars.some((x) => x.gain > 0.5);

  /* ---------- lista de operaciones ---------- */
  // cuánto se ha vendido de cada compra (las ventas dicen de qué compra salieron)
  const usedOf = useMemo(() => {
    const u = new Map<number, number>();
    for (const d of report?.disposals ?? []) for (const s of d.sources ?? []) if (s.id != null) u.set(s.id, (u.get(s.id) ?? 0) + s.qty);
    return u;
  }, [report]);
  const moveById = useMemo(() => new Map((moves ?? []).map((m) => [m.id, m])), [moves]);
  const allBuys = useMemo(() => mine.filter((m) => m.kind === "compra"), [mine]);
  const thirdOps = useMemo<Op[]>(() => (moves ?? []).filter((m) => m.tercero && inRange(m.t) && (m.kind === "compra" || m.kind === "venta")).map((m) => {
    const buy = m.kind === "compra";
    return { key: `t${m.id}`, id: m.id, t: m.t, kind: m.kind, asset: (buy ? m.in_asset : m.out_asset) ?? "", qty: (buy ? m.in_qty : m.out_qty) ?? 0,
      received: null, cost: buy ? m.cop_value + (m.fee_cop || 0) : 0, gross: buy ? 0 : m.cop_value, fee: buy ? 0 : m.fee_cop || 0, gain: 0,
      missing: false, gmf: m.gmf_cop || 0, net: 0, sources: [], buy, method: m.pay_method, counterpart: m.counterpart };
  }).sort((p, q) => q.t - p.t), [moves, a, b]);

  /** Oculta (o vuelve a mostrar). Al ocultar una compra se van con ella las ventas que salieron de esa. */
  async function markThird(o: Op, on: boolean) {
    if (o.id == null) return;
    const ids = [o.id];
    if (o.buy && on) for (const d of report?.disposals ?? []) {
      if (d.sources?.some((x) => x.id === o.id)) ids.push(d.id);  // si no, quedarían vendidas sin su compra
    }
    if (o.buy && !on) for (const m of moves ?? []) {
      if (m.tercero && m.kind === "venta" && m.lot_from === o.id) ids.push(m.id);
    }
    try {
      await api.movementsThird(ids, on);
      const more = ids.length - 1;
      toast(on ? "Oculta" : "Visible otra vez",
        on ? `Ya no suma ni resta${more ? ` (con ${more === 1 ? "la venta que salió" : `${more} ventas que salieron`} de esa compra)` : ""}. La ves en "Ocultas".`
          : `Vuelve a contar en tus resultados${more ? ` con ${more} venta${more === 1 ? "" : "s"}` : ""}.`, "good");
      refresh();
    } catch (e) {
      toast("No se pudo cambiar", (e as Error).message, "bad");
    }
  }
  const buyOps = useMemo<Op[]>(() => buys.map((m) => {
    const asset = m.in_asset ?? "", q = m.in_qty ?? 0, cost = m.cop_value + (m.fee_cop || 0), g = m.gmf_cop || 0;
    const p2p = market?.p2p;
    // comisión al vender en P2P: el porcentaje o el mínimo por orden (en dólares; solo se sabe directo en USDT/USDC/FDUSD)
    const feeQty = (x: number) => Math.min(x, Math.max((p2p?.fee ?? 0) * x, ["USDT", "USDC", "FDUSD"].includes(asset) ? p2p?.min_usd ?? 0 : 0));
    const left = Math.max(q - (usedOf.get(m.id) ?? 0), 0);
    const even = q > 0 ? (cost + g) / (q - feeQty(q)) : null;
    let now: Op["now"] = null;
    if (left > 1e-6 && p2p) {
      const ad = (p2p.buyers[asset] ?? []).find((b) => b.min <= left * b.price && left * b.price <= b.max && (!b.available || b.available >= left));
      if (ad) now = { profit: (left - feeQty(left)) * ad.price - (cost + g) * (left / q), price: ad.price, nick: ad.nick };
    }
    return { key: `b${m.id}`, id: m.id, t: m.t, kind: m.kind, asset, qty: q, received: null, cost, gross: 0, fee: 0, gain: 0, missing: false,
      gmf: g, net: 0, sources: [], buy: true, method: m.pay_method, counterpart: m.counterpart, left, even, now };
  }), [buys, usedOf, market]);
  const listed = show === "ocultas" ? thirdOps : show === "compras" ? buyOps
    : show === "todas" ? [...inPeriod, ...buyOps].sort((p, q) => q.t - p.t)
    : inPeriod.filter((o) => (show === "gana" ? Math.round(o.net) > 0 : Math.round(o.net) < 0));
  const pages = Math.ceil(listed.length / PAGE);
  const slice = listed.slice(page * PAGE, page * PAGE + PAGE);
  const bucketSum = useMemo(() => {
    const m = new Map<number, { gain: number; n: number }>();
    for (const o of listed) { const k = bucketOf(dayOf(o.t), group); const x = m.get(k) ?? { gain: 0, n: 0 }; x.gain += o.buy ? (show === "compras" ? -o.gmf : 0) : o.net; x.n++; m.set(k, x); }
    return m;
  }, [listed, group]);

  /* ---------- ahorita ---------- */
  const holdings = (report?.holdings ?? []).filter((h) => h.qty > 1e-12).map((h) => {
    const v = market?.values[h.asset];
    return { ...h, value: v ? v.cop : null, price: v ? v.cop / h.qty : null };
  }).sort((p, q) => (q.value ?? q.cost) - (p.value ?? p.cost));
  const holdCost = holdings.reduce((s, h) => s + h.cost, 0);
  const valued = holdings.filter((h) => h.value != null);
  const holdValue = valued.reduce((s, h) => s + (h.value ?? 0), 0);
  const holdDiff = holdValue - valued.reduce((s, h) => s + h.cost, 0);

  if (!report) return <Skeleton rows={5} />;

  const periodOptions: SelectOption[] = [
    ...presets.map((p) => ({ value: p.id, label: p.label, search: p.label, icon: <Icon name="calendar" size={16} /> })),
    { value: "rango", label: "Elegir fechas…", search: "rango fechas personalizado", icon: <Icon name="edit" size={16} /> },
  ];
  const quick = (live ? ["hoy", "semana", "mes", "año"] : ["año"]).map((id) => presets.find((p) => p.id === id)!).filter(Boolean);
  const periodText = custom ? `${clean(F_SHORT.format(dateOf(a)))} – ${clean(F_SHORT.format(dateOf(b)))}` : cur.label.toLowerCase();
  const margin = sum.cost > 0 ? (sum.salesNet / sum.cost) * 100 : 0;

  return (
    <div className="stack">
      {/* ---------- periodo ---------- */}
      <div className="card period-bar">
        <div className="seg">
          {quick.map((p) => <button key={p.id} className={period === p.id ? "on" : ""} onClick={() => pick(p.id)}>{p.id === "año" ? "Año" : p.label}</button>)}
        </div>
        <div className="filter-inline period-sel">
          <Select label="Periodo" value={period} options={periodOptions} onChange={pick} />
        </div>
        {custom && (
          <div className="range">
            <input type="date" value={from} min={isoOf(y0)} max={isoOf(y1)} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
            <span className="muted">a</span>
            <input type="date" value={to} min={isoOf(y0)} max={isoOf(y1)} onChange={(e) => setTo(e.target.value)} aria-label="Hasta" />
          </div>
        )}
        <span className="sub period-days">{span === 1 ? clean(F_DAY.format(dateOf(a))) : `${num(span)} días`}</span>
      </div>

      {/* ---------- resumen del periodo ---------- */}
      <div className="kpis">
        <div className="kpi accent">
          <small>{sum.net < -0.5 ? "Perdiste" : "Ganaste"} · {periodText}</small>
          <b className={tone(sum.net)}>{signedMoney(sum.net)}</b>
          <span>Operaciones {signedMoney(sum.gain)}{sum.gmf >= 0.5 ? ` · 4x1000 −${money(sum.gmf)}` : ""}</span>
        </div>
        <div className="kpi">
          <small>Compraste</small>
          <b>{moves ? money(sum.bought) : "…"}</b>
          <span>{sum.nBought} compra{sum.nBought === 1 ? "" : "s"} · pesos que pusiste</span>
        </div>
        <div className="kpi">
          <small>Vendiste</small>
          <b>{money(sum.sold)}</b>
          <span>{sum.nSold ? `${sum.nSold} venta${sum.nSold === 1 ? "" : "s"} · ${sum.won} con ganancia` : "Sin ventas en el periodo"}</span>
        </div>
        <div className="kpi">
          <small>Margen</small>
          <b className={tone(margin)}>{sum.cost > 0 ? `${margin >= 0 ? "+" : "−"}${num(Math.abs(margin), 2)} %` : "—"}</b>
          <span>{sum.cost > 0 ? `Por cada $ 100.000 ganaste ${signedMoney(margin * 1000)}` : "Lo que ganas sobre lo que te costó"}</span>
        </div>
      </div>

      <div className="grid-2 overview-grid">
        {/* ---------- gráfica ---------- */}
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Ganancia por {GROUP_LABEL[group].toLowerCase()}</h2>
              <span className="sub">Ya sin el 4x1000 · verde ganaste · rojo perdiste</span>
            </div>
            <div className="seg">
              {(Object.keys(GROUP_LABEL) as Group[]).map((g) => <button key={g} className={group === g ? "on" : ""} onClick={() => setGroup(g)}>{GROUP_LABEL[g]}</button>)}
            </div>
          </div>
          <div className="card-body">
            {!inPeriod.length ? (
              <div className="chart-empty">Sin ventas ni ganancias en este periodo</div>
            ) : (
              <div className="bars-wrap" onMouseLeave={() => setHover(null)}>
                <div className={`bars ${hasNeg && hasPos ? "both" : hasNeg ? "neg" : "pos"}`} role="img" aria-label={`Ganancia por ${GROUP_LABEL[group].toLowerCase()}`}>
                  {bars.map((x, i) => {
                    const h = Math.abs(x.gain) / maxAbs * 100;
                    return (
                      <div key={x.k} className={`bar-col ${hover === i ? "on" : ""}`} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
                        <div className="bar-half up">{x.gain > 0.5 && <span className="bar up" style={{ height: `max(${h}%, 2px)` }} />}</div>
                        <div className="bar-half down">{x.gain < -0.5 && <span className="bar down" style={{ height: `max(${h}%, 2px)` }} />}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="bars-axis">
                  <span>{bucketLabel(bars[0].k, group)}</span>
                  {bars.length > 2 && <span>{bucketLabel(bars[bars.length - 1].k, group)}</span>}
                </div>
                {hover != null && bars[hover] && (
                  <div className="bar-tip" style={{ left: `${Math.min(80, Math.max(20, ((hover + 0.5) / bars.length) * 100))}%` }}>
                    <b>{bucketLabel(bars[hover].k, group, true)}</b>
                    <span>Ganancia <b className={tone(bars[hover].gain)}>{signedMoney(bars[hover].gain)}</b></span>
                    <span>{bars[hover].n} operaci{bars[hover].n === 1 ? "ón" : "ones"} · compraste {money(bars[hover].bought)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ---------- ahorita ---------- */}
        <div className="card">
          <div className="card-head">
            <div>
              <h2>{live ? "Cómo vas ahorita" : `Cómo cerraste ${year}`}</h2>
              <span className="sub">{live ? "Lo que tienes, a precio de hoy" : "Lo que tenías al 31 de diciembre"}</span>
            </div>
          </div>
          {!holdings.length ? (
            <Empty icon="wallet" title="No tienes cripto guardada">Todo lo que compraste ya lo vendiste.</Empty>
          ) : (
            <>
              <div className="now-head">
                <div><small>Te costó</small><b>{money(holdCost)}</b></div>
                <div><small>Vale {live ? "hoy" : "al cierre"}</small><b>{market ? money(holdValue) : marketErr ? "—" : "…"}</b></div>
                <div><small>Si vendieras {live ? "ya" : "ese día"}</small><b className={market ? tone(holdDiff) : ""}>{market ? signedMoney(holdDiff) : marketErr ? "—" : "…"}</b></div>
              </div>
              {market && valued.length < holdings.length && (
                <p className="now-note">Sin precio de hoy: {holdings.filter((h) => h.value == null).map((h) => h.asset).join(", ")}. No entra en “vale” ni en “si vendieras”.</p>
              )}
              <div className="now-list">
                {holdings.map((h) => {
                  const diff = h.value != null ? h.value - h.cost : null;
                  const pct = diff != null && h.cost > 0 ? (diff / h.cost) * 100 : null;
                  return (
                    <div key={h.asset} className="now-row">
                      <Coin asset={h.asset} size={28} />
                      <div className="now-main">
                        <b>{qty(h.qty)} {h.asset}</b>
                        <small>Te costó {money(h.cost)}{h.price != null ? ` · 1 ${h.asset} = ${money(h.price)}` : ""}</small>
                      </div>
                      <div className="now-val">
                        <b>{h.value != null ? money(h.value) : market || marketErr ? <span className="muted">Sin precio</span> : "…"}</b>
                        {diff != null && <small className={tone(diff)}>{signedMoney(diff)}{pct != null && ` (${pct >= 0 ? "+" : "−"}${num(Math.abs(pct), 1)} %)`}</small>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ---------- cada operación ---------- */}
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Cada operación</h2>
            <span className="sub">Tus compras y ventas: cuánto pagaste, cuánto recibiste y cuánto te quedó</span>
          </div>
          <div className="actions">
            <div className="seg">
              {([["todas", "Todas"], ["compras", "Compras"], ["gana", "Con ganancia"], ["pierde", "Con pérdida"]] as const).map(([k, l]) => (
                <button key={k} className={show === k ? "on" : ""} onClick={() => { setShow(k); setPage(0); }}>{l}</button>
              ))}
              {(thirdOps.length > 0 || show === "ocultas") && (
                <button className={show === "ocultas" ? "on" : ""} onClick={() => { setShow("ocultas"); setPage(0); }}
                  title="Compras y ventas que ocultaste: no suman ni restan">
                  Ocultas <span className="seg-count">{thirdOps.length}</span>
                </button>
              )}
            </div>
            <button className="btn btn-sm btn-ghost" onClick={onDetail}>Detalle fiscal <Icon name="chevron" size={14} /></button>
          </div>
        </div>
        {!listed.length ? (
          <Empty icon="trend" title={inPeriod.length ? "Nada con ese filtro" : "Sin operaciones en este periodo"}>
            {!inPeriod.length && "Prueba con otro periodo: arriba puedes elegir semana, mes o fechas."}
          </Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="t mv-table">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Qué hiciste</th>
                    <th className="r">Te costó</th>
                    <th className="r hide-sm">Recibiste</th>
                    <th className="r" title="Venta: lo que recibiste menos lo que te costó, ya sin la parte del 4x1000 de la compra. El 4x1000 de una compra se resta en las ventas que salen de ella, una sola vez">Te quedó</th>
                    <th className="r hide-sm">%</th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((o, i) => {
                    const k = bucketOf(dayOf(o.t), group);
                    const head = i === 0 || bucketOf(dayOf(slice[i - 1].t), group) !== k;
                    const g = bucketSum.get(k);
                    const pct = o.cost > 0 ? (o.net / o.cost) * 100 : null;
                    return [
                      head && g && (
                        <tr key={`h${k}`} className="group-row">
                          <td colSpan={2}>{bucketLabel(k, group, true)} <span>· {g.n} operaci{g.n === 1 ? "ón" : "ones"}</span></td>
                          <td />
                          <td className="hide-sm" />
                          <td className="r"><Pnl v={g.gain} /></td>
                          <td className="hide-sm" />
                        </tr>
                      ),
                      show === "ocultas" ? (
                        <tr key={o.key} className="third-row">
                          <td className="nowrap">{hourMin(o.t)}{group !== "dia" && <span className="cell-sub">{clean(F_SHORT.format(dateOf(dayOf(o.t))))}</span>}</td>
                          <td>
                            <span className="op-what">
                              <Badge kind={KIND_BADGE[o.kind]}>{KIND_LABEL[o.kind]}</Badge>
                              <Asset asset={o.asset} qty={qty(o.qty)} />
                              <span className="third-tag"><Icon name="x" size={11} /> oculta</span>
                            </span>
                            {o.qty > 0 && (
                              <span className="cell-sub op-prices">
                                {o.buy ? <>Compraste a <b>{unitPrice(o.cost / o.qty)}</b></> : <>Vendiste a <b>{unitPrice(o.gross / o.qty)}</b></>} por {o.asset}
                                {o.method ? ` · ${o.method}` : ""}{o.counterpart ? ` · ${o.counterpart}` : ""}
                              </span>
                            )}
                          </td>
                          <td className="r">{o.buy ? money(o.cost + o.gmf) : <span className="muted">—</span>}</td>
                          <td className="r hide-sm">{o.buy ? `${qty(o.qty)} ${o.asset}` : money(o.gross - o.fee)}</td>
                          <td className="r" colSpan={2}>
                            <button className="btn btn-sm op-mine" onClick={() => void markThird(o, false)} title="Que vuelva a sumar en tus resultados">
                              <Icon name="back" size={14} /> Mostrar
                            </button>
                          </td>
                        </tr>
                      ) : o.buy ? (
                        <tr key={o.key} className="buy-row">
                          <td className="nowrap">{hourMin(o.t)}{group !== "dia" && <span className="cell-sub">{clean(F_SHORT.format(dateOf(dayOf(o.t))))}</span>}</td>
                          <td>
                            <span className="op-what">
                              <Badge kind={KIND_BADGE[o.kind]}>{KIND_LABEL[o.kind]}</Badge>
                              <Asset asset={o.asset} qty={qty(o.qty)} />
                              <HideBtn onClick={() => void markThird(o, true)} />
                            </span>
                            {o.qty > 0 && <span className="cell-sub op-prices">Compraste a <b>{unitPrice(o.cost / o.qty)}</b> por {o.asset}</span>}
                            <span className="cell-sub">{o.method ?? ""}{o.counterpart ? ` · a ${o.counterpart}` : ""}</span>
                            {o.even != null && (
                              <span className="cell-sub buy-even">
                                Para no perder: vende a <b>{money(o.even)}</b>/{o.asset} o más
                                {(o.left ?? 0) <= 1e-6 ? " · ya la vendiste toda" : (o.left ?? 0) < o.qty - 1e-6 ? ` · te quedan ${qty(o.left)}` : ""}
                              </span>
                            )}
                          </td>
                          <td className="r">{money(o.cost + o.gmf)}{o.gmf >= 1 && <span className="cell-sub">{money(o.cost)} + 4x1000</span>}</td>
                          <td className="r hide-sm">{qty(o.qty)} {o.asset}</td>
                          <td className="r">
                            {o.gmf >= 1 ? <><span className="muted">4x1000 −{money(o.gmf)}</span>
                              <span className="cell-sub" title="No se resta aquí: se resta en cada venta que sale de esta compra, en proporción a lo que vendes">se resta al vender</span></>
                              : <span className="muted">—</span>}
                            {o.now && (
                              <span className="cell-sub" title={`Al mejor comprador de P2P que acepta lo que te queda: ${o.now.nick}. Ya con este 4x1000.`}>
                                si vendes ya a {money(o.now.price)}: <span className={tone(o.now.profit)}>{signedMoney(o.now.profit)}</span>
                              </span>
                            )}
                          </td>
                          <td className="r hide-sm muted">—</td>
                        </tr>
                      ) : (
                      <tr key={o.key}>
                        <td className="nowrap">{hourMin(o.t)}{group !== "dia" && <span className="cell-sub">{clean(F_SHORT.format(dateOf(dayOf(o.t))))}</span>}</td>
                        <td>
                          <span className="op-what">
                            <Badge kind={KIND_BADGE[o.kind]}>{KIND_LABEL[o.kind]}</Badge>
                            <Asset asset={o.asset} qty={qty(o.qty)} />
                            {o.kind === "permuta" && o.received && <span className="muted nowrap">→ {o.received}</span>}
                            {o.kind === "venta" && o.id != null && <HideBtn onClick={() => void markThird(o, true)} />}
                          </span>
                          {o.missing && <span className="cell-sub warn">Falta la compra: la ganancia puede salir más alta</span>}
                          {o.qty > 0 && o.kind === "venta" && o.cost > 0 && (
                            <span className="cell-sub op-prices">
                              Compraste a <b>{unitPrice(o.cost / o.qty)}</b> → vendiste a <b>{unitPrice(o.gross / o.qty)}</b> por {o.asset}
                            </span>
                          )}
                          {o.manual ? (
                            <button className="cell-sub op-source" onClick={() => setCostOf(o)} title="Cambiar lo que te costó">
                              <span>Costo escrito a mano</span><span className="tag">a mano</span><Icon name="edit" size={12} />
                            </button>
                          ) : o.sources.length > 0 && (() => {
                            const mv = o.id != null ? moveById.get(o.id) : undefined;
                            return mv ? (
                              <button className="cell-sub op-source" onClick={() => setLotOf(mv.id)} title="Cambiar de qué compra salió esta venta">
                                <span>{sourceText(o)}</span>
                                {mv.lot_from != null && <span className="tag">elegida</span>}
                                <Icon name="edit" size={12} />
                              </button>
                            ) : <span className="cell-sub">{sourceText(o)}</span>;
                          })()}
                          {o.id != null && !o.manual && (o.kind === "venta" || o.kind === "permuta") && (
                            <button className={`cell-sub op-adjust ${o.missing ? "warn" : ""}`} onClick={() => setCostOf(o)}>
                              <Icon name="edit" size={12} /> {o.missing ? "Escribir cuánto te costó" : "Ajustar costo"}
                            </button>
                          )}
                        </td>
                        <td className="r">{o.cost ? money(o.cost) : <span className="muted">—</span>}</td>
                        <td className="r hide-sm">{money(o.gross - o.fee)}
                          {o.fee >= 1 && (() => {
                            const fq = o.id != null ? moveById.get(o.id)?.fee_qty : 0;
                            return <span className="cell-sub" title="La comisión de Binance sale en cripto: ya está dentro de lo que vendiste y no te llega">
                              comisión {fq ? `${num(fq, 2)} ${o.asset}` : money(o.fee)}</span>;
                          })()}</td>
                        <td className="r"><b><Pnl v={o.net} /></b>
                          {o.gmf >= 1 && (
                            <span className="cell-sub" title="La ganancia de verdad: lo que recibiste menos lo que te costó, menos la parte del 4x1000 que pagaste al comprar lo que vendiste (las comisiones de Binance ya van en el costo y en lo recibido)">
                              {signedMoney(o.gain)} − 4x1000 {money(o.gmf)}
                            </span>
                          )}
                          {pct != null && <span className={`cell-sub show-sm ${tone(pct)}`}>{pct >= 0 ? "+" : "−"}{num(Math.abs(pct), 2)} %</span>}</td>
                        <td className={`r hide-sm ${pct == null ? "muted" : tone(pct)}`}>{pct == null ? "—" : `${pct >= 0 ? "+" : "−"}${num(Math.abs(pct), 2)} %`}</td>
                      </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={page} pages={pages} onPage={setPage} />
            {costOf && costOf.id != null && (
              <CostModal sale={{ id: costOf.id, asset: costOf.asset, qty: costOf.qty, received: costOf.gross - costOf.fee, cost: costOf.cost,
                gmf: costOf.gmf, manual: !!costOf.manual }} onClose={() => setCostOf(null)} />
            )}
            {lotOf != null && moveById.get(lotOf) && (
              <LotModal sale={moveById.get(lotOf)!} buys={allBuys} used={usedOf} onClose={() => setLotOf(null)} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

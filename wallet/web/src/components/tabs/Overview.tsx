"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type Kind, type Market, type Movement, type SaleSource } from "@/lib/api";
import { cashValue, currentYear, hourMin, KIND_LABEL, money, num, qty, signedMoney, tone } from "@/lib/format";
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
  gmf: number; net: number; sources: SaleSource[] }

type Show = "todas" | "gana" | "pierde";
const PAGE = 50;

/** Resultados fáciles: elige un periodo y mira cuánto compraste, cuánto ganaste en cada operación y cómo vas ahorita. */
export function Overview({ onDetail }: { onDetail: () => void }) {
  const { report, year, version } = useWallet();
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
      gmf: d.gmf ?? 0, net: d.net ?? d.gain, sources: d.sources ?? [] }));
    const incomes = report.incomes.map((x) => ({ key: `i${x.id}`, t: x.t, kind: x.kind, asset: x.asset, qty: x.qty, received: null,
      cost: 0, gross: x.value, fee: 0, gain: x.value, missing: false, gmf: 0, net: x.value, sources: [] }));
    return [...sales, ...incomes].sort((p, q) => q.t - p.t);
  }, [report]);

  const inPeriod = useMemo(() => ops.filter((o) => inRange(o.t)), [ops, a, b]);
  const buys = useMemo(() => (moves ?? []).filter((m) => m.kind === "compra" && inRange(m.t)), [moves, a, b]);
  const gmf = useMemo(() => (moves ?? []).reduce((s, m) => s + (inRange(m.t) ? m.gmf_cop || 0 : 0), 0), [moves, a, b]);

  const sum = useMemo(() => {
    const sales = inPeriod.filter((o) => o.kind === "venta" || o.kind === "permuta");
    const gain = inPeriod.reduce((s, o) => s + o.gain, 0);
    const cost = sales.reduce((s, o) => s + o.cost + o.fee, 0);
    return {
      gain, cost,
      sold: sales.reduce((s, o) => s + o.gross, 0), nSold: sales.length,
      won: sales.filter((o) => Math.round(o.gain) > 0).length,
      bought: buys.reduce((s, m) => s + cashValue(m), 0), nBought: buys.length,
      net: gain - gmf,
    };
  }, [inPeriod, buys, gmf]);

  /* ---------- gráfica por día / semana / mes ---------- */
  const bars = useMemo(() => {
    const map = new Map<number, { gain: number; n: number; bought: number }>();
    for (let d = a; d <= b; d++) {
      const k = bucketOf(d, group);
      if (!map.has(k)) map.set(k, { gain: 0, n: 0, bought: 0 });
    }
    for (const o of inPeriod) { const x = map.get(bucketOf(dayOf(o.t), group)); if (x) { x.gain += o.gain; x.n++; } }
    for (const m of buys) { const x = map.get(bucketOf(dayOf(m.t), group)); if (x) x.bought += cashValue(m); }
    return [...map].sort((p, q) => p[0] - q[0]).map(([k, v]) => ({ k, ...v }));
  }, [inPeriod, buys, a, b, group]);
  const maxAbs = Math.max(1, ...bars.map((x) => Math.abs(x.gain)));
  const hasNeg = bars.some((x) => x.gain < -0.5);
  const hasPos = bars.some((x) => x.gain > 0.5);

  /* ---------- lista de operaciones ---------- */
  const listed = inPeriod.filter((o) => show === "todas" || (show === "gana" ? Math.round(o.net) > 0 : Math.round(o.net) < 0));
  const pages = Math.ceil(listed.length / PAGE);
  const slice = listed.slice(page * PAGE, page * PAGE + PAGE);
  const bucketSum = useMemo(() => {
    const m = new Map<number, { gain: number; n: number }>();
    for (const o of listed) { const k = bucketOf(dayOf(o.t), group); const x = m.get(k) ?? { gain: 0, n: 0 }; x.gain += o.net; x.n++; m.set(k, x); }
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
  const margin = sum.cost > 0 ? (sum.gain / sum.cost) * 100 : 0;

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
          <span>Operaciones {signedMoney(sum.gain)}{gmf > 0 ? ` · 4x1000 −${money(gmf)}` : ""}</span>
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
              <span className="sub">Verde ganaste · rojo perdiste</span>
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
            <span className="sub">Cuánto te costó lo que vendiste, cuánto recibiste y cuánto ganaste</span>
          </div>
          <div className="actions">
            <div className="seg">
              {([["todas", "Todas"], ["gana", "Con ganancia"], ["pierde", "Con pérdida"]] as const).map(([k, l]) => (
                <button key={k} className={show === k ? "on" : ""} onClick={() => { setShow(k); setPage(0); }}>{l}</button>
              ))}
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
                    <th className="r" title="Ya con el 4x1000 que pagaste al comprar lo que vendiste">Te quedó</th>
                    <th className="r hide-sm">%</th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((o, i) => {
                    const k = bucketOf(dayOf(o.t), group);
                    const head = i === 0 || bucketOf(dayOf(slice[i - 1].t), group) !== k;
                    const g = bucketSum.get(k);
                    const pct = o.cost > 0 ? (o.net / (o.cost + o.fee)) * 100 : null;
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
                      <tr key={o.key}>
                        <td className="nowrap">{hourMin(o.t)}{group !== "dia" && <span className="cell-sub">{clean(F_SHORT.format(dateOf(dayOf(o.t))))}</span>}</td>
                        <td>
                          <span className="op-what">
                            <Badge kind={KIND_BADGE[o.kind]}>{KIND_LABEL[o.kind]}</Badge>
                            <Asset asset={o.asset} qty={qty(o.qty)} />
                            {o.kind === "permuta" && o.received && <span className="muted nowrap">→ {o.received}</span>}
                          </span>
                          {o.missing && <span className="cell-sub warn">Falta la compra: la ganancia puede salir más alta</span>}
                          {o.sources.length > 0 && <span className="cell-sub">{sourceText(o)}</span>}
                        </td>
                        <td className="r">{o.cost || o.fee ? money(o.cost + o.fee) : <span className="muted">—</span>}</td>
                        <td className="r hide-sm">{money(o.gross)}</td>
                        <td className="r"><b><Pnl v={o.net} /></b>
                          {o.gmf >= 1 && <span className="cell-sub">{signedMoney(o.gain)} − 4x1000 {money(o.gmf)}</span>}
                          {pct != null && <span className={`cell-sub show-sm ${tone(pct)}`}>{pct >= 0 ? "+" : "−"}{num(Math.abs(pct), 2)} %</span>}</td>
                        <td className={`r hide-sm ${pct == null ? "muted" : tone(pct)}`}>{pct == null ? "—" : `${pct >= 0 ? "+" : "−"}${num(Math.abs(pct), 2)} %`}</td>
                      </tr>,
                    ];
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={page} pages={pages} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { currentYear, date, dateTime, money, num, signedMoney, tone } from "@/lib/format";
import type { TabId } from "../App";
import { GmfQuestion } from "../GmfQuestion";
import { Asset, Badge, Coin, Empty, Note, Segmented, Skeleton } from "../ui";
import { useWallet } from "../wallet";
import { Gains } from "./Gains";

const MONTH = new Intl.DateTimeFormat("es-CO", { month: "long", timeZone: "UTC" });
const monthName = (i: number) => {
  const m = MONTH.format(new Date(Date.UTC(2026, i, 15)));
  return m.charAt(0).toUpperCase() + m.slice(1);
};

export type ResultsView = "resumen" | "rondas" | "operaciones";
const VIEWS: { id: ResultsView; label: string }[] = [
  { id: "resumen", label: "Resumen" },
  { id: "rondas", label: "Rondas de arbitraje" },
  { id: "operaciones", label: "Por operación" },
];

/** Resultados del año: estado de resultados, mes a mes, por moneda, rondas y cada operación. */
export function Results({ onTab, initialView = "resumen" }: { onTab: (t: TabId) => void; initialView?: ResultsView }) {
  const { report, reportError, year, me } = useWallet();
  const [view, setView] = useState<ResultsView>(initialView);
  useEffect(() => setView(initialView), [initialView]);

  if (reportError) return <Note kind="bad">{reportError}</Note>;
  if (!report) return <Skeleton rows={6} />;
  const s = report.summary;
  const b = report.books;
  const pnl = b.pnl;
  const live = year >= currentYear();
  const nowMonth = Number(new Intl.DateTimeFormat("en", { timeZone: "America/Bogota", month: "numeric" }).format(new Date())) - 1;
  const thisMonth = b.months[live ? nowMonth : 11];
  const first = b.months.findIndex((m) => m.ops > 0);
  const months = first < 0 ? [] : b.months.slice(first, (live ? nowMonth : 11) + 1).filter((m) => live || m.ops > 0);
  const ops = b.months.reduce((a, m) => a + m.ops, 0);
  const bought = b.months.reduce((a, m) => a + m.bought, 0);
  const sold = b.months.reduce((a, m) => a + m.sold, 0);
  const closedRounds = b.rounds.filter((r) => !r.open);
  const won = closedRounds.filter((r) => r.result > 0.5).length;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Resultados {year}</h1>
          <p>{live ? `Al ${date(Date.now() / 1000)}. Cuánto has ganado o perdido y de dónde sale.` : "Cuánto ganaste o perdiste en el año y de dónde salió."}</p>
        </div>
        <Segmented value={view} onChange={setView} label="Vista" options={VIEWS.map((v) => [v.id, v.label] as const)} />
      </div>

      {view !== "operaciones" && <GmfQuestion operations={pnl.gross_profit + pnl.income} gmf={pnl.gmf} onSettings={() => onTab("ajustes")} />}

      {me.movements === 0 ? (
        <div className="card"><Empty icon="trend" title="Todavía no hay movimientos">Conecta tu Binance en Inicio y todo aparece solo.</Empty></div>
      ) : view === "operaciones" ? (
        <Gains embedded />
      ) : view === "rondas" ? (
        <>
          <div className="kpis kpis-3">
            <div className="kpi accent"><small>Rondas cerradas</small><b>{num(closedRounds.length)}</b><span>{won} con ganancia · {closedRounds.length - won} con pérdida</span></div>
            <div className="kpi"><small>Antes del 4x1000</small><b className={tone(closedRounds.reduce((a, r) => a + r.result_before_gmf, 0))}>{signedMoney(closedRounds.reduce((a, r) => a + r.result_before_gmf, 0))}</b><span>Lo que dejó el arbitraje</span></div>
            <div className="kpi"><small>Después del 4x1000</small><b className={tone(closedRounds.reduce((a, r) => a + r.result, 0))}>{signedMoney(closedRounds.reduce((a, r) => a + r.result, 0))}</b><span>4x1000 {money(closedRounds.reduce((a, r) => a + r.gmf, 0))}</span></div>
          </div>
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Rondas de arbitraje</h2>
                <p className="sub">Cada vuelta de pesos a cripto y de vuelta a pesos, con lo que de verdad ganaste</p>
              </div>
            </div>
            {!b.rounds.length ? <Empty icon="trend" title={`Sin rondas en ${year}`} /> : (
              <div className="table-wrap">
                <table className="t">
                  <thead>
                    <tr><th>Ronda</th><th>Ruta</th><th className="r">Pagaste</th><th className="r">Recibiste</th><th className="r hide-sm">Antes del 4x1000</th><th className="r hide-sm">4x1000</th><th className="r">Resultado</th></tr>
                  </thead>
                  <tbody>
                    {b.rounds.slice().reverse().map((r) => (
                      <tr key={r.start}>
                        <td className="nowrap">{dateTime(r.start)}<span className="cell-sub">{r.ops} operaciones{r.end !== r.start ? ` · hasta ${dateTime(r.end).split(", ")[1] ?? ""}` : ""}</span></td>
                        <td><span className="route">{["COP", ...r.assets, ...(r.open ? [] : ["COP"])].map((a, i) => <Coin key={i} asset={a} size={18} />)}</span></td>
                        <td className="r">{money(r.paid)}</td>
                        <td className="r">{r.open ? <span className="muted">—</span> : money(r.received)}</td>
                        <td className={`r hide-sm ${r.open ? "" : tone(r.result_before_gmf)}`}>{r.open ? "" : signedMoney(r.result_before_gmf)}</td>
                        <td className="r hide-sm">{money(r.gmf)}</td>
                        <td className={`r ${r.open ? "" : tone(r.result)}`}>{r.open ? <Badge kind="info">En curso</Badge> : <b>{signedMoney(r.result)}</b>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi accent">
              <small>Resultado {live ? "del año hasta hoy" : `de ${year}`}</small>
              <b className={tone(pnl.net)}>{signedMoney(pnl.net)}</b>
              <span>Operaciones {signedMoney(pnl.gross_profit + pnl.income)}{pnl.gmf > 0 ? ` · 4x1000 −${money(pnl.gmf)}` : ""}</span>
            </div>
            <div className="kpi">
              <small>{live ? `Resultado de ${monthName(nowMonth).toLowerCase()}` : "Operaciones del año"}</small>
              {live ? <b className={tone(thisMonth.net)}>{signedMoney(thisMonth.net)}</b> : <b>{num(ops)}</b>}
              <span>{live ? `${num(thisMonth.ops)} operaciones este mes` : "Compras, ventas y cambios"}</span>
            </div>
            <div className="kpi">
              <small>Compraste en el año</small>
              <b>{money(bought)}</b>
              <span>Vendiste {money(sold)}</span>
            </div>
            <div className="kpi">
              <small>Gastos del negocio</small>
              <b>{money(pnl.expenses)}</b>
              <span>Internet, celular, banco, contador</span>
            </div>
          </div>

          {report.warnings_total > 0 && (
            <Note kind="warn">
              <b>{report.warnings_total} {report.warnings_total === 1 ? "venta no tiene" : "ventas no tienen"} su compra.</b> Sin ella el resultado sale más alto de lo real.{" "}
              <button className="link" onClick={() => setView("operaciones")}>Ver cuáles</button>
            </Note>
          )}

          <div className="grid-2">
            <div className="card card-pad">
              <h2 style={{ marginBottom: 8 }}>Estado de resultados</h2>
              <div className="lines">
                <div className="line"><span>Ventas y cambios de cripto<span className="cell-sub">Cambiar una cripto por otra cuenta como venta (DIAN)</span></span><span className="num">{money(pnl.sales)}</span></div>
                <div className="line"><span>− Lo que te había costado
                  {!!pnl.buy_fees && <span className="cell-sub">Incluye {money(pnl.buy_fees)} de comisiones de Binance en tus compras</span>}</span>
                  <span className="num">{money(pnl.cost)}</span></div>
                {pnl.fees > 0 && <div className="line"><span>− Comisiones de venta</span><span className="num">{money(pnl.fees)}</span></div>}
                <div className="line total"><span>Ganancia en operaciones</span><span className={`num ${tone(pnl.gross_profit)}`}>{signedMoney(pnl.gross_profit)}</span></div>
                {pnl.income > 0 && <div className="line"><span>+ Ganancias de Earn y staking</span><span className="num up">{money(pnl.income)}</span></div>}
                <div className="line">
                  <span>− 4x1000
                    <span className="cell-sub">
                      {me.profile.gmf_mode === "exenta" ? "Tu cuenta es exenta: no pagas 4x1000"
                        : me.profile.gmf_mode === "tope350" ? "Solo lo que pasa de 350 UVT al mes"
                        : "$4.000 por cada $1.000.000 que pagaste comprando"}
                      {" · "}<button className="link" onClick={() => onTab("ajustes")}>cambiar</button>
                    </span>
                  </span>
                  <span className="num">{money(pnl.gmf)}</span>
                </div>
                {pnl.expenses > 0 && <div className="line"><span>− Gastos del negocio</span><span className="num">{money(pnl.expenses)}</span></div>}
                <div className="line total"><span>Resultado neto</span><span className={`num ${tone(pnl.net)}`}>{signedMoney(pnl.net)}</span></div>
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h2>Por moneda</h2></div>
              {!b.assets.length ? <Empty icon="wallet" title="Sin monedas este año" /> : (
                <div className="table-wrap">
                  <table className="t">
                    <thead><tr><th>Cripto</th><th className="r">Compraste</th><th className="r">Vendiste</th><th className="r">Resultado</th><th className="r">Tienes</th></tr></thead>
                    <tbody>
                      {b.assets.map((a) => (
                        <tr key={a.asset}>
                          <td><Asset asset={a.asset} /></td>
                          <td className="r">{money(a.bought)}</td>
                          <td className="r">{money(a.sold)}</td>
                          <td className={`r ${tone(a.gain + a.income)}`}>{signedMoney(a.gain + a.income)}</td>
                          <td className="r">{a.hold_qty > 0 ? <>{money(a.hold_cost)}<span className="cell-sub">{num(a.hold_qty, a.hold_qty < 1 ? 6 : 2)} {a.asset}</span></> : <span className="muted">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Mes a mes</h2>
              <span className="sub">Verde gana · rojo pierde</span>
            </div>
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr><th>Mes</th><th className="r">Compras</th><th className="r">Ventas</th><th className="r hide-sm">Operaciones</th><th className="r hide-sm">4x1000</th><th className="r hide-sm">Gastos</th><th className="r">Resultado</th></tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m.month}>
                      <td>{monthName(m.month - 1)}</td>
                      <td className="r">{money(m.bought)}</td>
                      <td className="r">{money(m.sold)}</td>
                      <td className="r hide-sm">{num(m.ops)}</td>
                      <td className="r hide-sm">{money(m.gmf)}</td>
                      <td className="r hide-sm">{money(m.expenses)}</td>
                      <td className={`r ${tone(m.net)}`}><b>{signedMoney(m.net)}</b></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total {year}</td>
                    <td className="r">{money(bought)}</td>
                    <td className="r">{money(sold)}</td>
                    <td className="r hide-sm">{num(ops)}</td>
                    <td className="r hide-sm">{money(pnl.gmf)}</td>
                    <td className="r hide-sm">{money(pnl.expenses)}</td>
                    <td className={`r ${tone(pnl.net)}`}>{signedMoney(pnl.net)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <p className="small-print">Patrimonio fiscal al cierre: {money(s.patrimony)} (lo que pagaste por las cripto que tienes).</p>
        </>
      )}
    </div>
  );
}

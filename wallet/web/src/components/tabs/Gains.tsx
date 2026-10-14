"use client";

import { useEffect, useMemo, useState } from "react";
import type { Disposal } from "@/lib/api";
import { currentYear, date, KIND_LABEL, money, num, qty, signedMoney, tone } from "@/lib/format";
import { Asset, Badge, Empty, Icon, Note, Pager, Pnl, Segmented, Skeleton } from "../ui";
import { useWallet } from "../wallet";
import { KIND_BADGE } from "./Movements";

const PAGE = 100;
type Filter = "todas" | "gana" | "pierde" | "sin";

function holding(d: Disposal) {
  if (d.missing >= d.qty - 1e-12) return "—";
  const a = Math.floor(d.days_min), b = Math.floor(d.days_max);
  const f = (n: number) => (n === 0 ? "mismo día" : n === 1 ? "1 día" : `${num(n)} días`);
  return a === b ? f(a) : `${f(a)} – ${f(b)}`.replace("mismo día – ", "0 – ");
}

function classBadge(d: Disposal) {
  if (d.go_share >= 0.999) return <Badge kind="info">Ganancia ocasional</Badge>;
  if (d.go_share <= 0.001) return <Badge>Renta ordinaria</Badge>;
  return <Badge kind="info">Mixta</Badge>;
}

export function Gains({ embedded }: { embedded?: boolean }) {
  const { report, reportError, year } = useWallet();
  const [filter, setFilter] = useState<Filter>("todas");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [filter, year]);

  const rows = useMemo(() => {
    const d = (report?.disposals ?? []).slice().reverse();
    if (filter === "gana") return d.filter((x) => Math.round(x.gain) > 0);
    if (filter === "pierde") return d.filter((x) => Math.round(x.gain) < 0);
    if (filter === "sin") return d.filter((x) => x.missing > 1e-9);
    return d;
  }, [report, filter]);

  if (reportError) return <Note kind="bad">{reportError}</Note>;
  if (!report) return <Skeleton rows={5} />;
  const s = report.summary;
  const gross = s.ro.gross + s.go.gross;
  const costs = s.ro.costs + s.go.costs;
  const income = s.ro.income + s.go.airdrops;
  const total = rows.reduce((a, x) => ({ gross: a.gross + x.gross, cost: a.cost + x.cost + x.fee, gain: a.gain + x.gain }), { gross: 0, cost: 0, gain: 0 });
  const pages = Math.ceil(rows.length / PAGE);

  return (
    <div className="stack">
      {embedded ? (
        <div className="actions" style={{ justifyContent: "space-between" }}>
          <p className="muted" style={{ fontSize: 13.5 }}>Cada vez que vendiste o cambiaste cripto: lo que recibiste menos lo que te había costado.</p>
          <a className="btn btn-sm" href={`/api/export/ganancias.csv?year=${year}`} download><Icon name="download" size={14} /> CSV</a>
        </div>
      ) : (
        <div className="page-head">
          <div>
            <h1>Ganancias {year}{year >= currentYear() ? " hasta hoy" : ""}</h1>
            <p>Cada vez que vendiste o cambiaste cripto: lo que recibiste menos lo que te había costado.</p>
          </div>
          <a className="btn" href={`/api/export/ganancias.csv?year=${year}`} download><Icon name="download" size={16} /> Exportar CSV</a>
        </div>
      )}

      <div className="kpis">
        <div className="kpi"><small>Recibiste</small><b>{money(gross)}</b><span>{report.disposals.length} ventas y cambios</span></div>
        <div className="kpi"><small>Te había costado</small><b>{money(costs)}</b><span>Incluye comisiones</span></div>
        <div className="kpi accent"><small>{gross - costs < 0 ? "Perdiste" : "Ganaste"}</small><b className={tone(gross - costs)}>{signedMoney(gross - costs)}</b><span>Antes del 4x1000</span></div>
        <div className="kpi"><small>Ganancias de Earn</small><b className={tone(income)}>{signedMoney(income)}</b><span>Earn, staking y airdrops</span></div>
      </div>

      <div className="card">
        <div className="card-head">
          <Segmented value={filter} onChange={setFilter} label="Filtro"
            options={[["todas", "Todas"], ["gana", "Con ganancia"], ["pierde", "Con pérdida"], ["sin", `Sin costo (${report.warnings_total})`]] as const} />
          <span className="sub">Verde gana · rojo pierde</span>
        </div>
        {!rows.length ? (
          <Empty icon="trend" title={report.disposals.length ? "Nada con ese filtro" : `Sin ventas ni permutas en ${year}`}>
            {!report.disposals.length && "Cuando vendas o cambies cripto, aparece aquí con su ganancia."}
          </Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Operación</th>
                    <th className="r">Recibiste</th>
                    <th className="r">Te costó</th>
                    <th className="r">Ganancia</th>
                    {!report.profile.habitual && <th className="hide-sm">Se declara como</th>}
                    <th className="r hide-sm">Tenencia</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(page * PAGE, page * PAGE + PAGE).map((d) => (
                    <tr key={`${d.id}-${d.t}`}>
                      <td className="nowrap">{date(d.t)}</td>
                      <td>
                        <span className="actions" style={{ gap: 8, flexWrap: "nowrap" }}>
                          <Badge kind={KIND_BADGE[d.kind]}>{KIND_LABEL[d.kind]}</Badge>
                          <Asset asset={d.asset} qty={qty(d.qty)} />
                          {d.kind === "permuta" && d.received && <span className="muted nowrap">→ {d.received}</span>}
                        </span>
                        {d.missing > 1e-9 && <span className="cell-sub warn">Sin compra registrada para {qty(d.missing)} {d.asset}</span>}
                      </td>
                      <td className="r">{money(d.gross)}{d.fee > 0 && <span className="cell-sub">comisión {money(d.fee)}</span>}</td>
                      <td className="r">{money(d.cost)}</td>
                      <td className="r"><Pnl v={d.gain} /></td>
                      {!report.profile.habitual && <td className="hide-sm">{classBadge(d)}</td>}
                      <td className="r hide-sm muted">{holding(d)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total {filter !== "todas" && "filtrado"}</td>
                    <td className="r">{money(total.gross)}</td>
                    <td className="r">{money(total.cost)}</td>
                    <td className="r"><Pnl v={total.gain} /></td>
                    <td className="hide-sm" colSpan={report.profile.habitual ? 1 : 2} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <Pager page={page} pages={pages} onPage={setPage} />
          </>
        )}
      </div>

      {report.incomes.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Ingresos recibidos en cripto</h2>
            <span className="sub">Se declaran por su valor el día que los recibiste</span>
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Cripto</th><th className="r">Valor en pesos</th><th className="hide-sm">Se declara como</th></tr></thead>
              <tbody>
                {report.incomes.slice().reverse().map((x) => (
                  <tr key={x.id}>
                    <td className="nowrap">{date(x.t)}</td>
                    <td><Badge kind={KIND_BADGE[x.kind]}>{KIND_LABEL[x.kind]}</Badge></td>
                    <td><Asset asset={x.asset} qty={qty(x.qty)} /></td>
                    <td className="r"><Pnl v={x.value} /></td>
                    <td className="hide-sm">{x.kind === "airdrop" ? "Ganancia ocasional" : "Renta ordinaria"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Note>
        <b>Cambiar una cripto por otra cuenta como venta.</b> Por ejemplo, pasar USDT a BTC: la DIAN lo toma como si vendieras los
        USDT a su precio de ese día. Por eso aparece aunque no hayas pasado a pesos.
      </Note>
    </div>
  );
}

"use client";

import { Fragment, useState } from "react";
import type { BalanceSheet, CashBook, CashFlow, EquityChanges, FsNote, IncomeStatement, InventoryBook, JournalEntry, Trial } from "@/lib/api";
import { date, dateTime, money, num, signedMoney, tone } from "@/lib/format";
import { Badge, Empty, Icon } from "./ui";

function Row({ code, name, value, strong, signed }: { code?: string; name: string; value: number; strong?: boolean; signed?: boolean }) {
  return (
    <div className={`line ${strong ? "total" : ""}`}>
      <span>{code && <span className="acc">{code}</span>}{name}</span>
      <span className={`num ${signed ? tone(value) : ""}`}>{signed ? signedMoney(value) : money(value)}</span>
    </div>
  );
}

/** Estado de situación financiera (balance general). */
export function BalanceView({ b }: { b: BalanceSheet }) {
  const bank = b.assets.find((a) => a.account === "1110");
  return (
    <div className="stack">
      <div className="grid-2">
        <div className="card card-pad">
          <h3 className="st-title">Activo</h3>
          <div className="lines">
            {b.assets.filter((a) => Math.abs(a.value) > 0.5 || a.account === "1110").map((a) => <Row key={a.account} code={a.account} name={a.name} value={a.value} />)}
            <Row name="Total activo" value={b.total_assets} strong />
          </div>
        </div>
        <div className="card card-pad">
          <h3 className="st-title">Pasivo</h3>
          <div className="lines">
            {b.liabilities.filter((x) => Math.abs(x.value) > 0.5).map((x) => <Row key={x.account} code={x.account} name={x.name} value={x.value} />)}
            <Row name="Total pasivo" value={b.total_liabilities} strong />
          </div>
          <h3 className="st-title" style={{ marginTop: 18 }}>Patrimonio</h3>
          <div className="lines">
            {b.equity.map((e) => <Row key={e.account} code={e.account} name={e.name} value={e.value} signed={e.account !== "3105"} />)}
            <Row name="Total patrimonio" value={b.total_equity} strong signed />
            <Row name="Total pasivo y patrimonio" value={b.total_liabilities + b.total_equity} strong />
          </div>
        </div>
      </div>
      <div className="st-check">
        {b.balanced ? <Badge kind="good"><Icon name="check" size={13} /> Cuadra: activo = pasivo + patrimonio</Badge>
          : <Badge kind="bad">No cuadra</Badge>}
        <span className="muted">Al {dateTime(b.at)}</span>
      </div>
      {bank && bank.value < -0.5 && (
        <div className="note-box warn">
          <Icon name="alert" size={16} />
          <div><b>Bancos en negativo.</b> Tus libros no saben con cuánto dinero empezaste. El cierre automático del mes lo registra como aporte; si sabes tu saldo real, cuádralo antes en <b>Cierres</b>.</div>
        </div>
      )}
    </div>
  );
}

/** Estado de resultados del periodo, en el orden del PUC con sus subtotales. */
export function IncomeView({ i, label }: { i: IncomeStatement; label?: string }) {
  return (
    <div className="card card-pad">
      {label && <h3 className="st-title">{label}</h3>}
      <div className="lines">
        {i.layout.map((x, k) => x.kind === "section" ? <div key={k} className="line section"><span>{x.label}</span></div>
          : x.kind === "line" ? <Row key={k} code={x.account} name={x.label} value={x.value ?? 0} />
          : <div key={k} className={`line ${x.kind === "total" ? "subtotal" : "total"}`}>
              <span>{x.label}</span><span className={`num ${x.kind !== "total" ? tone(x.value ?? 0) : ""}`}>{x.kind !== "total" ? signedMoney(x.value ?? 0) : money(x.value ?? 0)}</span>
            </div>)}
      </div>
    </div>
  );
}

/** Estado de cambios en el patrimonio: cada cuenta en una columna, de saldo inicial a saldo final. */
export function EquityView({ e }: { e: EquityChanges }) {
  return (
    <div className="stack">
      <div className="card">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr><th>Concepto</th>{e.columns.map((c) => <th key={c.account} className="r"><span className="acc">{c.account}</span>{c.name}</th>)}<th className="r">Total</th></tr>
            </thead>
            <tbody>
              {e.rows.map((r) => (
                <tr key={r.key} className={r.key === "opening" || r.key === "closing" ? "strong-row" : ""}>
                  <td>{r.label}</td>
                  {e.columns.map((c) => <td key={c.account} className="r">{Math.abs(r.values[c.account]) < 0.5 ? "—" : signedMoney(r.values[c.account])}</td>)}
                  <td className="r"><b>{signedMoney(r.total)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="st-check">
        {e.balanced ? <Badge kind="good"><Icon name="check" size={13} /> El saldo final es el patrimonio del balance</Badge> : <Badge kind="bad">No cuadra con el balance</Badge>}
      </div>
    </div>
  );
}

/** Estado de flujos de efectivo por el método directo. */
export function CashFlowView({ f }: { f: CashFlow }) {
  return (
    <div className="card card-pad">
      <div className="lines">
        <Row name="Efectivo al inicio del periodo" value={f.opening} strong />
        {f.sections.map((s) => (
          <Fragment key={s.id}>
            <div className="line section"><span>{s.label}</span></div>
            {s.lines.length ? s.lines.map((ln) => <Row key={ln.label} name={ln.label} value={ln.value} signed />)
              : <div className="line"><span className="muted">Sin movimientos</span><span /></div>}
            <div className="line subtotal"><span>Efectivo neto de {s.label.toLowerCase()}</span><span className={`num ${tone(s.total)}`}>{signedMoney(s.total)}</span></div>
          </Fragment>
        ))}
        <Row name="Aumento (disminución) neto del efectivo" value={f.net} strong signed />
        <Row name="Efectivo al final del periodo" value={f.closing} strong />
      </div>
    </div>
  );
}

/** Libro de inventarios y balances: el balance al corte con cada cripto en detalle. */
export function InventoryView({ inv }: { inv: InventoryBook }) {
  const b = inv.balance;
  const q = (v: number) => num(v, 8).replace(/,?0+$/, "");
  const block = (title: string, items: { account: string; name: string; value: number }[], total: number, totalLabel: string, detail = false) => (
    <>
      <tr className="section-row"><td colSpan={6}>{title}</td></tr>
      {items.map((x) => (
        <Fragment key={x.account}>
          <tr><td><span className="acc">{x.account}</span></td><td>{x.name}</td><td /><td /><td className="r">{money(x.value)}</td><td /></tr>
          {detail && x.account === inv.account && inv.cryptos.map((k) => (
            <tr key={k.asset} className="cash-entry">
              <td /><td>{k.asset}<span className="cell-sub">Desde {date(k.since)}</span></td>
              <td className="r">{q(k.qty)}</td><td className="r">{money(k.unit)}</td><td className="r">{money(k.cost)}</td>
              <td className="r">{k.market == null ? "—" : money(k.market)}{k.market != null && <span className={`cell-sub ${tone(k.market - k.cost)}`}>{signedMoney(k.market - k.cost)}</span>}</td>
            </tr>
          ))}
        </Fragment>
      ))}
      <tr className="strong-row"><td /><td>{totalLabel}</td><td /><td /><td className="r">{money(total)}</td><td /></tr>
    </>
  );
  return (
    <div className="stack">
      <div className="card">
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Cuenta</th><th>Nombre</th><th className="r">Cantidad</th><th className="r">Costo unitario</th><th className="r">Valor en libros</th><th className="r">Valor de mercado</th></tr></thead>
            <tbody>
              {block("Activo", b.assets, b.total_assets, "Total activo", true)}
              {block("Pasivo", b.liabilities, b.total_liabilities, "Total pasivo")}
              {block("Patrimonio", b.equity, b.total_equity, "Total patrimonio")}
              <tr className="strong-row"><td /><td>Total pasivo y patrimonio</td><td /><td /><td className="r">{money(b.total_liabilities + b.total_equity)}</td><td /></tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="small-print">
        Corte al {dateTime(inv.at)}. Las cripto van al costo, una por una{inv.cryptos.length ? "" : " (hoy no tienes ninguna)"}. El valor de mercado es informativo:
        precio de Binance × TRM al corte; no se registra en los libros.
      </p>
      <div className="sign-row print-only">
        <span>Contribuyente</span><span>Contador público · T.P.</span>
      </div>
    </div>
  );
}

/** Notas a los estados financieros, generadas con las cifras de los libros. */
export function NotesView({ notes }: { notes: FsNote[] }) {
  const cell = (head: string, v: string | number | null) =>
    v == null ? "—" : typeof v === "string" ? v : head === "Cantidad" ? num(v, 8).replace(/,?0+$/, "") : head === "Operaciones" ? String(v) : money(v);
  return (
    <div className="stack">
      {notes.map((n) => (
        <div key={n.n} className="card card-pad fs-note">
          <h3 className="st-title">Nota {n.n}. {n.title}</h3>
          {n.text.map((p, i) => <p key={i}>{p}</p>)}
          {n.table && n.table.rows.length > 0 && (
            <div className="table-wrap">
              <table className="t">
                <thead><tr>{n.table.head.map((h, i) => <th key={h} className={i ? "r" : ""}>{h}</th>)}</tr></thead>
                <tbody>{n.table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={j ? "r" : ""}>{cell(n.table!.head[j], v)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Mayor y balances (balance de prueba). */
export function TrialView({ t }: { t: Trial }) {
  return (
    <div className="card">
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr><th>Cuenta</th><th>Nombre</th><th className="r">Saldo anterior</th><th className="r">Débitos</th><th className="r">Créditos</th><th className="r">Saldo final</th></tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r.account}>
                <td><span className="acc">{r.account}</span></td>
                <td>{r.name}</td>
                <td className="r">{money(r.previous)}</td>
                <td className="r">{money(r.debit)}</td>
                <td className="r">{money(r.credit)}</td>
                <td className="r"><b>{money(r.final)}</b></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Totales {t.totals.balanced ? <Badge kind="good">Débitos = créditos</Badge> : <Badge kind="bad">No cuadra</Badge>}</td>
              <td className="r">{money(t.totals.debit)}</td>
              <td className="r">{money(t.totals.credit)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

const DAY_STATUS = {
  abierto: <Badge>Abierto · hoy</Badge>,
  cerrado: <Badge kind="good"><Icon name="check" size={12} /> Cerrado</Badge>,
  congelado: <Badge kind="info"><Icon name="lock" size={12} /> Congelado</Badge>,
};
const dayLabel = (d: string) => date(new Date(`${d}T12:00:00-05:00`).getTime() / 1000);
const hour = (t: number) => new Date(t * 1000).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" });

/** Libro de caja y bancos: un cierre automático por cada día con movimiento en la cuenta 1110. */
export function CashBookView({ b, label }: { b: CashBook; label: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const all = open.size === b.days.length && b.days.length > 0;
  const toggle = (day: string) => setOpen((s) => { const n = new Set(s); if (n.has(day)) n.delete(day); else n.add(day); return n; });
  const gmf = b.totals.gmf;
  return (
    <div className="stack">
      <div className="ledger-sum ledger-sum-4">
        <div><small>Saldo inicial</small><b>{money(b.opening)}</b><span>Al empezar {label.toLowerCase()}</span></div>
        <div className="in"><small>Entradas</small><b>{money(b.totals.in)}</b><span>Ventas y aportes</span></div>
        <div className="out"><small>Salidas</small><b>{money(b.totals.out + gmf)}</b><span>{gmf ? `Incluye 4x1000 ${money(gmf)}` : "Compras, gastos y retiros"}</span></div>
        <div><small>Saldo final</small><b className={b.closing < 0 ? "warn" : ""}>{money(b.closing)}</b><span>Cuenta 1110 Bancos</span></div>
      </div>
      {!b.days.length ? (
        <div className="card"><Empty icon="bank" title={`Sin movimientos de caja en ${label.toLowerCase()}`}>Cada día con compras, ventas, gastos o aportes se cierra solo.</Empty></div>
      ) : (
        <div className="card">
          <div className="card-head no-print">
            <h2>{b.days.length} cierres diarios</h2>
            <button className="btn btn-sm btn-ghost" onClick={() => setOpen(all ? new Set() : new Set(b.days.map((d) => d.day)))}>
              {all ? "Ocultar comprobantes" : "Ver todos los comprobantes"}
            </button>
          </div>
          <div className="table-wrap">
            <table className="t cash-book">
              <thead>
                <tr><th>Día</th><th className="r">Saldo inicial</th><th className="r">Entradas</th><th className="r">Salidas</th><th className="r">4x1000</th><th className="r">Saldo final</th><th>Cierre</th></tr>
              </thead>
              <tbody>
                {b.days.map((d) => (
                  <Fragment key={d.day}>
                    <tr className="cash-day" onClick={() => toggle(d.day)} aria-expanded={open.has(d.day)}>
                      <td className="nowrap"><b>{dayLabel(d.day)}</b><span className="cell-sub">{d.entries.length} comprobantes{d.real != null ? ` · real ${money(d.real)}` : ""}</span></td>
                      <td className="r">{money(d.opening)}</td>
                      <td className="r up">{d.in ? money(d.in) : ""}</td>
                      <td className="r down">{d.out ? money(d.out) : ""}</td>
                      <td className="r">{d.gmf ? money(d.gmf) : ""}</td>
                      <td className="r"><b className={d.closing < 0 ? "warn" : ""}>{money(d.closing)}</b></td>
                      <td>{DAY_STATUS[d.status]}</td>
                    </tr>
                    {open.has(d.day) && d.entries.map((e) => (
                      <tr key={e.number} className="cash-entry">
                        <td className="nowrap mono">{e.number} · {hour(e.t)}</td>
                        <td>{e.text}</td>
                        <td className="r">{e.in ? money(e.in) : ""}</td>
                        <td className="r">{e.out ? money(e.out) : ""}</td>
                        <td className="r">{e.gmf ? money(e.gmf) : ""}</td>
                        <td className="r">{money(e.balance)}</td>
                        <td />
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Totales</td>
                  <td className="r">{money(b.totals.in)}</td><td className="r">{money(b.totals.out)}</td><td className="r">{money(gmf)}</td>
                  <td className="r">{money(b.closing)}</td><td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
      <p className="small-print">
        Cada día con movimiento en tus cuentas se cierra solo a medianoche: saldo inicial + entradas − salidas − 4x1000 = saldo final.
        Queda congelado con el cierre automático del mes. Toca un día para ver sus comprobantes.
      </p>
    </div>
  );
}

/** Libro diario: un comprobante por operación. */
export function JournalView({ entries, lock, onDeleteNote }: { entries: JournalEntry[]; lock: number; onDeleteNote?: (id: number) => void }) {
  return (
    <div className="card">
      <div className="table-wrap">
        <table className="t journal">
          <thead>
            <tr><th>Comprobante</th><th>Fecha</th><th>Detalle</th><th>Cuenta</th><th className="r">Débito</th><th className="r">Crédito</th></tr>
          </thead>
          <tbody>
            {entries.flatMap((e) => e.lines.map((l, i) => (
              <tr key={`${e.number}-${i}`} className={i === 0 ? "first" : "cont"}>
                <td className="nowrap">{i === 0 && <>{e.number}{e.t <= lock && <span title="Periodo cerrado" className="lock-ic"><Icon name="lock" size={12} /></span>}</>}</td>
                <td className="nowrap">{i === 0 && date(e.t)}</td>
                <td>{i === 0 && <>
                  {e.kind === "nota" && <Badge kind="info">Nota</Badge>} {e.text}
                  {e.support && <span className="cell-sub">Soporte: {e.support}</span>}
                  {e.kind === "nota" && e.ref != null && e.t > lock && onDeleteNote && (
                    <button className="btn btn-sm btn-ghost no-print" onClick={() => onDeleteNote(e.ref!)}><Icon name="trash" size={12} /> Borrar</button>
                  )}
                </>}</td>
                <td><span className="acc">{l.account}</span>{l.name}</td>
                <td className="r">{l.debit ? money(l.debit) : ""}</td>
                <td className="r">{l.credit ? money(l.credit) : ""}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

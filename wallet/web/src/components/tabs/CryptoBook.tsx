"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type Movement } from "@/lib/api";
import { cashValue, dayNum, hourMin, KIND_LABEL, money, num, signedMoney, tone } from "@/lib/format";
import { methodName } from "../GmfChoice";
import { Badge, Coin, Empty, Icon, Note, Pager, Skeleton } from "../ui";
import { useWallet } from "../wallet";
import { KIND_BADGE } from "./Movements";

interface KRow {
  t: number;
  kind: string;
  id: number;
  ref: string;
  text: string;
  in_qty?: number;
  in_unit?: number;
  in_cost?: number;
  out_qty?: number;
  out_unit?: number;
  out_cost?: number;
  sale?: number;
  /** comisión de Binance en pesos (en compras ya va dentro del costo) */
  fee?: number;
  fee_qty?: number;
  fee_asset?: string;
  /** 4x1000 de esa compra: gasto aparte */
  gmf?: number;
  gain?: number;
  bal_qty: number;
  bal_cost: number;
  missing?: number;
}
interface KAsset {
  asset: string;
  rows: KRow[];
  opening: { qty: number; cost: number };
  closing: { qty: number; cost: number };
  totals: { in_qty: number; in_cost: number; out_qty: number; out_cost: number; sales: number; gain: number; fees?: number; gmf?: number; fee_qty?: number };
}
interface KBook { year: number; method: "fifo" | "promedio"; name: string; nit: string; username: string; assets: KAsset[] }

const q8 = (v: number) => (Math.abs(v) < 1e-12 ? "0" : num(v, Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 1 ? 4 : 8));
const blank = (v: number | undefined, f: (n: number) => string) => (v == null ? "" : f(v));
/** "P2P 22941584298392563712" → "P2P …92563712" (la completa va en el title y en el Excel) */
const shortRef = (r: string) => r.replace(/\d{11,}/, (d) => "…" + d.slice(-8));
const cryptoQty = (q: number) => num(q, 8).replace(/0+$/, "").replace(/,$/, "");

function When({ t }: { t: number }) {
  return <td className="c-date">{dayNum(t)}<span className="cell-sub">{hourMin(t)}</span></td>;
}

function Ref({ r }: { r?: string }) {
  return r ? <span className="cell-sub mono" title={r}>{shortRef(r)}</span> : null;
}

/** El botón principal de los libros: el Excel con todo explicado para cuadrar con la DIAN. */
export function ExcelButton({ small = false }: { small?: boolean }) {
  const { year } = useWallet();
  return (
    <a className={`btn btn-primary ${small ? "btn-sm" : ""}`} href={`/api/export/contabilidad.xlsx?year=${year}`} download
      title="Resumen explicado, casillas del formulario 210, kardex, operaciones, 4x1000, libros contables y comprobaciones">
      <Icon name="download" size={small ? 14 : 16} /> Excel para la DIAN
    </a>
  );
}

/** Comisión de Binance y 4x1000 de una compra, dichos en una línea. */
function Costs({ r, asset }: { r: KRow; asset: string }) {
  const parts: string[] = [];
  if (r.fee_qty && r.fee_qty > 0) parts.push(`Binance cobró ${cryptoQty(r.fee_qty)} ${r.fee_asset || asset}${r.fee ? ` (${money(r.fee)})` : ""}`);
  else if (r.fee && r.fee > 0) parts.push(`Comisión ${money(r.fee)}`);
  if (r.gmf && r.gmf > 0) parts.push(`4x1000 ${money(r.gmf)}`);
  return parts.length ? <>{parts.map((p) => <span key={p} className="cell-sub costs">{p}</span>)}</> : null;
}

/** Libro de criptoactivos: kardex por cripto con entradas, salidas y saldo corrido. */
export function Kardex() {
  const { year, version } = useWallet();
  const [book, setBook] = useState<KBook | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<string>("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/libro-cripto?year=${year}`, { credentials: "same-origin" })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "Error"); return d as KBook; })
      .then((d) => { if (alive) { setBook(d); setSel((s) => (d.assets.some((a) => a.asset === s) ? s : d.assets[0]?.asset ?? "")); } },
        (e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [year, version]);

  if (error) return <Note kind="bad">{error}</Note>;
  if (!book) return <Skeleton rows={4} />;
  const a = book.assets.find((x) => x.asset === sel);
  const method = book.method === "fifo" ? "PEPS (primero en entrar, primero en salir)" : "Promedio ponderado";

  return (
    <div className="stack">
      {!book.assets.length ? (
        <div className="card"><Empty icon="book" title={`Sin criptoactivos en ${year}`}>Cuando compres o recibas cripto, su kardex aparece aquí.</Empty></div>
      ) : (
        <>
          <div className="coin-tabs no-print" role="tablist" aria-label="Cripto">
            {book.assets.map((x) => (
              <button key={x.asset} role="tab" aria-selected={x.asset === sel} className={`coin-tab ${x.asset === sel ? "on" : ""}`} onClick={() => setSel(x.asset)}>
                <Coin asset={x.asset} size={22} />
                <span><b>{x.asset}</b><small>{x.rows.length} movimientos</small><small><span className={tone(x.totals.gain)}>{signedMoney(x.totals.gain)}</span></small></span>
              </button>
            ))}
          </div>

          {a && (
            <>
              <div className="ledger-sum">
                <div><small>Saldo inicial</small><b>{q8(a.opening.qty)} {a.asset}</b><span>{money(a.opening.cost)}</span></div>
                <div className="in"><small>Entradas</small><b>{q8(a.totals.in_qty)} {a.asset}</b><span>{money(a.totals.in_cost)}</span></div>
                <div className="out"><small>Salidas</small><b>{q8(a.totals.out_qty)} {a.asset}</b><span>{money(a.totals.out_cost)}</span></div>
                <div><small>Saldo final</small><b>{q8(a.closing.qty)} {a.asset}</b><span>{money(a.closing.cost)}</span></div>
                <div className="res"><small>Utilidad del año</small><b className={tone(a.totals.gain)}>{signedMoney(a.totals.gain)}</b><span>Ventas {money(a.totals.sales)}</span></div>
              </div>

              {(!!a.totals.fees || !!a.totals.gmf) && (
                <div className="cost-strip">
                  {!!a.totals.fees && (
                    <div>
                      <Icon name="wallet" size={16} />
                      <span><b>Comisiones de Binance: {money(a.totals.fees)}</b>{a.totals.fee_qty ? ` (${cryptoQty(a.totals.fee_qty)} ${a.asset})` : ""}
                        <small>Binance se queda un poco de cripto en cada orden. Ya está dentro del costo de la compra.</small></span>
                    </div>
                  )}
                  {!!a.totals.gmf && (
                    <div>
                      <Icon name="bank" size={16} />
                      <span><b>4x1000 de estas compras: {money(a.totals.gmf)}</b>
                        <small>No es costo de la cripto: es un gasto aparte. La mitad se resta en la declaración (casilla 84).</small></span>
                    </div>
                  )}
                </div>
              )}

              <div className="card ledger-card">
                <div className="ledger-title">
                  <Coin asset={a.asset} size={20} />
                  <b>{a.asset}</b>
                  <span className="muted">Método de costo: {method}</span>
                </div>
                <div className="table-wrap">
                  <table className="ledger">
                    <thead>
                      <tr>
                        <th rowSpan={2} className="c-n">N°</th>
                        <th rowSpan={2}>Fecha</th>
                        <th rowSpan={2}>Detalle</th>
                        <th colSpan={3} className="g-in">Entradas</th>
                        <th colSpan={3} className="g-out">Salidas</th>
                        <th colSpan={2} className="g-bal">Saldo</th>
                        <th colSpan={2} className="g-res">Resultado</th>
                      </tr>
                      <tr>
                        <th className="g-in r">Cantidad</th><th className="g-in r">Costo unit.</th><th className="g-in r">Costo total</th>
                        <th className="g-out r">Cantidad</th><th className="g-out r">Costo unit.</th><th className="g-out r">Costo total</th>
                        <th className="g-bal r">Cantidad</th><th className="g-bal r">Costo total</th>
                        <th className="g-res r">Valor venta</th><th className="g-res r">Utilidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.rows.map((r, i) => ({ r, i })).reverse().map(({ r, i }) => (
                        <tr key={i} className={r.out_qty != null ? "is-out" : "is-in"}>
                          <td className="c-n">{i + 1}</td>
                          <When t={r.t} />
                          <td className="c-text">{r.text}<Ref r={r.ref} /><Costs r={r} asset={a.asset} />{!!r.missing && r.missing > 1e-9 && <span className="cell-sub warn">Sin compra para {q8(r.missing)}</span>}</td>
                          <td className="r">{blank(r.in_qty, q8)}</td>
                          <td className="r">{blank(r.in_unit, money)}</td>
                          <td className="r">{blank(r.in_cost, money)}</td>
                          <td className="r">{blank(r.out_qty, q8)}</td>
                          <td className="r">{blank(r.out_unit, money)}</td>
                          <td className="r">{blank(r.out_cost, money)}</td>
                          <td className="r b">{q8(r.bal_qty)}</td>
                          <td className="r b">{money(r.bal_cost)}</td>
                          <td className="r">{r.out_qty != null && r.sale ? money(r.sale) : ""}</td>
                          <td className={`r ${r.gain != null && r.out_qty != null ? tone(r.gain) : ""}`}>{r.out_qty != null && r.gain != null ? signedMoney(r.gain) : ""}</td>
                        </tr>
                      ))}
                      <tr className="opening">
                        <td className="c-n" />
                        <td className="c-date">01/01/{year}</td>
                        <td><b>Saldo inicial</b></td>
                        <td colSpan={6} />
                        <td className="r">{q8(a.opening.qty)}</td>
                        <td className="r">{money(a.opening.cost)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="c-n" />
                        <td colSpan={2}>Totales y saldo final</td>
                        <td className="r">{q8(a.totals.in_qty)}</td><td /><td className="r">{money(a.totals.in_cost)}</td>
                        <td className="r">{q8(a.totals.out_qty)}</td><td /><td className="r">{money(a.totals.out_cost)}</td>
                        <td className="r">{q8(a.closing.qty)}</td><td className="r">{money(a.closing.cost)}</td>
                        <td className="r">{money(a.totals.sales)}</td>
                        <td className={`r ${tone(a.totals.gain)}`}>{signedMoney(a.totals.gain)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="ledger-foot">
                  Saldo inicial {money(a.opening.cost)} + entradas {money(a.totals.in_cost)} − salidas {money(a.totals.out_cost)} = saldo final {money(a.closing.cost)}
                  {Math.abs(a.opening.cost + a.totals.in_cost - a.totals.out_cost - a.closing.cost) < 1 ? <Badge kind="good"><Icon name="check" size={12} /> Cuadra</Badge> : <Badge kind="bad">No cuadra</Badge>}
                </div>
              </div>
              <p className="small-print">
                El costo de cada salida sale de los lotes por {method}. En un cambio entre cripto, el valor de venta es el valor comercial de ese día
                (Concepto DIAN 1621 de 2023). Utilidad = valor de venta − comisión − costo.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Lo que una operación movió en tus bancos: negativo si salió plata, positivo si entró. */
function bankEffect(m: Movement): number | null {
  if (m.kind === "compra") return -(cashValue(m) + m.gmf_cop);
  if (m.kind === "venta") return cashValue(m);
  if (m.kind === "gasto" || m.kind === "retiro") return -(m.cop_value + m.gmf_cop);
  if (m.kind === "aporte") return m.cop_value;
  return null;
}

/** Registro de operaciones: el libro auxiliar con todo lo que pasó, numerado. */
export function OpsRegister() {
  const { year, version, me } = useWallet();
  const [rows, setRows] = useState<Movement[] | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const PAGE = 50;

  useEffect(() => {
    let alive = true;
    api.movements(year).then((r) => alive && setRows(r.movements), (e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [year, version]);

  const numbered = useMemo(() => (rows ?? []).map((m, i) => ({ ...m, n: `OP-${year}-${String(i + 1).padStart(4, "0")}` })).reverse(), [rows, year]);

  if (error) return <Note kind="bad">{error}</Note>;
  if (!rows) return <Skeleton rows={4} />;
  const value = (m: Movement) => (m.kind === "compra" ? cashValue(m) : m.cop_value);
  const unit = (m: Movement) => {
    if (m.kind === "compra" && m.in_qty) return cashValue(m) / (m.in_qty + (m.fee_qty || 0));
    if ((m.kind === "venta" || m.kind === "permuta") && m.out_qty) return m.cop_value / m.out_qty;
    if ((m.kind === "ingreso" || m.kind === "airdrop") && m.in_qty) return m.cop_value / m.in_qty;
    return null;
  };
  const side = (a: string | null, q: number | null) => (!a ? <span className="muted">—</span> : a === "COP" ? money(q) : <span className="nowrap"><Coin asset={a} size={16} /> {q8(q ?? 0)} {a}</span>);
  const t = rows.reduce((s, m) => {
    const e = bankEffect(m) ?? 0;
    return { v: s.v + value(m), f: s.f + m.fee_cop, g: s.g + m.gmf_cop, out: s.out + Math.min(0, e), in: s.in + Math.max(0, e) };
  }, { v: 0, f: 0, g: 0, out: 0, in: 0 });

  return (
    <div className="stack">
      {!rows.length ?<div className="card"><Empty icon="list" title={`Sin operaciones en ${year}`} /></div> : (
        <>
          <div className="ledger-sum ledger-sum-4">
            <div className="out"><small>Salió de tus cuentas</small><b>{money(-t.out)}</b><span>Compras + 4x1000</span></div>
            <div className="in"><small>Entró a tus cuentas</small><b>{money(t.in)}</b><span>Ventas</span></div>
            <div><small>Comisiones de Binance</small><b>{money(t.f)}</b><span>Ya incluidas en lo pagado</span></div>
            <div className="res"><small>4x1000</small><b>{money(t.g)}</b><span>{me.profile.gmf_mode === "exenta" ? "Cuenta exenta" : "0,4 % de cada compra"}</span></div>
          </div>
          <div className="card ledger-card">
            <div className="table-wrap">
              <table className="ledger register">
                <thead>
                  <tr>
                    <th>N°</th><th>Fecha</th><th>Operación</th><th>Entregaste</th><th>Recibiste</th>
                    <th className="r">Valor</th><th className="r">Comisión<br />Binance</th><th className="r">4x1000</th><th className="r">En tus<br />bancos</th>
                  </tr>
                </thead>
                <tbody>
                  {numbered.slice(page * PAGE, page * PAGE + PAGE).map((m) => {
                    const u = unit(m);
                    const e = bankEffect(m);
                    return (
                      <tr key={m.id}>
                        <td className="c-n nowrap mono">{m.n}</td>
                        <When t={m.t} />
                        <td><Badge kind={KIND_BADGE[m.kind]}>{KIND_LABEL[m.kind]}</Badge>{m.ref ? <Ref r={m.ref} /> : <span className="cell-sub">{m.source === "manual" ? "Manual" : m.platform || m.note}</span>}
                          {m.pay_method && <span className="cell-sub" title={m.counterpart ? `Contraparte: ${m.counterpart}` : undefined}>{methodName(m.pay_method)}{m.counterpart ? ` · ${m.counterpart}` : ""}</span>}</td>
                        <td>{side(m.out_asset, m.out_qty)}</td>
                        <td>{side(m.in_asset, m.in_qty)}{m.kind === "compra" && !!m.fee_qty && <span className="cell-sub costs" title={`Pediste ${q8((m.in_qty ?? 0) + m.fee_qty)} ${m.in_asset}`}>Binance cobró {cryptoQty(m.fee_qty)} {m.fee_asset}</span>}</td>
                        <td className="r b">{money(value(m))}{u != null && <span className="cell-sub">a {money(u)} c/u</span>}</td>
                        <td className="r">{m.fee_cop ? money(m.fee_cop) : ""}</td>
                        <td className="r">{m.gmf_cop ? money(m.gmf_cop) : ""}</td>
                        <td className={`r b ${e != null ? tone(e) : ""}`} title={e == null ? "No pasa por tus bancos: se queda en Binance" : undefined}>{e != null ? signedMoney(e) : <span className="muted">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}>{rows.length} operaciones</td><td className="r">{money(t.v)}</td><td className="r">{money(t.f)}</td><td className="r">{money(t.g)}</td>
                    <td className={`r ${tone(t.in + t.out)}`}>{signedMoney(t.in + t.out)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <Pager page={page} pages={Math.ceil(numbered.length / PAGE)} onPage={setPage} />
          </div>
          <p className="small-print">
            Valor: en compras, lo que pagaste (incluye la comisión de Binance); en ventas, lo que vendiste; en cambios entre cripto, el valor comercial
            de ese momento. En tus bancos: la plata que de verdad salió o entró, con el 4x1000. Los cambios entre cripto no tocan tus bancos.
          </p>
        </>
      )}
    </div>
  );
}

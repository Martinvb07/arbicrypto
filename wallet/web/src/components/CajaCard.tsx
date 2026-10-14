"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type GastoCategory, type JornadaOp, type JornadaReport, type JornadaState, type JornadaSummary, type Kind } from "@/lib/api";
import { date, fromLocalInput, GASTO_LABEL, hourMin, money, parseNum, qty, signedMoney, toLocalInput, tone } from "@/lib/format";
import type { TabId } from "./App";
import { Select } from "./Select";
import { Field, Icon, Modal, Note, Segmented, Skeleton } from "./ui";
import { useWallet } from "./wallet";

const GMF = 0.004;
const ACCOUNTS = ["Nequi", "Daviplata", "Bancolombia", "Davivienda", "Banco de Bogotá", "Banco Popular", "BBVA", "Nu"];

/** Caja del día: la abres con lo que tienes en la cuenta, las compras y ventas de Binance se suman solas y al cerrarla
 *  queda el informe del día. Es tu control diario: no toca la contabilidad ni la declaración. */
export function CajaCard({ onTab: _onTab }: { onTab: (t: TabId) => void }) {
  const { version } = useWallet();
  const [st, setSt] = useState<JornadaState | null>(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"" | "in" | "out" | "close">("");
  const [report, setReport] = useState<JornadaReport | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api.jornada().then((d) => { if (alive) { setSt(d); setError(""); } }, (e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [version, tick]);
  useEffect(() => {  // con la caja abierta se refresca sola cada minuto (Binance se trae cada 5)
    if (!st?.open) return;
    const id = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, [st?.open]);

  if (error) return <div className="card card-pad"><Note kind="bad">{error}</Note></div>;
  if (!st) return <div className="card"><div className="card-body"><Skeleton rows={3} /></div></div>;
  const j = st.open;
  const view = async (id: number) => setReport((await api.jornadaVer(id)).report);

  return (
    <div className="card">
      {j ? <OpenDay j={j} onModal={setModal} /> : <OpenForm suggest={st.suggest} />}
      {st.history.length > 0 && <History items={st.history} onView={(id) => void view(id)} />}
      {modal === "in" || modal === "out" ? <CashMoveModal dir={modal} account={j?.account ?? st.suggest.account} onClose={() => setModal("")} /> : null}
      {modal === "close" && j && <CloseModal j={j} onClose={() => setModal("")} onDone={(r) => { setModal(""); setReport(r); }} />}
      {report && <ReportModal r={report} onClose={() => setReport(null)} />}
    </div>
  );
}

function OpenForm({ suggest }: { suggest: JornadaState["suggest"] }) {
  const { toast, refresh } = useWallet();
  const [acc, setAcc] = useState(suggest.account || "Nequi");
  const [amount, setAmount] = useState(suggest.amount != null ? String(Math.round(suggest.amount)) : "");
  const [busy, setBusy] = useState(false);
  const value = parseNum(amount);

  async function open(e: FormEvent) {
    e.preventDefault();
    if (value == null || !acc.trim()) return;
    setBusy(true);
    try {
      await api.jornadaAbrir(value, acc.trim());
      toast("Caja del día abierta", `${acc.trim()} · arrancas con ${money(value)}. Tus compras y ventas de Binance se suman solas.`, "good");
      refresh();
    } catch (err) {
      toast("No se pudo abrir la caja", (err as Error).message, "bad");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card-head">
        <div>
          <h2>Abre tu caja del día</h2>
          <span className="sub">Escribe con cuánta plata arrancas hoy</span>
        </div>
      </div>
      <form className="card-body stack" onSubmit={open}>
        <p className="muted" style={{ fontSize: 13.5 }}>
          Desde que la abres, cada compra y venta de Binance se suma sola (con su 4x1000). Al final del día la cierras y te queda el
          informe: cuánto compraste y vendiste, cuánto debes tener en la cuenta y cuánto ganaste.
        </p>
        <div className="form">
          <Field label="Cuenta">
            <input type="text" value={acc} onChange={(e) => setAcc(e.target.value)} list="caja-accounts" maxLength={40} required />
          </Field>
          <Field label="Arrancas con" hint={suggest.amount != null ? "Lo que tenías al cerrar la última caja" : undefined}>
            <input type="text" inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$ 0" required />
          </Field>
        </div>
        <datalist id="caja-accounts">{ACCOUNTS.map((a) => <option key={a} value={a} />)}</datalist>
        <div className="form-actions" style={{ marginTop: 0 }}>
          <button className="btn btn-primary" disabled={busy || value == null}>{busy ? "Abriendo…" : "Abrir caja"}</button>
        </div>
      </form>
    </>
  );
}

const OP_LABEL: Partial<Record<string, string>> = { compra: "Compraste", venta: "Vendiste", aporte: "Entrada", retiro: "Salida para ti", gasto: "Gasto" };
const OP_ICON: Partial<Record<string, string>> = { compra: "download", venta: "upload", aporte: "plus", retiro: "logout", gasto: "file" };

function opText(o: JornadaOp) {
  if (o.kind === "compra" || o.kind === "venta") return `${OP_LABEL[o.kind]} ${qty(o.qty)} ${o.asset}${o.price ? ` a ${money(o.price)}` : ""}`;
  return OP_LABEL[o.kind] ?? (o.text || o.kind);
}

function OpenDay({ j, onModal }: { j: JornadaReport; onModal: (m: "in" | "out" | "close") => void }) {
  const { binance, setBinance, toast } = useWallet();
  const syncing = binance?.job.state === "running";
  const rows = j.ops.filter((o) => o.delta !== 0 || o.kind === "compra" || o.kind === "venta").slice(-8).reverse();
  const t = j.totals;
  const sync = async () => {
    try {
      setBinance(await api.binanceSync());
    } catch (e) {
      toast("No se pudo actualizar", (e as Error).message, "bad");
    }
  };
  return (
    <>
      <div className="card-head">
        <div>
          <h2>Caja del día · {j.account}</h2>
          <span className="sub">
            Abierta {date(j.opened)} a las {hourMin(j.opened)} con {money(j.opening)} · Binance {syncing ? "actualizando…" : j.synced ? `al día de las ${hourMin(j.synced)}` : "sin traer"}
          </span>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={() => void sync()} disabled={syncing} title="Traer ya tus últimas órdenes de Binance">
          <Icon name="refresh" size={14} /> {syncing ? "Trayendo…" : "Actualizar"}
        </button>
      </div>
      <div className="bank-total">
        <span>Debes tener en {j.account}<small>Arrancaste + ventas − compras − 4x1000 ± entradas y salidas</small></span>
        <b className={`num ${j.expected < 0 ? "warn" : ""}`}>{money(j.expected)}</b>
      </div>
      <div className="cd-stats">
        <div><small>Compras ({t.buys})</small><b className="num">{money(t.bought)}</b></div>
        <div><small>Ventas ({t.sells})</small><b className="num">{money(t.sold)}</b></div>
        <div><small>4x1000</small><b className="num">{money(t.gmf)}</b></div>
        <div><small>Ganancia del día</small><b className={`num ${tone(j.gain)}`}>{signedMoney(j.gain)}</b></div>
      </div>
      {rows.length ? (
        <div className="feed">
          {rows.map((o, i) => (
            <div key={`${o.ref}-${o.t}-${i}`} className="feed-row">
              <span className="feed-ic"><Icon name={OP_ICON[o.kind] ?? "info"} size={14} /></span>
              <span className="feed-txt">{opText(o)}<small>{hourMin(o.t)}{o.counterpart ? ` · ${o.counterpart}` : ""}{o.method ? ` · ${o.method}` : ""}{o.gmf ? ` · 4x1000 ${money(o.gmf)}` : ""}</small></span>
              <b className={`num ${tone(o.delta)}`}>{signedMoney(o.delta)}</b>
            </div>
          ))}
        </div>
      ) : <p className="muted" style={{ padding: "4px 22px 0" }}>Todavía no hay compras ni ventas desde que abriste. Se suman solas; lo demás anótalo con Entrada o Salida.</p>}
      <div className="card-body" style={{ paddingTop: 12 }}>
        <div className="actions">
          <button className="btn btn-sm btn-primary" onClick={() => onModal("close")}><Icon name="lock" size={14} /> Cerrar caja</button>
          <button className="btn btn-sm" onClick={() => onModal("in")}><Icon name="plus" size={14} /> Entrada</button>
          <button className="btn btn-sm" onClick={() => onModal("out")}><Icon name="download" size={14} /> Salida</button>
        </div>
      </div>
    </>
  );
}

function CloseModal({ j, onClose, onDone }: { j: JornadaReport; onClose: () => void; onDone: (r: JornadaReport) => void }) {
  const { toast, refresh, setBinance } = useWallet();
  const [real, setReal] = useState("");
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const value = parseNum(real);
  const busy = step !== "";

  async function close(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      setStep("Trayendo tus últimas órdenes de Binance…");
      let b = await api.binanceSync().catch(() => null);
      for (let i = 0; b && b.job.state === "running" && i < 40; i++) {  // espera a que termine (máx. ~1 minuto)
        await new Promise((r) => setTimeout(r, 1500));
        b = await api.binance().catch(() => null);
      }
      if (b) setBinance(b);
      setStep("Armando el informe…");
      let res: { report: JornadaReport } | null = null;
      for (let i = 0; !res && i < 10; i++) {
        try {
          res = await api.jornadaCerrar(value);
        } catch (err) {
          if (!(err instanceof ApiError) || err.status !== 409) throw err;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (!res) throw new Error("Binance sigue sincronizando. Intenta de nuevo en un momento.");
      toast("Caja cerrada", `Ganancia del día: ${signedMoney(res.report.gain)}`, res.report.gain >= 0 ? "good" : "bad");
      refresh();
      onDone(res.report);
    } catch (err) {
      setError((err as Error).message);
      setStep("");
    }
  }

  async function discard() {
    if (!confirm("¿Descartar esta caja sin informe? Tus movimientos no cambian.")) return;
    await api.jornadaBorrar(j.id).catch(() => null);
    refresh();
    onClose();
  }

  return (
    <Modal title={`Cerrar caja · ${j.account}`} onClose={busy ? () => undefined : onClose}>
      <form onSubmit={close}>
        <p className="kind-hint">
          Según tus movimientos debes tener <b>{money(j.expected)}</b> en {j.account}. Escribe cuánto tienes de verdad para ver si cuadra
          (si lo dejas vacío, el informe sale igual).
        </p>
        <div className="form">
          <Field label={`Tienes de verdad en ${j.account}`} wide hint={value != null ? `Diferencia: ${signedMoney(value - j.expected)}` : "Opcional"}>
            <input type="text" inputMode="decimal" className="num" value={real} onChange={(e) => setReal(e.target.value)} placeholder={money(j.expected)} autoFocus />
          </Field>
        </div>
        {step && <p className="muted" style={{ marginTop: 12 }}>{step}</p>}
        {error && <p className="form-error" style={{ marginTop: 12 }}>{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void discard()} disabled={busy}>Descartar caja</button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Cerrando…" : "Cerrar y ver informe"}</button>
        </div>
      </form>
    </Modal>
  );
}

function History({ items, onView }: { items: JornadaSummary[]; onView: (id: number) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 3);
  return (
    <div className="cd-history">
      <div className="cd-history-head">
        <b>Días anteriores</b>
        {items.length > 3 && <button className="link" onClick={() => setAll(!all)}>{all ? "Ver menos" : `Ver los ${items.length}`}</button>}
      </div>
      {shown.map((h) => (
        <button key={h.id} className="cd-day" onClick={() => onView(h.id)}>
          <span>
            <b>{date(h.opened)}</b>
            <small>{h.account} · {h.ops} {h.ops === 1 ? "operación" : "operaciones"}{h.diff != null && Math.abs(h.diff) >= 1 ? ` · no cuadró por ${signedMoney(h.diff)}` : h.diff != null ? " · cuadró" : ""}</small>
          </span>
          <b className={`num ${tone(h.gain ?? 0)}`}>{signedMoney(h.gain ?? 0)}</b>
          <Icon name="chevron" size={14} />
        </button>
      ))}
    </div>
  );
}

function ReportModal({ r, onClose }: { r: JornadaReport; onClose: () => void }) {
  const { refresh } = useWallet();
  const t = r.totals;
  const remove = async () => {
    if (!confirm("¿Borrar este informe? Tus movimientos no cambian.")) return;
    await api.jornadaBorrar(r.id).catch(() => null);
    refresh();
    onClose();
  };
  const lines: [string, number, string?][] = [
    ["Arrancaste con", r.opening],
    [`Compras (${t.buys})`, -t.bought, "down"],
    [`Ventas (${t.sells})`, t.sold, "up"],
    ["4x1000", -t.gmf, "down"],
    ...(t.in ? [["Entradas", t.in, "up"] as [string, number, string]] : []),
    ...(t.out ? [["Salidas y gastos", -t.out, "down"] as [string, number, string]] : []),
  ];
  return (
    <Modal title={`Informe del día · ${date(r.opened)}`} onClose={onClose} wide>
      <p className="muted" style={{ marginTop: -4 }}>
        {r.account} · de {hourMin(r.opened)} a {r.closed ? hourMin(r.closed) : "ahora"}{r.closed && date(r.closed) !== date(r.opened) ? ` del ${date(r.closed)}` : ""}
      </p>
      <div className="kpis" style={{ margin: "12px 0 16px" }}>
        <div className="kpi accent"><small>Ganancia del día</small><b className={tone(r.gain)}>{signedMoney(r.gain)}</b><span>Vueltas del día, ya con 4x1000</span></div>
        <div className="kpi"><small>Debes tener</small><b>{money(r.expected)}</b><span>Según tus movimientos</span></div>
        <div className="kpi"><small>Tenías de verdad</small><b>{r.cash_real != null ? money(r.cash_real) : "—"}</b><span>{r.cash_real != null ? "Lo que escribiste al cerrar" : "No lo escribiste"}</span></div>
        <div className="kpi"><small>Diferencia</small><b className={r.diff != null && Math.abs(r.diff) >= 1 ? "warn" : ""}>{r.diff != null ? signedMoney(r.diff) : "—"}</b><span>{r.diff == null ? "Sin saldo real" : Math.abs(r.diff) < 1 ? "Cuadra" : "Falta anotar algo"}</span></div>
      </div>

      <div className="cd-lines">
        {lines.map(([k, v, c]) => <div key={k}><span>{k}</span><b className={`num ${c ?? ""}`}>{k === "Arrancaste con" ? money(v) : signedMoney(v)}</b></div>)}
        <div className="cd-total"><span>Debes tener</span><b className="num">{money(r.expected)}</b></div>
      </div>

      {r.assets.length > 0 && (
        <>
          <h3 className="cd-h">Por cripto</h3>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Cripto</th><th className="r">Compraste</th><th className="r">A</th><th className="r">Vendiste</th><th className="r">A</th><th className="r">Ganancia</th><th className="r">Te quedó</th></tr></thead>
              <tbody>
                {r.assets.map((x) => (
                  <tr key={x.asset}>
                    <td><b>{x.asset}</b></td>
                    <td className="r">{qty(x.bought_qty)}</td><td className="r">{x.buy_avg != null ? money(x.buy_avg) : "—"}</td>
                    <td className="r">{qty(x.sold_qty)}</td><td className="r">{x.sell_avg != null ? money(x.sell_avg) : "—"}</td>
                    <td className={`r ${tone(x.gain)}`}>{signedMoney(x.gain)}</td>
                    <td className="r">{Math.abs(x.left) < 1e-9 ? "0" : `${x.left > 0 ? "" : "−"}${qty(Math.abs(x.left))}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small-print" style={{ margin: "8px 0 0" }}>
            Ganancia = lo que compraste y vendiste el mismo día, a su precio promedio (con comisiones). Lo que te quedó sin vender va a lo que te costó;
            si vendiste más de lo que compraste, eso salió de lo que ya tenías y no cuenta como ganancia del día.
          </p>
        </>
      )}

      <h3 className="cd-h">Operaciones ({r.ops.length})</h3>
      {r.ops.length ? (
        <div className="table-wrap cd-ops">
          <table className="t">
            <thead><tr><th>Hora</th><th>Qué</th><th className="hide-sm">Con</th><th className="r">Pesos</th></tr></thead>
            <tbody>
              {r.ops.map((o, i) => (
                <tr key={`${o.ref}-${i}`}>
                  <td className="nowrap">{hourMin(o.t)}</td>
                  <td>{opText(o)}{o.gmf ? <small className="cell-sub">4x1000 {money(o.gmf)}</small> : null}</td>
                  <td className="hide-sm">{o.counterpart || "—"}{o.method ? <small className="cell-sub">{o.method}</small> : null}</td>
                  <td className={`r ${tone(o.delta)}`}>{o.delta ? signedMoney(o.delta) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">No hubo compras ni ventas en esta caja.</p>}

      <div className="form-actions">
        <button className="btn btn-ghost" onClick={() => void remove()}><Icon name="trash" size={14} /> Borrar</button>
        <a className="btn" href={`/api/jornada/${r.id}.csv`} download><Icon name="download" size={14} /> Descargar Excel</a>
        <button className="btn btn-primary" onClick={onClose}>Listo</button>
      </div>
    </Modal>
  );
}

/** Entrada o salida de pesos que no viene de Binance. */
function CashMoveModal({ dir, account, onClose }: { dir: "in" | "out"; account: string; onClose: () => void }) {
  const { me, toast, refresh } = useWallet();
  const charged = (me.profile.gmf_methods?.[account] ?? me.profile.gmf_mode) !== "exenta";
  const [kind, setKind] = useState<Kind>(dir === "in" ? "aporte" : "retiro");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<GastoCategory>("servicios");
  const [dt, setDt] = useState(toLocalInput(Math.floor(Date.now() / 1000)));
  const [gmfOn, setGmfOn] = useState(dir === "out" && charged);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const v = parseNum(value) ?? 0;
  const gmf = dir === "out" && gmfOn ? Math.round(v * GMF * 100) / 100 : 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const t = fromLocalInput(dt);
    if (!Number.isFinite(t)) return setError("Revisa la fecha.");
    if (!v) return setError("Escribe el valor.");
    setBusy(true);
    try {
      await api.addMovement({ kind, t, cop_value: v, note: note.trim(), category: kind === "gasto" ? category : "", pay_method: account, gmf_cop: gmf });
      toast(dir === "in" ? "Entrada registrada" : "Salida registrada", `${account}: ${signedMoney(dir === "in" ? v : -(v + gmf))}`, "good");
      refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={dir === "in" ? `Entrada a ${account}` : `Salida de ${account}`} onClose={onClose}>
      <form onSubmit={submit}>
        {dir === "out" ? (
          <div style={{ marginBottom: 14 }}>
            <Segmented value={kind} onChange={setKind} label="Tipo de salida" options={[["retiro", "Para ti"], ["gasto", "Gasto del negocio"]] as const} />
          </div>
        ) : null}
        <p className="kind-hint">
          {dir === "in" ? "Plata tuya que entra a la caja: una consignación, una transferencia desde otra cuenta, plata para operar."
            : kind === "retiro" ? "Plata que sacas de la caja para ti: gastos personales, pasarla a otra cuenta."
            : "Algo que pagas para el negocio (internet, celular, contador). Se descuenta en tu declaración."}
        </p>
        <div className="form">
          <Field label={dir === "in" ? "Cuánto entró" : "Cuánto salió"}>
            <input type="text" inputMode="decimal" className="num" value={value} onChange={(e) => setValue(e.target.value)} required placeholder="$ 0" autoFocus />
          </Field>
          <Field label="Fecha y hora">
            <input type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} required />
          </Field>
          {kind === "gasto" && (
            <Field label="Tipo de gasto">
              <Select label="Tipo de gasto" value={category} onChange={(v) => setCategory(v as GastoCategory)}
                options={(Object.keys(GASTO_LABEL) as GastoCategory[]).map((c) => ({ value: c, label: GASTO_LABEL[c] }))} />
            </Field>
          )}
          <Field label={kind === "gasto" ? "En qué fue" : "Concepto"} wide hint={kind === "gasto" ? "Guarda la factura o el recibo: es tu soporte." : undefined}>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} required={kind === "gasto"}
              placeholder={dir === "in" ? "Ej.: me transferí de Bancolombia" : kind === "gasto" ? "Ej.: internet de octubre" : "Ej.: mercado"} />
          </Field>
          {dir === "out" && (
            <Field label="4x1000" wide hint={gmfOn ? `${money(gmf)} más salen de ${account}` : `${account} no te cobra en esta salida`}>
              <label className="check"><input type="checkbox" checked={gmfOn} onChange={(e) => setGmfOn(e.target.checked)} /> {account} me cobra 4x1000</label>
            </Field>
          )}
        </div>
        {error && <p className="form-error" style={{ marginTop: 12 }}>{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

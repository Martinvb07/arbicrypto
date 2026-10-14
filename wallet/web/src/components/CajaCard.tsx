"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, type Caja, type GastoCategory, type Kind } from "@/lib/api";
import { date, dateTime, fromLocalInput, GASTO_LABEL, money, parseNum, signedMoney, toLocalInput, tone } from "@/lib/format";
import type { TabId } from "./App";
import { Field, Icon, Modal, Note, Segmented, Select, Skeleton } from "./ui";
import { useWallet } from "./wallet";

const GMF = 0.004;
const ACCOUNTS = ["Nequi", "Daviplata", "Bancolombia", "Davivienda", "Banco de Bogotá", "Banco Popular", "BBVA", "Nu"];

/** La caja en pesos: se inicia con lo que hay hoy en la cuenta y desde ahí lleva cada entrada y salida. */
export function CajaCard({ onTab }: { onTab: (t: TabId) => void }) {
  const { version } = useWallet();
  const [c, setC] = useState<Caja | null>(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"" | "in" | "out">("");

  useEffect(() => {
    let alive = true;
    api.caja().then((d) => alive && setC(d), (e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [version]);

  if (error) return <div className="card card-pad"><Note kind="bad">{error}</Note></div>;
  if (!c) return <div className="card"><div className="card-body"><Skeleton rows={3} /></div></div>;
  if (!c.start) return <StartCaja account={c.account} books={c.balance} />;

  const account = c.account || "tu cuenta";
  const rows = c.days.flatMap((d) => d.entries).slice(-8).reverse();
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Caja · {account}</h2>
          <span className="sub">Iniciada el {date(c.start.t)} con {money(c.start.amount)}</span>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={() => onTab("caja")}>Registro completo <Icon name="chevron" size={14} /></button>
      </div>
      <div className="bank-total">
        <span>Debes tener en {account}<small>Saldo inicial + entradas − salidas − 4x1000</small></span>
        <b className={`num ${c.balance < 0 ? "warn" : ""}`}>{money(c.balance)}</b>
      </div>
      {rows.length ? (
        <div className="feed">
          {rows.map((e) => (
            <div key={e.number} className="feed-row">
              <span className="feed-txt">{e.text}<small>{dateTime(e.t)}{e.gmf ? ` · 4x1000 ${money(e.gmf)}` : ""} · saldo {money(e.balance)}</small></span>
              <b className={`num ${tone(e.in - e.out - e.gmf)}`}>{signedMoney(e.in - e.out - e.gmf)}</b>
            </div>
          ))}
        </div>
      ) : <p className="muted" style={{ padding: "4px 22px 0" }}>Todavía no hay movimientos desde que iniciaste. Lo de Binance entra solo; lo demás anótalo aquí.</p>}
      <div className="card-body" style={{ paddingTop: 12 }}>
        <div className="actions">
          <button className="btn btn-sm btn-primary" onClick={() => setModal("in")}><Icon name="plus" size={14} /> Entrada</button>
          <button className="btn btn-sm" onClick={() => setModal("out")}><Icon name="download" size={14} /> Salida</button>
          <button className="btn btn-sm btn-ghost" onClick={() => onTab("cierres")}><Icon name="lock" size={14} /> Cuadrar con {account}</button>
        </div>
      </div>
      {modal && <CashMoveModal dir={modal} account={c.account} onClose={() => setModal("")} />}
    </div>
  );
}

function StartCaja({ account, books }: { account: string; books: number }) {
  const { toast, refresh } = useWallet();
  const [acc, setAcc] = useState(account || "Nequi");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const value = parseNum(amount);

  async function start(e: FormEvent) {
    e.preventDefault();
    if (value == null || !acc.trim()) return;
    setBusy(true);
    try {
      await api.cajaIniciar(value, acc.trim());
      const diff = value - books;
      toast(`Caja iniciada en ${acc.trim()}`, Math.abs(diff) >= 0.5 ? `Tus libros quedan con ${money(value)} (${signedMoney(diff)} como ${diff > 0 ? "aporte" : "retiro"} tuyo).` : undefined, "good");
      refresh();
    } catch (err) {
      toast("No se pudo iniciar", (err as Error).message, "bad");
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Inicia tu caja</h2>
          <span className="sub">Escribe cuánta plata tienes hoy en tu cuenta</span>
        </div>
      </div>
      <form className="card-body stack" onSubmit={start}>
        <p className="muted" style={{ fontSize: 13.5 }}>
          Desde ese momento la app lleva tu caja: lo de Binance entra solo y lo demás (plata que metes, gastos, lo que sacas para ti) lo anotas aquí.
          Así sabes cuánto debes tener en la cuenta en todo momento.
        </p>
        <div className="form">
          <Field label="Cuenta">
            <input type="text" value={acc} onChange={(e) => setAcc(e.target.value)} list="caja-accounts" maxLength={40} required />
          </Field>
          <Field label="Saldo de hoy">
            <input type="text" inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$ 0" required />
          </Field>
        </div>
        <datalist id="caja-accounts">{ACCOUNTS.map((a) => <option key={a} value={a} />)}</datalist>
        <div className="form-actions" style={{ marginTop: 0 }}>
          <button className="btn btn-primary" disabled={busy || value == null}>{busy ? "Iniciando…" : "Iniciar caja"}</button>
        </div>
      </form>
    </div>
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

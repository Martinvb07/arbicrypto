"use client";

import { useState, type FormEvent } from "react";
import { api, type GastoCategory, type Kind, type Movement, type MovementInput } from "@/lib/api";
import { cashValue, fromLocalInput, GASTO_LABEL, KIND_HINT, KIND_LABEL, money, num, parseNum, toLocalInput } from "@/lib/format";
import { Field, Icon, Modal, Select } from "./ui";
import { useWallet } from "./wallet";

const KINDS: Kind[] = ["compra", "venta", "permuta", "ingreso", "airdrop", "comision", "gasto", "aporte", "retiro"];
const CASH: Kind[] = ["gasto", "aporte", "retiro"];
const STABLE = new Set(["USDT", "USDC", "FDUSD", "BUSD", "DAI", "TUSD"]);
const PLATFORMS = ["Binance P2P", "Binance Spot", "Binance Convert", "Binance Earn", "Bybit", "OKX", "Bitget", "Billetera propia"];
const GMF = 0.004;

const s = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

export function MoveModal({ move, onClose }: { move?: Movement; onClose: () => void }) {
  const { me, toast, refresh } = useWallet();
  const [kind, setKind] = useState<Kind>(move?.kind ?? "compra");
  const [dt, setDt] = useState(toLocalInput(move?.t ?? Math.floor(Date.now() / 1000)));
  const [outAsset, setOutAsset] = useState(move?.out_asset && move.out_asset !== "COP" ? move.out_asset : "USDT");
  const [outQty, setOutQty] = useState(move?.out_asset !== "COP" ? s(move?.out_qty) : "");
  const [inAsset, setInAsset] = useState(move?.in_asset && move.in_asset !== "COP" ? move.in_asset : kind === "permuta" ? "BTC" : "USDT");
  const [inQty, setInQty] = useState(move?.in_asset !== "COP" ? s(move?.in_qty) : "");
  const [cop, setCop] = useState(s(move ? (move.kind === "compra" || move.kind === "venta" ? cashValue(move) : move.cop_value) : null));
  const [fee, setFee] = useState(move?.fee_cop ? s(move.fee_cop) : "");
  const [gmfOn, setGmfOn] = useState(move ? move.gmf_cop > 0 : me.profile.gmf_mode !== "exenta");
  const [platform, setPlatform] = useState(move?.platform ?? "Binance P2P");
  const [counterpart, setCounterpart] = useState(move?.counterpart ?? "");
  const [note, setNote] = useState(move?.note ?? "");
  const [category, setCategory] = useState<GastoCategory>((move?.category as GastoCategory) || "servicios");
  const [quote, setQuote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const cash = CASH.includes(kind);
  const hasOut = kind === "venta" || kind === "permuta" || kind === "comision";
  const hasIn = kind === "compra" || kind === "permuta" || kind === "ingreso" || kind === "airdrop";
  const pesos = kind === "compra" || kind === "venta";
  const copNum = parseNum(cop) ?? 0;
  const gmfValue = kind === "compra" && gmfOn ? Math.round(copNum * GMF * 100) / 100 : move && kind === "venta" ? move.gmf_cop : 0;

  async function calc() {
    setError("");
    setQuote("");
    const t = fromLocalInput(dt);
    // valor comercial: el lado estable si lo hay, si no lo que se recibe
    let asset = inAsset, q = parseNum(inQty);
    if (kind === "comision" || (kind === "permuta" && STABLE.has(outAsset.toUpperCase()))) {
      asset = outAsset;
      q = parseNum(outQty);
    }
    if (!asset || !q) return setError("Escribe la cripto y la cantidad primero.");
    try {
      const r = await api.value(asset.toUpperCase(), q, t);
      setCop(String(Math.round(r.cop)));
      setQuote(`${num(q, 8).replace(/,?0+$/, "")} ${asset.toUpperCase()} × US$ ${num(r.usd, r.usd < 10 ? 4 : 2)} × TRM ${num(r.trm, 2)}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const t = fromLocalInput(dt);
    if (!Number.isFinite(t)) return setError("Revisa la fecha.");
    if (cash) {
      const v = parseNum(cop);
      if (!v) return setError("Escribe el valor en pesos.");
      setBusy(true);
      try {
        const input: MovementInput = { kind, t, cop_value: v, note: note.trim(), category: kind === "gasto" ? category : "",
          pay_method: me.profile.cash_account || "", gmf_cop: kind !== "aporte" && gmfOn ? Math.round(v * GMF * 100) / 100 : 0 };
        if (move) await api.editMovement(move.id, input);
        else await api.addMovement(input);
        toast(move ? "Movimiento actualizado" : `${KIND_LABEL[kind]} registrado`, undefined, "good");
        refresh();
        onClose();
      } catch (err) {
        setError((err as Error).message);
        setBusy(false);
      }
      return;
    }
    const m: MovementInput = { kind, t, platform: platform.trim(), counterpart: counterpart.trim(), note: note.trim() };
    if (hasOut) { m.out_asset = outAsset.trim().toUpperCase(); m.out_qty = parseNum(outQty) ?? undefined; }
    if (hasIn) { m.in_asset = inAsset.trim().toUpperCase(); m.in_qty = parseNum(inQty) ?? undefined; }
    m.cop_value = parseNum(cop) ?? (kind === "comision" ? 0 : undefined);
    if (pesos || kind === "permuta") m.fee_cop = parseNum(fee) ?? 0;
    if (pesos && m.cop_value != null) {
      // lo escrito es lo que pasó por el banco: el valor de la cripto es eso menos (compra) o más (venta) la comisión
      if (kind === "compra" && (m.fee_cop ?? 0) >= m.cop_value) return setError("La comisión no puede ser mayor que lo que pagaste.");
      m.cop_value = kind === "compra" ? m.cop_value - (m.fee_cop ?? 0) : m.cop_value + (m.fee_cop ?? 0);
    }
    if (pesos) m.gmf_cop = gmfValue;
    setBusy(true);
    try {
      if (move) await api.editMovement(move.id, m);
      else await api.addMovement(m);
      toast(move ? "Movimiento actualizado" : "Movimiento agregado", undefined, "good");
      refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const assetInput = (v: string, set: (v: string) => void, label: string) => (
    <Field label={label}>
      <input type="text" value={v} onChange={(e) => set(e.target.value.toUpperCase())} list="assets" required maxLength={12} placeholder="USDT" />
    </Field>
  );
  const qtyInput = (v: string, set: (v: string) => void, label: string) => (
    <Field label={label}>
      <input type="text" inputMode="decimal" className="num" value={v} onChange={(e) => set(e.target.value)} required placeholder="0,00" />
    </Field>
  );

  return (
    <Modal title={move ? "Editar movimiento" : "Agregar movimiento"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="kind-grid" role="radiogroup" aria-label="Tipo">
          {KINDS.map((k) => (
            <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => { setKind(k); setQuote(""); }}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <p className="kind-hint">{KIND_HINT[kind]}</p>

        {cash ? (
          <div className="form">
            <Field label="Fecha y hora (Colombia)" wide>
              <input type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} required />
            </Field>
            <Field label={kind === "gasto" ? "Cuánto pagaste" : kind === "aporte" ? "Cuánto metiste" : "Cuánto sacaste"}>
              <input type="text" inputMode="decimal" className="num" value={cop} onChange={(e) => setCop(e.target.value)} required placeholder="$ 0" />
            </Field>
            {kind === "gasto" ? (
              <Field label="Tipo de gasto">
                <Select label="Tipo de gasto" value={category} onChange={(v) => setCategory(v as GastoCategory)}
                  options={(Object.keys(GASTO_LABEL) as GastoCategory[]).map((c) => ({ value: c, label: GASTO_LABEL[c] }))} />
              </Field>
            ) : <div />}
            <Field label={kind === "gasto" ? "En qué fue" : "Nota (opcional)"} wide hint={kind === "gasto" ? "Guarda la factura o el recibo: es tu soporte." : undefined}>
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} required={kind === "gasto"}
                placeholder={kind === "gasto" ? "Ej.: internet de octubre" : kind === "aporte" ? "Ej.: plata para operar" : "Ej.: retiro para gastos personales"} />
            </Field>
            {kind !== "aporte" && (
              <Field label="4x1000" wide hint={gmfOn ? `${money(Math.round((parseNum(cop) ?? 0) * GMF))} más salen de tu cuenta` : "Cuenta exenta"}>
                <label className="check"><input type="checkbox" checked={gmfOn} onChange={(e) => setGmfOn(e.target.checked)} /> Me cobraron 4x1000 en esta salida</label>
              </Field>
            )}
          </div>
        ) : (
        <div className="form">
          <Field label="Fecha y hora (Colombia)" wide>
            <input type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} required />
          </Field>

          {hasOut && assetInput(outAsset, setOutAsset, kind === "permuta" ? "Entregaste" : "Cripto")}
          {hasOut && qtyInput(outQty, setOutQty, kind === "permuta" ? "Cantidad entregada" : kind === "venta" ? "Cantidad vendida" : "Cantidad")}
          {hasIn && assetInput(inAsset, setInAsset, kind === "permuta" ? "Recibiste" : "Cripto")}
          {hasIn && qtyInput(inQty, setInQty, kind === "permuta" ? "Cantidad recibida" : "Cantidad recibida")}

          <Field label={kind === "compra" ? "Pesos pagados" : kind === "venta" ? "Pesos recibidos" : kind === "comision" ? "Valor en pesos (opcional)" : "Valor en pesos ese día"} wide
            hint={quote || (kind === "permuta" ? "Valor comercial de lo que cambiaste. Para la DIAN es el precio de venta." : !pesos ? "Precio en dólares de Binance × TRM del día." : undefined)}>
            <div className="input-row">
              <input type="text" inputMode="decimal" className="num" value={cop} onChange={(e) => setCop(e.target.value)} required={kind !== "comision"} placeholder="$ 0" />
              {!pesos && <button type="button" className="btn" onClick={calc}><Icon name="refresh" size={15} /> Calcular</button>}
            </div>
          </Field>

          {(pesos || kind === "permuta") && (
            <Field label={kind === "compra" ? "De eso, comisión de Binance" : kind === "venta" ? "Comisión cobrada" : "Comisión en pesos"}
              hint={kind === "compra" ? "Lo que se quedó Binance o la plataforma. Ya está dentro de los pesos pagados."
                : kind === "venta" ? "Lo que cobró Binance o la plataforma. Los pesos recibidos ya vienen sin ella."
                : "Comisión del cambio, si la hubo."}>
              <input type="text" inputMode="decimal" className="num" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="$ 0" />
            </Field>
          )}
          {kind === "compra" && (
            <Field label="4x1000" hint={gmfOn ? `${money(gmfValue)} ($4.000 por cada $1.000.000) · la mitad se descuenta` : "Cuenta exenta o pagaste sin banco"}>
              <label className="check" style={{ height: 38 }}>
                <input type="checkbox" checked={gmfOn} onChange={(e) => setGmfOn(e.target.checked)} /> Pagué 4x1000 en esta compra
              </label>
            </Field>
          )}

          <Field label="Plataforma">
            <input type="text" value={platform} onChange={(e) => setPlatform(e.target.value)} list="platforms" maxLength={60} />
          </Field>
          <Field label="Contraparte (opcional)">
            <input type="text" value={counterpart} onChange={(e) => setCounterpart(e.target.value)} maxLength={80} placeholder="Nombre o usuario" />
          </Field>
          <Field label="Nota (opcional)" wide>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </Field>
        </div>
        )}

        <datalist id="assets">{["USDT", "BTC", "ETH", "BNB", "SOL", "USDC", "FDUSD", "XRP", "ADA", "DOGE", "TRX"].map((a) => <option key={a} value={a} />)}</datalist>
        <datalist id="platforms">{PLATFORMS.map((p) => <option key={p} value={p} />)}</datalist>

        {error && <p className="form-error" style={{ marginTop: 12 }}>{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { money, qty, signedMoney, tone } from "@/lib/format";
import { Field, Modal } from "./ui";
import { useWallet } from "./wallet";

const GMF_RATE = 0.004;
/** Pesos: 304.685, 304685, $ 304.685,50 → 304685(,50). */
function parsePesos(v: string): number | null {
  const t = v.replace(/[\s$]/g, "").replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Ajustar a mano cuánto te costó lo de una venta (y su 4x1000), para los casos en que el historial no cuadra:
 *  plata de otro que compraste, compras que no están en la wallet… La ganancia se calcula con lo que escribas. */
export function CostModal({ sale, onClose }: {
  sale: { id: number; asset: string; qty: number; received: number; cost: number; gmf: number; manual: boolean };
  onClose: () => void;
}) {
  const { refresh, toast } = useWallet();
  const [cost, setCost] = useState(sale.manual ? Math.round(sale.cost).toLocaleString("es-CO") : "");
  const [gmfOn, setGmfOn] = useState(!sale.manual || sale.gmf > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const c = parsePesos(cost);
  const gmf = c != null && gmfOn ? Math.round(c * GMF_RATE * 100) / 100 : 0;
  const gain = c != null ? sale.received - c : null;

  async function save(value: number | null) {
    setBusy(true);
    setError("");
    try {
      await api.movementCost(sale.id, value, value == null ? null : gmf);
      toast(value == null ? "Costo de las compras otra vez" : "Costo ajustado",
        value == null ? undefined : `Ganancia: ${signedMoney(sale.received - value)}${gmf ? ` · neta ${signedMoney(sale.received - value - gmf)}` : ""}`, "good");
      refresh();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="¿Cuánto te costó?" onClose={busy ? () => undefined : onClose}>
      <p className="kind-hint" style={{ marginTop: -4 }}>
        Venta de <b>{qty(sale.qty)} {sale.asset}</b>: te llegaron <b>{money(sale.received)}</b>.
        Escribe lo que pagaste por esos {sale.asset} (sin el 4x1000) y la ganancia sale de ahí.
        {!sale.manual && sale.cost > 0 && <> Ahora, sacado de tus compras: {money(sale.cost)}.</>}
      </p>
      <div className="form">
        <Field label="Te costó" wide>
          <input type="text" inputMode="decimal" className="num" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="$ 0" autoFocus />
        </Field>
      </div>
      <label className="switch-row" style={{ borderBottom: 0 }}>
        <span><b>Pagué 4x1000 al comprar</b><small>{gmfOn && c ? `−${money(gmf)} (0,4 %)` : "Sin 4x1000"}</small></span>
        <input type="checkbox" role="switch" checked={gmfOn} onChange={(e) => setGmfOn(e.target.checked)} />
        <span className={`switch ${gmfOn ? "on" : ""}`} aria-hidden="true" />
      </label>
      <div className={`cost-preview ${gain == null ? "empty" : ""}`}>
        <div><small>Recibiste</small><b>{money(sale.received)}</b></div>
        <span>−</span>
        <div><small>Te costó</small><b>{c != null ? money(c) : "—"}</b></div>
        {gmfOn && <><span>−</span><div><small>4x1000</small><b>{c != null ? money(gmf) : "—"}</b></div></>}
        <span>=</span>
        <div className="res"><small>Te quedó</small><b className={gain != null ? tone(gain - gmf) : ""}>{gain != null ? signedMoney(gain - gmf) : "—"}</b></div>
      </div>
      {error && <p className="form-error" style={{ marginTop: 12 }}>{error}</p>}
      <div className="form-actions">
        {sale.manual && <button className="btn btn-ghost" disabled={busy} onClick={() => void save(null)}>Usar mis compras</button>}
        <button className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn btn-primary" disabled={busy || c == null} onClick={() => c != null && void save(c)}>{busy ? "Guardando…" : "Guardar"}</button>
      </div>
    </Modal>
  );
}

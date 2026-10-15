"use client";

import { useState } from "react";
import { api, type Movement } from "@/lib/api";
import { date, hourMin, money, qty } from "@/lib/format";
import { methodName } from "./GmfChoice";
import { Icon, Modal } from "./ui";
import { useWallet } from "./wallet";

/** En una venta: de qué compra salió (la plata de un amigo, una compra en especial…). Sin elegir, sale de la más vieja primero. */
export function LotModal({ sale, buys, used, onClose }: {
  sale: Movement; buys: Movement[]; used: Map<number, number>; onClose: () => void;
}) {
  const { refresh, toast } = useWallet();
  const [pick, setPick] = useState<number | null>(sale.lot_from ?? null);
  const [busy, setBusy] = useState(false);
  const asset = sale.out_asset ?? "";
  const list = buys.filter((m) => m.in_asset === asset && m.t <= sale.t).sort((a, b) => b.t - a.t);

  async function save(from: number | null) {
    setPick(from);
    setBusy(true);
    try {
      await api.movementLot(sale.id, from);
      refresh();
      onClose();
    } catch (e) {
      setPick(sale.lot_from ?? null);
      toast("No se pudo cambiar", (e as Error).message, "bad");
    }
    setBusy(false);
  }

  return (
    <Modal title="¿De qué compra salió esta venta?" onClose={onClose} wide>
      <p className="kind-hint" style={{ marginTop: -4 }}>
        Venta de <b>{qty(sale.out_qty)} {asset}</b> por {money(sale.cop_value)} · {date(sale.t)} {hourMin(sale.t)}.
        Elige la compra de donde sacaste esos dólares: se resta de esa, y si no alcanza, sigue con la más vieja.
      </p>
      <div className="gmf-pick lot-pick">
        <label className={`gmf-pick-row ${pick == null ? "on" : ""}`}>
          <span className="gmf-pick-txt">
            <b>Automático</b>
            <small>De la compra más vieja primero (FIFO)</small>
          </span>
          <span className="gmf-pick-val"><Icon name="sort" size={14} /></span>
          <input type="radio" name="lot" checked={pick == null} disabled={busy} onChange={() => void save(null)} />
          <span className={`lot-radio ${pick == null ? "on" : ""}`} aria-hidden="true" />
        </label>
        {list.map((m, i) => {
          const on = pick === m.id;
          const left = Math.max((m.in_qty ?? 0) - (used.get(m.id) ?? 0), 0);
          return (
            <label key={m.id} className={`gmf-pick-row ${on ? "on" : ""}`} style={{ animationDelay: `${Math.min(i + 1, 12) * 25}ms` }}>
              <span className="gmf-pick-txt">
                <b>{qty(m.in_qty)} {asset} por {money(m.cop_value + (m.fee_cop || 0))}</b>
                <small>
                  {date(m.t)} · {hourMin(m.t)}{m.pay_method ? ` · ${methodName(m.pay_method)}` : ""}{m.counterpart ? ` · a ${m.counterpart}` : ""}
                </small>
              </span>
              <span className="gmf-pick-val num">{left <= 1e-6 ? "ya vendida" : `quedan ${qty(left)}`}</span>
              <input type="radio" name="lot" checked={on} disabled={busy} onChange={() => void save(m.id)} />
              <span className={`lot-radio ${on ? "on" : ""}`} aria-hidden="true" />
            </label>
          );
        })}
      </div>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}

"use client";

import { useEffect, useState } from "react";
import { api, type GmfMode, type Movement } from "@/lib/api";
import { date, hourMin, money, qty } from "@/lib/format";
import { methodName } from "./GmfChoice";
import { Icon, Segmented } from "./ui";
import { useWallet } from "./wallet";

type Pick = "todas" | "exenta" | "elegir";
const OPTIONS = [["todas", "Todas con 4x1000"], ["exenta", "Ninguna"], ["elegir", "Elegir cuáles"]] as const;
const SHOW = 12;

/** 4x1000 en Resultados: todas las compras lo pagan, ninguna, o eliges compra por compra. Las ventas nunca lo pagan. */
export function GmfPanel() {
  const { me, setMe, refresh, toast, year, version } = useWallet();
  const mode = me.profile.gmf_mode;
  const [busy, setBusy] = useState(false);
  const [buys, setBuys] = useState<Movement[] | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (mode !== "elegir") return;
    let alive = true;
    api.movements(year).then((r) => alive && setBuys(r.movements.filter((m) => m.kind === "compra").sort((a, b) => b.t - a.t)),
      () => alive && setBuys([]));
    return () => { alive = false; };
  }, [mode, year, version]);

  async function setMode(m: Pick) {
    if (m === mode) return;
    setBusy(true);
    try {
      const r = await api.saveProfile({ ...me.profile, gmf_mode: m as GmfMode, gmf_exempt: m === "exenta", gmf_methods: {} });
      setMe({ ...me, profile: r.profile });
      refresh();
    } catch (e) {
      toast("No se pudo cambiar", (e as Error).message, "bad");
    }
    setBusy(false);
  }

  async function mark(ids: number[], on: boolean) {
    if (!ids.length) return;
    setBusy(true);
    try {
      await api.movementsGmf(ids, on);
      refresh();
    } catch (e) {
      toast("No se pudo cambiar", (e as Error).message, "bad");
    }
    setBusy(false);
  }

  const paid = (buys ?? []).reduce((a, m) => a + (m.gmf_cop || 0), 0);
  const withGmf = (buys ?? []).filter((m) => (m.gmf_cop || 0) > 0).length;
  const shown = all ? buys ?? [] : (buys ?? []).slice(0, SHOW);
  return (
    <div className="card card-pad gmf-panel">
      <div className="gmf-panel-head">
        <div>
          <h2>4x1000 de tus compras</h2>
          <p className="muted">Solo al comprar (le pagas al vendedor desde tu cuenta). Al vender recibes plata y no se paga.</p>
        </div>
        <Segmented label="4x1000" value={(mode === "tope350" ? "" : mode) as Pick} onChange={(m) => void setMode(m)} options={OPTIONS} />
      </div>
      {mode === "tope350" && <p className="muted small-print">Ahora tienes “exenta hasta el tope del mes” (en Ajustes). Elige otra opción para cambiarlo.</p>}
      {Object.keys(me.profile.gmf_methods ?? {}).length > 0 && mode !== "elegir" && (
        <p className="muted small-print">Tienes cuentas con su propio 4x1000 en Ajustes; al elegir aquí se usa lo mismo para todas.</p>
      )}
      {mode === "elegir" && (
        buys == null ? <p className="muted">Cargando tus compras…</p> : !buys.length ? <p className="muted">No hay compras en {year}.</p> : (
          <>
            <div className="gmf-pick-bar">
              <span><b>{withGmf}</b> de {buys.length} compras con 4x1000 · <b>{money(paid)}</b></span>
              <div className="actions">
                <button className="btn btn-sm" disabled={busy} onClick={() => void mark(buys.map((m) => m.id), true)}>Marcar todas</button>
                <button className="btn btn-sm" disabled={busy} onClick={() => void mark(buys.map((m) => m.id), false)}>Ninguna</button>
              </div>
            </div>
            <div className="gmf-pick">
              {shown.map((m) => {
                const on = (m.gmf_cop || 0) > 0;
                const pesos = m.cop_value + (m.fee_cop || 0);
                return (
                  <label key={m.id} className={`gmf-pick-row ${on ? "on" : ""}`}>
                    <input type="checkbox" checked={on} disabled={busy} onChange={(e) => void mark([m.id], e.target.checked)} />
                    <span className="gmf-pick-txt">
                      <b>{qty(m.in_qty)} {m.in_asset} por {money(pesos)}</b>
                      <small>{date(m.t)} {hourMin(m.t)}{m.pay_method ? ` · ${methodName(m.pay_method)}` : ""}</small>
                    </span>
                    <span className={`num ${on ? "down" : "muted"}`}>{on ? `−${money(m.gmf_cop)}` : "sin 4x1000"}</span>
                  </label>
                );
              })}
            </div>
            {buys.length > SHOW && (
              <button className="link" onClick={() => setAll(!all)}><Icon name={all ? "chevronDown" : "chevron"} size={13} /> {all ? "Ver menos" : `Ver las ${buys.length} compras`}</button>
            )}
          </>
        )
      )}
    </div>
  );
}

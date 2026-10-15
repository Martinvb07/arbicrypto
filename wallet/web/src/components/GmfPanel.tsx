"use client";

import { useEffect, useState } from "react";
import { api, type GmfMode, type Movement } from "@/lib/api";
import { date, hourMin, money, qty } from "@/lib/format";
import { methodName } from "./GmfChoice";
import { Icon, Modal, Segmented } from "./ui";
import { useWallet } from "./wallet";

type Pick = "todas" | "exenta" | "elegir";
const OPTIONS = [["todas", "Todas"], ["exenta", "Ninguna"], ["elegir", "Elegir cuáles"]] as const;

/** Filtro de 4x1000 en Resultados: todas las compras lo pagan, ninguna, o eliges compra por compra (en un modal).
 *  Solo las compras pagan 4x1000: al vender recibes plata y no se cobra. */
export function GmfPanel() {
  const { me, setMe, refresh, toast, report } = useWallet();
  const mode = me.profile.gmf_mode;
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const gmf = report?.books.pnl.gmf ?? 0;

  async function setMode(m: Pick) {
    if (m === mode) {
      if (m === "elegir") setOpen(true);
      return;
    }
    setBusy(true);
    try {
      const r = await api.saveProfile({ ...me.profile, gmf_mode: m as GmfMode, gmf_exempt: m === "exenta", gmf_methods: {} });
      setMe({ ...me, profile: r.profile });
      refresh();
      if (m === "elegir") setOpen(true);
    } catch (e) {
      toast("No se pudo cambiar", (e as Error).message, "bad");
    }
    setBusy(false);
  }

  return (
    <>
      <div className="card period-bar gmf-bar">
        <span className="gmf-bar-label" title="Solo al comprar: al vender no se paga">
          <Icon name="bank" size={15} /> 4x1000 <small>en compras</small>
        </span>
        <Segmented label="4x1000 en compras" value={(mode === "tope350" ? "" : mode) as Pick} onChange={(m) => void setMode(m)} options={OPTIONS} />
        {mode === "elegir" && (
          <button className="btn btn-sm" onClick={() => setOpen(true)} disabled={busy}><Icon name="edit" size={14} /> Elegir compras</button>
        )}
        <span className="gmf-bar-sum">
          {mode === "tope350" ? "Exenta hasta el tope del mes (Ajustes)" : gmf > 0 ? <>−{money(gmf)} en el año</> : "Sin 4x1000"}
        </span>
      </div>
      {open && <PickModal onClose={() => setOpen(false)} />}
    </>
  );
}

/** Lista de compras del año: cada una con su interruptor de 4x1000. Cambia al instante y se guarda sola. */
function PickModal({ onClose }: { onClose: () => void }) {
  const { refresh, toast, year } = useWallet();
  const [buys, setBuys] = useState<Movement[] | null>(null);
  const [on, setOn] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.movements(year).then((r) => {
      if (!alive) return;
      const list = r.movements.filter((m) => m.kind === "compra").sort((a, b) => b.t - a.t);
      setBuys(list);
      setOn(Object.fromEntries(list.map((m) => [m.id, (m.gmf_cop || 0) > 0])));
    }, () => alive && setBuys([]));
    return () => { alive = false; };
  }, [year]);

  async function mark(ids: number[], value: boolean) {
    if (!ids.length) return;
    const before = on;
    setOn((x) => ({ ...x, ...Object.fromEntries(ids.map((id) => [id, value])) }));  // se ve al instante
    setBusy(true);
    try {
      const r = await api.movementsGmf(ids, value);
      if ((r as { skipped?: number }).skipped) toast("Algunas no cambiaron", "Son de meses ya cerrados.", "bad");
      refresh();
    } catch (e) {
      setOn(before);
      toast("No se pudo cambiar", (e as Error).message, "bad");
    }
    setBusy(false);
  }

  const gmfOf = (m: Movement) => Math.round((m.cop_value + (m.fee_cop || 0)) * 0.004 * 100) / 100;
  const list = buys ?? [];
  const marked = list.filter((m) => on[m.id]);
  const total = marked.reduce((a, m) => a + ((m.gmf_cop || 0) > 0 ? m.gmf_cop : gmfOf(m)), 0);

  return (
    <Modal title={`4x1000 de tus compras ${year}`} onClose={onClose} wide>
      <p className="kind-hint" style={{ marginTop: -4 }}>
        Marca las compras en las que tu banco te cobró 4x1000. Las ventas no lo pagan. Todo Resultados se recalcula con esto.
      </p>
      {buys == null ? <div className="gmf-pick-empty">Cargando tus compras…</div> : !list.length ? <div className="gmf-pick-empty">No hay compras en {year}.</div> : (
        <>
          <div className="gmf-pick-bar">
            <span><b>{marked.length}</b> de {list.length} con 4x1000 · <b className="down">−{money(total)}</b></span>
            <div className="actions">
              <button className="btn btn-sm" disabled={busy} onClick={() => void mark(list.map((m) => m.id), true)}><Icon name="check" size={14} /> Todas</button>
              <button className="btn btn-sm" disabled={busy} onClick={() => void mark(list.map((m) => m.id), false)}><Icon name="x" size={14} /> Ninguna</button>
            </div>
          </div>
          <div className="gmf-pick">
            {list.map((m, i) => {
              const v = !!on[m.id];
              const amount = (m.gmf_cop || 0) > 0 ? m.gmf_cop : gmfOf(m);
              return (
                <label key={m.id} className={`gmf-pick-row ${v ? "on" : ""}`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                  <span className="gmf-pick-txt">
                    <b>{qty(m.in_qty)} {m.in_asset} por {money(m.cop_value + (m.fee_cop || 0))}</b>
                    <small>{date(m.t)} · {hourMin(m.t)}{m.pay_method ? ` · ${methodName(m.pay_method)}` : ""}</small>
                  </span>
                  <span className={`gmf-pick-val num ${v ? "down" : ""}`}>{v ? `−${money(amount)}` : "sin 4x1000"}</span>
                  <input type="checkbox" role="switch" checked={v} disabled={busy} onChange={(e) => void mark([m.id], e.target.checked)} />
                  <span className={`switch ${v ? "on" : ""}`} aria-hidden="true" />
                </label>
              );
            })}
          </div>
        </>
      )}
      <div className="form-actions">
        <button className="btn btn-primary" onClick={onClose}>Listo</button>
      </div>
    </Modal>
  );
}

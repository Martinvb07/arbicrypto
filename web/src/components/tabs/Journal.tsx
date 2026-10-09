"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { dateTime, money, signedMoney, tone } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { JournalEntry } from "@/lib/types";
import { ask, DateTimePicker } from "../overlay";
import { Icon, Segmented, Skeleton } from "../ui";

type Kind = JournalEntry["kind"];
const KINDS: [Kind, string][] = [["p2p", "P2P"], ["spot", "Spot"], ["otro", "Otro"]];

/** Fecha y hora local en el formato del campo datetime-local. */
const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

function AddForm({ onSaved }: { onSaved: () => void }) {
  const { toast } = useLive();
  const [when, setWhen] = useState(nowLocal());
  const [kind, setKind] = useState<Kind>("p2p");
  const [description, setDescription] = useState("");
  const [invested, setInvested] = useState("");
  const [received, setReceived] = useState("");
  const [estimated, setEstimated] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const gain = Number(received) - Number(invested);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addJournal({
        t: new Date(when).getTime() / 1000, kind, description, note,
        invested: Number(invested), received: Number(received), estimated: estimated === "" ? null : Number(estimated),
      });
      toast("Operación anotada", undefined, "good", 2500);
      setDescription(""); setInvested(""); setReceived(""); setEstimated(""); setNote(""); setWhen(nowLocal());
      onSaved();
    } catch (err) {
      toast("No se pudo anotar", (err as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={(e) => void submit(e)}>
      <div className="card-head">
        <h2>Anotar operación</h2>
        <Segmented label="Tipo de operación" value={kind} onChange={setKind} options={KINDS} />
      </div>
      <div className="journal-form">
        <div className="login-field">Fecha<DateTimePicker value={when} onChange={setWhen} /></div>
        <label className="login-field wide">Qué hiciste<input type="text" maxLength={200} placeholder="Ej: compré USDT a FrFk y vendí a INITIUM_CO" value={description} onChange={(e) => setDescription(e.target.value)} required /></label>
        <label className="login-field">Pagaste (con 4x1000)<span className="with-unit"><input type="number" min={1} step="any" value={invested} onChange={(e) => setInvested(e.target.value)} required /><span>COP</span></span></label>
        <label className="login-field">Recibiste<span className="with-unit"><input type="number" min={0} step="any" value={received} onChange={(e) => setReceived(e.target.value)} required /><span>COP</span></span></label>
        <label className="login-field">Ganancia que estimaba el panel<span className="with-unit"><input type="number" step="any" placeholder="opcional" value={estimated} onChange={(e) => setEstimated(e.target.value)} /><span>COP</span></span></label>
        <label className="login-field">Nota<input type="text" maxLength={500} placeholder="opcional" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <div className="toolbar" style={{ justifyContent: "space-between", marginTop: 4 }}>
        <span className="sub">{invested && received ? <>Ganancia real: <b className={`val ${tone(gain)}`}>{signedMoney(gain)}</b></> : "La ganancia se calcula sola"}</span>
        <button className="btn btn-brand" type="submit" disabled={busy}>{busy ? "Guardando…" : "Anotar"}</button>
      </div>
    </form>
  );
}

export function Journal() {
  const { state, toast } = useLive();
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const load = useCallback(() => {
    api.journal().then((r) => setEntries(r.entries)).catch(() => setEntries([]));
  }, []);
  useEffect(load, [load]);
  if (!state || !entries) return <Skeleton rows={8} />;

  const admin = state.user.role === "admin";
  const invested = entries.reduce((a, e) => a + e.invested, 0);
  const profit = entries.reduce((a, e) => a + (e.received - e.invested), 0);
  const withEst = entries.filter((e) => e.estimated != null);
  const diff = withEst.reduce((a, e) => a + (e.received - e.invested) - (e.estimated ?? 0), 0);
  const remove = async (id: number) => {
    if (!(await ask({ title: "¿Borrar esta operación?", body: "Se quita de la bitácora y del Excel. Esto no se puede deshacer.",
      confirm: "Borrar", tone: "danger", icon: "trash" }))) return;
    await api.deleteJournal(id).catch((e: Error) => toast("Error", e.message, "bad"));
    load();
  };

  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi"><small>Operaciones</small><b>{entries.length}</b><span>{admin ? "de todo el equipo" : "tuyas"}</span></div>
        <div className="kpi"><small>Ganancia real</small><b className={`val ${tone(profit)}`}>{signedMoney(profit)}</b><span>ya con todos los costos</span></div>
        <div className="kpi"><small>Promedio por operación</small><b className={`val ${tone(profit)}`}>{entries.length ? signedMoney(profit / entries.length) : "—"}</b><span>sobre {money(invested, 0)} pagados</span></div>
        <div className="kpi"><small>Real vs estimado</small><b className={`val ${tone(diff)}`}>{withEst.length ? signedMoney(diff) : "—"}</b><span>{withEst.length ? `en ${withEst.length} operaciones con estimado` : "anota la ganancia estimada"}</span></div>
      </div>

      <AddForm onSaved={load} />

      <div className="card">
        <div className="card-head">
          <h2>Operaciones {state.connected && <span className="badge good" title="Cada compra P2P seguida de su venta se anota sola">Se anotan solas desde Binance</span>}</h2>
          <a className="btn btn-sm" href="/api/journal.csv" download><Icon name="download" size={15} /> Exportar a Excel</a>
        </div>
        {!entries.length ? (
          <p className="muted">{state.connected ? "Todavía no hay operaciones. Se anotan solas cuando compras y vendes en P2P." : "Conecta tu cuenta en Mi Binance y tus operaciones P2P se anotan solas."}</p>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Fecha</th><th>Operación</th><th className="num hide-sm">Pagaste</th><th className="num hide-sm">Recibiste</th><th className="num">Ganancia</th><th className="num hide-sm">Estimada</th><th /></tr></thead>
              <tbody>
                {entries.map((e) => {
                  const g = e.received - e.invested;
                  return (
                    <tr key={e.id}>
                      <td className="dim">{dateTime(e.t * 1000)}</td>
                      <td>
                        <span className="tag">{e.kind === "p2p" ? "P2P" : e.kind === "spot" ? "Spot" : "Otro"}</span>
                        {e.auto && <span className="tag auto" title="Armada sola con tus órdenes P2P de Binance">Automática</span>} {e.description}
                        {(e.note || admin) && <div className="sub">{admin ? e.user : ""}{admin && e.note ? " · " : ""}{e.note}</div>}
                      </td>
                      <td className="num hide-sm">{money(e.invested, 0)}</td>
                      <td className="num hide-sm">{money(e.received, 0)}</td>
                      <td className="num"><b className={`val ${tone(g)}`}>{signedMoney(g)}</b></td>
                      <td className="num hide-sm dim">{e.estimated == null ? "—" : signedMoney(e.estimated)}</td>
                      <td className="num">{!e.auto && (admin || e.user === state.user.name) && <button className="btn btn-ghost btn-sm btn-danger" onClick={() => void remove(Number(e.id))} aria-label="Borrar"><Icon name="trash" size={15} /></button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="note"><Icon name="check" size={14} /> El archivo de Excel sirve como soporte de tus operaciones (por ejemplo, para tu declaración ante la DIAN).</p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, type PucAccount } from "@/lib/api";
import { fromLocalInput, money, parseNum, toLocalInput } from "@/lib/format";
import { Field, Icon, Modal, Note } from "./ui";
import { useWallet } from "./wallet";

const CLASSES: [string, string][] = [["activo", "Activo"], ["pasivo", "Pasivo"], ["patrimonio", "Patrimonio"], ["ingreso", "Ingresos"], ["gasto", "Gastos"], ["costo", "Costos"]];
type Line = { account: string; debit: string; credit: string };
const empty = (): Line => ({ account: "", debit: "", credit: "" });

/** Nota de contabilidad: el asiento manual que hace el contador (causaciones, reclasificaciones, ajustes). */
export function NoteModal({ onClose }: { onClose: () => void }) {
  const { toast, refresh } = useWallet();
  const [puc, setPuc] = useState<PucAccount[]>([]);
  const [dt, setDt] = useState(toLocalInput(Math.floor(Date.now() / 1000)));
  const [text, setText] = useState("");
  const [support, setSupport] = useState("");
  const [lines, setLines] = useState<Line[]>([empty(), empty()]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.puc().then((r) => setPuc(r.accounts), (e: Error) => setError(e.message)); }, []);

  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const debit = lines.reduce((s, l) => s + (parseNum(l.debit) ?? 0), 0);
  const credit = lines.reduce((s, l) => s + (parseNum(l.credit) ?? 0), 0);
  const diff = Math.round((debit - credit) * 100) / 100;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const t = fromLocalInput(dt);
    if (!Number.isFinite(t)) return setError("Revisa la fecha.");
    const used = lines.filter((l) => l.account || l.debit || l.credit);
    if (used.some((l) => !l.account)) return setError("Elige la cuenta de cada renglón.");
    if (used.length < 2) return setError("Una nota necesita al menos dos renglones.");
    if (diff !== 0) return setError(`Los débitos y los créditos no cuadran: diferencia ${money(diff)}.`);
    setBusy(true);
    try {
      await api.notaCrear({ t, text: text.trim(), support: support.trim(),
        lines: used.map((l) => ({ account: l.account, debit: parseNum(l.debit) ?? 0, credit: parseNum(l.credit) ?? 0 })) });
      toast("Nota de contabilidad registrada", text.trim(), "good");
      refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Nueva nota de contabilidad" onClose={onClose} wide>
      <form onSubmit={submit} className="stack">
        <div className="form form-3">
          <Field label="Fecha"><input type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} required /></Field>
          <Field label="Detalle"><input type="text" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} required placeholder="Ej.: causación honorarios contador octubre" /></Field>
          <Field label="Soporte (opcional)"><input type="text" value={support} onChange={(e) => setSupport(e.target.value)} maxLength={120} placeholder="Ej.: cuenta de cobro 012" /></Field>
        </div>
        <div className="table-wrap">
          <table className="t note-lines">
            <thead><tr><th>Cuenta</th><th className="r">Débito</th><th className="r">Crédito</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select value={l.account} onChange={(e) => set(i, { account: e.target.value })} aria-label="Cuenta">
                      <option value="">Elige la cuenta…</option>
                      {CLASSES.map(([cls, label]) => (
                        <optgroup key={cls} label={label}>
                          {puc.filter((a) => a.class === cls).map((a) => <option key={a.account} value={a.account}>{a.account} · {a.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td><input type="text" inputMode="decimal" className="num" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} placeholder="$ 0" aria-label="Débito" /></td>
                  <td><input type="text" inputMode="decimal" className="num" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} placeholder="$ 0" aria-label="Crédito" /></td>
                  <td className="r">{lines.length > 2 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} aria-label="Quitar renglón"><Icon name="x" size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><button type="button" className="btn btn-sm" onClick={() => setLines((ls) => [...ls, empty()])}><Icon name="plus" size={14} /> Renglón</button></td>
                <td className="r">{money(debit)}</td><td className="r">{money(credit)}</td>
                <td className={`r ${diff ? "warn" : "up"}`}>{diff ? `Dif. ${money(diff)}` : "Cuadra"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <Note>Las notas cambian los libros (diario, mayor, balances y estados), no el cálculo de la declaración, que sale de tus operaciones.
          Para un gasto deducible, regístralo como gasto en la caja o en Movimientos.</Note>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions" style={{ marginTop: 0 }}>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy || diff !== 0 || debit === 0}>{busy ? "Guardando…" : "Registrar nota"}</button>
        </div>
      </form>
    </Modal>
  );
}

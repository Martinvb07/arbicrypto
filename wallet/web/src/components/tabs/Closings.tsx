"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type AutoClose, type Closing, type ClosingDetail, type ClosingKind } from "@/lib/api";
import { date, dateTime, money, num, parseNum, signedMoney, tone } from "@/lib/format";
import { BalanceView, IncomeView } from "../Statements";
import { Badge, Empty, Icon, Modal, Note, Skeleton, Switch } from "../ui";
import { useWallet } from "../wallet";

const KIND_LABEL: Record<ClosingKind, string> = { caja: "Cuadre de caja", inicio: "Inicio de caja", mes: "Cierre de mes", anio: "Cierre de año" };
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "Octubre 2026", "Año 2026" o "Caja 10 oct 2026, 9:30". */
function period(c: Closing): string {
  const d = new Date(c.t * 1000);
  if (c.kind === "anio") return `Año ${d.getFullYear()}`;
  if (c.kind === "mes") return `${MONTHS[d.getMonth()][0].toUpperCase()}${MONTHS[d.getMonth()].slice(1)} ${d.getFullYear()}`;
  return `${c.kind === "inicio" ? "Inicio de caja" : "Caja"} ${dateTime(c.t)}`;
}

type Data = { closings: Closing[]; lock_until: number; cash_now: number; auto: AutoClose };

export function Closings({ embedded }: { embedded?: boolean }) {
  const { version, refresh, toast } = useWallet();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<ClosingDetail | null>(null);

  const load = useCallback(() => {
    api.cierres().then(setData, (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load, version]);
  const done = () => { refresh(); load(); };

  async function toggle(on: boolean) {
    try {
      const r = await api.cierreAuto(on);
      toast(on ? "Cierres automáticos activados" : "Cierres automáticos en pausa",
        r.made ? `Se hicieron ${r.made} cierres pendientes.` : undefined, "good");
      done();
    } catch (e) {
      toast("No se pudo cambiar", (e as Error).message, "bad");
    }
  }

  async function reopen(c: Closing) {
    const pause = c.locked ? " y los cierres automáticos quedan en pausa hasta que los actives otra vez" : "";
    if (!confirm(`¿Reabrir ${period(c)}? Se borra ese cierre${pause}.`)) return;
    try {
      await api.cierreReopen();
      toast("Cierre reabierto", undefined, "good");
      done();
    } catch (e) {
      toast("No se pudo reabrir", (e as Error).message, "bad");
    }
  }

  if (error) return <Note kind="bad">{error}</Note>;
  if (!data) return <Skeleton rows={4} />;
  const last = data.closings[data.closings.length - 1];

  return (
    <div className="stack">
      {!embedded && (
        <div className="page-head">
          <div>
            <h1>Cierres</h1>
            <p>Se hacen solos cada mes. Tú solo revisas.</p>
          </div>
        </div>
      )}

      <div className="card card-pad stack">
        <Switch on={data.auto.on} onChange={toggle} label="Cierres automáticos"
          hint="La caja se cierra sola cada día (Caja diaria). 3 días después de terminar cada mes, la app guarda la foto de tus libros y congela el mes. Diciembre cierra el año." />
        <AutoState auto={data.auto} />
      </div>

      <CashCard cashNow={data.cash_now} onDone={done} />

      <div className="card">
        <div className="card-head"><h2>Historial</h2></div>
        {!data.closings.length ? (
          <Empty icon="lock" title="Todavía no hay cierres">El primero se hace solo cuando termine el mes.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr><th>Periodo</th><th className="r">Caja</th><th className="r">Ajuste</th><th /></tr>
              </thead>
              <tbody>
                {data.closings.slice().reverse().map((c) => (
                  <tr key={c.id}>
                    <td className="nowrap">
                      {c.locked ? <Icon name="lock" size={13} /> : null} {period(c)}
                      <span className="cell-sub">{c.auto ? "Automático" : KIND_LABEL[c.kind]}</span>
                    </td>
                    <td className="r">{money(c.cash_real)}</td>
                    <td className={`r ${tone(c.adjustment)}`}>{Math.abs(c.adjustment) < 0.5 ? "Cuadra" : signedMoney(c.adjustment)}</td>
                    <td className="r">
                      <div className="row-actions">
                        <button className="btn btn-sm" onClick={() => api.cierre(c.id).then(setDetail)}>Ver</button>
                        {c.id === last?.id && <button className="btn btn-sm btn-ghost" onClick={() => reopen(c)}>Reabrir</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && <ClosingModal c={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function AutoState({ auto }: { auto: AutoClose }) {
  const next = auto.next;
  if (!next) return <p className="muted">Cuando tengas movimientos, el primer cierre se hace solo.</p>;
  const label = `${next.label[0].toUpperCase()}${next.label.slice(1)}${next.kind === "anio" ? " (cierra el año)" : ""}`;
  if (!auto.on) return <Note kind="warn"><b>En pausa.</b> {label} no se cierra hasta que los actives.</Note>;
  if (auto.reason) return <Note kind="warn"><b>{label} está pendiente.</b> {auto.reason}</Note>;
  if (auto.ready) return <p className="muted">{label} se cierra en la próxima hora.</p>;
  return <p className="muted">Próximo: <b>{label}</b>, el {date(next.due)}.</p>;
}

function CashCard({ cashNow, onDone }: { cashNow: number; onDone: () => void }) {
  const { toast } = useWallet();
  const [real, setReal] = useState("");
  const [busy, setBusy] = useState(false);
  const value = parseNum(real);
  const diff = value == null ? null : value - cashNow;

  async function save() {
    if (value == null) return;
    setBusy(true);
    try {
      await api.cuadrarCaja(value);
      toast("Caja cuadrada", diff && Math.abs(diff) >= 0.5 ? `Ajuste de ${signedMoney(diff)}` : "Tus libros ya decían lo mismo.", "good");
      setReal("");
      onDone();
    } catch (e) {
      toast("No se pudo guardar", (e as Error).message, "bad");
    }
    setBusy(false);
  }

  return (
    <div className="card card-pad stack">
      <div>
        <h2>Cuadrar caja <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· opcional</span></h2>
        <p className="muted" style={{ fontSize: 13.5 }}>
          Según tus libros tienes <b className={cashNow < 0 ? "warn" : ""}>{money(cashNow)}</b> en las cuentas que usas para cripto.
          Si no lo cuadras, el cierre del mes toma lo de tus libros.
        </p>
      </div>
      <div className="input-row">
        <input type="text" inputMode="decimal" className="num" value={real} onChange={(e) => setReal(e.target.value)}
          placeholder="¿Cuánto tienes de verdad hoy?" aria-label="Saldo real hoy" />
        <button className="btn btn-primary" disabled={busy || value == null} onClick={save}>{busy ? "Guardando…" : "Guardar"}</button>
      </div>
      {diff != null && Math.abs(diff) >= 0.5 && (
        <p className="muted" style={{ fontSize: 13 }}>
          Diferencia {signedMoney(diff)}: queda como {diff > 0 ? "aporte tuyo (plata que pusiste)" : "retiro tuyo (plata que sacaste)"}.
        </p>
      )}
    </div>
  );
}

function ClosingModal({ c, onClose }: { c: ClosingDetail; onClose: () => void }) {
  const s = c.snapshot;
  const y = new Date(c.t * 1000).getFullYear();
  return (
    <Modal title={`${period(c)} · ${KIND_LABEL[c.kind]}`} onClose={onClose} wide>
      <div className="stack print-area">
        <div className="kpis kpis-3">
          <div className="kpi"><small>Caja según libros</small><b>{money(c.cash_expected)}</b></div>
          <div className="kpi"><small>Caja real</small><b>{money(c.cash_real)}</b></div>
          <div className="kpi"><small>{c.adjustment >= 0 ? "Aporte registrado" : "Retiro registrado"}</small><b className={tone(c.adjustment)}>{signedMoney(c.adjustment)}</b></div>
        </div>
        {c.note && <p className="muted">{c.note}</p>}
        <h3 className="st-title">Balance general</h3>
        <BalanceView b={s.balance} />
        {s.income_month && <IncomeView i={s.income_month} label="Resultados del mes" />}
        <IncomeView i={s.income_year} label={`Resultados de ${y} hasta el cierre`} />
        {s.declaracion && (
          <div className="card card-pad">
            <h3 className="st-title">Declaración {y} (formulario 210)</h3>
            <div className="lines">
              {Object.entries(s.declaracion.casillas).filter(([, v]) => Math.abs(v) > 0.5).map(([k, v]) => (
                <div className="line" key={k}><span><span className="acc">{k}</span>Casilla {k}</span><span className="num">{money(v)}</span></div>
              ))}
              <div className="line total"><span>Impuesto estimado por las cripto</span><span className="num">{money(s.declaracion.tax_total)}</span></div>
            </div>
          </div>
        )}
        <p className="muted" style={{ fontSize: 12 }}>Foto guardada el {dateTime(c.created)}. {num(s.trial_year.rows.length)} cuentas · débitos = créditos: {s.trial_year.totals.balanced ? "sí" : "no"}.</p>
      </div>
      <div className="form-actions no-print">
        <button className="btn" onClick={() => window.print()}><Icon name="print" size={16} /> Imprimir</button>
        <button className="btn btn-primary" onClick={onClose}>Listo</button>
      </div>
    </Modal>
  );
}

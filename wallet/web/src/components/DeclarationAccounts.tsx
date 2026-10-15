"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type BankCategory, type BanksSummary, type Report } from "@/lib/api";
import { money, num, signedMoney, tone } from "@/lib/format";
import type { TabId } from "./App";
import { Select } from "./Select";
import { BankLogo, Icon, Skeleton } from "./ui";
import { useWallet } from "./wallet";

const fmtDay = (d: string | null) => (d ? new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(d + "T12:00:00Z")).replace(/\./g, "") : "—");
const PAGE = 12;

/** Declaración → tus cuentas: lo que entró y salió por los extractos y por Binance P2P, la suma que cuenta para el
 *  tope de consignaciones y los movimientos por clasificar (la clasificación cambia esa suma). */
export function DeclarationAccounts({ report, onTab }: { report: Report; onTab: (t: TabId) => void }) {
  const { year, version, refresh, toast } = useWallet();
  const [data, setData] = useState<BanksSummary | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let alive = true;
    api.bancos(year).then((d) => alive && setData(d), () => alive && setData(null));
    return () => { alive = false; };
  }, [year, version, tick]);

  const pending = useMemo(() => (data?.transactions ?? []).filter((t) => t.category === "otro" && t.amount > 0).slice().reverse(), [data]);
  if (!data) return <div className="card"><div className="card-body"><Skeleton rows={4} /></div></div>;

  const t = report.summary.topes;
  const bought = t.compras.value;
  const sold = Math.max(0, t.consignaciones.value - (report.extra.other_deposits || 0));  // ventas P2P (pesos que te entraron)
  const other = data.dian.deposits_other;
  const totalIn = data.accounts.reduce((a, x) => a + x.in, 0);
  const totalOut = data.accounts.reduce((a, x) => a + x.out, 0);
  const totalGmf = data.accounts.reduce((a, x) => a + x.gmf, 0);
  const applied = Math.round(report.extra.other_deposits || 0) === Math.round(other);
  const limit = t.consignaciones.limit;
  const sum = sold + other;

  async function apply() {
    if (!data) return;
    setBusy(true);
    try {
      await api.saveYearExtra(year, { ...report.extra, other_patrimony: Math.round(data.dian.bank_balances_end),
        other_deposits: Math.round(data.dian.deposits_other), gmf_cert: Math.round(data.dian.gmf_real) || report.extra.gmf_cert });
      toast("Listo", "Tu declaración ya usa lo de tus extractos", "good");
      refresh();
    } catch (e) {
      toast("No se pudo guardar", (e as Error).message, "bad");
    }
    setBusy(false);
  }

  async function classify(id: number, category: BankCategory) {
    try {
      await api.bancoTx(id, { category, similar: true });
      setTick((x) => x + 1);
      refresh();
    } catch (e) {
      toast("No se pudo cambiar", (e as Error).message, "bad");
    }
  }

  const names = data.category_names;
  const shown = all ? pending : pending.slice(0, PAGE);
  return (
    <div className="card dacc">
      <div className="card-head">
        <div>
          <h2>Tus cuentas</h2>
          <p className="sub">Lo que entró y salió en {year} según tus extractos y Binance P2P. Las consignaciones cuentan para el tope.</p>
        </div>
        <button className="btn btn-sm" onClick={() => onTab("cuentas")}><Icon name="upload" size={14} /> Subir extractos</button>
      </div>

      <div className="table-wrap">
        <table className="t dacc-table">
          <thead><tr><th>Cuenta</th><th className="r">Entró</th><th className="r">Salió</th><th className="r hide-sm">4x1000</th><th className="hide-sm">Extractos</th></tr></thead>
          <tbody>
            {data.accounts.map((a) => (
              <tr key={a.id}>
                <td><span className="dacc-name"><BankLogo name={a.name} kind={a.kind} size={26} /><b>{a.name}</b></span></td>
                {a.files ? <>
                  <td className="r up">{money(a.in)}</td>
                  <td className="r down">{money(a.out)}</td>
                  <td className="r hide-sm">{money(a.gmf)}</td>
                  <td className="hide-sm muted">{a.files} · {fmtDay(a.day_from)} a {fmtDay(a.day_to)}</td>
                </> : <td colSpan={4}><button className="link warn" onClick={() => onTab("cuentas")}>Sin extractos: súbelos para que cuenten</button></td>}
              </tr>
            ))}
            <tr className="dacc-p2p">
              <td><span className="dacc-name"><span className="dacc-bn">B</span><b>Binance P2P</b></span><span className="cell-sub">Vendiste (te entró) · compraste (pagaste)</span></td>
              <td className="r up">{money(sold)}</td>
              <td className="r down">{money(bought)}</td>
              <td className="r hide-sm muted">—</td>
              <td className="hide-sm muted">Desde tu Binance</td>
            </tr>
          </tbody>
          <tfoot>
            <tr><td>Total extractos</td><td className="r">{money(totalIn)}</td><td className="r">{money(totalOut)}</td><td className="r hide-sm">{money(totalGmf)}</td><td className="hide-sm" /></tr>
          </tfoot>
        </table>
      </div>

      <div className="dacc-sum">
        <div className="lines">
          <div className="line"><span>Ventas en Binance P2P<span className="cell-sub">Pesos que te consignaron los compradores</span></span><span className="num">{money(sold)}</span></div>
          <div className="line"><span>+ Otras consignaciones de tus extractos<span className="cell-sub">Sin traslados entre tus cuentas ni lo de Binance (ya va arriba)</span></span><span className="num">{money(other)}</span></div>
          <div className="line total"><span>Consignaciones para el tope</span><span className={`num ${sum >= limit ? "down" : ""}`}>{money(sum)}</span></div>
        </div>
        <div className="dacc-bar"><i style={{ width: `${Math.min(100, (sum / limit) * 100)}%` }} className={sum >= limit ? "over" : ""} /></div>
        <p className="small-print">{sum >= limit ? `Pasaste el tope de ${money(limit)}: declaras.` : `Te faltan ${money(limit - sum)} para el tope de ${money(limit)}.`}</p>
        {applied ? (
          <p className="dacc-ok"><Icon name="check" size={14} /> Tu declaración ya usa lo de tus extractos</p>
        ) : (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void apply()}><Icon name="check" size={14} /> {busy ? "Guardando…" : "Usar en mi declaración"}</button>
        )}
      </div>

      {pending.length > 0 && (
        <div className="dacc-pending">
          <div className="dacc-pending-head">
            <b>Entradas sin clasificar ({num(pending.length)})</b>
            <span className="muted">Dile a la app qué son: si fue un traslado entre tus cuentas o algo de Binance, no cuenta dos veces. Se aplica a las parecidas.</span>
          </div>
          {shown.map((x) => (
            <div key={x.id} className="dacc-row">
              <span className="dacc-row-txt"><b>{x.description}</b><small>{fmtDay(x.day)} · {data.accounts.find((a) => a.id === x.account_id)?.name ?? "—"}</small></span>
              <b className={`num ${tone(x.amount)}`}>{signedMoney(x.amount)}</b>
              <Select label="Categoría" value={x.category} floating searchable={false} className="cat-select pending"
                onChange={(v) => void classify(x.id, v as BankCategory)}
                options={(Object.keys(names) as BankCategory[]).map((c) => ({ value: c, label: names[c], icon: <span className={`cat-dot cat-${c}`} /> }))} />
            </div>
          ))}
          {pending.length > PAGE && (
            <button className="link" onClick={() => setAll(!all)}>{all ? "Ver menos" : `Ver las ${num(pending.length)}`}</button>
          )}
        </div>
      )}
    </div>
  );
}

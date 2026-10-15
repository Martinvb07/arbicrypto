"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, type Report, type Tope, type YearExtra } from "@/lib/api";
import { currentYear, date, dateTime, money, num, parseNum, qty, signedMoney, tone } from "@/lib/format";
import type { TabId } from "../App";
import { DeclarationAccounts } from "../DeclarationAccounts";
import { CopyBoxes, HowToFile, TodoList, useTodos } from "../DeclarationParts";
import { ImportModal } from "../ImportModal";
import { TopesList, willFile } from "../Topes";
import { Asset, Field, Icon, Note, Skeleton } from "../ui";
import { useWallet } from "../wallet";
import { ExcelButton } from "./CryptoBook";

type Step = "revisa" | "casillas" | "presenta";

function Line({ label, v, signed, total, hint }: { label: string; v: number; signed?: boolean; total?: boolean; hint?: string }) {
  return (
    <div className={`line ${total ? "total" : ""}`}>
      <span>{label}{hint && <span className="cell-sub">{hint}</span>}</span>
      <span className={`num ${signed ? tone(v) : ""}`}>{signed ? signedMoney(v) : money(v)}</span>
    </div>
  );
}

export function Declaration({ onTab }: { onTab: (t: TabId) => void }) {
  const { report, reportError } = useWallet();
  if (reportError) return <Note kind="bad">{reportError}</Note>;
  if (!report) return <Skeleton rows={6} />;
  return <DeclarationBody report={report} onTab={onTab} />;
}

function DeclarationBody({ report, onTab }: { report: Report; onTab: (t: TabId) => void }) {
  const { year, me } = useWallet();
  const [upload, setUpload] = useState(false);
  const [detail, setDetail] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [step, setStep] = useState<Step>("revisa");
  const todos = useTodos(report, onTab, () => setUpload(true));
  const s = report.summary;
  const f = s.f210;
  const p = report.profile;
  const live = year >= currentYear();
  const over = (Object.entries(s.topes) as [string, Tope][]).filter(([, t]) => t.over);
  const mustFile = over.length > 0;
  const soon = willFile(report);
  const TOPE_NAME: Record<string, string> = { patrimonio: "patrimonio", ingresos: "ingresos", consignaciones: "consignaciones", compras: "compras" };

  const printIt = () => {
    setDetail(true);
    setTimeout(() => window.print(), 150);
  };

  let deadlineBig: string, deadlineSmall: React.ReactNode;
  if (live) {
    deadlineBig = `Ago – oct ${year + 1}`;
    deadlineSmall = "La DIAN publica el calendario a fin de año";
  } else if (!p.nit) {
    deadlineBig = "Falta tu cédula";
    deadlineSmall = <button className="link" onClick={() => onTab("ajustes")}>Escríbela en Ajustes</button>;
  } else if (report.deadline) {
    const days = Math.ceil((Date.parse(report.deadline + "T23:59:59-05:00") - Date.now()) / 86400000);
    deadlineBig = date(Date.parse(report.deadline + "T12:00:00-05:00") / 1000);
    deadlineSmall = days > 1 ? `Faltan ${days} días` : days === 1 ? "Vence mañana" : days === 0 ? "Vence hoy" : `Venció hace ${-days} días: preséntala ya`;
  } else {
    deadlineBig = "Sin calendario";
    deadlineSmall = "Aún no está publicado";
  }

  const c87 = f.casillas["87"] || 0;
  const taxSmall = s.tax_total > 0
    ? (report.extra.other_income > 0 ? "Sumando tus otros ingresos" : "Si no tienes otros ingresos")
    : c87 > 0 ? `Tu ganancia de ${money(c87)} está en la parte que no paga (hasta ${money(1090 * s.uvt)})`
    : "No hubo ganancia";

  const verdict = mustFile ? "yes" : soon ? "maybe" : "no";
  const verdictTitle = mustFile ? (live ? `Sí, declaras en ${year + 1}` : "Sí, debes declarar")
    : soon ? "Probablemente declares" : live ? "Por ahora no declaras" : "Por tus cripto, no declaras";
  const verdictWhy = mustFile ? `Pasas el tope de ${new Intl.ListFormat("es", { type: "conjunction" }).format(over.map(([k]) => TOPE_NAME[k]))}.`
    : soon ? "A este ritmo pasas un tope antes del 31 de diciembre."
    : "No llegas a ninguno de los topes con tus cripto. Si tienes salario u otros bienes, escríbelos en el paso 1.";
  const blocking = todos.filter((t) => !t.optional).length;
  const STEPS: { id: Step; n: number; title: string; sub: string; done: boolean }[] = [
    { id: "revisa", n: 1, title: "Revisa", sub: blocking ? `Falta${blocking > 1 ? "n" : ""} ${blocking} cosa${blocking > 1 ? "s" : ""}` : "Todo completo", done: !blocking },
    { id: "casillas", n: 2, title: "Copia las casillas", sub: "Formulario 210", done: false },
    { id: "presenta", n: 3, title: "Presenta", sub: live ? `En ${year + 1}` : "En la DIAN", done: false },
  ];

  return (
    <div className="stack">
      <div className="page-head no-print">
        <div>
          <h1>Declaración {year}</h1>
          <p>{live ? `Así vas este año. La presentas en ${year + 1}.` : "Tres pasos para presentarla en la DIAN."}</p>
        </div>
        <div className="actions">
          <button className="btn btn-icon" onClick={printIt} title="Imprimir resumen" aria-label="Imprimir"><Icon name="print" size={16} /></button>
          <ExcelButton />
        </div>
      </div>

      <div className={`card verdict-card ${verdict} no-print`}>
        <div className="verdict-main">
          <span className="verdict-ic"><Icon name={verdict === "no" ? "check" : "alert"} size={22} /></span>
          <div>
            <small>{live ? `¿Declaras en ${year + 1}?` : "¿Debes declarar?"}</small>
            <h2>{verdictTitle}</h2>
            <p>{verdictWhy}</p>
          </div>
        </div>
        <div className="verdict-stats">
          <div><small>Impuesto por tus cripto</small><b>{money(s.tax_total)}</b><span>{taxSmall}</span></div>
          <div><small>Fecha límite</small><b>{deadlineBig}</b><span>{deadlineSmall}</span></div>
        </div>
      </div>

      <div className="steps-nav no-print" role="tablist" aria-label="Pasos">
        {STEPS.map((x) => (
          <button key={x.id} role="tab" aria-selected={step === x.id} className={`step-tab ${step === x.id ? "on" : ""} ${x.done ? "done" : ""}`} onClick={() => setStep(x.id)}>
            <span className="step-n">{x.done ? <Icon name="check" size={14} /> : x.n}</span>
            <span><b>{x.title}</b><small>{x.sub}</small></span>
          </button>
        ))}
      </div>

      {step === "revisa" && (
        <div className="stack no-print">
          <TodoList todos={todos} />
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Los topes que obligan a declarar</h2>
                <p className="sub">Si pasas uno solo, declaras. Valores {year} en pesos.</p>
              </div>
            </div>
            <TopesList report={report} />
          </div>
          <DeclarationAccounts report={report} onTab={onTab} />
          <div className="card">
            <button className="fold" onClick={() => setExtraOpen(!extraOpen)} aria-expanded={extraOpen}>
              <span><b>¿Tienes salario, arriendos u otros bienes?</b><span className="cell-sub">Escríbelos para saber si debes declarar y cuánto pagarías en total. Opcional.</span></span>
              <Icon name="chevron" size={18} />
            </button>
            {extraOpen && <ExtraForm key={year} initial={report.extra} />}
          </div>
          <div className="step-next"><button className="btn btn-primary" onClick={() => setStep("casillas")}>Siguiente: copiar las casillas <Icon name="arrowRight" size={15} /></button></div>
        </div>
      )}

      {step === "casillas" && (
        <div className="stack no-print">
          <CopyBoxes report={report} />
          <div className="card">
            <div className="card-head">
              <div>
                <h2>{live ? "Tus cripto hoy" : `Tus cripto al 31 de diciembre de ${year}`}</h2>
                <p className="sub">Van en la casilla 29 por lo que te costaron, no por lo que valen (art. 267 ET).</p>
              </div>
            </div>
            {!report.holdings.length ? (
              <div className="card-body"><p className="muted">{live ? "Hoy no tienes cripto: todo está en pesos." : "No tenías cripto al cierre del año."}</p></div>
            ) : (
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>Cripto</th><th className="r">Cantidad</th><th className="r">Te costó</th><th className="r hide-sm">Desde</th></tr></thead>
                  <tbody>
                    {report.holdings.map((h) => (
                      <tr key={h.asset}><td><Asset asset={h.asset} /></td><td className="r">{qty(h.qty)}</td><td className="r"><b>{money(h.cost)}</b></td><td className="r hide-sm muted">{date(h.since)}</td></tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={2}>Total casilla 29</td><td className="r">{money(report.holdings.reduce((a, h) => a + h.cost, 0))}</td><td className="hide-sm" /></tr></tfoot>
                </table>
              </div>
            )}
          </div>
          <div className="step-next">
            <button className="btn btn-ghost" onClick={() => setStep("revisa")}>Atrás</button>
            <button className="btn btn-primary" onClick={() => setStep("presenta")}>Siguiente: presentar <Icon name="arrowRight" size={15} /></button>
          </div>
        </div>
      )}

      {step === "presenta" && (
        <div className="stack no-print">
          <div className="grid-2">
            <HowToFile report={report} />
            <div className="card card-pad">
              <h2 style={{ marginBottom: 12 }}>Para tu contador</h2>
              <div className="dl-list">
                <a className="dl-row" href={`/api/export/paquete-contador.zip?year=${year}`} download>
                  <span className="dl-ic"><Icon name="download" size={16} /></span>
                  <span><b>Paquete completo (.zip)</b><small>El Excel y todos los CSV</small></span>
                </a>
                <a className="dl-row" href={`/api/export/movimientos.csv?year=${year}`} download>
                  <span className="dl-ic"><Icon name="list" size={16} /></span>
                  <span><b>Movimientos</b><small>Cada compra, venta y cambio</small></span>
                </a>
                <a className="dl-row" href={`/api/export/ganancias.csv?year=${year}`} download>
                  <span className="dl-ic"><Icon name="trend" size={16} /></span>
                  <span><b>Ganancias</b><small>Lo que ganaste en cada venta</small></span>
                </a>
                <a className="dl-row" href={`/api/export/patrimonio.csv?year=${year}`} download>
                  <span className="dl-ic"><Icon name="wallet" size={16} /></span>
                  <span><b>Patrimonio</b><small>Tus cripto al cierre</small></span>
                </a>
              </div>
              <h3 className="dl-title">Guarda también</h3>
              <ul className="checklist">
                <li>El certificado del 4x1000 de cada banco (para restar la mitad).</li>
                <li>Los extractos de las cuentas con que pagaste y recibiste en P2P.</li>
                <li>El historial de Binance del año.</li>
              </ul>
            </div>
          </div>
          <div className="step-next"><button className="btn btn-ghost" onClick={() => setStep("casillas")}>Atrás</button></div>
        </div>
      )}

      <div className="no-print" style={{ display: "flex", justifyContent: "center" }}>
        <button className="btn btn-ghost" onClick={() => setDetail(!detail)}>{detail ? "Ocultar el detalle" : "Ver el cálculo completo, casilla por casilla"} <Icon name="chevronDown" size={14} /></button>
      </div>

      {detail && (
        <div className="card card-pad doc">
          <div className="doc-head">
            <div>
              <h1 style={{ fontSize: 19 }}>Criptoactivos · año gravable {year}{live ? " (parcial)" : ""}</h1>
              <p className="muted">Resumen para la declaración de renta de persona natural (formulario 210)</p>
            </div>
            <dl>
              <dt>Contribuyente</dt><dd>{p.name || me.user.username}</dd>
              <dt>Cédula / NIT</dt><dd>{p.nit || "—"}</dd>
              <dt>Método de costo</dt><dd>{p.method === "fifo" ? "PEPS" : "Promedio ponderado"}</dd>
              <dt>Operación habitual</dt><dd>{p.habitual ? "Sí (activos movibles)" : "No (activos fijos)"}</dd>
              <dt>Generado</dt><dd>{dateTime(Date.now() / 1000)}</dd>
            </dl>
          </div>

          <section className="doc-section">
            <h3>Patrimonio</h3>
            <div className="lines">
              <Line label="Criptoactivos a costo fiscal al 31 de diciembre" v={f.patrimonio_bruto} total hint="Casilla 29 (patrimonio bruto), junto a tus demás bienes. Art. 267 ET." />
            </div>
            {report.holdings.length > 0 && (
              <table className="t" style={{ marginTop: 6 }}>
                <thead><tr><th>Cripto</th><th className="r">Cantidad</th><th className="r">Costo fiscal</th></tr></thead>
                <tbody>
                  {report.holdings.map((h) => (
                    <tr key={h.asset}><td>{h.asset}</td><td className="r">{qty(h.qty)}</td><td className="r">{money(h.cost)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="doc-section">
            <h3>Cédula general · rentas no laborales</h3>
            <div className="lines">
              <Line label="Casilla 74 · Ingresos brutos" v={f.no_laborales.ingresos} hint="Valor de ventas y permutas de menos de 2 años o habituales, más ingresos en cripto" />
              <Line label="Casilla 77 · Costos y deducciones procedentes" v={f.no_laborales.costos} hint="Costo fiscal de lo vendido + comisiones" />
              <Line label="Casilla 78 · Renta líquida" v={f.casillas["78"]} />
              <Line label="Casilla 84 · 50 % del 4x1000 (deducción imputable)" v={f.casillas["84"]}
                hint={`Art. 115 ET. Pagado: ${money(s.gmf.paid)}${s.gmf.cert > 0 ? " (certificado del banco)" : " (calculado: $4.000 por millón comprado)"}.`} />
              {f.casillas["88"] > 0
                ? <Line label="Casilla 88 · Pérdida líquida (se compensa en años siguientes)" v={-f.casillas["88"]} signed total />
                : <Line label="Casilla 87 · Renta líquida ordinaria (después del 4x1000)" v={f.casillas["87"]} signed total />}
            </div>
          </section>

          <section className="doc-section">
            <h3>Ganancias ocasionales</h3>
            <div className="lines">
              <Line label="Casilla 112 · Ingresos por ganancias ocasionales" v={f.ganancia_ocasional.ingresos} hint="Cripto tenidas 2 años o más (si no eres habitual) y airdrops" />
              <Line label="Casilla 113 · Costos" v={f.ganancia_ocasional.costos} />
              <Line label="Casilla 115 · Ganancia ocasional gravable" v={f.ganancia_ocasional.gravable} total />
            </div>
          </section>

          <section className="doc-section">
            <h3>Impuesto estimado por las cripto</h3>
            <div className="lines">
              <Line label="Renta (tabla art. 241 ET)" v={s.ro.tax}
                hint={report.extra.other_income > 0 ? `Lo que suben las cripto sobre tus otras rentas de ${money(report.extra.other_income)}` : "Sin otras rentas registradas este año"} />
              <Line label="Casilla 127 · Ganancia ocasional (15 %, art. 314 ET)" v={s.go.tax} />
              <Line label="Total estimado" v={s.tax_total} total />
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
              No incluye retenciones, anticipo, descuentos ni rentas exentas de otras fuentes. UVT {year}: {money(s.uvt)}.
            </p>
          </section>

          <section className="doc-section">
            <h3>Datos de apoyo</h3>
            <div className="lines">
              <Line label="Pesos pagados comprando cripto" v={s.totals.bought_cop} />
              <Line label="Pesos recibidos vendiendo cripto" v={s.totals.sold_cop} />
              <Line label="4x1000 pagado" v={s.gmf.paid}
                hint={s.gmf.cert > 0 ? `Certificado del banco · calculado: ${money(s.gmf.estimated)}` : "0,4 % de cada compra pagada desde el banco"} />
              <Line label="Comisiones en pesos" v={s.totals.fees} />
              <div className="line"><span>Ventas y permutas registradas</span><span className="num">{num(report.disposals.length)}</span></div>
            </div>
            {report.warnings_total > 0 && (
              <Note kind="warn"><b>{report.warnings_total === 1 ? "1 venta sin compra registrada quedó" : `${report.warnings_total} ventas sin compra registrada quedaron`}</b> con costo $0. Complétalas antes de declarar.</Note>
            )}
          </section>

          <section className="doc-section">
            <h3>Soportes que debes guardar</h3>
            <ul className="checklist">
              <li>Historial de operaciones de Binance (y de otros exchanges) del año y de las compras anteriores.</li>
              <li>Los CSV de esta app: <a href={`/api/export/movimientos.csv?year=${year}`} download>movimientos</a>, <a href={`/api/export/ganancias.csv?year=${year}`} download>ganancias</a> y <a href={`/api/export/patrimonio.csv?year=${year}`} download>patrimonio</a>.</li>
              <li>Certificado del 4x1000 de cada banco o billetera (para deducir el 50 %).</li>
              <li>Extractos de las cuentas donde pagaste y recibiste pesos en P2P.</li>
              <li>Documento soporte en compras a personas no obligadas a facturar (art. 771-2 ET, Decreto 1625 de 2016 art. 1.6.1.4.12): confirma con tu contador si te aplica.</li>
            </ul>
          </section>

          <section className="doc-section">
            <h3>Para tener en cuenta</h3>
            <ul className="checklist">
              <li>Cada permuta (cripto por cripto) es una enajenación: genera ganancia o pérdida (Concepto DIAN 1621 de 2023).</li>
              <li>Los valores en dólares se pasan a pesos con la TRM del día de cada operación (art. 269 ET).</li>
              {s.exterior.over && <li><b>Formulario 160:</b> tus cripto superan 2.000 UVT ({money(s.exterior.limit)}) al 1 de enero de {s.exterior.year}. Si están en un exchange del exterior, revisa con tu contador si debes declarar activos en el exterior.</li>}
              {s.ro.loss > 0 && <li>Pérdida de {money(s.ro.loss)} en rentas no laborales: se puede compensar con rentas de años siguientes (art. 330 ET).</li>}
              <li>Desde el año 2026 los proveedores de cripto reportan a la DIAN bajo el estándar CARF (Resolución 000240 de 2025).</li>
            </ul>
          </section>

          <p className="muted" style={{ fontSize: 12 }}>
            Cálculo informativo hecho con ArbiCrypto Wallet según el Estatuto Tributario y el Concepto Unificado DIAN 1621 de 2023.
            No reemplaza la revisión de un contador público.
          </p>
        </div>
      )}

      {upload && <ImportModal onClose={() => setUpload(false)} />}
    </div>
  );
}

function ExtraForm({ initial }: { initial: YearExtra }) {
  const { year, toast, refresh } = useWallet();
  const fmt = (v: number) => (v ? num(v) : "");
  const [income, setIncome] = useState(fmt(initial.other_income));
  const [patrimony, setPatrimony] = useState(fmt(initial.other_patrimony));
  const [deposits, setDeposits] = useState(fmt(initial.other_deposits));
  const [gmfCert, setGmfCert] = useState(fmt(initial.gmf_cert));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setIncome(fmt(initial.other_income));
    setPatrimony(fmt(initial.other_patrimony));
    setDeposits(fmt(initial.other_deposits));
    setGmfCert(fmt(initial.gmf_cert));
  }, [initial]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.saveYearExtra(year, {
        other_income: parseNum(income) ?? 0, other_patrimony: parseNum(patrimony) ?? 0, other_deposits: parseNum(deposits) ?? 0,
        gmf_cert: parseNum(gmfCert) ?? 0,
      });
      toast("Datos guardados", undefined, "good");
      refresh();
    } catch (err) {
      toast("No se pudo guardar", (err as Error).message, "bad");
    }
    setBusy(false);
  }

  return (
    <form className="card-body no-print" onSubmit={save} id="otros-datos" style={{ paddingTop: 4 }}>
      <div className="form form-4">
        <Field label="Renta gravable de otras fuentes" hint="Salario, honorarios o arriendos, ya restadas las rentas exentas.">
          <input type="text" inputMode="decimal" className="num" value={income} onChange={(e) => setIncome(e.target.value)} placeholder="$ 0" />
        </Field>
        <Field label="Otro patrimonio al 31/12" hint="Casa, carro, cuentas bancarias, inversiones.">
          <input type="text" inputMode="decimal" className="num" value={patrimony} onChange={(e) => setPatrimony(e.target.value)} placeholder="$ 0" />
        </Field>
        <Field label="Otras consignaciones del año" hint="Lo que entró a tus cuentas aparte de ventas de cripto.">
          <input type="text" inputMode="decimal" className="num" value={deposits} onChange={(e) => setDeposits(e.target.value)} placeholder="$ 0" />
        </Field>
        <Field label="4x1000 del certificado del banco" hint="Si lo tienes, reemplaza el cálculo automático.">
          <input type="text" inputMode="decimal" className="num" value={gmfCert} onChange={(e) => setGmfCert(e.target.value)} placeholder="$ 0" />
        </Field>
      </div>
      <div className="form-actions" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button>
      </div>
    </form>
  );
}

"use client";

import { useState } from "react";
import type { Report } from "@/lib/api";
import { currentYear, date, longDate, money } from "@/lib/format";
import type { TabId } from "./App";
import { ImportModal } from "./ImportModal";
import { Icon } from "./ui";
import { useWallet } from "./wallet";

type Todo = { id: string; text: string; why: string; button: string; go: () => void; optional?: boolean };

/** Solo lo que falta, en palabras simples. */
export function useTodos(report: Report, onTab: (t: TabId) => void, onUpload: () => void): Todo[] {
  const { binance: b } = useWallet();
  const todos: Todo[] = [];
  const fresh = !!b?.last_ok && Date.now() / 1000 - b.last_ok < 2 * 86400;
  if (!b?.connected) {
    todos.push({ id: "binance", text: "Conecta tu Binance", why: "Con eso la app trae todas tus operaciones sola.", button: "Conectar", go: () => onTab("resumen") });
  } else if (b.last_error) {
    todos.push({ id: "binance", text: "Binance no se pudo actualizar", why: b.last_error, button: "Ver", go: () => onTab("resumen") });
  } else if (!fresh && b.job.state !== "running") {
    todos.push({ id: "binance", text: "Binance aún no termina de traer tu historial", why: "Espera unos minutos.", button: "Ver", go: () => onTab("resumen") });
  }
  if (b?.connected && !b.has_old_p2p && b.p2p_api_from) {
    todos.push({
      id: "p2p", text: `Sube tus P2P de antes del ${date(b.p2p_api_from)}`,
      why: "Binance no los entrega solos. Descárgalos en Binance: P2P → Órdenes → Exportar.", button: "Subir archivo", go: onUpload, optional: true,
    });
  }
  if (report.cuadre && !report.cuadre.ok) {
    const n = report.cuadre.rows.filter((r) => !r.ok).length;
    todos.push({ id: "cuadre", text: `${n} cripto no cuadran con tu Binance`, why: "Falta algún movimiento, por ejemplo algo que trajiste de otra plataforma.", button: "Revisar", go: () => onTab("patrimonio") });
  }
  if (report.warnings_total > 0) {
    const n = report.warnings_total;
    todos.push({ id: "costo", text: `${n} venta${n > 1 ? "s" : ""} sin su compra`, why: "Sin la compra, la app no sabe cuánto ganaste y pagarías de más.", button: "Revisar", go: () => onTab("ganancias") });
  }
  if (report.unvalued > 0) {
    todos.push({ id: "pesos", text: `${report.unvalued} movimiento${report.unvalued > 1 ? "s" : ""} sin valor en pesos`, why: "Edítalos y toca Calcular.", button: "Revisar", go: () => onTab("movimientos") });
  }
  if (!report.profile.nit || !report.profile.name) {
    todos.push({ id: "perfil", text: "Escribe tu nombre y cédula", why: "Para tu fecha límite y el resumen.", button: "Escribir", go: () => onTab("ajustes") });
  }
  return todos;
}

export function TodoList({ todos }: { todos: Todo[] }) {
  if (!todos.length) {
    return (
      <div className="card todo-ok">
        <span className="verdict-icon no"><Icon name="check" size={20} /></span>
        <div><b>No falta nada</b><span className="cell-sub">Tus operaciones están completas y cuadran con Binance.</span></div>
      </div>
    );
  }
  return (
    <div className="card">
      <div className="card-head"><h2>Antes de declarar</h2></div>
      <div className="checks">
        {todos.map((t) => (
          <div key={t.id} className={`check-row ${t.optional ? "opt" : "bad"}`}>
            <span className="check-ic"><Icon name={t.optional ? "info" : "alert"} size={15} /></span>
            <div><b>{t.text}</b><span className="cell-sub">{t.why}</span></div>
            <button className="btn btn-sm" onClick={t.go}>{t.button}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Aviso corto en Resumen para el año que se declara. */
export function DeclarationBanner({ report, onTab }: { report: Report; onTab: (t: TabId) => void }) {
  const [upload, setUpload] = useState(false);
  const todos = useTodos(report, onTab, () => setUpload(true)).filter((t) => !t.optional);
  return (
    <div className="card ready-line">
      <span className={`verdict-icon ${todos.length ? "yes" : "no"}`}><Icon name={todos.length ? "alert" : "check"} size={20} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b>{todos.length ? `Para declarar el ${report.year} te falta${todos.length > 1 ? "n" : ""} ${todos.length} cosa${todos.length > 1 ? "s" : ""}` : `Tu declaración del ${report.year} está lista`}</b>
        <span className="cell-sub">{todos.length ? todos.map((t) => t.text).join(" · ") : "Ve a Declaración y copia los valores en la DIAN."}</span>
      </div>
      <button className="btn btn-sm btn-primary" onClick={() => onTab("declaracion")}>Ir a declaración</button>
      {upload && <ImportModal onClose={() => setUpload(false)} />}
    </div>
  );
}

const BOXES: { n: string; name: string; hint: string; show?: (r: Report) => boolean }[] = [
  { n: "29", name: "Tus cripto (patrimonio)", hint: "Lo que pagaste por las cripto que tenías el 31 de diciembre" },
  { n: "74", name: "Lo que vendiste y cambiaste", hint: "Ventas, cambios entre cripto y ganancias de Earn" },
  { n: "77", name: "Lo que te costó", hint: "Lo que pagaste por lo que vendiste, más comisiones" },
  { n: "84", name: "La mitad del 4x1000", hint: "Pide el certificado del 4x1000 a tu banco" },
  { n: "112", name: "Ventas de cripto que tenías hace más de 2 años", hint: "Van aparte: pagan 15 %", show: (r) => r.summary.f210.casillas["112"] > 0 },
  { n: "113", name: "Lo que te costaron esas cripto", hint: "", show: (r) => r.summary.f210.casillas["112"] > 0 },
];

/** Los valores para copiar en el formulario 210. */
export function CopyBoxes({ report }: { report: Report }) {
  const { toast } = useWallet();
  const c = report.summary.f210.casillas;
  const live = report.year >= currentYear();
  const rows = BOXES.filter((x) => !x.show || x.show(report));

  const copy = async (n: string, v: number) => {
    const text = String(Math.round(v));
    try {
      await navigator.clipboard.writeText(text);
      toast(`Casilla ${n} copiada`, money(v), "good");
    } catch {
      toast(`Casilla ${n}`, text);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{live ? "Así quedaría tu formulario si el año cerrara hoy" : "Copia esto en el formulario de la DIAN"}</h2>
          <p className="sub">Formulario 210 · cada número va en la casilla que dice</p>
        </div>
      </div>
      <div className="boxes">
        {rows.map((x) => (
          <div key={x.n} className="box-row">
            <span className="casilla">{x.n}</span>
            <div className="box-txt"><b>{x.name}</b>{x.hint && <span className="cell-sub">{x.hint}</span>}</div>
            <b className="num box-val">{money(c[x.n] ?? 0)}</b>
            {!live && <button className="btn btn-sm" onClick={() => copy(x.n, c[x.n] ?? 0)}><Icon name="copy" size={14} /> Copiar</button>}
          </div>
        ))}
      </div>
      <div className="card-body box-foot">
        <span className="muted">La DIAN calcula sola el resto. Te debe dar una ganancia de <b>{money(c["87"] || 0)}</b>
          {c["88"] > 0 && <> o una pérdida de <b>{money(c["88"])}</b></>}.</span>
      </div>
    </div>
  );
}

/** Pasos para presentar en la DIAN. */
export function HowToFile({ report }: { report: Report }) {
  return (
    <div className="card card-pad">
      <h2 style={{ marginBottom: 12 }}>Cómo presentarla</h2>
      <ol className="steps big">
        <li>Entra a <a href="https://www.dian.gov.co" target="_blank" rel="noopener noreferrer">dian.gov.co</a> → <b>Usuario registrado</b>.</li>
        <li>Abre el <b>Formulario 210</b> del año {report.year}.</li>
        <li>Copia los valores de arriba en sus casillas. Si tienes salario o casa, la DIAN ya trae casi todo cargado.</li>
        <li>Firma con tu <b>firma electrónica</b> y presenta.</li>
        <li>Si sale valor a pagar, genera el <b>recibo 490</b> y paga por PSE{report.deadline ? <> antes del <b>{longDate(report.deadline)}</b></> : ""}.</li>
      </ol>
    </div>
  );
}

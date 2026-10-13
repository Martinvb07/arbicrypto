"use client";

import type { Report, Tope } from "@/lib/api";
import { currentYear, money, num, yearElapsed } from "@/lib/format";

type Key = "patrimonio" | "ingresos" | "consignaciones" | "compras";

const TOPES: { key: Key; label: string; uvt: number; hint: string }[] = [
  { key: "patrimonio", label: "Lo que tienes", uvt: 4500, hint: "Tus cripto (lo que pagaste) + tus otros bienes" },
  { key: "ingresos", label: "Lo que recibiste", uvt: 1400, hint: "Ventas y cambios de cripto + otros ingresos" },
  { key: "consignaciones", label: "Lo que entró a tus cuentas", uvt: 1400, hint: "Pesos de ventas P2P + otras consignaciones" },
  { key: "compras", label: "Lo que pagaste comprando", uvt: 1400, hint: "Pesos que pagaste por cripto" },
];

/** Proyección al 31 de diciembre de lo que va del año (el patrimonio no se proyecta). */
export function projected(report: Report, k: Key): number | null {
  const live = report.year >= currentYear();
  const e = yearElapsed(report.year);
  return live && k !== "patrimonio" && e > 0.02 && e < 0.99 ? report.summary.topes[k].value / e : null;
}

export function willFile(report: Report): boolean {
  const t = report.summary.topes;
  return !Object.values(t).some((x) => x.over) && TOPES.some((x) => (projected(report, x.key) ?? 0) >= t[x.key].limit);
}

/** Los cuatro topes que obligan a declarar. */
export function TopesList({ report }: { report: Report }) {
  const live = report.year >= currentYear();
  return (
    <div className="topes">
      {TOPES.map((t) => (
        <TopeRow key={t.key} tope={report.summary.topes[t.key]} uvt={t.uvt} hint={t.hint} projected={projected(report, t.key)}
          label={t.key === "patrimonio" ? (live ? "Lo que tienes hoy" : "Lo que tenías el 31 de diciembre") : t.label} />
      ))}
    </div>
  );
}

function TopeRow({ label, hint, uvt, tope, projected: proj }: { label: string; hint: string; uvt: number; tope: Tope; projected: number | null }) {
  const pct = (v: number) => Math.min(100, tope.limit > 0 ? (v / tope.limit) * 100 : 0);
  const willOver = proj != null && proj >= tope.limit;
  return (
    <div className="tope">
      <div>
        <div>{label}</div>
        <small title={`${num(uvt)} UVT`}>{hint} · declaras si llegas a {money(tope.limit)}</small>
        {proj != null && proj > 0 && (
          <small className={`tope-proj ${willOver && !tope.over ? "warn" : ""}`}>A este ritmo cierras el año en {money(proj)}</small>
        )}
      </div>
      <b className={`num ${tope.over ? "warn" : ""}`}>{money(tope.value)}</b>
      <div className="tope-bar">
        {proj != null && <i className="proj" style={{ width: `${pct(proj)}%` }} />}
        <i className={tope.over ? "over" : ""} style={{ width: `${pct(tope.value)}%` }} />
      </div>
    </div>
  );
}

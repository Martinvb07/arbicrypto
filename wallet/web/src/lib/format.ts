import type { Kind } from "./api";

const TZ = "America/Bogota";
const COP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0, minimumFractionDigits: 0 });
const DATE = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const DATETIME = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const LONG = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const DAY = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const HOUR = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

/** Pesos que de verdad pasaron por el banco: en la compra, valor + comisión de Binance; en la venta, valor − comisión. */
export function cashValue(m: { kind: string; cop_value: number; fee_cop: number }): number {
  if (m.kind === "compra") return m.cop_value + (m.fee_cop || 0);
  if (m.kind === "venta") return m.cop_value - (m.fee_cop || 0);
  return m.cop_value;
}

/** "08/10/2026": fecha corta de libro contable */
export function dayNum(t: number): string {
  return DAY.format(new Date(t * 1000));
}

/** "13:46" */
export function hourMin(t: number): string {
  return HOUR.format(new Date(t * 1000));
}

/** $ 1.234.567 */
export function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const r = Math.round(v);
  return COP.format(r === 0 ? 0 : r);
}

/** +$ 12.000 / −$ 3.000 */
export function signedMoney(v: number): string {
  const r = Math.round(v);
  if (r === 0) return money(0);
  return (r > 0 ? "+" : "−") + money(Math.abs(r));
}

/** Cantidad de cripto: hasta 8 decimales, sin ceros de sobra. */
export function qty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const max = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8;
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: max }).format(v);
}

export function num(v: number, dec = 0): string {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: dec, minimumFractionDigits: dec }).format(v);
}

export function date(t: number): string {
  return DATE.format(new Date(t * 1000)).replace(/\./g, "");
}

export function dateTime(t: number): string {
  return DATETIME.format(new Date(t * 1000)).replace(/\./g, "");
}

/** "2026-08-12" → "miércoles, 12 de agosto de 2026" */
export function longDate(iso: string): string {
  return LONG.format(new Date(iso + "T12:00:00Z"));
}

export function tone(v: number): "up" | "down" | "zero" {
  const r = Math.round(v);
  return r > 0 ? "up" : r < 0 ? "down" : "zero";
}

/** Fecha y hora de Colombia ↔ valor de <input type="datetime-local"> */
export function toLocalInput(t: number): string {
  return new Date((t - 5 * 3600) * 1000).toISOString().slice(0, 16);
}

export function fromLocalInput(v: string): number {
  return Date.parse(`${v.length === 10 ? v + "T00:00" : v}:00-05:00`) / 1000;
}

/** Inicio del año en hora de Colombia, en segundos. */
export function yearStart(y: number): number {
  return Date.parse(`${y}-01-01T00:00:00-05:00`) / 1000;
}

/** Año actual en Colombia. */
export function currentYear(): number {
  return Number(new Intl.DateTimeFormat("en", { timeZone: TZ, year: "numeric" }).format(new Date()));
}

/** Qué parte del año ya pasó: 1 si ya terminó. */
export function yearElapsed(y: number): number {
  const a = yearStart(y), b = yearStart(y + 1), now = Date.now() / 1000;
  return Math.min(1, Math.max(0, (now - a) / (b - a)));
}

/** "2026 · en curso", "2025 · se declara en 2026" */
export function yearLabel(y: number): string {
  const c = currentYear();
  return y === c ? `${y} · en curso` : y === c - 1 ? `${y} · se declara en ${c}` : String(y);
}

/** Acepta 1.234.567,89 · 1234567.89 · 1234567,89 */
export function parseNum(s: string): number | null {
  let v = s.trim().replace(/[$\s ]/g, "");
  if (!v) return null;
  if (v.includes(",") && v.includes(".")) {
    v = v.lastIndexOf(",") > v.lastIndexOf(".") ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  } else if (v.includes(",")) {
    v = (v.match(/,/g) ?? []).length === 1 ? v.replace(",", ".") : v.replace(/,/g, "");
  } else if ((v.match(/\./g) ?? []).length > 1) {
    v = v.replace(/\./g, "");
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const KIND_LABEL: Record<Kind, string> = {
  compra: "Compra",
  venta: "Venta",
  permuta: "Permuta",
  ingreso: "Ingreso",
  airdrop: "Airdrop",
  comision: "Comisión",
  gasto: "Gasto",
  aporte: "Aporte",
  retiro: "Retiro",
};

export const KIND_HINT: Record<Kind, string> = {
  compra: "Compraste cripto con pesos (por ejemplo en P2P).",
  venta: "Vendiste cripto y recibiste pesos.",
  permuta: "Cambiaste una cripto por otra (Spot o Convert). Para la DIAN es una venta.",
  ingreso: "Staking, Earn, minería o pagos recibidos en cripto. Es renta ordinaria.",
  airdrop: "Cripto recibida gratis. Es ganancia ocasional.",
  comision: "Comisión pagada en otra cripto (por ejemplo en BNB).",
  gasto: "Un gasto del negocio pagado en pesos: internet, celular, cuota de manejo, contador.",
  aporte: "Plata tuya que metiste a la cuenta para operar. No es ganancia.",
  retiro: "Plata que sacaste del negocio para ti. No es gasto.",
};

export const GASTO_LABEL: Record<"servicios" | "bancarios" | "honorarios" | "otros", string> = {
  servicios: "Servicios (internet, celular)",
  bancarios: "Bancarios (cuota de manejo, comisiones)",
  honorarios: "Honorarios (contador)",
  otros: "Otros",
};

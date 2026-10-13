import type { BinanceStatus, Report } from "./api";
import { currentYear, date } from "./format";

export type Check = {
  id: string;
  ok: boolean;
  /** opcional: no bloquea la declaración */
  optional?: boolean;
  title: string;
  detail: string;
  action?: "binance" | "upload" | "ganancias" | "movimientos" | "patrimonio" | "ajustes" | "extra";
};

/** Qué falta para poder declarar el año con confianza. */
export function readiness(r: Report, b: BinanceStatus | null): Check[] {
  const live = r.year >= currentYear();
  const fresh = !!b?.last_ok && Date.now() / 1000 - b.last_ok < 2 * 86400;
  const checks: Check[] = [
    {
      id: "binance",
      ok: !!b?.connected && fresh && !b.last_error,
      title: "Binance conectado y al día",
      detail: !b?.connected ? "Conéctalo una vez y todo se trae solo."
        : b.last_error ? `La última sincronización falló: ${b.last_error}`
        : fresh ? "Se actualiza solo cada 30 minutos." : "Aún no termina la primera sincronización.",
      action: "binance",
    },
    {
      id: "p2p",
      ok: !b?.connected || !!b.has_old_p2p,
      title: "P2P anteriores subidos",
      detail: b?.p2p_api_from && !b.has_old_p2p
        ? `Binance no entrega por API los P2P antes del ${date(b.p2p_api_from)}. Si hiciste P2P antes, sube el archivo de Binance.`
        : "Tienes P2P de antes de lo que entrega la API.",
      action: "upload",
      optional: true,
    },
    {
      id: "cuadre",
      ok: !!r.cuadre?.ok,
      title: "Cuadre con tus saldos de Binance",
      detail: !r.cuadre ? "Se hace al sincronizar Binance."
        : r.cuadre.ok ? "Lo que calcula la app coincide con lo que tienes en Binance."
        : `${r.cuadre.rows.filter((x) => !x.ok).length} cripto no cuadran: falta algún movimiento (por ejemplo un depósito de otra plataforma).`,
      action: "patrimonio",
    },
    {
      id: "costo",
      ok: r.warnings_total === 0,
      title: "Todas las ventas tienen su compra",
      detail: r.warnings_total ? `${r.warnings_total} venta${r.warnings_total > 1 ? "s" : ""} sin compra: su costo quedó en $0 y pagarías de más.` : "Cada venta tiene su costo.",
      action: "ganancias",
    },
    {
      id: "pesos",
      ok: r.unvalued === 0,
      title: "Todo valorado en pesos",
      detail: r.unvalued ? `${r.unvalued} movimiento${r.unvalued > 1 ? "s" : ""} sin valor en pesos.` : "Cada operación tiene su valor con la TRM del día.",
      action: "movimientos",
    },
    {
      id: "perfil",
      ok: !!r.profile.nit && !!r.profile.name,
      title: "Nombre y cédula en el perfil",
      detail: r.profile.nit ? "Listos para el resumen." : "Los necesitas para tu fecha límite y el resumen.",
      action: "ajustes",
    },
    {
      id: "gmf",
      ok: r.extra.gmf_cert > 0,
      optional: true,
      title: "Certificado del 4x1000 del banco",
      detail: r.extra.gmf_cert > 0 ? "Se usa el valor del certificado." : "Opcional: sin él se usa el cálculo ($4.000 por cada millón comprado). Para deducirlo, la DIAN pide el certificado.",
      action: "extra",
    },
    {
      id: "cierre",
      ok: !live,
      title: `Año ${r.year} cerrado`,
      detail: live ? `Las cifras definitivas salen después del 31 de diciembre. Se declara en ${r.year + 1}.` : "Cifras definitivas del año.",
    },
  ];
  return checks;
}

export function pending(checks: Check[]): number {
  return checks.filter((c) => !c.ok && !c.optional && c.id !== "cierre").length;
}

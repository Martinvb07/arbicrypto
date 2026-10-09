// Formatos en español de Colombia: $3.236,00 · 0,45 % · 154,52 USDT

const cache = new Map<string, Intl.NumberFormat>();

function nf(min: number, max = min): Intl.NumberFormat {
  const key = `${min}-${max}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("es-CO", { minimumFractionDigits: min, maximumFractionDigits: max });
    cache.set(key, f);
  }
  return f;
}

export const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Color de un número: verde si es positivo, rojo si es negativo, gris si es cero o no hay dato. */
export const tone = (v: number | null | undefined): "up" | "down" | "flat" => (!ok(v) || Math.abs(v) < 0.005 ? "flat" : v > 0 ? "up" : "down");

export const num = (v: number | null | undefined, d = 2): string => (ok(v) ? nf(d).format(v) : "—");

/** Pesos: sin decimales para montos grandes, con 2 para precios como el del USDT. */
export function money(v: number | null | undefined, d?: number): string {
  if (!ok(v)) return "—";
  const digits = d ?? (Math.abs(v) >= 1e5 ? 0 : 2);
  return (v < 0 ? "−$" : "$") + nf(digits).format(Math.abs(v));
}

/** Ganancia por dólar con signo y centavos: +$8,10 / −$28,40 */
export function perUsd(v: number | null | undefined): string {
  if (!ok(v)) return "—";
  return (v > 0 ? "+" : v < 0 ? "−" : "") + "$" + nf(2).format(Math.abs(v));
}

/** Ganancias en pesos con signo: +$4.500 / −$5.447 */
export function signedMoney(v: number | null | undefined): string {
  if (!ok(v)) return "—";
  return (v > 0 ? "+" : "") + money(v, 0);
}

export function pct(v: number | null | undefined, d = 2): string {
  if (!ok(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${nf(d).format(Math.abs(v) * 100)} %`;
}

/** Porcentaje sin signo (para metas, comisiones). */
export const pctPlain = (v: number | null | undefined, d = 1): string => (ok(v) ? `${nf(d).format(v * 100)} %` : "—");

/** Cantidades de cripto: menos decimales a medida que crece el número. */
export function qty(v: number | null | undefined): string {
  if (!ok(v)) return "—";
  const d = v >= 1000 ? 2 : v >= 1 ? 4 : 8;
  return nf(0, d).format(v);
}

export function price(v: number | null | undefined): string {
  if (!ok(v)) return "—";
  return v >= 1000 ? num(v, 2) : v >= 1 ? num(v, 4) : num(v, 8);
}

const timeFmt = new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export const hhmm = (sec: number) => timeFmt.format(sec * 1000);
export const dateTime = (ms: number) => dateFmt.format(ms);

export function ago(t: number | null | undefined, now: number): string {
  if (!t) return "—";
  const s = Math.max(0, Math.round(now - t));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `hace ${Math.round(s / 3600)} h`;
}

export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

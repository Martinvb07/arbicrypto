// Asesor de anuncios: con el libro P2P en vivo recomienda a cuánto poner tu anuncio de compra y el de venta.
// Todo es puro (sin React) para que se pueda revisar y probar aparte.

import { fitsAd, simulateAds, takerFeeAt, type AdSimResult } from "./calc";
import type { Ad, FlowSide, HistPoint, MarketEntry, Order, Side, State } from "./types";

/** Cómo publicas: "fast" sale de 1.º (te toman rápido), "mid" en el top 3, "slow" más atrás (ganas más, esperas más).
 *  "take" no publica: tomas ya el mejor anuncio que acepta tu monto. */
export type Plan = "fast" | "mid" | "slow" | "take";

export const PLANS: readonly { id: Plan; label: string; short: string; pos: number; speed: number }[] = [
  { id: "fast", label: "Rápido", short: "Sales 1.º", pos: 1, speed: 2 },
  { id: "mid", label: "Equilibrado", short: "Top 3", pos: 3, speed: 1 },
  { id: "slow", label: "Paciente", short: "Más atrás", pos: 8, speed: 0 },
  { id: "take", label: "Tomar ya", short: "Sin anuncio", pos: 0, speed: 3 },
];

/** Lo mínimo para superar a otro anuncio: un peso hasta 100.000 (dólares, ETH...) y en los grandes (BTC) ~0,001 %.
 *  Igual que ad_tick() en el servidor, que lo usa en el aviso "te pasaron tu anuncio". */
export function advTick(price: number) {
  return price < 1e5 ? 1 : 10 ** Math.max(0, String(Math.trunc(price)).length - 6);
}

/** Tu anuncio de compra compite con los que compran (m.SELL: a ellos les vendes); el de venta, con los que venden (m.BUY). */
export const rivalsOf = (m: MarketEntry, side: Side) => {
  const k = side === "BUY" ? "SELL" : "BUY";
  return m.all?.[k]?.length ? m.all[k]! : m[k]; // la lista completa, tal cual la ve cualquiera en Binance
};

/** Puesto de tu anuncio en esa lista como lo pone Binance: los que ofrecen mejor precio van antes; con los que empatas,
 *  puedes quedar antes o después (por eso un rango). */
export function rankIn(rivals: Ad[], price: number, side: Side) {
  const pos = rivals.filter((a) => beats(side, a.price, price)).length + 1;
  const ties = rivals.filter((a) => a.price === price).length;
  return { pos, last: pos + ties, ties };
}

/** "6.º" o "6.º a 8.º" si empatas. */
export const rankText = (r: { pos: number; last: number }) => (r.last > r.pos ? `${r.pos}.º a ${r.last}.º` : `${r.pos}.º`);

/** ¿Este precio es mejor que aquel para quien toma tu anuncio? Tu compra gana pagando más; tu venta, cobrando menos. */
export const beats = (side: Side, a: number, b: number) => (side === "BUY" ? a > b : a < b);

/** Anuncios que de verdad pelean con el tuyo por ese monto: quien quiere hacer una orden de hasta `amount` los ve junto al
 *  tuyo. Fuera los que no aceptan ese rango (piden más que tu monto, o su máximo es diminuto) y los que ya no tienen saldo. */
export function realRivals(rivals: Ad[], amount: number) {
  const live = rivals.filter((a) => a.min <= amount && a.max >= amount * 0.1 && (!a.available || a.available * a.price >= a.min));
  return { live, skipped: rivals.length - live.length };
}

/** Precio para quedar en el puesto `pos` (1 = primero): superar por un paso al que hoy está en ese puesto. Si hay menos
 *  anuncios, igualar al último. Nunca más agresivo que salir 1.º. */
export function priceForPos(rivals: Ad[], side: Side, pos: number): number | null {
  if (!rivals.length) return null;
  const dir = side === "BUY" ? 1 : -1;
  const first = rivals[0].price + dir * advTick(rivals[0].price);
  const at = rivals[pos - 1];
  const p = at ? at.price + dir * advTick(at.price) : rivals[rivals.length - 1].price;
  return beats(side, p, first) ? first : p;
}

export interface SideOption {
  plan: Plan;
  price: number | null;
  fee: number;
  /** Minutos que tardaría en llenarse con tu monto: 0 al tomar, Infinity si nadie se movió en ese puesto, null si aún se mide. */
  eta: number | null;
  /** Puesto en que queda tu anuncio. */
  pos?: number;
  /** Solo "take": a quién le compras o le vendes. */
  ad?: Ad;
}

export interface Combo {
  buy: SideOption;
  sell: SideOption;
  sim: AdSimResult;
  speed: number;
  /** Comprar y luego vender, en minutos (null si falta medir algún lado). */
  eta: number | null;
}

export interface Advice {
  amount: number;
  buyRivals: Ad[];
  sellRivals: Ad[];
  skipped: { buy: number; sell: number };
  buy: SideOption[];
  sell: SideOption[];
  combos: Combo[];
  /** La recomendada: la más rápida que deja al menos el margen seguro; si ninguna, la más rápida que gana algo. */
  best: Combo | null;
  /** Con lo medido: la que se llena antes y gana algo, si es otra y bastante más rápida que la recomendada. */
  quick: Combo | null;
  /** La recomendada gana menos del margen seguro: si un precio se mueve mientras esperas puede volverse pérdida. */
  tight: boolean;
  /** El 1.º está muy por delante del 2.º: quedar 2.º te ahorra esta diferencia (en pesos por unidad). */
  gap: { buy: number | null; sell: number | null };
}

const speedOf = (p: Plan) => PLANS.find((x) => x.id === p)!.speed;

// ---------------------------------------------------------------- cuánto tarda en llenarse (con lo medido del P2P)

/** Menos de 10 minutos medidos no alcanza para estimar. */
export const FLOW_MIN = 600;

/** El movimiento de la lista con la que compite tu anuncio: tu compra compite con los que compran (lista SELL). */
export const flowOf = (s: State, asset: string, side: Side): FlowSide | undefined => s.flow?.[asset]?.[side === "BUY" ? "SELL" : "BUY"];

/** Pesos por hora que se le toman a UN anuncio en ese puesto (lo de su tramo repartido entre los puestos del tramo). */
export function perAdHour(f: FlowSide, pos: number) {
  const b = f.buckets.find((x) => pos >= x.from && pos <= x.to) ?? f.buckets[f.buckets.length - 1];
  return b ? (b.fiat / (b.to - b.from + 1)) * (3600 / Math.max(f.window, 1)) : 0;
}

/** Minutos para que te tomen `amount` pesos en ese puesto. */
export function etaAt(f: FlowSide | undefined, pos: number, amount: number): number | null {
  if (!f || f.window < FLOW_MIN) return null;
  const rate = perAdHour(f, pos);
  return rate > 0 ? (amount / rate) * 60 : Infinity;
}

/** Cómo se mueve un rival: órdenes por hora y la última. */
export function rivalFlow(f: FlowSide | undefined, ad: Ad) {
  const x = f?.ads[String(ad.adv ?? ad.user ?? ad.nick)];
  if (!f || f.window < FLOW_MIN) return null;
  const k = 3600 / Math.max(f.window, 1);
  return { perHour: (x?.n ?? 0) * k, fiatHour: (x?.fiat ?? 0) * k, last: x?.last ?? null };
}

export function advise(s: State, asset: string, m: MarketEntry, amount: number, makerFee: number): Advice {
  const gmf = s.settings.gmf;
  // el puesto se cuenta como en Binance: contra toda la lista, no solo los que aceptan tu monto
  const b = { live: rivalsOf(m, "BUY"), skipped: 0 };
  const v = { live: rivalsOf(m, "SELL"), skipped: 0 };

  const mine = (side: Side, rivals: Ad[]): SideOption[] =>
    PLANS.filter((p) => p.id !== "take").map((p) => {
      const price = priceForPos(rivals, side, p.pos);
      // el puesto en la lista completa (la que se mide), no solo entre los que aceptan tu monto
      const pos = price == null ? undefined : rivalsOf(m, side).filter((x) => beats(side, x.price, price)).length + 1;
      return { plan: p.id, price, fee: makerFee, pos, eta: pos == null ? null : etaAt(flowOf(s, asset, side), pos, amount) };
    });

  // comprar tomando: el vendedor más barato que acepta tu monto
  const buyAd = m.BUY.find((a) => fitsAd(a, amount, amount / a.price));
  const buy: SideOption[] = [...mine("BUY", b.live), {
    plan: "take", price: buyAd?.price ?? null, ad: buyAd, eta: 0,
    fee: buyAd ? takerFeeAt(s, amount, asset, buyAd.price) : s.p2p_fee ?? 0,
  }];

  // vender tomando: depende de cuánto te llegó; se usa lo de comprar al mejor precio propio (casi igual en todos los planes)
  const refBuy = buy.find((o) => o.price)?.price;
  const qtyRef = refBuy ? (amount / refBuy) * (1 - makerFee) : 0;
  const sellAd = qtyRef ? m.SELL.find((a) => fitsAd(a, qtyRef * a.price, qtyRef, asset === "BTC" ? qtyRef : 0)) : undefined;
  const sell: SideOption[] = [...mine("SELL", v.live), {
    plan: "take", price: sellAd?.price ?? null, ad: sellAd, eta: 0,
    fee: sellAd ? takerFeeAt(s, qtyRef * sellAd.price, asset, sellAd.price) : s.p2p_fee ?? 0,
  }];

  const combos: Combo[] = [];
  for (const x of buy) {
    for (const y of sell) {
      if (!x.price || !y.price) continue;
      combos.push({ buy: x, sell: y, speed: speedOf(x.plan) + speedOf(y.plan),
        eta: x.eta == null || y.eta == null ? null : x.eta + y.eta,
        sim: simulateAds(amount, x.price, y.price, x.fee, y.fee, gmf, y.plan !== "take") });
    }
  }
  // con lo medido: la que se llena antes (y entre las que tardan parecido, la que más deja); sin medir: por puesto
  const measured = combos.every((c) => c.eta != null);
  const slot = (c: Combo) => (c.eta === Infinity ? 1e9 : Math.round(c.eta! / 10)); // tramos de 10 min
  const pick = (ok: (c: Combo) => boolean) =>
    combos.filter(ok).sort(measured ? (p, q) => slot(p) - slot(q) || q.sim.net - p.sim.net
      : (p, q) => q.speed - p.speed || q.sim.net - p.sim.net)[0] ?? null;
  const safe = pick((c) => c.sim.ratio >= s.settings.safe_p2p);
  const best = safe ?? pick((c) => c.sim.net > 0);

  const gapOf = (r: Ad[]) => {
    if (r.length < 2) return null;
    const g = Math.abs(r[0].price - r[1].price);
    return g / r[0].price >= 0.001 ? g : null; // solo si pesa: 0,1 % o más
  };
  const quick = measured && best && best.eta != null && best.eta > 30
    ? combos.filter((c) => c.sim.net > 0 && c.eta! < best.eta! / 2).sort((p, q) => p.eta! - q.eta! || q.sim.net - p.sim.net)[0] ?? null
    : null;
  return {
    quick, amount, buyRivals: b.live, sellRivals: v.live, skipped: { buy: b.skipped, sell: v.skipped },
    buy, sell, combos, best, tight: !!best && !safe, gap: { buy: gapOf(b.live), sell: gapOf(v.live) },
  };
}

// ---------------------------------------------------------------- mejores horas (últimas 24 h)

export interface HourSpread {
  hour: number;
  /** Margen promedio entre anuncios en esa hora, ya sin tu comisión de anunciante (dos veces) ni el 4x1000. */
  net: number | null;
  points: number;
}

/** Con el gráfico del día (mejor vendedor y mejor comprador cada 20 s): cuánto dejaría, hora por hora, comprar con tu
 *  anuncio un paso arriba del mejor comprador y vender con tu anuncio un paso abajo del mejor vendedor. */
export function hourSpreads(hist: HistPoint[], asset: string, makerFee: number, gmf: number): HourSpread[] {
  const acc = Array.from({ length: 24 }, () => ({ sum: 0, n: 0 }));
  for (const p of hist) {
    const [seller, buyer] = p.p[asset] ?? [];
    if (!seller || !buyer) continue;
    const net = ((seller - advTick(seller)) / (buyer + advTick(buyer))) * (1 - makerFee) / (1 + makerFee) - 1 - gmf;
    const h = new Date(p.t * 1000).getHours();
    acc[h].sum += net;
    acc[h].n += 1;
  }
  return acc.map((a, hour) => ({ hour, net: a.n ? a.sum / a.n : null, points: a.n }));
}

// ---------------------------------------------------------------- lo que aprendes de tus propios anuncios

export interface MakerSideStats {
  n: number;
  /** Volumen en pesos. */
  fiat: number;
  avgPrice: number | null;
  /** Compra: cuánto más barato que comprarle ya al mejor vendedor de ese momento. Venta: cuánto más caro que venderle ya
   *  al mejor comprador. Solo con órdenes de las últimas 24 h (las que tienen precio del mercado al lado). */
  edge: number | null;
  edgeN: number;
}

export interface MakerStats {
  buy: MakerSideStats;
  sell: MakerSideStats;
  /** Horas del día (0-23) con más órdenes de tus anuncios, de más a menos. */
  hours: { hour: number; n: number }[];
  /** Venta promedio / compra promedio − 1 con tus anuncios. */
  spread: number | null;
  days: number;
}

/** Une las órdenes guardadas con las que trae la cuenta (las nuevas aún no guardadas) sin repetir. */
export function mergeOrders(a: Order[], b: Order[]) {
  const seen = new Map<string, Order>();
  for (const o of [...a, ...b]) seen.set(o.id, { ...seen.get(o.id), ...o, role: o.role ?? seen.get(o.id)?.role ?? null });
  return [...seen.values()];
}

/** El punto del gráfico del día más cercano a `t` (en segundos), si está a menos de 2 minutos. */
function nearest(hist: HistPoint[], t: number) {
  let lo = 0;
  let hi = hist.length - 1;
  if (hi < 0) return null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (hist[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const c = [hist[lo], hist[lo - 1]].filter(Boolean).sort((x, y) => Math.abs(x.t - t) - Math.abs(y.t - t))[0];
  return c && Math.abs(c.t - t) <= 120 ? c : null;
}

export function makerStats(orders: Order[], hist: HistPoint[], asset: string, days = 30, nowSec = Date.now() / 1000): MakerStats {
  const since = (nowSec - days * 86400) * 1000;
  const mine = orders.filter((o) => o.role === "MAKER" && o.status === "COMPLETED" && o.asset === asset && o.time >= since && o.price > 0);
  const side = (sd: Side): MakerSideStats => {
    const rows = mine.filter((o) => o.side === sd);
    const qty = rows.reduce((x, o) => x + o.amount, 0);
    const fiat = rows.reduce((x, o) => x + (o.total || o.amount * o.price), 0);
    let edge = 0;
    let edgeN = 0;
    for (const o of rows) {
      const p = nearest(hist, o.time / 1000)?.p[asset];
      const ref = sd === "BUY" ? p?.[0] : p?.[1]; // compra vs. comprarle ya al mejor vendedor; venta vs. venderle ya al mejor comprador
      if (!ref) continue;
      edge += sd === "BUY" ? 1 - o.price / ref : o.price / ref - 1;
      edgeN += 1;
    }
    return { n: rows.length, fiat, avgPrice: qty ? fiat / qty : null, edge: edgeN ? edge / edgeN : null, edgeN };
  };
  const counts = new Map<number, number>();
  for (const o of mine) {
    const h = new Date(o.time).getHours();
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  const buy = side("BUY");
  const sell = side("SELL");
  return {
    buy, sell, days,
    hours: [...counts.entries()].map(([hour, n]) => ({ hour, n })).sort((x, y) => y.n - x.n),
    spread: buy.avgPrice && sell.avgPrice ? sell.avgPrice / buy.avgPrice - 1 : null,
  };
}

// ---------------------------------------------------------------- vigilar tu anuncio (igual que outbid_state() del servidor)

export interface WatchState {
  /** Puesto de tu anuncio ahora y el que quieres. */
  pos: number;
  want: number;
  /** Te pasaron: estás más atrás del puesto que quieres. */
  lost: boolean;
  /** Precio justo para quedar en el puesto que quieres. */
  ideal: number | null;
  /** > 0: pagas de más (compra) o cobras de menos (venta) por unidad para ese puesto. */
  room: number;
  top: Ad | undefined;
  rivals: number;
}

export function watchState(m: MarketEntry, side: Side, target: number, amount: number, aheadOk: number): WatchState {
  const want = aheadOk + 1;
  const rivals = rivalsOf(m, side).filter((x) => x.price !== target); // como en Binance (el monto ya no filtra)
  void amount;
  const ahead = rivals.filter((x) => beats(side, x.price, target));
  if (!rivals.length) return { pos: 1, want, lost: false, ideal: null, room: 0, top: undefined, rivals: 0 };
  const at = rivals[want - 1];
  const ideal = at ? at.price + (side === "BUY" ? 1 : -1) * advTick(at.price) : rivals[rivals.length - 1].price;
  return { pos: ahead.length + 1, want, lost: ahead.length >= want, ideal, room: (target - ideal) * (side === "BUY" ? 1 : -1), top: rivals[0], rivals: rivals.length };
}

/** Desde cuánto avisa "puedes ganar más": 0,03 % y al menos dos pasos (OUTBID_GAP del servidor). */
export const roomGap = (price: number) => Math.max(2 * advTick(price), price * 0.0003);

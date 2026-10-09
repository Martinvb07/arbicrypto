// Cálculos que convierten los datos del backend en cifras simples.
// Todo lo que se muestra ya incluye comisiones de Binance y el 4x1000: 0,4 % de cada pago que haces (al comprar), ganes o pierdas.
import type { Ad, HistPoint, Side, State } from "./types";

/** ¿Este aviso es para mí? (rutas de mi capital y mis propias vigilancias) */
export const isMine = (a: { capital?: number | null; user?: string | null; users?: string[] | null }, s: State) =>
  a.users ? a.users.includes(s.user.name) : (a.capital == null || a.capital === s.settings.capital) && (!a.user || a.user === s.user.name);

export const COIN_NAMES: Record<string, string> = {
  USDT: "Tether · dólar", USDC: "USD Coin · dólar", FDUSD: "First Digital · dólar", BTC: "Bitcoin", ETH: "Ethereum",
  BNB: "BNB", SOL: "Solana", XRP: "XRP", DOGE: "Dogecoin", ADA: "Cardano", TRX: "TRON", LTC: "Litecoin", LINK: "Chainlink",
  AVAX: "Avalanche", DOT: "Polkadot", BCH: "Bitcoin Cash", ATOM: "Cosmos", UNI: "Uniswap", ETC: "Ethereum Classic",
  XLM: "Stellar", FIL: "Filecoin",
};

/** USDT, USDC y FDUSD son dólares digitales: 1 = 1 dólar. */
export const isDollar = (asset: string | undefined) => asset === "USDT" || asset === "USDC" || asset === "FDUSD";

export function bestAd(s: State, asset: string, side: Side): Ad | undefined {
  return s.p2p?.market[asset]?.[side]?.[0];
}

/** Lo que de verdad sale de tu banco al comprar: el precio del anuncio + el 4x1000 (0,4 % de lo que pagas). */
export const effBuy = (price: number | undefined, s: State) => (price == null ? price : price * (1 + s.settings.gmf));

/** El 4x1000 que cobra el banco sobre un pago. */
export const gmfOf = (paid: number, s: State) => paid * s.settings.gmf;

export function usdtPrices(s: State) {
  return { buy: effBuy(bestAd(s, "USDT", "BUY")?.price, s), sell: bestAd(s, "USDT", "SELL")?.price };
}

/** Convierte una ganancia relativa en pesos por cada dólar (USDT). */
export const perDollar = (ratio: number, s: State) => ratio * (s.usd_ref ?? 0);

/** Resultado por dólar de comprar y vender una cripto al instante en P2P. */
export function roundTrip(s: State, asset: string): number | null {
  const buy = bestAd(s, asset, "BUY")?.price;
  const sell = bestAd(s, asset, "SELL")?.price;
  if (!buy || !sell) return null;
  const keep = 1 - (s.p2p_fee ?? 0); // comisión P2P al comprar y al vender
  return perDollar((sell * keep * keep) / (effBuy(buy, s) ?? buy) - 1, s); // al comprar pagas el 4x1000
}

/** Serie de precios de una cripto: precios de los anuncios, antes de comisiones y 4x1000. */
export function series(hist: HistPoint[], asset: string) {
  const out: { t: number; buy: number; sell: number }[] = [];
  for (const h of hist) {
    const [b, sl] = h.p[asset] ?? [];
    if (b && sl) out.push({ t: h.t, buy: b, sell: sl });
  }
  return out;
}

export function dayStats(points: { t: number; buy: number; sell: number }[], nowSec: number) {
  const day = points.filter((p) => p.t >= nowSec - 86400);
  if (day.length < 3) return null;
  const buys = day.map((p) => p.buy);
  const sells = day.map((p) => p.sell);
  return { buyMin: Math.min(...buys), buyMax: Math.max(...buys), sellMin: Math.min(...sells), sellMax: Math.max(...sells) };
}

export const advertiserUrl = (ad: Ad) =>
  ad.user ? `https://p2p.binance.com/es/advertiserDetail?advertiserNo=${encodeURIComponent(ad.user)}` : undefined;

export const spotUrl = (pair?: [string, string] | null) =>
  pair ? `https://www.binance.com/es/trade/${pair[0]}_${pair[1]}?type=spot` : undefined;

/** Cantidad lista para pegar en Binance: con punto decimal y redondeada hacia abajo (nunca más de lo que tienes). */
export function copyQty(q: number, asset: string): string {
  const d = isDollar(asset) ? 2 : 6;
  return (Math.floor(q * 10 ** d) / 10 ** d).toFixed(d).replace(/\.?0+$/, "");
}

/** Anunciante recomendable: muchas órdenes y casi no cancela (el mismo criterio que pinta verde en Precios P2P). */
export const GOOD_ORDERS = 50;
export const GOOD_FINISH = 0.97;
export const trusted = (ad: Ad) => ad.orders >= GOOD_ORDERS && ad.finish >= GOOD_FINISH;

/** Comprar y vender la misma cripto en P2P con anunciantes recomendables, acepten o no tu capital. */
export interface Deal {
  asset: string;
  buy: Ad;
  sell: Ad;
  /** Montos en pesos que aceptan los dos anuncios a la vez. */
  lo: number;
  hi: number;
  /** Ganancia por cada peso que le pagas al vendedor, ya con comisión P2P y 4x1000. */
  ratio: number;
  per_usd: number;
  /** El monto sugerido: tu capital si cabe; si no, el más cercano que aceptan. */
  amount: number;
  fitsCapital: boolean;
}

/** El mejor par de anuncios recomendables que gana comprando y vendiendo `asset`, y entre qué montos se puede hacer. */
export function bestDeal(s: State, asset: string): Deal | null {
  const m = s.p2p?.market[asset];
  if (!m) return null;
  const k = 1 - (s.p2p_fee ?? 0);
  const cap = s.settings.capital;
  let best: Deal | null = null;
  for (const b of m.BUY.filter(trusted)) {
    for (const v of m.SELL.filter(trusted)) {
      const ratio = (v.price * k * k) / b.price - 1 - s.settings.gmf;
      if (ratio <= 0 || (best && ratio <= best.ratio)) continue;
      const c = (v.price * k) / b.price; // pesos que vale en el anuncio de venta cada peso que pagas
      const lo = Math.ceil(Math.max(b.min, v.min / c));
      const hi = Math.floor(Math.min(b.max, v.max / c, b.available ? b.available * b.price : Infinity, v.available ? (v.available * b.price) / k : Infinity));
      if (!(lo <= hi)) continue;
      const amount = Math.min(Math.max(cap, lo), hi);
      best = { asset, buy: b, sell: v, lo, hi, ratio, per_usd: perDollar(ratio, s), amount, fitsCapital: amount === cap };
    }
  }
  return best;
}

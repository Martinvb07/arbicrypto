// Cálculos que convierten los datos del backend en cifras simples.
// Todo lo que se muestra ya incluye comisiones de Binance y el 4x1000 sobre la ganancia (lo que llega de más a Nequi).
import type { Ad, HistPoint, Side, State } from "./types";

/** ¿Este aviso es para mí? (rutas de mi capital y mis propias vigilancias) */
export const isMine = (a: { capital?: number | null; user?: string | null }, s: State) =>
  (a.capital == null || a.capital === s.settings.capital) && (!a.user || a.user === s.user.name);

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

/** Lo que pagas al comprar: el precio del anuncio (el 4x1000 solo se cobra sobre la ganancia). */
export const effBuy = (price: number | undefined, _s: State) => price;

/** Descuenta el 4x1000 solo cuando hay ganancia. */
export const afterGmf = (ratio: number, s: State) => (ratio > 0 ? ratio * (1 - s.settings.gmf) : ratio);

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
  return perDollar(afterGmf((sell * keep * keep) / buy - 1, s), s);
}

/** Serie de precios de una cripto (el 4x1000 no cambia el precio, solo la ganancia). */
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

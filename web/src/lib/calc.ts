// Cálculos que convierten los datos del backend en cifras simples.
// Todo lo que se muestra ya incluye comisiones de Binance y el 4x1000: 0,4 % de cada pago que haces (al comprar), ganes o pierdas.
import type { Ad, HistPoint, Side, SpotStep, State } from "./types";

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

/** Lo que de verdad te queda al pagar `paid` y recibir `received` (ya sin comisión P2P): descuenta el 4x1000 de lo que
 *  pagas, lo que cobra tu banco por la transferencia al vendedor y el impuesto de renta sobre la ganancia (si ganas). */
export function netOf(paid: number, received: number, s: State) {
  const gmf = gmfOf(paid, s);
  const bank = s.settings.bank_fee ?? 0;
  const gross = received - paid - gmf - bank;
  const tax = Math.max(gross, 0) * (s.settings.tax ?? 0);
  return { gmf, bank, tax, gross, net: gross - tax, ratio: paid ? (gross - tax) / paid : 0 };
}

/** ¿El anuncio acepta alguno de mis medios? (sin medios elegidos, todos sirven) */
export const paysWith = (ad: Ad, methods: string[] | undefined) => !methods?.length || ad.methods.some((m) => methods.includes(m));

/** ¿El anuncio acepta mi capital (monto y cripto disponible)? */
export const takesCapital = (ad: Ad, capital: number) => fitsAd(ad, capital, capital / ad.price);

/** Lo que tienes de `asset` en tu Binance (Spot + Fondos) para vender; 0 si no tienes o es menos de un dólar (polvo). */
export function walletQty(s: State, asset: string) {
  const acc = s.account;
  if (!acc) return 0;
  const q = [...acc.spot, ...acc.funding].filter((b) => b.asset === asset).reduce((t, b) => t + b.qty, 0);
  const price = bestAd(s, asset, "SELL")?.price ?? 0;
  return q * price >= (s.usd_ref ?? 4000) ? q : 0;
}

/** "p2p:USDT>BTC" → "COP → USDT → BTC → COP"; "spot:USDT>BTC>ETH>USDT" → "USDT → BTC → ETH → USDT". */
export function routeName(id: string, fiat = "COP") {
  const [venue, path = ""] = id.split(":");
  const coins = path.split(">");
  if (venue === "spot") return coins.join(" → ");
  return [fiat, ...(coins[0] === coins[1] ? [coins[0]] : coins), fiat].join(" → ");
}

/** ¿El anuncio me sirve por monto? Al vender cuenta lo que tienes en tu billetera de Binance; sin saldo (o al comprar), tu capital. */
export function takesMine(ad: Ad, s: State, asset: string, side: Side) {
  const q = side === "SELL" ? walletQty(s, asset) : 0;
  return q ? fitsAd(ad, q * ad.price, q, asset === "BTC" ? q : 0) : takesCapital(ad, s.settings.capital);
}

export function usdtPrices(s: State) {
  return { buy: effBuy(bestAd(s, "USDT", "BUY")?.price, s), sell: bestAd(s, "USDT", "SELL")?.price };
}

/** Comisión al TOMAR un anuncio por `fiat` pesos de `asset` a `price`: el porcentaje, pero nunca menos que el mínimo fijo por
 *  orden (0,07 USDT en automático). Con tu capital es igual a s.p2p_fee; con otro monto el mínimo pesa distinto. */
export function takerFeeAt(s: State, fiat: number, asset: string, price: number) {
  const rate = s.p2p_fee_rate ?? s.p2p_fee ?? 0;
  const minUsd = s.p2p_fee_min_usd ?? 0;
  const pesosPerUsd = isDollar(asset) ? price : s.usd_ref ?? 0;
  return fiat > 0 && minUsd && pesosPerUsd ? Math.min(Math.max(rate, (minUsd * pesosPerUsd) / fiat), 1) : rate;
}

/** Convierte una ganancia relativa en pesos por cada dólar (USDT). */
export const perDollar = (ratio: number, s: State) => ratio * (s.usd_ref ?? 0);

/** Resultado por dólar de comprar y vender una cripto al instante en P2P. */
export function roundTrip(s: State, asset: string): number | null {
  const buy = bestAd(s, asset, "BUY")?.price;
  const sell = bestAd(s, asset, "SELL")?.price;
  if (!buy || !sell) return null;
  const keep = 1 - (s.p2p_fee ?? 0); // comisión P2P al comprar y al vender
  const cap = s.settings.capital;
  return perDollar(netOf(cap, ((cap / buy) * keep) * sell * keep, s).ratio, s); // 4x1000, transferencia y renta
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

/** Dominio con el que la app de Binance comparte P2P: en el celular abre la app; en el computador, la página. */
const C2C = "https://c2c.binance.com/es-LA";

/** El anuncio exacto en Binance P2P; si no hay número de anuncio, el perfil del anunciante. */
export const advertiserUrl = (ad: Ad) =>
  ad.adv ? `${C2C}/adv?code=${encodeURIComponent(ad.adv)}` :
  ad.user ? `${C2C}/advertiserDetail?advertiserNo=${encodeURIComponent(ad.user)}` : undefined;

export const spotUrl = (pair?: [string, string] | null) =>
  pair ? `https://www.binance.com/es/trade/${pair[0]}_${pair[1]}?type=spot` : undefined;

/** En el par de Spot, ¿se vende la moneda que tienes (es la base, ETH en ETHUSDT) o se compra la otra? */
export const spotSells = (st: SpotStep) => (st.pair ? st.pair[0] === st.from : st.symbol.startsWith(st.from));

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
  /** Ganancia por cada peso que le pagas al vendedor, ya con comisión P2P, 4x1000, transferencia y renta. */
  ratio: number;
  per_usd: number;
  /** El monto sugerido: tu capital si cabe; si no, el más cercano que aceptan. */
  amount: number;
  fitsCapital: boolean;
}

/** Pesos que recibes comprando por `amount` al anuncio `b` y vendiendo todo al anuncio `v`, con la comisión al tomar de cada orden. */
export function dealReceived(s: State, asset: string, b: Ad, v: Ad, amount: number) {
  const got = (amount / b.price) * (1 - takerFeeAt(s, amount, asset, b.price));
  return got * v.price * (1 - takerFeeAt(s, got * v.price, asset, v.price));
}

/** El mejor par de anuncios recomendables que gana comprando y vendiendo `asset`, y entre qué montos se puede hacer. */
export function bestDeal(s: State, asset: string): Deal | null {
  const m = s.p2p?.market[asset];
  if (!m) return null;
  const k = 1 - (s.p2p_fee ?? 0);
  const cap = s.settings.capital;
  let best: Deal | null = null;
  for (const b of m.BUY.filter((a) => trusted(a) && paysWith(a, s.settings.pay_methods))) {
    for (const v of m.SELL.filter((a) => trusted(a) && paysWith(a, s.settings.recv_methods))) {
      if ((v.price * k * k) / b.price - 1 - s.settings.gmf <= 0) continue; // ni antes de transferencia y renta gana
      const c = (v.price * k) / b.price; // pesos que vale en el anuncio de venta cada peso que pagas
      if (b.hold_btc || (v.hold_btc && asset !== "BTC")) continue; // exige tener BTC que no sabemos si tienes
      // límites en cripto: compras `amount / b.price` y vendes eso por k (montos en pesos que pagas)
      const lo = Math.ceil(Math.max(b.min, v.min / c, (b.min_qty ?? 0) * b.price, ((Math.max(v.min_qty ?? 0, v.hold_btc ?? 0)) * b.price) / k));
      const hi = Math.floor(Math.min(b.max, v.max / c, b.available ? b.available * b.price : Infinity, v.available ? (v.available * b.price) / k : Infinity,
        b.max_qty ? b.max_qty * b.price : Infinity, v.max_qty ? (v.max_qty * b.price) / k : Infinity));
      if (!(lo <= hi)) continue;
      const amount = Math.min(Math.max(cap, lo), hi);
      const { ratio } = netOf(amount, dealReceived(s, asset, b, v, amount), s); // comisión con ESTE monto (pesa el mínimo fijo)
      if (ratio <= 0 || (best && ratio <= best.ratio)) continue;
      best = { asset, buy: b, sell: v, lo, hi, ratio, per_usd: perDollar(ratio, s), amount, fitsCapital: amount === cap };
    }
  }
  return best;
}

// ---------------------------------------------------------------- simular tus propios anuncios

/** Comisión de anunciante sin ser comerciante verificado: Binance cobra de 0 % a 0,35 % según la moneda (los comerciantes
 *  pagan 20 % menos). Se usa la más alta mientras no tengas órdenes como anunciante: así nunca promete de más. */
export const MAKER_FEE_REF = 0.0035;

/** El anuncio acepta ese monto en pesos y esa cantidad de cripto, tiene esa cripto disponible y no exige tener más BTC
 *  de los que tienes (sin saberlo se cuenta como 0). Es `function` para que `takesCapital`, arriba, la pueda usar. */
export function fitsAd(ad: Ad, fiat: number, crypto: number, btcHeld = 0) {
  return ad.min <= fiat && fiat <= ad.max
    && (!ad.min_qty || crypto >= ad.min_qty) && (!ad.max_qty || crypto <= ad.max_qty)
    && (!ad.available || ad.available >= crypto) && btcHeld >= (ad.hold_btc ?? 0);
}

/** Puesto que tendría tu anuncio entre los que ya hay. BUY: tu anuncio compra y compite con los que compran (gana el más alto).
 *  SELL: tu anuncio vende y compite con los que venden (gana el más bajo). */
export function adRank(rivals: Ad[], price: number, side: Side) {
  const better = (a: Ad) => (side === "BUY" ? a.price > price : a.price < price);
  return { pos: rivals.filter(better).length + 1, ties: rivals.filter((a) => a.price === price).length, of: rivals.length };
}

export interface AdSimResult {
  /** Cripto que te llega al comprar, ya sin la comisión. */
  qty: number;
  /** Pesos que recibes al vender, ya sin la comisión. */
  received: number;
  gmf: number;
  /** Comisiones de compra y venta, en pesos. */
  fees: number;
  /** Lo que te queda: recibes − pagas − 4x1000. */
  net: number;
  /** net / amount */
  ratio: number;
  /** Precio mínimo de venta para no perder, con tu precio de compra. */
  breakevenSell: number;
  /** Precio máximo de compra para no perder, con tu precio de venta. */
  breakevenBuy: number;
}

/** Comprar cripto por `amount` pesos a `buy` y venderla a `sell`. Cada lado con su comisión: la de anunciante si es tu anuncio,
 *  la P2P normal si tomas el de otro. Al comprar, Binance te entrega la cripto menos la comisión. Al vender tomando un anuncio,
 *  la comisión sale de lo que vendes; con TU anuncio de venta se cobra aparte de tu saldo (vender Q congela Q + comisión), así
 *  que con lo que tienes vendes qty / (1 + comisión). El 4x1000 se paga sobre lo que le pagas al vendedor. */
export function simulateAds(amount: number, buy: number, sell: number, buyFee: number, sellFee: number, gmf: number,
  sellIsMine = false): AdSimResult {
  const qty = (amount / buy) * (1 - buyFee);
  const sellKeep = sellIsMine ? 1 / (1 + sellFee) : 1 - sellFee; // parte de tu cripto que de verdad cobras
  const received = qty * sell * sellKeep;
  const g = amount * gmf;
  const net = received - amount - g;
  return {
    qty, received, gmf: g, fees: (amount / buy) * sell - received, net, ratio: net / amount,
    breakevenSell: (amount + g) / (qty * sellKeep),
    breakevenBuy: (sell * (1 - buyFee) * sellKeep) / (1 + gmf),
  };
}

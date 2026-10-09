// Formas de los datos que entrega el backend (backend/app.py → /api/state)

export type Side = "BUY" | "SELL";

export interface Ad {
  price: number;
  min: number;
  max: number;
  available: number;
  methods: string[];
  nick: string;
  user: string | null;
  orders: number;
  finish: number;
  merchant: boolean;
  minutes: number | null;
}

export interface P2PStep {
  venue: "P2P";
  kind: "buy" | "sell";
  asset: string;
  label: string;
  price: number;
  unit: string;
  ad: Ad;
  qty: number;
}

export interface SpotStep {
  venue: "Spot";
  kind: "convert";
  from: string;
  to: string;
  label: string;
  price: number;
  unit: string;
  symbol: string;
  rate: number;
  qty: number;
  pair?: [string, string] | null;
}

export type Step = P2PStep | SpotStep;

export interface Route {
  id: string;
  steps: Step[];
  received: number;
  paid: number;
  /** En qué se van los pesos (COP): comisión Spot, redondeo de Binance, colchón, comisión P2P y 4x1000. */
  costs: { spot_fee: number; rounding: number; buffer: number; p2p_fee: number; gmf: number };
  profit: number;
  profit_fiat: number;
  per_usd: number;
}

/** Vender o comprar dólares directo en P2P o pasando por otra cripto en Spot. */
export interface Conversion {
  asset: string;
  per_usd: number;
  vs_direct: number | null;
  ad: Ad;
  symbol: string | null;
}

export interface MarketEntry {
  BUY: Ad[];
  SELL: Ad[];
  top: Partial<Record<Side, number | null>>;
}

export interface P2PState {
  t: number;
  market: Record<string, MarketEntry>;
  routes: Route[];
  conversions: { sell: Conversion[]; buy: Conversion[] };
  errors: string[];
  fiat: string;
}

export interface Triangle {
  path: string[];
  symbols: string[];
  pairs?: ([string, string] | null)[];
  gross: number;
  profit: number;
  liquidity: number;
  to_usdt: number;
  /** Ganancia con la profundidad del libro para tu monto (solo rutas cercanas a cero). */
  real?: number | null;
}

export interface SpotState {
  t: number;
  top: Triangle[];
  evaluated: number;
  liquid: number;
  profitable: number;
  fee: number;
  live?: boolean;
}

/** Oportunidad real: ya con comisiones y 4x1000, con anuncios que aceptan el monto. */
export type Opportunity =
  | { id: string; kind: "p2p"; profit: number; per_usd: number; gain: number; since: number; route: Route }
  | { id: string; kind: "spot"; profit: number; per_usd: number; gain: number; since: number; amount_usdt: number; tri: Triangle };

export interface Balance {
  asset: string;
  qty: number;
  usdt: number | null;
  fiat: number | null;
}

export interface Order {
  id: string;
  side: Side;
  asset: string;
  fiat: string;
  amount: number;
  price: number;
  total: number;
  status: string;
  time: number;
  counterpart: string | null;
}

/** Una forma de pasar tu cripto a pesos: (cambio en Spot) + venta P2P al mejor comprador que acepta el monto. */
export interface SpotHop {
  from: string;
  to: string;
  symbol: string;
  pair: [string, string];
}

export interface ExitOption {
  to: string;
  path: string[];
  hops?: SpotHop[];
  qty: number;
  ad: Ad;
  received: number;
  profit: number | null;
  breakeven: number | null;
  backup: { ad: Ad; received: number; profit: number | null } | null;
}

export interface ExitResult {
  asset: string;
  qty: number;
  cost: number;
  options: ExitOption[];
  failed: string[];
  t: number;
}

export interface AccountState {
  t: number;
  uid: number | null;
  maker: number;
  taker: number;
  permissions: { reading: boolean; trading: boolean; withdrawals: boolean; ip_restricted: boolean };
  spot: Balance[];
  funding: Balance[];
  orders: Order[];
  notes: string[];
  total_usdt: number;
  total_fiat: number | null;
  usdt_fiat: number | null;
}

/** Lo configurable (capital, aviso, 4x1000) más reglas fijas que manda el servidor. */
export interface Settings {
  capital: number;
  min_per_usd: number;
  gmf: number;
  fiat: string;
  p2p_assets: string[];
  max_profit: number;
  p2p_interval: number;
  min_orders: number;
  min_finish: number;
  safe_p2p: number;
  safe_spot: number;
  spot_slippage: number;
}

export type AlertKind = "p2p" | "spot" | "system" | "test" | "sell";

/** "Avísame cuando pueda vender sin perder": el servidor vigila cada 5 s. */
export interface Watch {
  id: string;
  asset: string;
  qty: number;
  cost: number;
  target: number;
  user: string;
  created: number;
  expires: number;
  status: "vigilando" | "lista" | "vendida" | "vencida" | "reemplazada";
  /** Switch "Avisarme cuando gane": si está apagado solo se muestra en la lista, sin sonido ni Telegram. */
  alert?: boolean;
  alerts: number;
  last: {
    t: number;
    failed: string[];
    best: { to: string; path: string[]; hops?: SpotHop[]; qty: number; received: number; profit: number; need_price: number; ok: boolean; ad: Ad } | null;
  } | null;
}

export interface Alert {
  id: number;
  /** Capital con el que se calculó (avisos de rutas P2P); solo suena a quien usa ese capital. */
  capital?: number | null;
  /** Dueño del aviso (vigilancias de venta); los demás no lo ven. */
  user?: string | null;
  t: number;
  kind: AlertKind;
  title: string;
  body: string;
}

export interface State {
  watches: Watch[];
  boot: number;
  now: number;
  settings: Settings;
  fee: number;
  p2p_fee: number;
  spot: SpotState | null;
  p2p: P2PState | null;
  account: AccountState | null;
  opps: Opportunity[];
  /** Tengo MI cuenta de Binance conectada (cada usuario conecta la suya; nadie ve la de otro). */
  connected: boolean;
  key_hint: string | null;
  /** Desde aquí se pueden ingresar llaves: el PC del panel, o el servidor con HTTPS. */
  can_connect: boolean;
  local: boolean;
  team: boolean;
  user: User;
  telegram: { bot: string | null; chat: string | null; ready: boolean };
  usd_ref: number | null;
  alerts_at_boot: number;
  alerts: Alert[];
  errors: Record<string, { t: number; msg: string }>;
}

/** Mejor precio de compra y venta de cada cripto en un momento: p.USDT = [compra, venta]. */
export interface HistPoint {
  t: number;
  p: Record<string, [number | null, number | null]>;
}

export interface User {
  name: string;
  role: "admin" | "user";
}

export interface TeamUser {
  username: string;
  role: "admin" | "user";
  created: number;
  last_login: number | null;
  invited_by: string | null;
}

export interface Invite {
  code: string;
  by: string;
  created: number;
  expires: number;
  used_by: string | null;
  used_at: number | null;
  status: "pendiente" | "usado" | "vencido";
}

/** Oportunidad guardada en el historial. */
export interface PastOpp {
  id: number;
  kind: "p2p" | "spot";
  label: string;
  start_t: number;
  end_t: number;
  open: number;
  best_per_usd: number;
  best_gain: number;
  capital: number;
}

export interface HourBest {
  hour: number;
  kind: "p2p" | "spot";
  best: number;
}

export interface JournalEntry {
  id: number | string;
  /** Armada sola con tus órdenes P2P de Binance (no se borra a mano). */
  auto?: boolean;
  user: string;
  t: number;
  kind: "p2p" | "spot" | "otro";
  description: string;
  invested: number;
  received: number;
  estimated: number | null;
  note: string | null;
}

// ---------------------------------------------------------------- chat del equipo

/** to = null: canal general; si no, mensaje privado. */
export interface ChatMessage {
  id: number;
  t: number;
  from: string;
  to: string | null;
  body: string;
}

export interface ChatUser {
  name: string;
  role: "admin" | "user";
  online: boolean;
}

/** channels[""] es el canal general; las demás llaves son el otro usuario del privado. */
export interface ChatSummary {
  me: string;
  users: ChatUser[];
  channels: Record<string, { last: ChatMessage; unread: number }>;
}

// Formas de los datos que entrega el backend (backend/app.py → /api/state)

export type Side = "BUY" | "SELL";

export interface Ad {
  price: number;
  min: number;
  max: number;
  available: number;
  /** Límites en cripto por orden (0 = sin límite aparte del de pesos). */
  min_qty?: number;
  max_qty?: number;
  /** BTC que el anunciante exige tener para tomar su anuncio (0 = no exige). */
  hold_btc?: number;
  /** Días que tu cuenta de Binance debe llevar registrada para tomar el anuncio (0 = no pide). */
  reg_days?: number;
  methods: string[];
  nick: string;
  user: string | null;
  /** Número del anuncio (advNo): enlace directo al anuncio. */
  adv?: string | null;
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
  costs: { spot_fee: number; rounding: number; buffer: number; p2p_fee: number; gmf: number; bank?: number; tax?: number };
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
  /** Vender: dólares que cambias y cripto que te llega a Spot (antes de la comisión P2P). Comprar: dólares que te quedan y cripto que compras. */
  usd?: number;
  qty?: number;
  /** Comisión P2P al vender, en cripto. */
  p2p_cut?: number;
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
  /** El libro completo, con los anuncios que tu cuenta no puede tomar (solo llega si se quitó alguno): para simular tu anuncio. */
  market_all?: Record<string, MarketEntry>;
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
  /** MAKER: la orden salió de tu propio anuncio; TAKER: tomaste el anuncio de otro. */
  role?: "MAKER" | "TAKER" | null;
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
  /** Comisión P2P al tomar un anuncio (-1 = automática, sacada de tus órdenes). */
  taker_fee: number;
  /** Lo que cobra tu banco por cada transferencia al vendedor, en pesos. */
  bank_fee: number;
  /** Impuesto de renta sobre la ganancia (0 a 0,39). */
  tax: number;
  /** Medios con los que pagas al comprar y por los que recibes al vender (vacío = todos). */
  pay_methods: string[];
  recv_methods: string[];
  /** Avisos silenciados: por tipo ("spot", "p2p", "sell", "price") o rutas puntuales ("p2p:USDT>BTC"). */
  muted_kinds?: MutableKind[];
  muted_routes?: string[];
  /** Fecha (AAAA-MM-DD) en que creaste tu cuenta de Binance: hay anuncios que piden 30, 60 o 90 días. */
  binance_since?: string | null;
  /** Anunciantes que no te dejan tomar su anuncio: no se usan en rutas, ventas ni avisos. */
  blocked?: { user: string; nick: string }[];
}

export type MutableKind = "spot" | "p2p" | "sell" | "price";

/** "Avísame cuando USDT esté barato": el servidor la revisa en cada escaneo P2P. */
export interface PriceAlert {
  id: string;
  asset: string;
  /** BUY: avisa cuando comprar cueste igual o menos que target. SELL: cuando vender pague igual o más. */
  side: Side;
  target: number;
  /** Solo anuncios que aceptan tu capital y tus medios de pago. */
  mine: boolean;
  on: boolean;
  /** Se apaga sola después de avisar una vez. */
  once: boolean;
  created: number;
  hits: number;
  last_hit?: number | null;
  last: { t: number; price: number | null; nick: string | null; hit: boolean } | null;
}

export type AlertKind = "p2p" | "spot" | "system" | "test" | "sell" | "price";

/** "Avísame cuando pueda vender sin perder": el servidor vigila cada 5 s. */
export interface WatchMove {
  id?: string; t: number; kind: "compraste" | "vendiste" | "editaste" | "cambiaste" | "llego";
  /** cambios en Spot: "cambiaste" (salió de esta fila hacia `to`, te llegaron `got`) o "llego" (entró desde `from`, diste `spent`) */
  to?: string; got?: number; from?: string; spent?: number;
  /** orden: cantidad, comisión, precio y pesos; moved/cost = lo que salió o entró de la fila y su costo */
  qty?: number; fee?: number; price?: number; total?: number; moved?: number; cost?: number;
  /** lo que quedó en la fila después */
  left: number; cost_left: number;
}

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
  /** Se agregó sola con una compra P2P de Binance (no la anotaste a mano). */
  auto?: boolean;
  /** Último ajuste automático con una orden P2P de Binance (vendiste una parte o compraste más). */
  synced?: { t: number; kind: "compraste" | "vendiste" | "llego"; qty: number; price: number; total: number; before?: { qty: number; cost: number } };
  /** Cómo empezó la moneda y cada orden de Binance que la movió (o que la editaste a mano). */
  start?: { t: number; qty: number; cost: number };
  moves?: WatchMove[];
  last: {
    t: number;
    failed: string[];
    /** Comprador que solo acepta una parte: cuánto le vendes, recibes y ganas con esa parte. */
    partial?: { ad: Ad; qty: number; received: number; profit: number; ok: boolean } | null;
    best: { to: string; path: string[]; hops?: SpotHop[]; qty: number; received: number; profit: number; need_price: number; even_price?: number; ok: boolean; ad: Ad } | null;
  } | null;
}

export interface Alert {
  id: number;
  /** Capital con el que se calculó (avisos de rutas P2P); solo suena a quien usa ese capital. */
  capital?: number | null;
  /** Dueño del aviso (vigilancias de venta); los demás no lo ven. */
  user?: string | null;
  /** Usuarios a los que les toca (cada quien tiene su capital, 4x1000 y mínimo); si existe, manda sobre capital/user. */
  users?: string[] | null;
  t: number;
  kind: AlertKind;
  title: string;
  body: string;
  /** Enlaces directos a Binance: el anunciante de cada paso, el par de Spot o la billetera. */
  links?: { label: string; url: string }[] | null;
}

export interface State {
  /** fotos de perfil del equipo: {usuario: url} (quien no tiene foto no aparece) */
  avatars?: Record<string, string>;
  watches: Watch[];
  boot: number;
  now: number;
  settings: Settings;
  fee: number;
  p2p_fee: number;
  /** La comisión P2P que sale de las órdenes de las cuentas conectadas (la que se usa en modo automático). */
  p2p_fee_auto?: number;
  /** La comisión al tomar un anuncio por partes: porcentaje y mínimo fijo por orden en dólares (p2p_fee ya los junta para tu capital). */
  p2p_fee_rate?: number;
  p2p_fee_min_usd?: number;
  price_alerts?: PriceAlert[];
  /** Lo que Binance te cobra por tus propios anuncios, sacado de tus órdenes como anunciante (null si no tienes). */
  maker_fee: number | null;
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
  /** tu equipo y cuántas solicitudes o invitaciones esperan tu respuesta */
  my_team?: { id: string | null; name: string | null; owner: boolean; waiting: number };
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

export type Access = "ambos" | "panel" | "wallet";

export interface User {
  name: string;
  role: "admin" | "user";
  /** a qué entra: panel y wallet, solo panel o solo wallet */
  access?: Access;
}

export interface TeamUser {
  username: string;
  role: "admin" | "user";
  access: Access;
  created: number;
  last_login: number | null;
  invited_by: string | null;
  /** id del equipo en el que está (null = sin equipo) */
  team: string | null;
}

/** Un equipo: cada quien está en uno o en ninguno, y solo ve y le escribe a los suyos. */
export interface TeamInfo { id: string; name: string; owner: string | null; created: number; members: string[]; by_user?: boolean }
export interface TeamMember { name: string; role: "admin" | "user"; online: boolean }
export interface TeamRequest { id: string; team: string; team_name?: string; user: string; kind: "pide" | "invita"; by: string; t: number }
export interface MyTeams {
  team: { id: string; name: string; owner: string | null; created: number; mine: boolean; members: TeamMember[] } | null;
  teams: { id: string; name: string; owner: string | null; size: number; asked: boolean }[];
  invites: TeamRequest[];
  asked: TeamRequest[];
  requests: TeamRequest[];
  invited: TeamRequest[];
  free: string[];
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

// ---------------------------------------------------------------- chat del equipo

/** to = null: canal general; si no, mensaje privado. */
export interface ChatMessage {
  id: number;
  t: number;
  from: string;
  to: string | null;
  body: string;
  /** Nombre de la imagen adjunta (se pide a /api/chat/image). */
  image?: string | null;
  reply_to?: number | null;
  /** El mensaje al que responde, resumido. */
  reply?: { id: number; from: string; body: string; image: boolean } | null;
  /** {emoji: [usuarios]} */
  reactions?: Record<string, string[]>;
}

export interface ChatUser {
  name: string;
  role: "admin" | "user";
  online: boolean;
}

/** channels[""] es el canal general; las demás llaves son el otro usuario del privado. */
/** Subgrupo del chat: su llave en channels es "#<id>". */
export interface ChatGroup {
  id: number;
  key: string;
  name: string;
  members: string[];
  created_by: string;
  created: number;
  can_edit: boolean;
}

export interface ChatSummary {
  me: string;
  users: ChatUser[];
  channels: Record<string, { last: ChatMessage; unread: number }>;
  groups: ChatGroup[];
  /** nombre de tu equipo: el canal General es su chat (null = sin equipo) */
  team?: string | null;
}

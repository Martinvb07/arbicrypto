export type Kind = "compra" | "venta" | "permuta" | "ingreso" | "airdrop" | "comision" | "gasto" | "aporte" | "retiro";
export type GastoCategory = "servicios" | "bancarios" | "honorarios" | "otros";

export interface Movement {
  id: number;
  t: number;
  kind: Kind;
  out_asset: string | null;
  out_qty: number | null;
  in_asset: string | null;
  in_qty: number | null;
  cop_value: number;
  fee_cop: number;
  gmf_cop: number;
  platform: string;
  counterpart: string;
  source: "manual" | "binance" | "csv";
  note: string;
  category?: GastoCategory | "";
  pay_method?: string;
  /** referencia legible: orden de Binance, etc. */
  ref?: string;
  /** comisión que Binance cobró en cripto (ya descontada de la cantidad); fee_cop es su valor en pesos */
  fee_qty?: number;
  fee_asset?: string;
}

export type MovementInput = Partial<Omit<Movement, "id" | "source">> & { kind: Kind; t: number };

export type GmfMode = "todas" | "exenta" | "tope350";

export interface Profile {
  name: string;
  nit: string;
  habitual: boolean;
  method: "fifo" | "promedio";
  gmf_exempt: boolean;
  gmf_mode: GmfMode;
  /** ya dijo si su banco le cobra el 4x1000 */
  gmf_asked?: boolean;
  /** 4x1000 por medio de pago (Nequi, Bancolombia…) */
  gmf_methods?: Record<string, GmfMode>;
  /** cuenta de pesos con la que se lleva la caja (Nequi…) */
  cash_account?: string;
}

export interface User {
  id: number;
  username: string;
  role: "admin" | "user";
}

export interface Me {
  user: User;
  profile: Profile;
  movements: number;
  pay_methods?: { method: string; n: number; total: number }[];
  /** medios de pago usados en P2P (compras y ventas), sacados del historial de órdenes de Binance */
  p2p_methods?: { method: string; buys: number; sells: number; total: number }[];
  years: number[];
  uvt: Record<string, number>;
  /** dirección del panel (panel.arbicrypto.org): usuarios, contraseñas y equipo se manejan allá */
  panel: string;
}

export interface Disposal {
  id: number;
  t: number;
  kind: Kind;
  asset: string;
  qty: number;
  received: string | null;
  gross: number;
  fee: number;
  proceeds: number;
  cost: number;
  gain: number;
  go_share: number;
  go_gain: number;
  ro_gain: number;
  days_min: number;
  days_max: number;
  missing: number;
}

export interface Income {
  id: number;
  t: number;
  kind: "ingreso" | "airdrop";
  asset: string;
  qty: number;
  value: number;
}

export interface Holding {
  asset: string;
  qty: number;
  cost: number;
  since: number;
}

export interface Tope {
  value: number;
  limit: number;
  over: boolean;
}

export interface Summary {
  year: number;
  uvt: number;
  ro: { gross: number; costs: number; sales: number; income: number; gmf_deduction: number; net: number; tax: number; loss: number };
  go: { gross: number; costs: number; sales: number; airdrops: number; net: number; tax: number; loss: number };
  tax_total: number;
  patrimony: number;
  gross_income: number;
  topes: { patrimonio: Tope; ingresos: Tope; consignaciones: Tope; compras: Tope };
  exterior: Tope & { uvt: number; year: number };
  f210: {
    patrimonio_bruto: number;
    no_laborales: { ingresos: number; costos: number; gmf: number; renta_liquida: number };
    ganancia_ocasional: { ingresos: number; costos: number; gravable: number };
    casillas: Record<string, number>;
    gmf_limited: boolean;
  };
  totals: { gmf: number; fees: number; bought_cop: number; sold_cop: number };
  gmf: { estimated: number; cert: number; paid: number; deduction: number };
}

export interface YearExtra {
  other_income: number;
  other_patrimony: number;
  other_deposits: number;
  gmf_cert: number;
}

export interface Report {
  year: number;
  profile: Profile;
  extra: YearExtra;
  summary: Summary;
  disposals: Disposal[];
  incomes: Income[];
  holdings: Holding[];
  opening: Holding[];
  warnings: { t: number; asset: string; qty: number; id: number; msg: string }[];
  warnings_total: number;
  unvalued: number;
  cuadre: Cuadre | null;
  books: Books;
  deadline: string | null;
  uvt_known: boolean;
}

export interface BookMonth {
  month: number;
  bought: number;
  sold: number;
  ops: number;
  gain: number;
  income: number;
  gmf: number;
  fees: number;
  expenses: number;
  net: number;
}

export interface BookAsset {
  asset: string;
  bought_qty: number;
  bought: number;
  sold_qty: number;
  sold: number;
  gain: number;
  income: number;
  hold_qty: number;
  hold_cost: number;
}

export interface Round {
  start: number;
  end: number;
  paid: number;
  received: number;
  gmf: number;
  fees: number;
  /** lo que se quedó Binance en comisiones (ya incluido en pagado/recibido) */
  binance_fees?: number;
  ops: number;
  assets: string[];
  open: boolean;
  result: number;
  result_before_gmf: number;
}

export interface Books {
  pnl: { sales: number; cost: number; fees: number; buy_fees?: number; gross_profit: number; income: number; gmf: number; expenses: number; net: number };
  months: BookMonth[];
  assets: BookAsset[];
  rounds: Round[];
}

export interface Cuadre {
  t: number | null;
  ok: boolean;
  rows: { asset: string; app: number; binance: number; diff: number; ok: boolean }[];
}

export interface JournalLine { account: string; name: string; debit: number; credit: number }
export interface JournalEntry { t: number; number: string; kind: string; ref: number | null; text: string; support?: string; lines: JournalLine[] }
/** Caja diaria (cuenta 1110): cada día con movimiento se cierra solo. */
export interface CashDay {
  day: string;
  opening: number;
  in: number;
  out: number;
  gmf: number;
  closing: number;
  status: "abierto" | "cerrado" | "congelado";
  real: number | null;
  entries: { number: string; t: number; kind: string; text: string; in: number; out: number; gmf: number; balance: number }[];
}
/** Caja desde que se inició: saldo inicial, cada entrada y salida y el saldo de hoy. */
export type Caja = { account: string; balance: number } & (
  | { start: null }
  | ({ start: { t: number; amount: number } } & Omit<CashBook, "period">)
);
export interface CashBook {
  period: { label: string; year: number; month: number };
  lock_until: number;
  opening: number;
  days: CashDay[];
  totals: { in: number; out: number; gmf: number };
  closing: number;
}
export interface TrialRow { account: string; name: string; nature: "D" | "C"; class: string; previous: number; debit: number; credit: number; final: number }
export interface Trial { rows: TrialRow[]; totals: { debit: number; credit: number; balanced: boolean } }
export interface IncomeStatement {
  lines: Record<string, number>;
  /** renglones en el orden del PUC con sus subtotales: lo que se muestra */
  layout: { kind: "section" | "line" | "total" | "subtotal" | "net"; account: string; label: string; value: number | null }[];
  sections: Record<string, number>;
  gross_profit: number;
  other_income: number;
  expenses: number;
  net: number;
}
export interface EquityChanges {
  columns: { account: string; name: string }[];
  rows: { key: string; label: string; values: Record<string, number>; total: number }[];
  balanced: boolean;
}
export interface CashFlow {
  opening: number;
  sections: { id: string; label: string; lines: { label: string; value: number }[]; total: number }[];
  net: number;
  closing: number;
}
export interface InventoryBook {
  period: { label: string; year: number; month: number };
  at: number;
  account: string;
  balance: BalanceSheet;
  cryptos: { asset: string; qty: number; cost: number; unit: number; since: number; market: number | null; usd: number | null; trm: number | null }[];
}
export interface FsNote { n: number; title: string; text: string[]; table: { head: string[]; rows: (string | number | null)[][] } | null }
export interface PucAccount { account: string; name: string; nature: "D" | "C"; class: string }
export interface NoteInput { t: number; text: string; support: string; lines: { account: string; debit: number; credit: number }[] }
export interface BalanceItem { account: string; name: string; value: number }
export interface BalanceSheet {
  at: number;
  assets: BalanceItem[];
  liabilities: BalanceItem[];
  equity: BalanceItem[];
  total_assets: number;
  total_liabilities: number;
  total_equity: number;
  balanced: boolean;
}
export interface Libros {
  period: { start: number; end: number; label: string; year: number; month: number; at: number };
  journal: JournalEntry[];
  trial: Trial;
  income: IncomeStatement;
  balance: BalanceSheet;
  equity: EquityChanges;
  cashflow: CashFlow;
  lock_until: number;
}
export type ClosingKind = "caja" | "inicio" | "mes" | "anio";
export interface Closing {
  id: number;
  kind: ClosingKind;
  t: number;
  cash_expected: number;
  cash_real: number;
  adjustment: number;
  locked: number;
  note: string;
  created: number;
  auto: number;
}
/** Cierre automático: el próximo mes por cerrar y, si ya tocaba, qué lo frena. */
export interface AutoClose {
  on: boolean;
  next: { kind: ClosingKind; year: number; month: number; t: number; label: string; due: number } | null;
  ready: boolean;
  reason: string | null;
}
export interface ClosingDetail extends Closing {
  snapshot: {
    balance: BalanceSheet;
    income_year: IncomeStatement;
    income_month?: IncomeStatement;
    trial_year: Trial;
    declaracion?: { casillas: Record<string, number>; tax_total: number };
    holdings?: Holding[];
  };
}

export interface SaldoRow {
  asset: string;
  qty: number;
  app_qty: number;
  binance_qty: number | null;
  wallets: { spot: number; funding: number; earn: number };
  usd_price: number | null;
  usd: number | null;
  cop: number | null;
  cost: number;
  ok: boolean;
}

export interface Saldos {
  binance: { connected: boolean; synced: number | null; rows: SaldoRow[]; trm: number | null; total_cop: number; total_usd: number; total_cost: number; ok: boolean };
  banks: {
    books: number;
    by_method: { method: string; in: number; out: number; gmf: number; ops: number; net: number }[];
    last_closing: Closing | null;
    statements?: { id: number; name: string; balance: number; day: string }[];
  };
  errors: string[];
}

export type BankCategory = "binance_p2p" | "gmf" | "traslado" | "salario" | "ingreso" | "rendimientos" | "negocio"
  | "bancarios" | "consumo" | "efectivo" | "credito" | "otro";
export type AccountKind = "ahorros" | "corriente" | "billetera" | "tarjeta";

export interface BankAccount {
  id: number;
  name: string;
  kind: AccountKind;
  pay_methods: string[];
  in: number;
  out: number;
  gmf: number;
  n: number;
  balance_end: number | null;
  balance_end_day: string | null;
  last_balance: number | null;
  last_day: string | null;
  files: number;
  day_from: string | null;
  day_to: string | null;
}

export interface BankTx {
  id: number;
  account_id: number;
  day: string;
  t: number;
  description: string;
  amount: number;
  balance: number | null;
  category: BankCategory;
  auto: number;
  note: string;
  match: { id: number; kind: "compra" | "venta"; asset: string; qty: number } | null;
}

export interface BankFile { id: number; account_id: number; name: string; rows: number; day_from: string | null; day_to: string | null; uploaded: number }

export interface BanksSummary {
  accounts: BankAccount[];
  files: BankFile[];
  categories: { category: BankCategory; name: string; in: number; out: number; n: number }[];
  transactions: BankTx[];
  p2p_unmatched: { id: number; t: number; kind: "compra" | "venta"; cop_value: number; pay_method: string }[];
  dian: { bank_balances_end: number; deposits_other: number; salary: number; other_income: number; consumption: number; gmf_real: number };
  category_names: Record<BankCategory, string>;
}

export interface StatementPreview {
  rows: { day: string; description: string; amount: number; balance: number | null }[];
  total: number;
  warnings: string[];
  known: number;
  day_from: string | null;
  day_to: string | null;
  inflow: number;
  outflow: number;
}

export type StatementInput = { account_id: number; filename: string; data: string; password?: string };

export interface Market {
  t: number;
  values: Record<string, { cop: number; usd: number; trm: number }>;
  errors: string[];
}

export interface BinanceStatus {
  connected: boolean;
  /** Mi Binance en el panel: ahí se conecta y se cambia la llave (una sola conexión para panel y wallet) */
  panel_url: string;
  every: number;
  hint?: string;
  since?: number;
  last_ok?: number | null;
  last_run?: number | null;
  last_error?: string | null;
  p2p_api_from?: number;
  has_old_p2p?: boolean;
  notes?: string[];
  job: ImportStatus;
}

export interface ImportStatus {
  state: "idle" | "running" | "done" | "error";
  step?: string;
  added?: number;
  found?: number;
  skipped?: number;
  errors?: string[];
  notes?: string[];
}

export interface CsvResult {
  locked?: number;
  added: number;
  skipped: number;
  examples: number;
  errors: string[];
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public data: Record<string, unknown>) {
    super(message);
  }
}

async function req<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new ApiError("Sin conexión con el servidor. ¿Está prendida la wallet (pm2 status)?", 0, {});
  }
  let data: Record<string, unknown> = {};
  try {
    data = await r.json();
  } catch {
    /* respuesta vacía */
  }
  if (!r.ok) throw new ApiError(String(data.error ?? `Error ${r.status}`), r.status, data);
  return data as T;
}

const get = <T>(p: string) => req<T>("GET", p);
const post = <T>(p: string, b?: unknown) => req<T>("POST", p, b);

export const api = {
  me: () => get<Me>("/api/me"),
  logout: () => post<{ panel: string }>("/api/logout"),
  saveProfile: (p: Profile) => post<{ profile: Profile }>("/api/profile", p),
  saveYearExtra: (year: number, e: YearExtra) => post("/api/year-extra", { year, ...e }),

  movements: (year: number | null) => get<{ movements: Movement[]; lock_until: number }>(`/api/movements${year ? `?year=${year}` : ""}`),
  addMovement: (m: MovementInput) => post("/api/movements", m),
  editMovement: (id: number, m: MovementInput) => post(`/api/movements/${id}`, m),
  deleteMovements: (ids: number[]) => post<{ deleted: number }>("/api/movements/delete", { ids }),
  deleteSource: (source: "binance" | "csv" | "manual") => post<{ deleted: number }>("/api/movements/delete", { source }),
  value: (asset: string, qty: number, t: number) =>
    get<{ cop: number; usd: number; trm: number }>(`/api/value?asset=${encodeURIComponent(asset)}&qty=${qty}&t=${t}`),

  binance: () => get<BinanceStatus>("/api/binance"),
  binanceSync: () => post<BinanceStatus>("/api/binance/sync"),
  importCsv: (text: string, partial: boolean) => post<CsvResult>("/api/import/csv", { text, partial }),

  report: (year: number) => get<Report>(`/api/report?year=${year}`),
  saldos: () => get<Saldos>("/api/saldos"),
  bancos: (year: number) => get<BanksSummary>(`/api/bancos?year=${year}`),
  bancoCuenta: (a: { id?: number; name: string; kind: AccountKind; pay_methods: string[] }) => post<{ id: number }>("/api/bancos/cuentas", a),
  bancoCuentaBorrar: (id: number) => post(`/api/bancos/cuentas/${id}/borrar`),
  extractoPreview: (i: StatementInput) => post<StatementPreview>("/api/bancos/extracto/preview", i),
  extractoSubir: (i: StatementInput) => post<{ file_id: number; added: number; skipped: number; warnings: string[] }>("/api/bancos/extracto", i),
  archivoBorrar: (id: number) => post(`/api/bancos/archivo/${id}/borrar`),
  bancoTx: (id: number, c: { category: BankCategory; similar?: boolean; note?: string }) => post(`/api/bancos/tx/${id}`, c),
  market: (year: number) => get<Market>(`/api/market?year=${year}`),

  libros: (year: number, month: number) => get<Libros>(`/api/libros?year=${year}&month=${month}`),
  cajaDiaria: (year: number, month: number) => get<CashBook>(`/api/caja-diaria?year=${year}&month=${month}`),
  inventarios: (year: number, month: number) => get<InventoryBook>(`/api/inventarios?year=${year}&month=${month}`),
  notasEf: (year: number) => get<{ notes: FsNote[] }>(`/api/notas-ef?year=${year}`),
  puc: () => get<{ accounts: PucAccount[] }>("/api/puc"),
  notaCrear: (n: NoteInput) => post<{ id: number }>("/api/notas", n),
  notaBorrar: (id: number) => post(`/api/notas/${id}/borrar`),
  caja: () => get<Caja>("/api/caja"),
  cajaIniciar: (cash_real: number, account: string) => post<{ id: number }>("/api/caja/iniciar", { cash_real, account }),
  cierres: () => get<{ closings: Closing[]; lock_until: number; cash_now: number; auto: AutoClose }>("/api/cierres"),
  cuadrarCaja: (cash_real: number) =>
    post<{ id: number }>("/api/cierres", { kind: "caja", t: Math.floor(Date.now() / 1000), cash_real, note: "", lock: false }),
  cierreAuto: (on: boolean) => post<{ made: number; auto: AutoClose }>("/api/cierres/auto", { on }),
  cierre: (id: number) => get<ClosingDetail>(`/api/cierres/${id}`),
  cierreReopen: () => post<{ reopened: number; lock_until: number; auto: AutoClose }>("/api/cierres/reabrir"),

};

"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeftRight, ArrowRight, Bell, BellOff, CalendarDays, ChartLine, Check, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Clock, Code, Copy, Download, ExternalLink, Eye, EyeOff, Flag, House, KeyRound, Lightbulb, ListFilter, Lock, LogOut, Megaphone, Menu, Moon, NotebookPen, PiggyBank, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, Sun, Target, Ticket, Trash2, TrendingUp, Triangle, TriangleAlert, UserCog, Users, Wallet, X, Zap,
  UserPen,
  Plus,
  Radar,
  BellRing,
  ListChecks,
  Activity,
  Coins,
  History,
  ChevronUp,
  ShoppingCart,
  HandCoins,
  Timer,
  Layers,
  Info,
  BadgeCheck,
  CreditCard,
  type LucideIcon,
} from "lucide-react";
import { ago, pct, perUsd, tone } from "@/lib/format";
import { useNow } from "@/lib/live";

// ---------------------------------------------------------------- íconos (Lucide)

const ICONS = {
  home: House,
  bulb: Lightbulb,
  flag: Flag,
  chart: ChartLine,
  wallet: Wallet,
  sliders: SlidersHorizontal,
  code: Code,
  bell: Bell,
  bellOff: BellOff,
  moon: Moon,
  refresh: RefreshCw,
  bolt: Zap,
  megaphone: Megaphone,
  check: Check,
  checkCircle: CircleCheck,
  alert: TriangleAlert,
  shield: ShieldCheck,
  users: Users,
  external: ExternalLink,
  arrowRight: ArrowRight,
  swap: ArrowLeftRight,
  triangle: Triangle,
  target: Target,
  clock: Clock,
  lock: Lock,
  key: KeyRound,
  ticket: Ticket,
  logout: LogOut,
  copy: Copy,
  trash: Trash2,
  piggy: PiggyBank,
  trend: TrendingUp,
  sparkle: Sparkles,
  x: X,
  book: NotebookPen,
  download: Download,
  menu: Menu,
  filter: ListFilter,
  calendar: CalendarDays,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  eye: Eye,
  eyeOff: EyeOff,
  search: Search,
  sun: Sun,
  userCog: UserCog,
  pencil: UserPen,
  plus: Plus,
  radar: Radar,
  bellRing: BellRing,
  listChecks: ListChecks,
  activity: Activity,
  coins: Coins,
  history: History,
  chevronUp: ChevronUp,
  cart: ShoppingCart,
  handCoins: HandCoins,
  timer: Timer,
  layers: Layers,
  info: Info,
  badgeCheck: BadgeCheck,
  card: CreditCard,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, className = "" }: { name: IconName; size?: number; className?: string }) {
  const C = ICONS[name];
  return <C className={`i ${className}`} size={size} strokeWidth={1.9} aria-hidden="true" />;
}

// ---------------------------------------------------------------- marca

export function Logo({ size = 38 }: { size?: number }) {
  return (
    <span className="logo" style={{ width: size, height: size }} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={size > 64 ? "/brand/mark-256.png" : "/brand/mark-128.png"} alt="" width={size} height={size} />
    </span>
  );
}

export function Brand() {
  return (
    <span className="brand">
      <Logo />
      <span>
        <span className="brand-name">
          Arbi<span>Crypto</span>
        </span>
        <span className="brand-sub">
          Arbitraje P2P · Binance
        </span>
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- monedas

const LOGOS = new Set(["btc", "eth", "bnb", "sol", "xrp", "usdt", "usdc", "fdusd", "ada", "doge", "trx", "ltc", "link", "dot", "matic", "avax", "dai", "tusd"]);

export function Coin({ s, size = 20 }: { s: string; size?: number }) {
  const sym = s.toUpperCase();
  if (sym === "COP") return <span className="flag-co" style={{ width: size, height: size }} aria-hidden="true" />;
  const l = sym.toLowerCase();
  if (LOGOS.has(l)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="coin" src={`/coins/${l}.svg`} width={size} height={size} alt="" />;
  }
  let h = 0;
  for (const ch of sym) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className="coin coin-fb" style={{ ["--h" as string]: h, width: size, height: size, fontSize: size * 0.36 }} aria-hidden="true">
      {sym.slice(0, 3)}
    </span>
  );
}

export function Asset({ s, size = 20, label }: { s: string; size?: number; label?: ReactNode }) {
  return (
    <span className="asset">
      <Coin s={s} size={size} />
      {label ?? s}
    </span>
  );
}

export function CoinPath({ path }: { path: string[] }) {
  return (
    <span className="path">
      {path.map((c, i) => (
        <span key={i} className="path">
          {i > 0 && <span className="arrow">→</span>}
          <Coin s={c} size={18} />
          {c}
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- piezas pequeñas

/** Pesos por dólar con color: verde positivo, rojo negativo, gris cero. */
export function Usd({ v, suffix }: { v: number | null | undefined; suffix?: string }) {
  return (
    <b className={`val ${tone(v)}`}>
      {perUsd(v)}
      {suffix && v != null && <span className="val-suffix"> {suffix}</span>}
    </b>
  );
}

export function Pnl({ v, d = 2 }: { v: number | null | undefined; d?: number }) {
  const cls = tone(v == null ? v : v * 100);
  return (
    <span className={`pnl ${cls}`}>
      {cls !== "flat" && <span className="arr" aria-hidden="true">{cls === "up" ? "▲" : "▼"}</span>}
      {pct(v, d)}
    </span>
  );
}

export type Tone = "good" | "bad" | "warn" | "info" | "brand" | "neutral";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone === "neutral" ? "" : tone}`}>{children}</span>;
}

export function Ago({ t }: { t: number | null | undefined }) {
  const now = useNow();
  return <>{now ? ago(t, now) : "—"}</>;
}

export function SectionHead({ icon, tone, title, sub, right }: { icon: IconName; tone?: "green" | "blue" | "red"; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="sec-head">
      <div>
        <h2>
          <span className={`sec-ico ${tone ?? ""}`}>
            <Icon name={icon} />
          </span>
          {title}
        </h2>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}

export function EmptyBox({ icon = "clock", title, children }: { icon?: IconName; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty-box">
      <span className="sec-ico blue">
        <Icon name={icon} />
      </span>
      <div>
        <b>{title}</b>
        {children && <div className="sub">{children}</div>}
      </div>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="switch">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function ExtLink({ href, children }: { href?: string; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {children}
      <Icon name="external" size={13} />
    </a>
  );
}

// ---------------------------------------------------------------- botones de opción con deslizado

/** Mide el botón elegido dentro de `ref` para que un fondo lo siga deslizándose (botones de opción y pestañas). */
export function useThumb(ref: React.RefObject<HTMLElement | null>, index: number) {
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const b = el.querySelectorAll<HTMLElement>(":scope > button")[index];
      setThumb(b ? { x: b.offsetLeft, w: b.offsetWidth } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.querySelectorAll(":scope > button").forEach((b) => ro.observe(b));
    return () => ro.disconnect();
  }, [ref, index]);
  return thumb ? { transform: `translateX(${thumb.x}px)`, width: thumb.w } : undefined;
}

/** Grupo de opciones (Todas / P2P / Spot…): el fondo de la opción elegida se desliza como un switch. */
export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T;
  options: readonly (readonly [T, ReactNode])[];
  onChange: (v: T) => void;
  label?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const thumb = useThumb(box, options.findIndex(([v]) => v === value));

  return (
    <div className="seg" ref={box} role="radiogroup" aria-label={label}>
      {thumb && <span className="seg-thumb" style={thumb} aria-hidden="true" />}
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={v === value} className={v === value ? "on" : ""} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- contraseña con botón para verla

/** Campo de contraseña con el ojito para ver lo que escribiste. */
export function PasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw-field">
      <input {...props} type={show ? "text" : "password"} />
      <button type="button" className="pw-eye" onClick={() => setShow(!show)} aria-label={show ? "Ocultar contraseña" : "Ver contraseña"}
        title={show ? "Ocultar contraseña" : "Ver contraseña"}>
        <Icon name={show ? "eyeOff" : "eye"} size={18} />
      </button>
    </span>
  );
}

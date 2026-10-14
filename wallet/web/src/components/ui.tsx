"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { institutionOf } from "@/lib/banks";
import { money, signedMoney, tone } from "@/lib/format";

const ICONS: Record<string, ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r=".8" /><circle cx="3.5" cy="12" r=".8" /><circle cx="3.5" cy="18" r=".8" /></>,
  trend: <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  wallet: <><path d="M3 7a2 2 0 0 1 2-2h13v4" /><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2Z" /><circle cx="16" cy="14.5" r="1.2" /></>,
  file: <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 15H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.7 4.4V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3Z" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  upload: <><path d="M12 15V3M7 8l5-5 5 5" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>,
  download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  alert: <><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17.5v.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.01" /></>,
  logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h11" /></>,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  print: <><path d="M7 8V3h10v5" /><rect x="3" y="8" width="18" height="9" rx="2" /><path d="M7 14h10v7H7z" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3M15 8l2 2" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" /><path d="M4 3v5h5M4 13a8 8 0 0 0 14.6 4.5L20 16" /><path d="M20 21v-5h-5" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  filter: <path d="M3 5h18l-7 8.5V19l-4 2v-7.5Z" />,
  sort: <><path d="M7 4v16M3 16l4 4 4-4" /><path d="M17 20V4M13 8l4-4 4 4" /></>,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  bank: <><path d="M3 10 12 4l9 6" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 21h18" /></>,
  book: <><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5Z" /><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3" /><path d="M8 7h8M8 11h6" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  scale: <><path d="M12 3v18M5 21h14M4 7h16" /><path d="m4 7-2.5 6a3 3 0 0 0 5 0Z" /><path d="m20 7-2.5 6a3 3 0 0 0 5 0Z" /></>,
};

export function Icon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg className={className ? `icon ${className}` : "icon"} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/** Logo de ArbiCrypto (el mismo del panel). */
export function BrandMark({ size = 38 }: { size?: number }) {
  return (
    <span className="logo" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={size > 64 ? "/brand/mark-256.png" : "/brand/mark-128.png"} alt="" width={size} height={size} />
    </span>
  );
}

const COIN_ICONS = new Set(["btc", "eth", "bnb", "sol", "xrp", "usdt", "usdc", "fdusd", "ada", "doge", "trx", "ltc", "link", "dot", "matic", "avax", "dai", "tusd"]);

/** Ícono de la moneda, igual que en el panel: logo real, bandera para COP o círculo con iniciales. */
export function Coin({ asset, size = 20 }: { asset: string; size?: number }) {
  const s = asset.toUpperCase();
  if (s === "COP") return <span className="flag-co" style={{ width: size, height: size }} aria-hidden="true" />;
  const k = s === "POL" ? "matic" : s.toLowerCase();
  if (COIN_ICONS.has(k)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="coin" src={`/coins/${k}.svg`} width={size} height={size} alt="" />;
  }
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className="coin coin-fb" style={{ ["--h" as string]: h, width: size, height: size, fontSize: size * 0.36 }} aria-hidden="true">
      {s.slice(0, 3)}
    </span>
  );
}

export function Asset({ asset, qty: q }: { asset: string | null; qty?: string }) {
  if (!asset) return <span className="muted">—</span>;
  return (
    <span className="asset">
      <Coin asset={asset} size={20} />
      {q && <span className="num">{q}</span>}
      <b>{asset}</b>
    </span>
  );
}

/** Valor en pesos con color: verde gana, rojo pierde, gris cero. */
export function Pnl({ v, plain }: { v: number; plain?: boolean }) {
  return <span className={`num ${tone(v)}`}>{plain ? money(v) : signedMoney(v)}</span>;
}

export function Badge({ children, kind = "" }: { children: ReactNode; kind?: string }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

export function Switch({ on, onChange, label, hint, disabled }: {
  on: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode; disabled?: boolean;
}) {
  return (
    <label className={`switch-row ${disabled ? "disabled" : ""}`}>
      <span>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={`switch ${on ? "on" : ""}`} aria-hidden="true" />
    </label>
  );
}

export function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
    };
  }, [onClose]);
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Empty({ icon = "info", title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={22} /></span>
      <b>{title}</b>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: i === 0 ? 92 : 56 }} />)}
    </div>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn btn-sm" disabled={page <= 0} onClick={() => onPage(page - 1)}>Anterior</button>
      <span className="muted">Página {page + 1} de {pages}</span>
      <button className="btn btn-sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Siguiente</button>
    </div>
  );
}

export function Note({ children, kind = "" }: { children: ReactNode; kind?: "" | "warn" | "bad" | "good" }) {
  return (
    <div className={`note-box ${kind}`}>
      <Icon name={kind === "good" ? "check" : kind ? "alert" : "info"} size={16} />
      <div>{children}</div>
    </div>
  );
}

/** Logo de la entidad (Bancolombia, Nequi…) con sus colores; si no se reconoce, ícono de banco o billetera. */
export function BankLogo({ name, kind, size = 36 }: { name: string; kind?: string; size?: number }) {
  const inst = institutionOf(name);
  if (!inst) {
    return (
      <span className="bank-logo generic" style={{ width: size, height: size }} aria-hidden="true">
        <Icon name={kind === "billetera" ? "wallet" : "bank"} size={Math.round(size * 0.5)} />
      </span>
    );
  }
  const fs = size * (inst.mark.length >= 4 ? 0.26 : inst.mark.length === 3 ? 0.3 : inst.mark.length === 2 ? 0.38 : 0.5);
  return (
    <span className="bank-logo" style={{ width: size, height: size, background: inst.bg, color: inst.fg, fontSize: fs }} title={inst.name} aria-hidden="true">
      {inst.mark}
    </span>
  );
}

/** Mide el botón elegido dentro de `ref` para que un fondo lo siga deslizándose (igual que en el panel). */
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

/** Grupo de opciones: el fondo de la elegida se desliza como un switch (el mismo del panel). */
export function Segmented<T extends string | number>({ value, options, onChange, label, className = "" }: {
  value: T;
  options: readonly (readonly [T, ReactNode])[];
  onChange: (v: T) => void;
  label?: string;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const thumb = useThumb(box, options.findIndex(([v]) => v === value));
  return (
    <div className={`seg ${className}`} ref={box} role="radiogroup" aria-label={label}>
      {thumb && <span className="seg-thumb" style={thumb} aria-hidden="true" />}
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={v === value} className={v === value ? "on" : ""} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

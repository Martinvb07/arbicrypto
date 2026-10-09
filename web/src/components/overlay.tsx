"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./ui";

/** Menú desplegable de la barra superior: se cierra al hacer clic afuera o con Escape. */
export function Menu({ button, buttonClass = "btn btn-sm", label, width, children }: {
  button: ReactNode;
  buttonClass?: string;
  label: string;
  width?: number;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={buttonClass} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={label} title={label}>
        {button}
      </button>
      {open && <div className="menu-pop" style={width ? { width } : undefined}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: ReactNode;
  /** Texto para buscar (por defecto, el valor). */
  search?: string;
  icon?: ReactNode;
  hint?: ReactNode;
}

/** Selector propio del panel (reemplaza al <select> del navegador): con íconos, buscador y teclado. */
export function Select({ value, options, onChange, label, searchable }: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  label: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const search = searchable ?? options.length > 8;
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => (o.search ?? o.value).toLowerCase().includes(q)) : options;
  const current = options.find((o) => o.value === value);
  const id = `sel-${label.replace(/\W+/g, "-").toLowerCase()}`;

  const close = (focus = true) => {
    setOpen(false);
    setQuery("");
    if (focus) trigger.current?.focus();
  };
  const choose = (o: SelectOption | undefined) => {
    if (!o) return;
    onChange(o.value);
    close();
  };
  const show = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const keys = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    const last = shown.length - 1;
    const moves: Record<string, () => void> = {
      ArrowDown: () => setActive((i) => Math.min(last, i + 1)),
      ArrowUp: () => setActive((i) => Math.max(0, i - 1)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => choose(shown[active]),
      Escape: () => close(),
      Tab: () => close(false),
    };
    const fn = moves[e.key];
    if (fn) {
      if (e.key !== "Tab") e.preventDefault();
      fn();
    }
  };

  return (
    <div className={`select ${open ? "open" : ""}`} ref={ref} onKeyDown={keys}>
      <button type="button" ref={trigger} className="select-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        onClick={() => (open ? close() : show())}>
        {current?.icon}
        <span className="select-label">{current?.label ?? "Elige…"}</span>
        {current?.hint && <span className="select-hint">{current.hint}</span>}
        <Icon name="chevronDown" size={16} className="select-caret" />
      </button>
      {open && (
        <div className="select-pop">
          {search && (
            <div className="select-search">
              <Icon name="search" size={15} />
              <input type="search" autoFocus placeholder="Buscar…" value={query} aria-controls={id}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }} />
            </div>
          )}
          <ul id={id} role="listbox" ref={list} aria-label={label} tabIndex={search ? -1 : 0} autoFocus={!search}>
            {shown.map((o, i) => (
              <li key={o.value} data-i={i} role="option" aria-selected={o.value === value}
                className={`${i === active ? "active" : ""} ${o.value === value ? "selected" : ""}`}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}>
                {o.icon}
                <span className="select-label">{o.label}</span>
                {o.hint && <span className="select-hint">{o.hint}</span>}
                {o.value === value && <Icon name="check" size={16} className="select-check" />}
              </li>
            ))}
            {!shown.length && <li className="select-empty">Sin resultados</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Hoja que sube desde abajo en el celular (y panel lateral si side="left"): menú, filtros. */
export function Sheet({ title, onClose, children, side = "bottom", footer }: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  side?: "bottom" | "left";
  footer?: ReactNode;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className={`sheet-back ${side}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet ${side}`} role="dialog" aria-modal="true">
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon name="x" size={16} /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const WEEK = ["L", "M", "M", "J", "V", "S", "D"];
const pad = (n: number) => String(n).padStart(2, "0");
/** "2026-10-08T18:23" (formato de datetime-local) <-> Date local */
const toLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fromLocal = (v: string) => (v ? new Date(v) : new Date());

/** Selector de fecha y hora propio: calendario + hora, igual en celular y PC. Valor como datetime-local. */
export function DateTimePicker({ value, onChange, label = "Fecha" }: { value: string; onChange: (v: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cur = fromLocal(value);
  const [view, setView] = useState({ y: cur.getFullYear(), m: cur.getMonth() });

  useEffect(() => {
    if (!open) return;
    const c = fromLocal(value);
    setView({ y: c.getFullYear(), m: c.getMonth() });
    const outside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<{ y: number; m: number; d: number; h: number; min: number }>) => {
    const d = new Date(cur);
    if (patch.y != null || patch.m != null || patch.d != null) d.setFullYear(patch.y ?? d.getFullYear(), patch.m ?? d.getMonth(), patch.d ?? d.getDate());
    if (patch.h != null) d.setHours(patch.h);
    if (patch.min != null) d.setMinutes(patch.min);
    onChange(toLocal(d));
  };
  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() + 6) % 7; // semana desde el lunes
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const today = new Date();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const move = (k: number) => setView(({ y, m }) => ({ y: m + k < 0 ? y - 1 : m + k > 11 ? y + 1 : y, m: (m + k + 12) % 12 }));
  const h12 = cur.getHours() % 12 || 12;
  const pm = cur.getHours() >= 12;
  const setHour = (h: number, isPm: boolean) => set({ h: (h % 12) + (isPm ? 12 : 0) });
  const shown = cur.toLocaleString("es-CO", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className={`dtp ${open ? "open" : ""}`} ref={ref}>
      <button type="button" className="select-btn" onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} aria-label={label}>
        <Icon name="calendar" size={17} />
        <span className="select-label">{shown}</span>
        <Icon name="chevronDown" size={16} className="select-caret" />
      </button>
      {open && (
        <div className="dtp-pop" role="dialog" aria-label={label}>
          <div className="dtp-head">
            <button type="button" className="icon-btn" onClick={() => move(-1)} aria-label="Mes anterior"><Icon name="chevronLeft" size={16} /></button>
            <b>{MONTHS[view.m]} {view.y}</b>
            <button type="button" className="icon-btn" onClick={() => move(1)} aria-label="Mes siguiente"><Icon name="chevronRight" size={16} /></button>
          </div>
          <div className="dtp-grid">
            {WEEK.map((w, i) => <span key={i} className="dtp-wd">{w}</span>)}
            {cells.map((d, i) => d == null ? <span key={i} /> : (
              <button type="button" key={i}
                className={`dtp-day ${d === cur.getDate() && view.m === cur.getMonth() && view.y === cur.getFullYear() ? "on" : ""} ${d === today.getDate() && view.m === today.getMonth() && view.y === today.getFullYear() ? "today" : ""}`}
                onClick={() => set({ y: view.y, m: view.m, d })}>
                {d}
              </button>
            ))}
          </div>
          <div className="dtp-time">
            <Icon name="clock" size={16} />
            <Select label="Hora" value={String(h12)} searchable={false} onChange={(v) => setHour(Number(v), pm)}
              options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: pad(i + 1) }))} />
            <span>:</span>
            <Select label="Minutos" value={String(cur.getMinutes())} onChange={(v) => set({ min: Number(v) })}
              options={Array.from({ length: 60 }, (_, i) => ({ value: String(i), label: pad(i), search: pad(i) }))} />
            <div className="dtp-ampm">
              <button type="button" className={!pm ? "on" : ""} onClick={() => setHour(h12, false)}>a. m.</button>
              <button type="button" className={pm ? "on" : ""} onClick={() => setHour(h12, true)}>p. m.</button>
            </div>
          </div>
          <div className="dtp-foot">
            <button type="button" className="link-btn" onClick={() => { onChange(toLocal(new Date())); setOpen(false); }}>Ahora</button>
            <button type="button" className="btn btn-brand btn-sm" onClick={() => setOpen(false)}>Listo</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- confirmaciones (en vez del confirm() del navegador)

interface Ask {
  title: string;
  body?: ReactNode;
  confirm?: string;
  cancel?: string;
  tone?: "danger" | "brand";
  icon?: IconName;
}
let showAsk: ((a: (Ask & { resolve: (v: boolean) => void }) | null) => void) | null = null;

/** Pregunta con la ventana del panel y devuelve true si la persona confirma. */
export function ask(a: Ask): Promise<boolean> {
  return new Promise((resolve) => (showAsk ? showAsk({ ...a, resolve }) : resolve(window.confirm(a.title))));
}

/** Se monta una vez en la página y dibuja las confirmaciones que pide ask(). */
export function ConfirmHost() {
  const [cur, setCur] = useState<(Ask & { resolve: (v: boolean) => void }) | null>(null);
  useEffect(() => {
    showAsk = setCur;
    return () => {
      showAsk = null;
    };
  }, []);
  useEffect(() => {
    if (!cur) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && done(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cur) return null;
  const done = (v: boolean) => {
    cur.resolve(v);
    setCur(null);
  };
  const danger = cur.tone === "danger";
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && done(false)}>
      <div className={`modal confirm ${danger ? "danger" : ""}`} role="alertdialog" aria-modal="true" aria-labelledby="ask-title">
        <span className="confirm-ico"><Icon name={cur.icon ?? (danger ? "alert" : "shield")} size={22} /></span>
        <h2 id="ask-title">{cur.title}</h2>
        {cur.body && <p className="confirm-body">{cur.body}</p>}
        <div className="confirm-actions">
          <button className="btn" onClick={() => done(false)}>{cur.cancel ?? "Cancelar"}</button>
          <button className={`btn ${danger ? "btn-danger-solid" : "btn-brand"}`} onClick={() => done(true)} autoFocus>{cur.confirm ?? "Confirmar"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Ventana emergente centrada. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  // Se dibuja directo en <body>: la barra superior tiene desenfoque y atraparía la ventana
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon name="x" size={16} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

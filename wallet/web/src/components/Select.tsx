"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./ui";

export interface SelectOption {
  value: string;
  label: ReactNode;
  /** Texto para buscar (por defecto, el valor). */
  search?: string;
  icon?: ReactNode;
  hint?: ReactNode;
}

/** Selector propio, el mismo del panel (reemplaza al <select> del navegador): con íconos, buscador y teclado. */
export function Select({ value, options, onChange, label, searchable, floating, className = "" }: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  label: string;
  searchable?: boolean;
  /** La lista flota encima de todo (para usarlo dentro de tablas con scroll, donde se recortaría). */
  floating?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties | undefined>(undefined);
  const search = searchable ?? options.length > 8;
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => (o.search ?? o.value).toLowerCase().includes(q)) : options;
  const current = options.find((o) => o.value === value);
  const id = `sel-${label.replace(/\W+/g, "-").toLowerCase()}`;

  const close = (focus = true) => {
    setOpen(false);
    setPlace(undefined);
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
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t) && !pop.current?.contains(t)) close(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  // flotante: se ubica junto al botón (abajo, o arriba si no cabe) y se cierra si la página se mueve
  useLayoutEffect(() => {
    if (!open || !floating) return;
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom, wide = Math.max(r.width, 220);
    // cerca del borde derecho se alinea por la derecha del botón: así la lista nunca se sale de la pantalla
    const x: CSSProperties = r.left + 300 > window.innerWidth ? { right: Math.max(8, window.innerWidth - r.right), left: "auto" } : { left: Math.max(8, r.left), right: "auto" };
    const maxWidth = window.innerWidth - 16;
    setPlace(below >= 260 || below >= r.top
      ? { position: "fixed", ...x, top: r.bottom + 6, minWidth: Math.min(wide, maxWidth), maxWidth }
      : { position: "fixed", ...x, bottom: window.innerHeight - r.top + 6, minWidth: Math.min(wide, maxWidth), maxWidth });
    const away = (e: Event) => { if (!pop.current?.contains(e.target as Node)) close(false); };
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    return () => { window.removeEventListener("scroll", away, true); window.removeEventListener("resize", away); };
  }, [open, floating]);

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

  const wrap = (node: ReactNode) => (floating ? createPortal(node, document.body) : node);

  // preventDefault: dentro de un <label> (Field) un clic en la lista no debe "re-clicar" el botón y reabrirla
  return (
    <div className={`select ${open ? "open" : ""} ${className}`} ref={ref} onKeyDown={keys} onClick={(e) => e.preventDefault()}>
      <button type="button" ref={trigger} className="select-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        onClick={() => (open ? close() : show())}>
        {current?.icon}
        <span className="select-label">{current?.label ?? "Elige…"}</span>
        {current?.hint && <span className="select-hint">{current.hint}</span>}
        <Icon name="chevronDown" size={16} className="select-caret" />
      </button>
      {open && (!floating || place) && wrap(
        <div className={`select-pop ${floating ? "floating" : ""}`} ref={pop} style={floating ? place : undefined} onKeyDown={floating ? keys : undefined}>
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
        </div>,
      )}
    </div>
  );
}

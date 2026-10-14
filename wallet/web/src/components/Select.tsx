"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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

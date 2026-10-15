"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "@/lib/api";
import { yearLabel } from "@/lib/format";
import { BrandMark, Icon } from "./ui";
import { Select } from "./Select";
import { goWithSplash } from "./splash";
import { useWallet } from "./wallet";
import { Home } from "./tabs/Home";
import { Movements } from "./tabs/Movements";
import { Banks } from "./tabs/Banks";
import { Books, type BooksView } from "./tabs/Books";
import { Results, type ResultsView } from "./tabs/Results";
import { Declaration } from "./tabs/Declaration";
import { Settings } from "./tabs/Settings";

/** Destinos de navegación. Los viejos (resumen, ganancias, patrimonio, cierres) apuntan a su nuevo lugar. */
export type TabId = "inicio" | "movimientos" | "cuentas" | "resultados" | "libros" | "declaracion" | "ajustes"
  | "resumen" | "ganancias" | "patrimonio" | "cierres" | "rondas" | "caja";
type Main = "inicio" | "movimientos" | "cuentas" | "resultados" | "libros" | "declaracion" | "ajustes";

const TABS: { id: Main; label: string; icon: string }[] = [
  { id: "inicio", label: "Inicio", icon: "home" },
  { id: "movimientos", label: "Movimientos", icon: "list" },
  { id: "cuentas", label: "Cuentas", icon: "bank" },
  { id: "resultados", label: "Resultados", icon: "trend" },
  { id: "libros", label: "Libros", icon: "book" },
  { id: "declaracion", label: "Declaración", icon: "file" },
  { id: "ajustes", label: "Ajustes", icon: "settings" },
];

const ROUTES: Record<TabId, [Main, string?]> = {
  inicio: ["inicio"], resumen: ["inicio"], patrimonio: ["inicio"], movimientos: ["movimientos"], cuentas: ["cuentas"],
  resultados: ["resultados", "resumen"], ganancias: ["resultados", "operaciones"], rondas: ["resultados", "rondas"],
  libros: ["libros", "diario"], cierres: ["libros", "cierres"], caja: ["libros", "caja"], declaracion: ["declaracion"], ajustes: ["ajustes"],
};

/** Fondo que se desliza detrás de la pestaña activa (como en el panel). */
function useThumb(nav: React.RefObject<HTMLElement | null>, index: number): CSSProperties | undefined {
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    const measure = () => {
      const b = el.querySelectorAll<HTMLButtonElement>(":scope > button")[index];
      setBox(b ? { x: b.offsetLeft, w: b.offsetWidth } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.querySelectorAll(":scope > button").forEach((b) => ro.observe(b));
    return () => ro.disconnect();
  }, [nav, index]);
  return box ? { transform: `translateX(${box.x}px)`, width: box.w } : undefined;
}

function ago(t: number | null | undefined): string {
  if (!t) return "";
  const m = Math.max(0, Math.round((Date.now() / 1000 - t) / 60));
  return m < 1 ? "hace un momento" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
}

/** Estado de Binance en la barra superior, como el "EN VIVO" del panel. */
function LivePill({ onClick }: { onClick: () => void }) {
  const { binance } = useWallet();
  if (!binance) return null;
  const running = binance.job.state === "running";
  const error = !running && (binance.job.state === "error" || !!binance.last_error);
  const cls = !binance.connected ? "" : running ? "busy" : error ? "bad" : "ok";
  const label = !binance.connected ? "BINANCE" : running ? "SINCRONIZANDO" : error ? "REVISAR BINANCE" : "BINANCE";
  const txt = !binance.connected ? "sin conectar" : running ? "" : error ? "" : ago(binance.last_ok);
  return (
    <button className={`live ${cls}`} onClick={onClick} title="Estado de la conexión con Binance">
      <span className="dot" />
      <b>{label}</b>
      {txt && <span className="live-txt">· {txt}</span>}
    </button>
  );
}

/** Traer ya lo último de Binance, sin esperar la sincronización automática. */
function SyncButton() {
  const { binance, setBinance, toast } = useWallet();
  const [asking, setAsking] = useState(false);
  if (!binance?.connected) return null;
  const running = asking || binance.job.state === "running";
  async function sync() {
    if (running) return;
    setAsking(true);
    try {
      setBinance(await api.binanceSync());
    } catch (e) {
      toast("No se pudo sincronizar", (e as Error).message, "bad");
    }
    setAsking(false);
  }
  return (
    <button className={`sync-btn ${running ? "busy" : ""}`} onClick={() => void sync()} disabled={running}
      title={running ? "Trayendo tus órdenes de Binance…" : "Traer ya tus últimas órdenes de Binance"}>
      <Icon name="refresh" size={15} />
      <span className="hide-sm">{running ? "Sincronizando…" : "Sincronizar"}</span>
    </button>
  );
}

/** Foto de perfil del panel (la trae la wallet por /api/me/avatar); si no hay, la inicial. */
function Avatar({ name, size }: { name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = size ? { width: size, height: size, fontSize: size * 0.42 } : undefined;
  return (
    <span className={`avatar ${failed ? "" : "has-img"}`} style={style}>
      {failed ? name.slice(0, 1).toUpperCase()
        // eslint-disable-next-line @next/next/no-img-element
        : <img src="/api/me/avatar" alt="" onError={() => setFailed(true)} />}
    </span>
  );
}

function UserMenu({ onTab, onLogout }: { onTab: (t: TabId) => void; onLogout: () => void }) {
  const { me } = useWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const name = me.user.username;
  return (
    <div className="menu" ref={ref}>
      <button className={`chip user-btn ${open ? "open" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        <Avatar name={name} />
        <span className="user-name">{name}</span>
        <Icon name="chevronDown" size={14} className="user-caret" />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <div className="menu-who menu-who-photo">
            <Avatar name={name} size={40} />
            <div>
              <b>{me.profile.name || name}</b>
              <small>{me.user.role === "admin" ? "Administrador" : "Usuario"}{me.profile.nit ? ` · CC ${me.profile.nit}` : ""}</small>
            </div>
          </div>
          <a role="menuitem" href={me.panel} onClick={(e) => { e.preventDefault(); setOpen(false); goWithSplash(me.panel, "Volviendo al panel"); }}><Icon name="back" size={16} /> Volver al panel</a>
          <button role="menuitem" onClick={() => { setOpen(false); onTab("ajustes"); }}><Icon name="settings" size={16} /> Ajustes y perfil fiscal</button>
          <button role="menuitem" className="danger" onClick={onLogout}><Icon name="logout" size={16} /> Cerrar sesión</button>
        </div>
      )}
    </div>
  );
}

export function App() {
  const { me, year, setYear } = useWallet();
  const [tab, setTabState] = useState<Main>("inicio");
  const [sub, setSub] = useState<string | undefined>(undefined);
  const [light, setLight] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const thumb = useThumb(navRef, TABS.findIndex((t) => t.id === tab));

  useEffect(() => {
    setLight(document.documentElement.dataset.theme === "light");
    const saved = sessionStorage.getItem("acw-tab") as TabId | null;
    if (saved && saved in ROUTES) {
      const [m, s] = ROUTES[saved];
      setTabState(m);
      setSub(s);
    }
  }, []);

  const setTab = (t: TabId) => {
    const [m, s] = ROUTES[t] ?? ["inicio"];
    setTabState(m);
    setSub(s);
    try { sessionStorage.setItem("acw-tab", m); } catch { /* sin almacenamiento */ }
    window.scrollTo({ top: 0 });
  };

  const toggleTheme = () => {
    const next = !light;
    setLight(next);
    if (next) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("acw-theme", next ? "light" : "dark"); } catch { /* sin almacenamiento */ }
  };

  // cierra la sesión de la wallet y la del panel (es la misma persona y la misma sesión)
  const logout = async () => {
    const r = await api.logout().catch(() => ({ panel: me.panel }));
    goWithSplash(`${r.panel}/salir`, "Cerrando sesión");
  };

  return (
    <div className="shell">
      <header className="top">
        <div className="wrap top-in">
          <div className="brand">
            <BrandMark />
            <span>
              <span className="brand-name">Arbi<span>Crypto</span></span>
              <span className="brand-sub">Wallet · Contabilidad DIAN</span>
            </span>
          </div>
          <LivePill onClick={() => setTab("inicio")} />
          <SyncButton />
          <div className="top-actions">
            <div className="year-select">
              <Select label="Año gravable" value={String(year)} searchable={false} onChange={(v) => setYear(Number(v))}
                options={me.years.map((y) => ({ value: String(y), label: yearLabel(y), icon: <Icon name="calendar" size={16} /> }))} />
            </div>
            <button className="icon-btn hide-sm" onClick={toggleTheme} title={light ? "Tema oscuro" : "Tema claro"} aria-label="Cambiar tema">
              <Icon name={light ? "moon" : "sun"} />
            </button>
            <UserMenu onTab={setTab} onLogout={logout} />
          </div>
        </div>
      </header>
      <div className="nav-wrap">
        <div className="wrap">
          <nav className="nav" ref={navRef} aria-label="Secciones">
            <span className="nav-thumb" style={thumb} aria-hidden="true" />
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}>
                <Icon name={t.icon} size={17} />
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>
      <main className="wrap">
        {tab === "inicio" && <Home onTab={setTab} />}
        {tab === "movimientos" && <Movements />}
        {tab === "cuentas" && <Banks />}
        {tab === "resultados" && <Results onTab={setTab} initialView={(sub as ResultsView) || "resumen"} />}
        {tab === "libros" && <Books initialView={(sub as BooksView) || "diario"} />}
        {tab === "declaracion" && <Declaration onTab={setTab} />}
        {tab === "ajustes" && <Settings />}
      </main>
      <footer className="wrap foot">
        <BrandMark size={22} />
        Cálculo informativo según el Estatuto Tributario y el Concepto DIAN 1621 de 2023. Revísalo con un contador antes de declarar.
      </footer>
    </div>
  );
}

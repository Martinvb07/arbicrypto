"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
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

const TABS: { id: Main; label: string; icon: string; sub: string; group: string }[] = [
  { id: "inicio", label: "Inicio", icon: "home", sub: "Tus saldos en Binance y bancos, y cómo vas este año", group: "Tu dinero" },
  { id: "movimientos", label: "Movimientos", icon: "list", sub: "Compras, ventas, gastos y aportes", group: "Tu dinero" },
  { id: "cuentas", label: "Cuentas", icon: "bank", sub: "Tus bancos y sus extractos", group: "Tu dinero" },
  { id: "resultados", label: "Resultados", icon: "trend", sub: "Cuánto ganaste o perdiste en cada operación", group: "Tu dinero" },
  { id: "libros", label: "Libros", icon: "book", sub: "Libro diario, mayor, caja y estados financieros", group: "Contabilidad" },
  { id: "declaracion", label: "Declaración", icon: "file", sub: "Tu formulario 210 ante la DIAN", group: "Contabilidad" },
  { id: "ajustes", label: "Ajustes", icon: "settings", sub: "Tu perfil fiscal y preferencias", group: "Cuenta" },
];

const ROUTES: Record<TabId, [Main, string?]> = {
  inicio: ["inicio"], resumen: ["inicio"], patrimonio: ["inicio"], movimientos: ["movimientos"], cuentas: ["cuentas"],
  resultados: ["resultados", "resumen"], ganancias: ["resultados", "operaciones"], rondas: ["resultados", "rondas"],
  libros: ["libros", "diario"], cierres: ["libros", "cierres"], caja: ["libros", "caja"], declaracion: ["declaracion"], ajustes: ["ajustes"],
};

/** Resaltado que se desliza (en vertical) hasta la sección activa del sidebar, como en el panel. */
function usePill(nav: React.RefObject<HTMLElement | null>, key: string): CSSProperties | null {
  const [box, setBox] = useState<{ y: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    const measure = () => {
      const b = el.querySelector<HTMLElement>("button.on");
      setBox(b ? { y: b.offsetTop, h: b.offsetHeight } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nav, key]);
  return box ? { transform: `translateY(${box.y}px)`, height: box.h } : null;
}

/** Las secciones del sidebar por grupos, con el resaltado deslizante. */
function SideNav({ tab, onTab, onPick }: { tab: Main; onTab: (t: TabId) => void; onPick?: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const pill = usePill(ref, tab);
  const [moved, setMoved] = useState(false); // el primer pintado no se anima
  useEffect(() => { const t = setTimeout(() => setMoved(true), 50); return () => clearTimeout(t); }, []);
  const groups = [...new Set(TABS.map((t) => t.group))];
  let k = 0;
  return (
    <nav className="side-nav" ref={ref} aria-label="Secciones">
      {pill && <span className={`side-pill ${moved ? "" : "still"}`} style={pill} aria-hidden="true" />}
      {groups.map((g, gi) => (
        <div key={g} className="side-sec">
          {gi > 0 && <small className="side-group"><span>{g}</span></small>}
          {TABS.filter((t) => t.group === g).map((t) => (
            <button key={t.id} className={tab === t.id ? "on" : ""} aria-current={tab === t.id ? "page" : undefined} data-tip={t.label}
              style={{ ["--i" as string]: k++ } as CSSProperties} onClick={() => { onTab(t.id); onPick?.(); }}>
              <Icon name={t.icon} size={19} className="side-ico" />
              <span className="side-lbl">{t.label}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Tu foto (o inicial), tu nombre y tu rol, arriba del menú. */
function SideProfile() {
  const { me } = useWallet();
  const name = me.user.username;
  return (
    <div className="side-profile" title={name}>
      <span className="side-av"><Avatar name={name} size={38} /></span>
      <div className="side-who">
        <b>{me.profile.name || name}</b>
        <small>{me.user.role === "admin" ? "Administrador" : "Usuario"}{me.profile.nit ? <span> · CC {me.profile.nit}</span> : null}</small>
      </div>
    </div>
  );
}

/** Abajo: volver al panel, tema, cerrar sesión y contraer. */
function SideFoot({ light, onTheme, onLogout, mini, onToggle }: {
  light: boolean; onTheme: (light: boolean, from?: { x: number; y: number }) => void; onLogout: () => void; mini?: boolean; onToggle?: () => void;
}) {
  const { me } = useWallet();
  return (
    <div className="side-foot">
      <button className="side-link" data-tip="Volver al panel" onClick={() => goWithSplash(me.panel, "Volviendo al panel")}>
        <Icon name="back" size={18} /><span>Volver al panel</span>
      </button>
      <button className="side-link" data-tip={light ? "Tema oscuro" : "Tema claro"} onClick={(e) => onTheme(!light, { x: e.clientX, y: e.clientY })}>
        <span className="side-theme" key={String(light)}><Icon name={light ? "moon" : "sun"} size={18} /></span>
        <span className="side-theme-lbl" key={`l${light}`}>{light ? "Tema oscuro" : "Tema claro"}</span>
      </button>
      <button className="side-link danger" data-tip="Cerrar sesión" onClick={onLogout}>
        <Icon name="logout" size={18} /><span>Cerrar sesión</span>
      </button>
      {onToggle && (
        <button className="side-link side-fold-btn" data-tip="Expandir" onClick={onToggle} aria-expanded={!mini}>
          <Icon name={mini ? "chevron" : "chevronLeft"} size={18} /><span>Contraer</span>
        </button>
      )}
    </div>
  );
}

function Logo() {
  return (
    <div className="side-logo">
      <BrandMark size={36} />
      <span className="side-name">Arbi<span>Crypto</span> <small>Wallet</small></span>
    </div>
  );
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
  const [mini, setMini] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    setLight(document.documentElement.dataset.theme === "light");
    setMini(document.documentElement.dataset.side === "mini");
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

  const toggleMini = () => {
    const next = !mini;
    setMini(next);
    if (next) document.documentElement.dataset.side = "mini";
    else delete document.documentElement.dataset.side;
    try { localStorage.setItem("acw-side", next ? "mini" : "full"); } catch { /* sin almacenamiento */ }
  };

  const setTheme = (next: boolean, from?: { x: number; y: number }) => {
    const apply = () => {
      setLight(next);
      if (next) document.documentElement.dataset.theme = "light";
      else delete document.documentElement.dataset.theme;
      try { localStorage.setItem("acw-theme", next ? "light" : "dark"); } catch { /* sin almacenamiento */ }
    };
    // el tema nuevo se abre en círculo desde el botón (donde el navegador lo permite)
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (!doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return apply();
    document.documentElement.style.setProperty("--vt-x", `${from?.x ?? innerWidth / 2}px`);
    document.documentElement.style.setProperty("--vt-y", `${from?.y ?? innerHeight / 2}px`);
    doc.startViewTransition(() => flushSync(apply));
  };

  // cierra la sesión de la wallet y la del panel (es la misma persona y la misma sesión)
  const logout = async () => {
    const r = await api.logout().catch(() => ({ panel: me.panel }));
    goWithSplash(`${r.panel}/salir`, "Cerrando sesión");
  };

  const cur = TABS.find((t) => t.id === tab) ?? TABS[0];
  return (
    <div className="shell">
      <aside className="side">
        <Logo />
        <SideProfile />
        <SideNav tab={tab} onTab={setTab} />
        <SideFoot light={light} onTheme={setTheme} onLogout={() => void logout()} mini={mini} onToggle={toggleMini} />
      </aside>
      {drawer && (
        <div className="drawer" role="dialog" aria-label="Secciones" onClick={() => setDrawer(false)}>
          <aside className="side drawer-side" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-top">
              <Logo />
              <button className="icon-btn" onClick={() => setDrawer(false)} aria-label="Cerrar menú"><Icon name="x" /></button>
            </div>
            <SideProfile />
            <div className="drawer-live"><LivePill onClick={() => { setTab("inicio"); setDrawer(false); }} /></div>
            <SideNav tab={tab} onTab={setTab} onPick={() => setDrawer(false)} />
            <SideFoot light={light} onTheme={setTheme} onLogout={() => void logout()} />
          </aside>
        </div>
      )}
      <div className="shell-main">
      <header className="topbar">
        <button className="icon-btn topbar-burger" onClick={() => setDrawer(true)} aria-label="Abrir menú de secciones"><Icon name="menu" size={20} /></button>
        <div className="topbar-title" key={tab}>
          <h1>{cur.label}</h1>
          <p>{cur.sub}</p>
        </div>
        <div className="top-actions">
          <LivePill onClick={() => setTab("inicio")} />
          <SyncButton />
          <div className="year-select">
            <Select label="Año gravable" value={String(year)} searchable={false} onChange={(v) => setYear(Number(v))}
              options={me.years.map((y) => ({ value: String(y), label: yearLabel(y), icon: <Icon name="calendar" size={16} /> }))} />
          </div>
          <UserMenu onTab={setTab} onLogout={logout} />
        </div>
      </header>
      <main className="wrap page-in" key={tab}>
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
    </div>
  );
}

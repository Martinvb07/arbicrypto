"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { perUsd } from "@/lib/format";
import { chatUnread, useChat } from "@/lib/chat";
import { useLive } from "@/lib/live";
import { Menu, Modal, Sheet } from "./overlay";
import { Ago, Brand, Icon, PasswordInput, useThumb, type IconName } from "./ui";

export type TabId = "inicio" | "vender" | "mercado" | "anuncios" | "historial" | "chat" | "cuenta" | "equipo";

export const TABS: { id: TabId; label: string; icon: IconName; admin?: boolean }[] = [
  { id: "inicio", label: "Arbitraje", icon: "bolt" },
  { id: "vender", label: "¿Dónde vendo?", icon: "target" },
  { id: "mercado", label: "Precios P2P", icon: "chart" },
  { id: "anuncios", label: "Simular anuncios", icon: "megaphone" },
  { id: "historial", label: "Historial", icon: "clock" },
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "cuenta", label: "Mi Binance", icon: "wallet" },
  { id: "equipo", label: "Equipo", icon: "users", admin: true },
];

// ---------------------------------------------------------------- avisos (en la barra)

function Row({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="pop-row">
      <div><b>{title}</b>{sub && <small>{sub}</small>}</div>
      <div className="pop-ctl">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <label className="switch"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} /></label>;
}

function AlertsMenu({ onTelegram }: { onTelegram: () => void }) {
  const { state, prefs, setPrefs, permission, askPermission, soundReady, enableSound, saveSettings, toast } = useLive();
  const [minUsd, setMinUsd] = useState("");
  useEffect(() => {
    if (state) setMinUsd(String(state.settings.min_per_usd));
  }, [state?.settings.min_per_usd]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!state) return null;
  const admin = state.user.role === "admin";
  const windowsOn = permission === "granted" && prefs.desktop;
  const soundOn = prefs.sound && soundReady;
  const ready = windowsOn && (soundOn || !prefs.sound);
  const commitMin = async () => {
    const n = Number(minUsd.replace(",", "."));
    if (!Number.isFinite(n) || n === state.settings.min_per_usd) return setMinUsd(String(state.settings.min_per_usd));
    if (await saveSettings({ min_per_usd: n })) toast("Aviso actualizado", `Te avisamos desde ${perUsd(n)} por dólar.`, "good", 2500);
  };
  const test = () => api.testAlert().then(() => undefined, (e: Error) => toast("Espera", e.message, "info"));
  return (
    <Menu label="Avisos" width={340} buttonClass={`btn btn-sm ${ready ? "bell-on" : "bell-warn"}`}
      button={<><Icon name={ready ? "bell" : "bellOff"} size={16} /><span className="lbl">Avisos</span></>}>
      {(close) => (
        <div className="pop">
          <div className="pop-head"><b>Avisos</b><small>Solo cuando aparece una oportunidad con ganancia</small></div>
          <Row title="Avisar desde" sub="Ganancia por dólar">
            <span className="inline-field">
              <input type="number" min={0} step="any" value={minUsd} onChange={(e) => setMinUsd(e.target.value)}
                onBlur={() => void commitMin()} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
              <span>COP</span>
            </span>
          </Row>
          <Row title="Sonido" sub={prefs.sound && !soundReady ? "Toca Activar para habilitarlo" : undefined}>
            {prefs.sound && !soundReady && <button className="btn btn-sm" onClick={enableSound}>Activar</button>}
            <Switch checked={prefs.sound} onChange={(v) => setPrefs({ sound: v })} label="Sonido" />
          </Row>
          <Row title="Notificaciones de Windows" sub="Con el panel abierto en el navegador">
            {permission === "granted"
              ? <Switch checked={prefs.desktop} onChange={(v) => setPrefs({ desktop: v })} label="Notificaciones" />
              : <button className="btn btn-sm btn-brand" onClick={() => void askPermission()}>Activar</button>}
          </Row>
          <Row title="Celular (Telegram)" sub={state.telegram.ready ? `Llega a ${state.telegram.chat}` : "Avisos al celular, para ti o el equipo"}>
            {admin ? <button className="btn btn-sm" onClick={() => { close(); onTelegram(); }}>{state.telegram.ready ? "Cambiar" : "Configurar"}</button>
              : <span className={state.telegram.ready ? "up" : "muted"}>{state.telegram.ready ? "Activo" : "No configurado"}</span>}
          </Row>
          <button className="btn btn-sm" style={{ width: "100%", marginTop: 10 }} onClick={() => void test()}>Probar aviso</button>
        </div>
      )}
    </Menu>
  );
}

function TelegramModal({ onClose }: { onClose: () => void }) {
  const { state, refresh, toast } = useLive();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const tg = state.telegram;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok, undefined, "good", 4000);
      setToken("");
      refresh();
    } catch (e) {
      toast("No se pudo", (e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Avisos al celular (Telegram)" onClose={onClose}>
      {tg.ready && (
        <div className="banner info" style={{ marginBottom: 14 }}>
          <Icon name="check" size={16} /> <span>Activo: llega a <b>{tg.chat}</b> por @{tg.bot}.</span>
        </div>
      )}
      <ol className="tg-steps">
        <li>En Telegram busca <b>@BotFather</b>, escribe <code>/newbot</code> y copia el <b>token</b>.
          <div className="inline-form" style={{ marginTop: 8 }}>
            <input type="text" placeholder="123456789:ABC..." value={token} onChange={(e) => setToken(e.target.value)} spellCheck={false} style={{ maxWidth: 280 }} />
            <button className="btn btn-sm btn-brand" disabled={busy || !token} onClick={() => void run(() => api.tgConnect(token), "Bot conectado")}>Conectar</button>
            {tg.bot && <span className="badge good">@{tg.bot}</span>}
          </div>
        </li>
        <li>Escríbele <code>/start</code> a tu bot. Para el equipo: agrégalo a un grupo y escribe <code>/start</code> ahí.</li>
        <li><button className="btn btn-sm" disabled={busy || !tg.bot} onClick={() => void run(api.tgDetect, "Listo: te llegó un mensaje de prueba")}>Buscar mi chat</button></li>
      </ol>
      {tg.ready && (
        <button className="btn btn-sm btn-danger" style={{ marginTop: 14 }} disabled={busy} onClick={() => void run(api.tgDisconnect, "Telegram desconectado")}>Quitar Telegram</button>
      )}
    </Modal>
  );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const { toast } = useLive();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) return toast("Las contraseñas nuevas no coinciden", undefined, "bad");
    try {
      await api.changePassword(cur, next);
      toast("Contraseña cambiada", "Se cerraron tus otras sesiones.", "good");
      onClose();
    } catch (err) {
      toast("No se pudo cambiar", (err as Error).message, "bad");
    }
  };
  return (
    <Modal title="Cambiar contraseña" onClose={onClose}>
      <form className="fields" onSubmit={(e) => void submit(e)}>
        <label className="login-field">Actual<PasswordInput value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required autoFocus /></label>
        <label className="login-field">Nueva (mínimo 8)<PasswordInput value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required /></label>
        <label className="login-field">Repite la nueva<PasswordInput value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" minLength={8} required /></label>
        <button className="btn btn-brand" type="submit">Cambiar contraseña</button>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- barra superior

export function Header({ onTab }: { onTab: (t: TabId) => void }) {
  const { state, offline } = useLive();
  const [modal, setModal] = useState<"telegram" | "password" | null>(null);
  const errors = state ? Object.keys(state.errors).length : 0;
  const liveCls = offline || !state ? "" : errors ? "warn" : "ok";

  const toggleTheme = () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try {
      localStorage.setItem("theme", root.dataset.theme);
    } catch {
      /* sin almacenamiento */
    }
  };
  const logout = async () => {
    await api.logout().catch(() => undefined);
    window.location.href = "/login";
  };

  return (
    <header className="top">
      <div className="wrap top-in">
        <a href="#inicio" onClick={() => onTab("inicio")} style={{ textDecoration: "none" }}><Brand /></a>
        <span className={`live ${liveCls}`} title="Conexión con Binance">
          <span className="dot" />
          <b>{offline ? "SIN CONEXIÓN" : !state ? "CONECTANDO" : errors ? "CON ERRORES" : "EN VIVO"}</b>
          {state && !offline && <span className="live-txt">· <Ago t={Math.max(state.spot?.t ?? 0, state.p2p?.t ?? 0)} /></span>}
        </span>
        <div className="actions">
          <AlertsMenu onTelegram={() => setModal("telegram")} />
          <button className="icon-btn" id="btn-theme" onClick={toggleTheme} title="Tema claro u oscuro" aria-label="Cambiar tema">
            <Icon name="moon" size={17} />
          </button>
          {state?.user && (
            <Menu label="Menú de usuario" buttonClass="btn btn-sm user-btn"
              button={<><span className="avatar">{state.user.name.slice(0, 1).toUpperCase()}</span><span className="lbl">{state.user.name}</span></>}>
              {(close) => (
                <>
                  <div className="menu-who">
                    <b>{state.user.name}</b>
                    <span className="sub">{state.user.role === "admin" ? "Administrador" : "Miembro del equipo"}</span>
                  </div>
                  <button onClick={() => { close(); setModal("password"); }}><Icon name="key" size={16} /> Cambiar contraseña</button>
                  {state.user.role === "admin" && <button onClick={() => { close(); onTab("equipo"); }}><Icon name="ticket" size={16} /> Invitar al equipo</button>}
                  <button onClick={() => void logout()}><Icon name="logout" size={16} /> Cerrar sesión</button>
                </>
              )}
            </Menu>
          )}
        </div>
      </div>
      {modal === "telegram" && <TelegramModal onClose={() => setModal(null)} />}
      {modal === "password" && <PasswordModal onClose={() => setModal(null)} />}
    </header>
  );
}

export function Nav({ tab, onTab }: { tab: TabId; onTab: (t: TabId) => void }) {
  const { state } = useLive();
  const admin = state?.user?.role === "admin";
  // Mi Binance es de todos: cada usuario ve solo su propia cuenta
  const tabs = TABS.filter((t) => !t.admin || admin);
  const nav = useRef<HTMLElement>(null);
  const [menu, setMenu] = useState(false);
  const cur = tabs.find((t) => t.id === tab) ?? tabs[0];
  const thumb = useThumb(nav, tabs.findIndex((t) => t.id === tab));
  const unread = chatUnread(useChat().summary);
  const count = (t: TabId) => (t === "chat" && unread > 0 ? <span className="count" aria-label={`${unread} sin leer`}>{unread > 99 ? "99+" : unread}</span> : null);
  useEffect(() => {
    nav.current?.querySelector<HTMLElement>("button.on")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [tab]);
  return (
    <div className="nav-wrap">
      <nav className="wrap nav" aria-label="Secciones" ref={nav}>
        {thumb && <span className="nav-thumb" style={thumb} aria-hidden="true" />}
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => onTab(t.id)} aria-current={tab === t.id ? "page" : undefined}>
            <Icon name={t.icon} size={17} />
            {t.label}
            {count(t.id)}
          </button>
        ))}
      </nav>
      {/* celular: una sola barra con la sección actual que abre el menú */}
      <div className="wrap nav-mobile">
        <button className="nav-burger" onClick={() => setMenu(true)} aria-label="Abrir menú de secciones" aria-expanded={menu}>
          <Icon name="menu" size={20} />
          <span className="nav-burger-cur"><Icon name={cur.icon} size={17} /> {cur.label}</span>
          {cur.id !== "chat" && count("chat")}
          <Icon name="chevronDown" size={16} />
        </button>
      </div>
      {menu && (
        <Sheet side="left" title="Secciones" onClose={() => setMenu(false)}>
          <div className="drawer-list">
            {tabs.map((t) => (
              <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => { onTab(t.id); setMenu(false); }}>
                <Icon name={t.icon} size={19} /> {t.label}
                {count(t.id)}
                {tab === t.id && <Icon name="check" size={16} className="drawer-check" />}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

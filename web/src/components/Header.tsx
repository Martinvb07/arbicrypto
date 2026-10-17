"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { perUsd } from "@/lib/format";
import { goWithSplash } from "./splash";
import { avatarImage, chatUnread, useChat } from "@/lib/chat";
import { useLive } from "@/lib/live";
import { Menu, Modal, Sheet } from "./overlay";
import { Ago, Brand, Icon, PasswordInput, UserAvatar, type IconName } from "./ui";

export type TabId = "inicio" | "vender" | "mercado" | "anuncios" | "historial" | "chat" | "cuenta" | "equipo";

export const TABS: { id: TabId; label: string; icon: IconName; sub: string; group?: "cuenta"; admin?: boolean }[] = [
  { id: "mercado", label: "Precios P2P", icon: "chart", sub: "Compradores y vendedores de Binance P2P en pesos, en vivo" },  // la principal: abre aquí
  { id: "vender", label: "¿Dónde vendo?", icon: "target", sub: "Tus monedas, cuánto te costaron y cuánto ganas si vendes ya" },
  { id: "inicio", label: "Arbitraje", icon: "bolt", sub: "Comprar barato y vender más caro, con todos los costos" },
  { id: "anuncios", label: "Simular anuncios", icon: "megaphone", sub: "Cuánto ganas publicando tus propios anuncios" },
  { id: "historial", label: "Historial", icon: "clock", sub: "Oportunidades pasadas y las mejores horas" },
  { id: "chat", label: "Chat", icon: "chat", sub: "Habla con tu equipo", group: "cuenta" },
  { id: "cuenta", label: "Mi Binance", icon: "wallet", sub: "Tus saldos y órdenes, solo los ves tú", group: "cuenta" },
  { id: "equipo", label: "Equipo", icon: "users", sub: "Tu equipo, solicitudes e invitaciones", group: "cuenta" },
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
          <Row title="Notificaciones de Windows" sub="Llegan aunque la pestaña esté dormida o cerrada">
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

// ---------------------------------------------------------------- tema

type Theme = "light" | "dark";
function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => {
    const root = document.documentElement;
    setThemeState(root.dataset.theme ? (root.dataset.theme as Theme) : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);
  const setTheme = (t: Theme) => {
    document.documentElement.dataset.theme = t;
    setThemeState(t);
    try {
      localStorage.setItem("theme", t);
    } catch {
      /* sin almacenamiento */
    }
  };
  return [theme, setTheme];
}

async function logout() {
  // en el VPS el login vive en la portada (arbicrypto.org/login)
  const r = await api.logout().catch(() => undefined);
  window.location.href = r?.login || "/login";
}

/** Insignia de pendientes al lado de una sección (chat sin leer, solicitudes del equipo). */
function useCounts() {
  const { state } = useLive();
  const unread = chatUnread(useChat().summary);
  const waiting = state?.my_team?.waiting ?? 0;
  return (t: TabId) => (t === "chat" && unread > 0 ? <span className="count" aria-label={`${unread} sin leer`}>{unread > 99 ? "99+" : unread}</span>
    : t === "equipo" && waiting > 0 ? <span className="count" aria-label={`${waiting} por responder`}>{waiting}</span> : null);
}

/** Estado de la conexión con Binance. */
function LiveBadge() {
  const { state, offline } = useLive();
  const errors = state ? Object.keys(state.errors).length : 0;
  const cls = offline || !state ? "" : errors ? "warn" : "ok";
  return (
    <span className={`live ${cls}`} title="Conexión con Binance">
      <span className="dot" />
      <b>{offline ? "SIN CONEXIÓN" : !state ? "CONECTANDO" : errors ? "CON ERRORES" : "EN VIVO"}</b>
      {state && !offline && <span className="live-txt">· <Ago t={Math.max(state.spot?.t ?? 0, state.p2p?.t ?? 0)} /></span>}
    </span>
  );
}

/** Las secciones en lista vertical (la usan el sidebar y el menú del celular). */
function SideNav({ tab, onTab, onPick }: { tab: TabId; onTab: (t: TabId) => void; onPick?: () => void }) {
  const { state } = useLive();
  const admin = state?.user?.role === "admin";
  const tabs = TABS.filter((t) => !t.admin || admin);
  const count = useCounts();
  const main = tabs.filter((t) => t.group !== "cuenta");
  const more = tabs.filter((t) => t.group === "cuenta");
  const item = (t: (typeof TABS)[number]) => (
    <button key={t.id} className={tab === t.id ? "on" : ""} aria-current={tab === t.id ? "page" : undefined}
      onClick={() => { onTab(t.id); onPick?.(); }}>
      <span className="side-ico"><Icon name={t.icon} size={18} /></span>
      <span className="side-lbl">{t.label}</span>
      {count(t.id)}
    </button>
  );
  return (
    <nav className="side-nav" aria-label="Secciones">
      <small className="side-group">Mercado</small>
      {main.map(item)}
      <small className="side-group">Tu cuenta</small>
      {more.map(item)}
      {state?.user && state.user.access !== "panel" && (
        <button onClick={() => goWithSplash("/wallet", "Abriendo tu wallet", "Contabilidad y declaración")}>
          <span className="side-ico"><Icon name="book" size={18} /></span>
          <span className="side-lbl">Wallet</span>
          <Icon name="external" size={13} className="side-ext" />
        </button>
      )}
    </nav>
  );
}

function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="theme-sw" role="radiogroup" aria-label="Tema">
      <span className="theme-thumb" style={{ transform: theme === "dark" ? "translateX(100%)" : "none" }} aria-hidden="true" />
      <button role="radio" aria-checked={theme === "light"} className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")}><Icon name="sun" size={15} /> Claro</button>
      <button role="radio" aria-checked={theme === "dark"} className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")}><Icon name="moon" size={15} /> Oscuro</button>
    </div>
  );
}

// ---------------------------------------------------------------- sidebar (escritorio)

export function Sidebar({ tab, onTab }: { tab: TabId; onTab: (t: TabId) => void }) {
  return (
    <aside className="side">
      <a href="#mercado" className="side-brand" onClick={() => onTab("mercado")}><Brand /></a>
      <SideNav tab={tab} onTab={onTab} />
      <div className="side-foot">
        <ThemeSwitch />
        <button className="side-out" onClick={() => void logout()}><Icon name="logout" size={17} /> Cerrar sesión</button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- barra superior

const TODAY = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long" });

export function Topbar({ tab, onTab }: { tab: TabId; onTab: (t: TabId) => void }) {
  const { state, refresh, toast } = useLive();
  const photoInput = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const [today, setToday] = useState("");
  useEffect(() => setToday(TODAY.format(new Date())), []);
  const unread = chatUnread(useChat().summary);
  const myPhoto = state?.user ? state.avatars?.[state.user.name] : undefined;
  const cur = TABS.find((t) => t.id === tab) ?? TABS[0];
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      await api.avatarSet(await avatarImage(file));
      refresh();
      toast("Foto lista", "Tu equipo ya la ve en el chat.", "good", 2500);
    } catch (e) {
      toast("No se pudo cambiar la foto", (e as Error).message, "bad");
    }
  };
  const removePhoto = async () => {
    try {
      await api.avatarDelete();
      refresh();
    } catch (e) {
      toast("No se pudo quitar la foto", (e as Error).message, "bad");
    }
  };
  const [modal, setModal] = useState<"telegram" | "password" | null>(null);

  return (
    <header className="topbar">
      <button className="icon-btn topbar-burger" onClick={() => setMenu(true)} aria-label="Abrir menú de secciones" aria-expanded={menu}>
        <Icon name="menu" size={20} />
      </button>
      <div className="topbar-title" key={tab}>
        <h1>{cur.label}</h1>
        <p>{cur.sub}</p>
      </div>
      <div className="topbar-act">
        {today && <span className="topbar-today"><Icon name="calendar" size={15} /> Hoy, {today}</span>}
        <LiveBadge />
        <AlertsMenu onTelegram={() => setModal("telegram")} />
        <button className={`icon-btn topbar-chat ${tab === "chat" ? "on" : ""}`} onClick={() => onTab("chat")} title="Chat" aria-label="Chat">
          <Icon name="chat" size={18} />
          {unread > 0 && <span className="topbar-dot" aria-label={`${unread} sin leer`} />}
        </button>
        {state?.user && (
          <Menu label="Menú de usuario" buttonClass="btn btn-sm user-btn"
            button={<><UserAvatar name={state.user.name} src={myPhoto} /><span className="lbl">{state.user.name}</span><Icon name="chevronDown" size={14} className="user-caret" /></>}>
            {(close) => (
              <>
                <div className="menu-who menu-who-photo">
                  <UserAvatar name={state.user.name} src={myPhoto} size={42} />
                  <div>
                    <b>{state.user.name}</b>
                    <span className="sub">{state.user.role === "admin" ? "Administrador" : "Miembro"}{state.my_team?.name ? ` · ${state.my_team.name}` : " · sin equipo"}</span>
                  </div>
                </div>
                {/* su propia wallet (wallet.arbicrypto.org), con esta misma sesión */}
                {state.user.access !== "panel" && <button onClick={() => { close(); goWithSplash("/wallet", "Abriendo tu wallet", "Contabilidad y declaración"); }}><Icon name="wallet" size={16} /> Wallet</button>}
                <button onClick={() => { close(); photoInput.current?.click(); }}><Icon name="pencil" size={16} /> {myPhoto ? "Cambiar foto" : "Poner foto de perfil"}</button>
                {myPhoto && <button onClick={() => { close(); void removePhoto(); }}><Icon name="trash" size={16} /> Quitar foto</button>}
                <button onClick={() => { close(); setModal("password"); }}><Icon name="key" size={16} /> Cambiar contraseña</button>
                {state.user.role === "admin" && <button onClick={() => { close(); onTab("equipo"); }}><Icon name="ticket" size={16} /> Invitar al equipo</button>}
                <button onClick={() => void logout()}><Icon name="logout" size={16} /> Cerrar sesión</button>
              </>
            )}
          </Menu>
        )}
        <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden
          onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {menu && (
        <Sheet side="left" title={<span className="drawer-brand"><Brand /></span>} onClose={() => setMenu(false)}>
          <div className="drawer-side">
            <LiveBadge />
            <SideNav tab={tab} onTab={onTab} onPick={() => setMenu(false)} />
            <div className="side-foot">
              <ThemeSwitch />
              <button className="side-out" onClick={() => void logout()}><Icon name="logout" size={17} /> Cerrar sesión</button>
            </div>
          </div>
        </Sheet>
      )}
      {modal === "telegram" && <TelegramModal onClose={() => setModal(null)} />}
      {modal === "password" && <PasswordModal onClose={() => setModal(null)} />}
    </header>
  );
}

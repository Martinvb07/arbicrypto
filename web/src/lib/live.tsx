"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "./api";
import { refreshChat } from "./chat";
import { isMine } from "./calc";
import type { Alert, HistPoint, MutableKind, Settings, State } from "./types";

// ---------------------------------------------------------------- reloj compartido (para "hace 3 s")

const clockListeners = new Set<() => void>();
let nowSec = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;

function subscribeClock(cb: () => void) {
  clockListeners.add(cb);
  if (!clockTimer) {
    nowSec = Date.now() / 1000;
    clockTimer = setInterval(() => {
      nowSec = Date.now() / 1000;
      clockListeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    clockListeners.delete(cb);
  };
}

export const useNow = () => useSyncExternalStore(subscribeClock, () => nowSec || Date.now() / 1000, () => 0);

// ---------------------------------------------------------------- preferencias de este navegador

export interface Prefs {
  sound: boolean;
  desktop: boolean;
  asset: string;
  range: number;
  /** Precios P2P: comprar a la izquierda y vender a la derecha (true) o un lado a la vez. */
  split: boolean;
}

const DEFAULT_PREFS: Prefs = {
  sound: true,
  desktop: true,
  asset: "USDT",
  range: 3600,
  split: true,
};

function readPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem("cj-prefs") || "{}") as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...saved };
  } catch {
    return DEFAULT_PREFS;
  }
}

// ---------------------------------------------------------------- avisos emergentes

export type Tone = "info" | "good" | "bad";
interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: Tone;
  /** Tipo de aviso (p2p, price…) para el ícono; vacío = mensaje del panel. */
  kind?: string;
  ms: number;
}

const TOAST_ICON: Record<string, string> = { p2p: "💰", spot: "⚡", sell: "🎯", price: "🔔", system: "⚠️", test: "🔊" };

// ---------------------------------------------------------------- contexto

interface Live {
  state: State | null;
  hist: HistPoint[];
  offline: boolean;
  prefs: Prefs;
  prefsReady: boolean;
  setPrefs: (p: Partial<Prefs>) => void;
  refresh: () => void;
  toast: (title: string, body?: string, tone?: Tone, ms?: number, kind?: string) => void;
  beep: (kind?: string) => void;
  unread: number;
  clearUnread: () => void;
  saveSettings: (p: Partial<Settings>) => Promise<boolean>;
  permission: NotificationPermission | "unsupported";
  askPermission: () => Promise<void>;
  soundReady: boolean;
  enableSound: () => void;
}

const LiveCtx = createContext<Live | null>(null);

export function useLive(): Live {
  const ctx = useContext(LiveCtx);
  if (!ctx) throw new Error("useLive fuera de LiveProvider");
  return ctx;
}

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const [hist, setHist] = useState<HistPoint[]>([]);
  const [offline, setOffline] = useState(false);
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [prefsReady, setPrefsReady] = useState(false);
  const [toasts, setToasts] = useState<(Toast & { leaving?: boolean })[]>([]);
  const [unread, setUnread] = useState(0);
  const [permission, setPermission] = useState<Live["permission"]>("default");
  const [soundReady, setSoundReady] = useState(false);

  const prefsRef = useRef(prefs);
  const seen = useRef<{ boot: number | null; alert: number }>({ boot: null, alert: 0 });
  const inflight = useRef(false);
  const again = useRef(false);
  const lastP2P = useRef(0);
  const histRef = useRef<HistPoint[]>([]);
  const audio = useRef<AudioContext | null>(null);
  const toastId = useRef(0);

  useEffect(() => {
    const p = readPrefs();
    prefsRef.current = p;
    setPrefsState(p);
    setPrefsReady(true);
    setPermission("Notification" in window ? Notification.permission : "unsupported");
    // El navegador solo deja sonar después de que tocas la página una vez
    const unlock = () => {
      try {
        audio.current ??= new AudioContext();
        // Se actualiza el aviso después de que termina el toque: si cambia en el mismo instante,
        // la página se mueve y el toque cae en otro botón
        void audio.current.resume().then(() => setTimeout(() => setSoundReady(audio.current?.state === "running"), 700));
      } catch {
        /* sin audio */
      }
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
  }, []);

  const setPrefs = useCallback((p: Partial<Prefs>) => {
    const next = { ...prefsRef.current, ...p };
    prefsRef.current = next;
    setPrefsState(next);
    try {
      localStorage.setItem("cj-prefs", JSON.stringify(next));
    } catch {
      /* almacenamiento bloqueado */
    }
  }, []);

  const dropToast = useCallback((id: number) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 220);
  }, []);
  const toast = useCallback((title: string, body?: string, tone: Tone = "info", ms = 8000, kind?: string) => {
    const id = ++toastId.current;
    setToasts((list) => [...list.slice(-3), { id, title, body, tone, kind, ms }]);
    setTimeout(() => dropToast(id), ms);
  }, [dropToast]);

  // Cada aviso suena distinto para reconocerlo sin mirar:
  // - Chat: "pop-pop" corto y suave con el tono deslizándose hacia arriba (como una burbuja), volumen bajo.
  // - Oportunidad (P2P, Spot, venta lista): fanfarria brillante tipo caja registradora, fuerte y larga.
  // - Alerta de precio: campana grave que resuena (dos golpes).
  // - Sistema: dos tonos graves que bajan. Pruebas: dos tonos cortos.
  type Note = { f: number; to?: number; at: number; len: number; peak: number; wave: OscillatorType };
  const SOUNDS: Record<string, Note[]> = {
    chat: [
      { f: 520, to: 980, at: 0, len: 0.09, peak: 0.16, wave: "sine" },
      { f: 640, to: 1180, at: 0.13, len: 0.1, peak: 0.13, wave: "sine" },
    ],
    opp: [523, 659, 784, 1047, 0, 784, 1047, 1319, 1568].flatMap((f, i) => (f ? [
      { f, at: i * 0.085, len: 0.22, peak: 0.26, wave: "square" as OscillatorType },
      { f: f * 2, at: i * 0.085, len: 0.18, peak: 0.07, wave: "triangle" as OscillatorType },
    ] : [])),
    price: [0, 0.55].flatMap((at) => [
      { f: 392, at, len: 1.1, peak: 0.3, wave: "sine" as OscillatorType },
      { f: 784, at, len: 0.8, peak: 0.14, wave: "sine" as OscillatorType },
      { f: 1176, at, len: 0.5, peak: 0.08, wave: "sine" as OscillatorType },
    ]),
    system: [
      { f: 440, at: 0, len: 0.28, peak: 0.25, wave: "sawtooth" },
      { f: 330, at: 0.3, len: 0.4, peak: 0.25, wave: "sawtooth" },
    ],
    test: [
      { f: 880, at: 0, len: 0.2, peak: 0.3, wave: "triangle" },
      { f: 1320, at: 0.12, len: 0.2, peak: 0.3, wave: "triangle" },
    ],
  };
  const beep = useCallback((kind: string = "test") => {
    const ctx = audio.current;
    if (!ctx || !prefsRef.current.sound) return;
    // Windows o el navegador pausan el audio (suspensión, audífonos, mucho rato sin tocar): se reanuda antes de sonar
    if (ctx.state !== "running") {
      void ctx.resume().then(() => ctx.state === "running" && beep(kind), () => undefined);
      return;
    }
    const t = ctx.currentTime;
    const notes = SOUNDS[kind === "p2p" || kind === "spot" || kind === "sell" ? "opp" : kind] ?? SOUNDS.test;
    notes.forEach((n) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const at = t + n.at;
      o.type = n.wave;
      o.frequency.setValueAtTime(n.f, at);
      if (n.to) o.frequency.exponentialRampToValueAtTime(n.to, at + n.len * 0.8);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(n.peak, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + n.len);
      o.connect(g).connect(ctx.destination);
      o.start(at);
      o.stop(at + n.len + 0.02);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Avisos push: llegan aunque Chrome/Edge duerma la pestaña o esté cerrada (ver public/sw.js)
  const syncPush = useCallback(async (on: boolean) => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const cur = await reg.pushManager.getSubscription();
      if (!on || Notification.permission !== "granted") {
        if (cur) {
          await api.pushUnsubscribe(cur.endpoint).catch(() => undefined);
          await cur.unsubscribe();
        }
        return;
      }
      const { key } = await api.pushKey();
      const raw = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
      let sub = cur;
      const old = sub?.options.applicationServerKey;
      if (sub && old && new Uint8Array(old).join() !== raw.join()) {  // la llave del servidor cambió
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
      await api.pushSubscribe(sub.endpoint);
    } catch {
      /* navegador sin push (o bloqueado): quedan los avisos con la página abierta */
    }
  }, []);

  useEffect(() => {
    if (prefsReady && state?.user.name) void syncPush(prefs.desktop);
  }, [prefsReady, prefs.desktop, permission, state?.user.name, syncPush]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const go = (e: MessageEvent<{ hash?: string }>) => {
      if (e.data?.hash) window.location.hash = e.data.hash;
    };
    navigator.serviceWorker.addEventListener("message", go);
    return () => navigator.serviceWorker.removeEventListener("message", go);
  }, []);

  const enableSound = useCallback(() => {
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume().then(() => {
        setSoundReady(audio.current?.state === "running");
        beep("test");
      });
    } catch {
      /* sin audio */
    }
  }, [beep]);

  const notify = useCallback(
    (a: Alert) => {
      toast(a.title, a.body, a.kind === "test" ? "info" : a.kind === "system" ? "bad" : "good", a.kind === "test" ? 5000 : 12000, a.kind);
      beep(a.kind);
      if (prefsRef.current.desktop && "Notification" in window && Notification.permission === "granted") {
        try {
          const n = new Notification(a.title, { body: a.body, tag: `cj-${a.id}`, icon: "/icons/web-app-manifest-192x192.png", requireInteraction: a.kind !== "test" });
          n.onclick = () => {
            window.focus();
            // directo a donde está el paso a paso con los botones a Binance
            if (a.kind === "p2p" || a.kind === "spot") window.location.hash = "inicio";
            else if (a.kind === "sell") window.location.hash = "vender";
            else if (a.kind === "price") window.location.hash = "mercado";
            n.close();
          };
        } catch {
          /* algunos navegadores solo notifican desde un service worker */
        }
      }
      if (document.hidden) setUnread((u) => u + 1);
    },
    [beep, toast],
  );

  const handleAlerts = useCallback(
    (s: State) => {
      const maxId = s.alerts[0]?.id ?? 0;
      if (seen.current.boot !== s.boot) {
        const first = seen.current.boot === null;
        // Al abrir no repite avisos viejos; tras un reinicio del servidor, solo avisa lo nuevo
        seen.current = { boot: s.boot, alert: first ? maxId : s.alerts_at_boot };
        if (first) return;
      }
      const muted = s.settings.muted_kinds ?? [];
      const fresh = s.alerts.filter((a) => a.id > seen.current.alert && isMine(a, s) && !muted.includes(a.kind as MutableKind)).reverse();
      seen.current.alert = Math.max(seen.current.alert, maxId);
      fresh.slice(-4).forEach(notify);
    },
    [notify],
  );

  const loadHistory = useCallback(async () => {
    const cur = histRef.current;
    try {
      const pts = await api.history(cur.length ? cur[cur.length - 1].t : 0);
      const cutoff = Date.now() / 1000 - 86400;
      histRef.current = cur.concat(pts).filter((p) => p.t > cutoff);
      setHist(histRef.current);
    } catch {
      /* se reintenta en el siguiente escaneo */
    }
  }, []);

  const refresh = useCallback(() => {
    if (inflight.current) {
      again.current = true;
      return;
    }
    inflight.current = true;
    api
      .state()
      .then((s) => {
        setOffline(false);
        handleAlerts(s);
        setState(s);
        const t = s.p2p?.t ?? 0;
        if (t !== lastP2P.current) {
          lastP2P.current = t;
          void loadHistory();
        }
      })
      .catch(() => setOffline(true))
      .finally(() => {
        inflight.current = false;
        if (again.current) {
          again.current = false;
          refresh();
        }
      });
  }, [handleAlerts, loadHistory]);

  // Tiempo real: el servidor avisa por SSE cada vez que termina un escaneo o hay una alerta
  useEffect(() => {
    refresh();
    refreshChat();
    const es = new EventSource("/api/events");
    // el chat solo recarga el chat: no hace falta volver a pedir todo el panel
    es.onmessage = (e: MessageEvent<string>) => (e.data === "chat" || e.data === "presence" ? refreshChat(e.data === "chat") : refresh());
    es.onopen = () => {
      refresh();
      refreshChat(true);
    };
    es.onerror = () => setOffline(true);
    const poll = setInterval(() => {
      refresh();
      refreshChat();
    }, 15000);
    const onVisible = () => {
      if (!document.hidden) setUnread(0);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      es.close();
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    document.title = unread ? `(${unread}) ArbiCrypto` : "ArbiCrypto";
  }, [unread]);

  const saveSettings = useCallback(
    async (p: Partial<Settings>) => {
      try {
        const settings = await api.saveSettings(p);
        setState((s) => (s ? { ...s, settings } : s));
        refresh();
        return true;
      } catch (e) {
        toast("No se pudieron guardar los cambios", (e as Error).message, "bad");
        return false;
      }
    },
    [refresh, toast],
  );

  const askPermission = useCallback(async () => {
    if (!("Notification" in window)) {
      toast("Tu navegador no soporta notificaciones", undefined, "bad");
      return;
    }
    const p = await Notification.requestPermission();
    setPermission(p);
    if (p === "granted") {
      setPrefs({ desktop: true });
      toast("Avisos activados", "Te avisaremos con sonido aunque la pestaña esté en segundo plano.", "good");
    } else {
      toast("Avisos bloqueados", "Actívalos desde el candado junto a la dirección de la página.", "bad");
    }
  }, [setPrefs, toast]);

  const value: Live = {
    state,
    hist,
    offline,
    prefs,
    prefsReady,
    setPrefs,
    refresh,
    toast,
    beep,
    unread,
    clearUnread: () => setUnread(0),
    saveSettings,
    permission,
    askPermission,
    soundReady,
    enableSound,
  };

  return (
    <LiveCtx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone} ${t.kind ? `k-${t.kind}` : ""} ${t.leaving ? "leaving" : ""}`} style={{ ["--ms" as string]: `${t.ms}ms` } as React.CSSProperties}>
            <span className="toast-ico" aria-hidden="true">{TOAST_ICON[t.kind ?? ""] ?? (t.tone === "bad" ? "!" : t.tone === "good" ? "✓" : "i")}</span>
            <div className="toast-txt">
              <b>{t.title}</b>
              {t.body && <p>{t.body}</p>}
            </div>
            <button aria-label="Cerrar" onClick={() => dropToast(t.id)}>×</button>
          </div>
        ))}
      </div>
    </LiveCtx.Provider>
  );
}

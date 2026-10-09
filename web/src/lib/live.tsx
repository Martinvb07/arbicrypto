"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "./api";
import { refreshChat } from "./chat";
import { isMine } from "./calc";
import type { Alert, HistPoint, Settings, State } from "./types";

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
}

const DEFAULT_PREFS: Prefs = {
  sound: true,
  desktop: true,
  asset: "USDT",
  range: 3600,
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
}

// ---------------------------------------------------------------- contexto

interface Live {
  state: State | null;
  hist: HistPoint[];
  offline: boolean;
  prefs: Prefs;
  prefsReady: boolean;
  setPrefs: (p: Partial<Prefs>) => void;
  refresh: () => void;
  toast: (title: string, body?: string, tone?: Tone, ms?: number) => void;
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
  const [toasts, setToasts] = useState<Toast[]>([]);
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

  const toast = useCallback((title: string, body?: string, tone: Tone = "info", ms = 8000) => {
    const id = ++toastId.current;
    setToasts((list) => [...list.slice(-3), { id, title, body, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), ms);
  }, []);

  // Oportunidad: tres tonos que suben (dos veces). Precio y pruebas: dos tonos cortos.
  const beep = useCallback((kind: string = "test") => {
    const ctx = audio.current;
    if (!ctx || !prefsRef.current.sound) return;
    const t = ctx.currentTime;
    const notes = kind === "p2p" || kind === "spot" || kind === "sell" ? [784, 1047, 1319, 0, 784, 1047, 1319] : [880, 1320];
    notes.forEach((f, i) => {
      if (!f) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const at = t + i * 0.12;
      o.type = "triangle";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(at);
      o.stop(at + 0.22);
    });
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
      toast(a.title, a.body, a.kind === "test" ? "info" : "good");
      beep(a.kind);
      if (prefsRef.current.desktop && "Notification" in window && Notification.permission === "granted") {
        try {
          const n = new Notification(a.title, { body: a.body, tag: `cj-${a.id}`, icon: "/icons/web-app-manifest-192x192.png", requireInteraction: a.kind !== "test" });
          n.onclick = () => {
            window.focus();
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
      const fresh = s.alerts.filter((a) => a.id > seen.current.alert && isMine(a, s)).reverse();
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
          <div key={t.id} className={`toast ${t.tone}`}>
            <b>{t.title}</b>
            <button aria-label="Cerrar" onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))}>
              ×
            </button>
            {t.body && <p>{t.body}</p>}
          </div>
        ))}
      </div>
    </LiveCtx.Provider>
  );
}

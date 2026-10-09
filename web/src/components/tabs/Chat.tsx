"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { refreshChat, useChat } from "@/lib/chat";
import { hhmm } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { ChatMessage, ChatSummary } from "@/lib/types";
import { ask } from "../overlay";
import { EmptyBox, Icon, Skeleton } from "../ui";

const PAGE = 60; // el servidor entrega de a 60 mensajes
const MAX = 2000;
const dayFmt = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long" });

function dayLabel(t: number) {
  const d = new Date(t * 1000).toDateString();
  const today = new Date();
  if (d === today.toDateString()) return "Hoy";
  if (d === new Date(today.getTime() - 86400000).toDateString()) return "Ayer";
  return dayFmt.format(t * 1000);
}

const preview = (m: ChatMessage, me: string, general: boolean) =>
  `${m.from === me ? "Tú: " : general ? `${m.from}: ` : ""}${m.body.replace(/\s+/g, " ")}`;

function Avatar({ name, online, general }: { name: string; online?: boolean; general?: boolean }) {
  return (
    <span className="chat-av">
      <span className={`avatar ${general ? "general" : ""}`}>{general ? <Icon name="users" size={15} /> : name[0].toUpperCase()}</span>
      {online !== undefined && <span className={`chat-dot ${online ? "on" : ""}`} aria-label={online ? "conectado" : "desconectado"} />}
    </span>
  );
}

// ---------------------------------------------------------------- lista de conversaciones

function Channels({ s, peer, onPick }: { s: ChatSummary; peer: string; onPick: (p: string) => void }) {
  const general = s.channels[""];
  const online = s.users.filter((u) => u.online).length;
  // primero lo que tiene mensajes sin leer, luego lo más reciente, luego quien está conectado
  const users = [...s.users].sort((a, b) => {
    const ca = s.channels[a.name], cb = s.channels[b.name];
    return (cb?.unread ?? 0) - (ca?.unread ?? 0) || (cb?.last.id ?? 0) - (ca?.last.id ?? 0) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name);
  });
  const row = (key: string, name: string, sub: string, unread: number, av: React.ReactNode) => (
    <button key={key} className={`chat-ch ${peer === key ? "on" : ""}`} onClick={() => onPick(key)} aria-current={peer === key ? "true" : undefined}>
      {av}
      <span className="chat-ch-txt">
        <b>{name}</b>
        <span className="sub">{sub}</span>
      </span>
      {unread > 0 && <span className="count">{unread > 99 ? "99+" : unread}</span>}
    </button>
  );
  return (
    <aside className="chat-list" aria-label="Conversaciones">
      <div className="chat-list-head"><h2>Chat del equipo</h2><span className="sub">{online} {online === 1 ? "conectado" : "conectados"}</span></div>
      {row("", "General", general ? preview(general.last, s.me, true) : "Todo el equipo", general?.unread ?? 0, <Avatar name="General" general />)}
      <div className="chat-sep">Mensajes privados</div>
      {users.length ? users.map((u) => {
        const c = s.channels[u.name];
        return row(u.name, u.name, c ? preview(c.last, s.me, false) : u.online ? "Conectado ahora" : "Sin mensajes", c?.unread ?? 0, <Avatar name={u.name} online={u.online} />);
      }) : <p className="sub chat-none">Aún no hay más personas en el equipo. Invítalas desde Equipo.</p>}
    </aside>
  );
}

// ---------------------------------------------------------------- conversación abierta

function Conversation({ s, peer, rev, onBack }: { s: ChatSummary; peer: string; rev: number; onBack: () => void }) {
  const { state, toast } = useLive();
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [more, setMore] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true); // seguir abajo mientras llegan mensajes, salvo que estés leyendo arriba
  const keepFrom = useRef<number | null>(null); // al cargar los viejos, no saltar de lugar
  const firstLoad = useRef(true);
  const me = s.me;
  const user = s.users.find((u) => u.name === peer);
  const admin = state?.user.role === "admin";
  const lastId = s.channels[peer]?.last.id ?? 0;
  const unread = s.channels[peer]?.unread ?? 0;

  useEffect(() => {
    setMsgs(null);
    setText("");
    stick.current = true;
    firstLoad.current = true;
    input.current?.focus();
  }, [peer]);

  // lo más nuevo: reemplaza la última página y conserva los viejos que ya se habían cargado
  useEffect(() => {
    let stop = false;
    api.chatMessages(peer).then(({ messages }) => {
      if (stop) return;
      if (firstLoad.current) {
        firstLoad.current = false;
        setMore(messages.length >= PAGE);
      }
      setMsgs((old) => {
        const first = messages[0]?.id ?? Infinity;
        return [...(old ?? []).filter((m) => m.id < first), ...messages];
      });
    }).catch((e: Error) => !stop && toast("No se pudo cargar el chat", e.message, "bad"));
    return () => {
      stop = true;
    };
  }, [peer, rev, lastId, toast]);

  // leído: solo si estás mirando la pestaña
  useEffect(() => {
    const mark = () => {
      if (!document.hidden && unread > 0 && lastId) void api.chatRead(peer, lastId).then(() => refreshChat(), () => undefined);
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [peer, lastId, unread]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !msgs) return;
    if (keepFrom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFrom.current;
      keepFrom.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [msgs]);

  const older = async () => {
    if (!msgs?.length) return;
    try {
      const { messages } = await api.chatMessages(peer, msgs[0].id);
      setMore(messages.length >= PAGE);
      keepFrom.current = box.current ? box.current.scrollHeight - box.current.scrollTop : null;
      setMsgs((old) => [...messages, ...(old ?? [])]);
    } catch (e) {
      toast("No se pudieron cargar", (e as Error).message, "bad");
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const { message } = await api.chatSend(peer, body);
      stick.current = true;
      setMsgs((old) => (old?.some((m) => m.id === message.id) ? old : [...(old ?? []), message]));
      setText("");
      refreshChat();
    } catch (e) {
      toast("No se envió", (e as Error).message, "bad");
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  const remove = async (m: ChatMessage) => {
    if (!(await ask({ title: "¿Borrar este mensaje?", body: "Se borra para todos. No se puede deshacer.", confirm: "Borrar", tone: "danger", icon: "trash" }))) return;
    try {
      await api.chatDelete(m.id);
      setMsgs((old) => old?.filter((x) => x.id !== m.id) ?? old);
    } catch (e) {
      toast("No se pudo borrar", (e as Error).message, "bad");
    }
  };

  const title = peer ? peer : "General";
  const online = s.users.filter((u) => u.online).length;
  const status = peer ? (user ? (user.online ? "Conectado" : "Desconectado") + " · privado, solo lo ven ustedes dos" : "Ya no está en el equipo")
    : `Todo el equipo · ${online + 1} ${online ? "conectados" : "conectado"}`;

  return (
    <section className="chat-conv" aria-label={`Conversación: ${title}`}>
      <header className="chat-conv-head">
        <button className="icon-btn chat-back" onClick={onBack} aria-label="Volver a las conversaciones"><Icon name="back" size={18} /></button>
        <Avatar name={title} general={!peer} online={user?.online} />
        <div className="chat-ch-txt"><b>{title}</b><span className="sub">{status}</span></div>
      </header>

      <div className="chat-msgs" ref={box} onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}>
        {!msgs ? <Skeleton rows={5} /> : !msgs.length ? (
          <div className="empty">{peer ? `Escríbele a ${peer}. Solo ustedes dos verán esta conversación.` : "Aún no hay mensajes. Escribe el primero para todo el equipo."}</div>
        ) : (
          <>
            {more && <button className="btn btn-sm chat-older" onClick={() => void older()}>Ver mensajes anteriores</button>}
            {msgs.map((m, i) => {
              const prev = msgs[i - 1];
              const newDay = !prev || new Date(prev.t * 1000).toDateString() !== new Date(m.t * 1000).toDateString();
              const grouped = !newDay && prev.from === m.from && m.t - prev.t < 300;
              const mine = m.from === me;
              return (
                <div key={m.id}>
                  {newDay && <div className="chat-day"><span>{dayLabel(m.t)}</span></div>}
                  <div className={`chat-msg ${mine ? "mine" : ""} ${grouped ? "grouped" : ""}`}>
                    <div className="chat-bubble">
                      {!mine && !peer && !grouped && <b className="chat-from">{m.from}</b>}
                      <p>{m.body}</p>
                      <time dateTime={new Date(m.t * 1000).toISOString()}>{hhmm(m.t)}</time>
                    </div>
                    {(mine || (!peer && admin)) && (
                      <button className="icon-btn danger chat-del" onClick={() => void remove(m)} title="Borrar mensaje" aria-label="Borrar mensaje"><Icon name="trash" size={14} /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {peer && !user ? (
        <p className="sub chat-closed">{peer} ya no está en el equipo: no puedes responderle.</p>
      ) : (
        <form className="chat-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <textarea ref={input} rows={1} value={text} maxLength={MAX} placeholder={peer ? `Mensaje privado para ${peer}` : "Mensaje para todo el equipo"}
            aria-label="Escribe un mensaje" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }} />
          <button className="btn btn-brand chat-send" type="submit" disabled={busy || !text.trim()} aria-label="Enviar"><Icon name="send" size={18} /></button>
        </form>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- pestaña

export function Chat() {
  const { summary, rev } = useChat();
  const [peer, setPeer] = useState("");
  const [open, setOpen] = useState(false); // celular: lista o conversación

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("cj-chat-peer");
      if (saved !== null) setPeer(saved);
    } catch {
      /* sin almacenamiento */
    }
  }, []);
  const pick = useCallback((p: string) => {
    setPeer(p);
    setOpen(true);
    try {
      sessionStorage.setItem("cj-chat-peer", p);
    } catch {
      /* sin almacenamiento */
    }
  }, []);

  if (!summary) return <div className="card"><Skeleton rows={6} /></div>;
  // si borraron a la persona y no hay nada que leer, vuelve al general
  const valid = peer === "" || summary.users.some((u) => u.name === peer) || summary.channels[peer];
  const cur = valid ? peer : "";

  return (
    <div className="stack">
      {summary.users.length === 0 && !summary.channels[""] && (
        <EmptyBox icon="chat" title="El chat está listo">Cuando invites a alguien al equipo, podrán escribirse aquí: en el canal General lo ve todo el equipo y los privados solo las dos personas.</EmptyBox>
      )}
      <div className={`card chat ${open ? "open" : ""}`}>
        <Channels s={summary} peer={cur} onPick={pick} />
        <Conversation s={summary} peer={cur} rev={rev} onBack={() => setOpen(false)} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- aviso de mensajes nuevos en cualquier pestaña

export function ChatWatcher({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const { summary } = useChat();
  const { toast, beep, prefs } = useLive();
  const seen = useRef<number | null>(null);

  useEffect(() => {
    if (!summary) return;
    const fresh = Object.entries(summary.channels)
      .filter(([, c]) => c.unread > 0 && c.last.from !== summary.me && c.last.id > (seen.current ?? Infinity));
    const max = Math.max(seen.current ?? 0, ...Object.values(summary.channels).map((c) => c.last.id));
    const first = seen.current === null;
    seen.current = max;
    if (first || !fresh.length || (active && !document.hidden)) return;
    beep("chat");
    for (const [peer, c] of fresh.slice(-3)) {
      const title = peer ? `Mensaje privado de ${c.last.from}` : `${c.last.from} en General`;
      const body = c.last.body.length > 140 ? `${c.last.body.slice(0, 140)}…` : c.last.body;
      if (!active) toast(title, body, "info", 6000);
      if (document.hidden && prefs.desktop && "Notification" in window && Notification.permission === "granted") {
        try {
          const n = new Notification(title, { body, tag: `cj-chat-${peer}`, icon: "/icons/web-app-manifest-192x192.png" });
          n.onclick = () => {
            window.focus();
            onOpen();
            n.close();
          };
        } catch {
          /* algunos navegadores solo notifican desde un service worker */
        }
      }
    }
  }, [summary]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

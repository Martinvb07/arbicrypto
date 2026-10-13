"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { chatUnread, imageUrl, msgText, REACTIONS, refreshChat, shrinkImage, useChat } from "@/lib/chat";
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
  `${m.from === me ? "Tú: " : general ? `${m.from}: ` : ""}${msgText(m).replace(/\s+/g, " ")}`;

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

// ---------------------------------------------------------------- piezas de un mensaje

/** Foto en pantalla completa: se cierra tocando afuera o con Escape. */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return createPortal(
    <div className="chat-lightbox" onClick={onClose} role="dialog" aria-label="Imagen">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
      <div className="chat-lightbox-bar">
        <a className="icon-btn" href={src} download target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label="Abrir original"><Icon name="download" size={18} /></a>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon name="x" size={18} /></button>
      </div>
    </div>,
    document.body,
  );
}

/** Cita del mensaje al que se responde (dentro de la burbuja o encima del cuadro de texto). */
function Quote({ q, me, onClick, onClose }: { q: { from: string; body: string; image?: boolean | string | null }; me: string; onClick?: () => void; onClose?: () => void }) {
  return (
    <div className={`chat-quote ${onClick ? "link" : ""}`} onClick={onClick} role={onClick ? "button" : undefined}>
      <b>{q.from === me ? "Tú" : q.from}</b>
      <span>{msgText({ body: q.body, image: q.image }) || "Mensaje"}</span>
      {onClose && <button type="button" className="icon-btn" onClick={onClose} aria-label="Cancelar respuesta"><Icon name="x" size={14} /></button>}
    </div>
  );
}

/** Reacciones de un mensaje: emoji + cuántos; la tuya resaltada (tocarla la quita). */
function Reactions({ m, me, onReact }: { m: ChatMessage; me: string; onReact: (e: string) => void }) {
  const list = Object.entries(m.reactions ?? {}).filter(([, u]) => u.length);
  if (!list.length) return null;
  return (
    <div className="chat-reacts">
      {list.map(([e, users]) => (
        <button key={e} type="button" className={`chat-react ${users.includes(me) ? "mine" : ""}`} onClick={() => onReact(e)}
          title={users.map((u) => (u === me ? "Tú" : u)).join(", ")}>
          <span>{e}</span>{users.length > 1 && <b>{users.length}</b>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- conversación abierta

function Conversation({ s, peer, rev, onBack }: { s: ChatSummary; peer: string; rev: number; onBack: () => void }) {
  const { state, toast } = useLive();
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [more, setMore] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null); // mensaje con el menú abierto (celular: al tocarlo)
  const [picker, setPicker] = useState<number | null>(null); // mensaje con las reacciones abiertas
  const [zoom, setZoom] = useState<string | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const file = useRef<HTMLInputElement>(null);
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
    setReplyTo(null);
    setImage(null);
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

  const attach = async (f: Blob | null | undefined) => {
    if (!f) return;
    try {
      setImage(await shrinkImage(f));
      input.current?.focus();
    } catch (e) {
      toast("No se pudo adjuntar", (e as Error).message, "bad");
    }
  };

  const react = async (m: ChatMessage, emoji: string) => {
    setPicker(null);
    setActive(null);
    // se ve al instante; el servidor confirma con el siguiente refresco
    setMsgs((old) => old?.map((x) => {
      if (x.id !== m.id) return x;
      const r: Record<string, string[]> = {};
      const had = Object.entries(x.reactions ?? {}).find(([, u]) => u.includes(me))?.[0];
      for (const [e, u] of Object.entries(x.reactions ?? {})) {
        const left = u.filter((n) => n !== me);
        if (left.length) r[e] = left;
      }
      if (had !== emoji) r[emoji] = [...(r[emoji] ?? []), me];
      return { ...x, reactions: r };
    }) ?? old);
    try {
      await api.chatReact(m.id, emoji);
    } catch (e) {
      toast("No se pudo reaccionar", (e as Error).message, "bad");
    }
  };

  const jump = (id: number) => {
    const el = box.current?.querySelector<HTMLElement>(`[data-msg="${id}"]`);
    if (!el) return toast("Ese mensaje es más antiguo", "Toca «Ver mensajes anteriores» para cargarlo.", "info", 3000);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(id);
    window.setTimeout(() => setFlash(null), 1600);
  };

  const send = async () => {
    const body = text.trim();
    if ((!body && !image) || busy) return;
    setBusy(true);
    try {
      const { message } = await api.chatSend(peer, body, { reply_to: replyTo?.id ?? null, image });
      stick.current = true;
      setMsgs((old) => (old?.some((m) => m.id === message.id) ? old : [...(old ?? []), message]));
      setText("");
      setReplyTo(null);
      setImage(null);
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

      <div className={`chat-msgs ${drag ? "drag" : ""}`} ref={box} onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        if (picker !== null) setPicker(null);
      }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void attach(e.dataTransfer.files[0]); }}>
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
                  <div data-msg={m.id} className={`chat-msg ${mine ? "mine" : ""} ${grouped ? "grouped" : ""} ${active === m.id ? "active" : ""} ${flash === m.id ? "flash" : ""} ${Object.keys(m.reactions ?? {}).length ? "has-reacts" : ""}`}>
                    <div className={`chat-bubble ${m.image ? "has-img" : ""}`} onClick={(e) => {
                      if ((e.target as HTMLElement).closest("button, a, img, .chat-quote")) return;
                      setActive(active === m.id ? null : m.id);
                    }} onDoubleClick={() => void react(m, "❤️")}>
                      {!mine && !peer && !grouped && <b className="chat-from">{m.from}</b>}
                      {m.reply && <Quote q={m.reply} me={me} onClick={() => jump(m.reply!.id)} />}
                      {m.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="chat-img" src={imageUrl(m.image)} alt="Imagen" loading="lazy" onClick={() => setZoom(imageUrl(m.image!))}
                          onLoad={() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }} />
                      )}
                      {m.body && <p>{m.body}</p>}
                      <time dateTime={new Date(m.t * 1000).toISOString()}>{hhmm(m.t)}</time>
                      <Reactions m={m} me={me} onReact={(e) => void react(m, e)} />
                    </div>
                    <div className="chat-tools">
                      <button className="icon-btn" onClick={() => { setPicker(picker === m.id ? null : m.id); }} title="Reaccionar" aria-label="Reaccionar"><Icon name="smile" size={15} /></button>
                      <button className="icon-btn" onClick={() => { setReplyTo(m); setActive(null); input.current?.focus(); }} title="Responder" aria-label="Responder"><Icon name="reply" size={15} /></button>
                      {(mine || (!peer && admin)) && (
                        <button className="icon-btn danger" onClick={() => void remove(m)} title="Borrar mensaje" aria-label="Borrar mensaje"><Icon name="trash" size={14} /></button>
                      )}
                      {picker === m.id && (
                        <div className="chat-picker" role="menu" aria-label="Reacciones">
                          {REACTIONS.map((e, k) => {
                            const on = m.reactions?.[e]?.includes(me);
                            return <button key={e} type="button" className={on ? "on" : ""} style={{ ["--k" as string]: k } as React.CSSProperties} onClick={() => void react(m, e)}>{e}</button>;
                          })}
                        </div>
                      )}
                    </div>
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
          {(replyTo || image) && (
            <div className="chat-compose-extra">
              {replyTo && <Quote q={replyTo} me={me} onClose={() => setReplyTo(null)} />}
              {image && (
                <div className="chat-attach">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image} alt="Imagen para enviar" />
                  <span>Imagen lista · escribe un texto si quieres</span>
                  <button type="button" className="icon-btn" onClick={() => setImage(null)} aria-label="Quitar imagen"><Icon name="x" size={14} /></button>
                </div>
              )}
            </div>
          )}
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" className="icon-btn chat-clip" onClick={() => file.current?.click()} title="Enviar imagen (también puedes pegarla con Ctrl+V)" aria-label="Enviar imagen">
            <Icon name="image" size={19} />
          </button>
          <textarea ref={input} rows={1} value={text} maxLength={MAX} placeholder={image ? "Agrega un texto (opcional)" : peer ? `Mensaje privado para ${peer}` : "Mensaje para todo el equipo"}
            aria-label="Escribe un mensaje" onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
              if (item) {
                e.preventDefault();
                void attach(item.getAsFile());
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
              if (e.key === "Escape" && replyTo) setReplyTo(null);
            }} />
          <button className="btn btn-brand chat-send" type="submit" disabled={busy || (!text.trim() && !image)} aria-label="Enviar"><Icon name="send" size={18} /></button>
        </form>
      )}
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
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

// ---------------------------------------------------------------- chat flotante (en todas las pestañas)

interface Incoming {
  peer: string;
  from: string;
  body: string;
  id: number;
}

/** Vista previa del mensaje que llegó, con respuesta rápida ahí mismo. */
function ChatPop({ m, onOpen, onClose }: { m: Incoming; onOpen: () => void; onClose: () => void }) {
  const { toast } = useLive();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const typing = text.trim().length > 0;
  const close = useCallback(() => {
    setLeaving(true); // animación de salida y luego se quita
    window.setTimeout(onClose, 200);
  }, [onClose]);

  // se va sola a los 15 s, salvo que estés escribiendo la respuesta
  useEffect(() => {
    if (typing) return;
    const t = window.setTimeout(close, 15000);
    return () => window.clearTimeout(t);
  }, [m.id, typing, close]);

  const reply = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await api.chatSend(m.peer, body);
      void api.chatRead(m.peer, m.id).catch(() => undefined);
      refreshChat(true);
      toast("Respuesta enviada", m.peer ? `A ${m.peer}` : "En General", "good", 2500);
      close();
    } catch (e) {
      toast("No se envió", (e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const title = m.peer ? `${m.from} · privado` : `${m.from} en General`;
  return (
    <div className={`chat-pop ${leaving ? "leaving" : ""}`} role="status" aria-live="polite">
      <button className="chat-pop-main" onClick={onOpen} title="Abrir la conversación">
        <Avatar name={m.peer ? m.from : "General"} general={!m.peer} />
        <span className="chat-ch-txt">
          <b>{title}</b>
          <span className="chat-pop-body">{m.body.length > 160 ? `${m.body.slice(0, 160)}…` : m.body}</span>
        </span>
      </button>
      <button className="icon-btn chat-pop-x" onClick={close} aria-label="Cerrar"><Icon name="x" size={15} /></button>
      <form className="chat-pop-reply" onSubmit={(e) => { e.preventDefault(); void reply(); }}>
        <input value={text} maxLength={MAX} onChange={(e) => setText(e.target.value)} placeholder={m.peer ? `Responder a ${m.from}…` : "Responder en General…"}
          aria-label="Respuesta rápida" />
        <button className="btn btn-brand" type="submit" disabled={busy || !typing} aria-label="Enviar"><Icon name="send" size={16} /></button>
      </form>
    </div>
  );
}

/** Burbuja de chat flotante: abre el chat sin salir de la pestaña, avisa de mensajes nuevos y deja responder ahí.
 *  En la pestaña Chat no se muestra (ahí ya está el chat completo), pero sigue sonando y notificando. */
export function ChatDock({ hidden, onFull }: { hidden: boolean; onFull: (peer: string) => void }) {
  const { summary, rev } = useChat();
  const { beep, prefs } = useLive();
  const [open, setOpen] = useState(false);
  const [peer, setPeer] = useState("");
  const [conv, setConv] = useState(false); // dentro del flotante: lista o conversación
  const [pop, setPop] = useState<Incoming | null>(null);
  const [shown, setShown] = useState(false); // sigue montado mientras corre la animación de cierre
  const seen = useRef<number | null>(null);

  useEffect(() => {
    if (open) return setShown(true);
    const t = window.setTimeout(() => setShown(false), 200);
    return () => window.clearTimeout(t);
  }, [open]);

  const openConv = useCallback((p: string) => {
    setPeer(p);
    setConv(true);
    setOpen(true);
    setPop(null);
  }, []);
  const closePop = useCallback(() => setPop(null), []);

  // mensajes nuevos: sonido, vista previa con respuesta rápida y notificación si la página está oculta
  useEffect(() => {
    if (!summary) return;
    const fresh = Object.entries(summary.channels)
      .filter(([, c]) => c.unread > 0 && c.last.from !== summary.me && c.last.id > (seen.current ?? Infinity));
    const max = Math.max(seen.current ?? 0, ...Object.values(summary.channels).map((c) => c.last.id));
    const first = seen.current === null;
    seen.current = max;
    if (first || !fresh.length) return;
    const [p, c] = fresh[fresh.length - 1];
    const looking = !document.hidden && (hidden || (open && conv && peer === p));
    if (looking) return;
    beep("chat");
    if (!hidden && !(open && conv && peer === p)) setPop({ peer: p, from: c.last.from, body: msgText(c.last), id: c.last.id });
    if (document.hidden && prefs.desktop && "Notification" in window && Notification.permission === "granted") {
      try {
        const title = p ? `Mensaje privado de ${c.last.from}` : `${c.last.from} en General`;
        const n = new Notification(title, { body: msgText(c.last).slice(0, 140), tag: `cj-chat-${p}`, icon: "/icons/web-app-manifest-192x192.png" });
        n.onclick = () => {
          window.focus();
          if (hidden) onFull(p);
          else openConv(p);
          n.close();
        };
      } catch {
        /* algunos navegadores solo notifican desde un service worker */
      }
    }
  }, [summary]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  if (hidden || !summary) return null;
  const unread = chatUnread(summary);
  const online = summary.users.filter((u) => u.online).length;
  const valid = peer === "" || summary.users.some((u) => u.name === peer) || summary.channels[peer];
  const cur = valid ? peer : "";

  return (
    <>
      {shown && (
        <div className={`chat-dock ${open ? "" : "leaving"}`} role="dialog" aria-label="Chat del equipo" aria-hidden={!open}>
          <header className="chat-dock-head">
            <span className="chat-dock-title">
              <b>Chat del equipo</b>
              <span className="sub"><span className="chat-dot-inline on" />{online + 1} {online ? "conectados" : "conectado (tú)"}</span>
            </span>
            <button className="icon-btn" onClick={() => { setOpen(false); onFull(cur); }} title="Abrir en pantalla completa" aria-label="Abrir en pantalla completa">
              <Icon name="expand" size={16} />
            </button>
            <button className="icon-btn" onClick={() => setOpen(false)} title="Cerrar (Esc)" aria-label="Cerrar chat"><Icon name="x" size={17} /></button>
          </header>
          <div className={`chat-dock-body ${conv ? "open" : ""}`}>
            <Channels s={summary} peer={cur} onPick={openConv} />
            <Conversation s={summary} peer={cur} rev={rev} onBack={() => setConv(false)} />
          </div>
        </div>
      )}
      {pop && !open && <ChatPop key={pop.id} m={pop} onOpen={() => openConv(pop.peer)} onClose={closePop} />}
      <button className={`chat-fab ${open ? "on" : ""} ${!open && unread > 0 ? "has-unread" : ""}`} onClick={() => { setOpen((o) => !o); setPop(null); }}
        aria-label={open ? "Cerrar chat" : unread ? `Abrir chat, ${unread} sin leer` : "Abrir chat"} aria-expanded={open}>
        <span className="fab-ico fab-chat"><Icon name="chat" size={25} /></span>
        <span className="fab-ico fab-x"><Icon name="x" size={25} /></span>
        {!open && unread > 0 && <span className="count" key={unread}>{unread > 99 ? "99+" : unread}</span>}
      </button>
    </>
  );
}

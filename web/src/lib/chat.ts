"use client";

import { useSyncExternalStore } from "react";
import { api } from "./api";
import type { ChatSummary } from "./types";

// Resumen del chat (conversaciones, no leídos, quién está conectado), compartido por la barra y la pestaña.
// rev sube con cada mensaje nuevo o borrado: la conversación abierta se vuelve a pedir.

interface ChatSnap {
  summary: ChatSummary | null;
  rev: number;
}

let snap: ChatSnap = { summary: null, rev: 0 };
let pendingRev = 0;
const listeners = new Set<() => void>();
let inflight = false;
let again = false;

export function refreshChat(changed = false) {
  if (changed) pendingRev++;
  if (inflight) {
    again = true;
    return;
  }
  inflight = true;
  const rev = pendingRev;
  api
    .chat()
    .then((summary) => {
      snap = { summary, rev: Math.max(snap.rev, rev) };
      listeners.forEach((l) => l());
    })
    .catch(() => undefined)
    .finally(() => {
      inflight = false;
      if (again) {
        again = false;
        refreshChat();
      }
    });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const EMPTY: ChatSnap = { summary: null, rev: 0 };
export const useChat = () => useSyncExternalStore(subscribe, () => snap, () => EMPTY);

/** Mensajes sin leer del canal general y de los privados con usuarios que siguen en el equipo. */
export function chatUnread(s: ChatSummary | null): number {
  if (!s) return 0;
  return Object.entries(s.channels).reduce((n, [peer, c]) => n + (peer === "" || s.users.some((u) => u.name === peer) ? c.unread : 0), 0);
}

/** Reacciones disponibles (las mismas que acepta el servidor). */
export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "💰"];

/** Texto corto de un mensaje para listas y avisos: las fotos sin texto salen como "📷 Foto". */
export const msgText = (m: { body: string; image?: string | boolean | null }) =>
  m.body ? (m.image ? `📷 ${m.body}` : m.body) : m.image ? "📷 Foto" : "";

/** Reduce una imagen (pegada, arrastrada o elegida) a máximo 1600 px en JPEG para que viaje liviana. Los GIF van tal cual. */
export async function shrinkImage(file: Blob): Promise<string> {
  const asUrl = (b: Blob) => new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(new Error("No se pudo leer la imagen."));
    r.readAsDataURL(b);
  });
  if (!file.type.startsWith("image/")) throw new Error("Eso no es una imagen.");
  if (file.type === "image/gif") {
    if (file.size > 2.5 * 1024 * 1024) throw new Error("El GIF pesa demasiado (máximo 2,5 MB).");
    return asUrl(file);
  }
  const src = await asUrl(file);
  const img = await new Promise<HTMLImageElement>((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => fail(new Error("No se pudo abrir la imagen."));
    i.src = src;
  });
  const max = 1600;
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext("2d");
  if (!ctx) return src;
  ctx.fillStyle = "#fff"; // las imágenes con fondo transparente no quedan negras
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  let out = c.toDataURL("image/jpeg", 0.82);
  if (out.length > 3.5 * 1024 * 1024) out = c.toDataURL("image/jpeg", 0.6);
  return out;
}

export const imageUrl = (name: string) => `/api/chat/image?name=${encodeURIComponent(name)}`;

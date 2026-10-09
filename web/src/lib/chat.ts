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

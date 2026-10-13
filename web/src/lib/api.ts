import type { ChatMessage, ChatSummary, ExitResult, HistPoint, HourBest, Invite, Order, PastOpp, PriceAlert, Settings, State, TeamUser } from "./types";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (r.status === 401) {
    window.location.href = "/login";
    throw new Error("Necesitas el código de acceso del equipo.");
  }
  if (!r.ok) throw new Error(`Error ${r.status}`);
  return r.json() as Promise<T>;
}

export async function post<T = { ok: boolean }>(url: string, body: unknown = {}): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (r.status === 413 && !data.error)
    throw new Error("El servidor no deja pasar algo tan pesado. Si es una imagen del chat, falta el ajuste de nginx del VPS (deploy/LEEME-VPS.md → Imágenes del chat).");
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}

export const api = {
  avatarSet: (image: string) => post<{ avatars: Record<string, string> }>("/api/me/avatar", { image }),
  avatarDelete: () => post<{ avatars: Record<string, string> }>("/api/me/avatar/delete"),
  state: () => getJson<State>("/api/state"),
  history: (since: number) => getJson<HistPoint[]>(`/api/history?since=${since}`),
  saveSettings: (s: Partial<Settings>) => post<Settings>("/api/settings", s),
  connect: (key: string, secret: string) => post("/api/connect", { key, secret }),
  disconnect: () => post("/api/disconnect"),
  refresh: () => post("/api/refresh"),
  testAlert: () => post("/api/test-alert"),
  login: (username: string, password: string) => post("/api/auth/login", { username, password }),
  register: (code: string, username: string, password: string) => post("/api/auth/register", { code, username, password }),
  logout: () => post("/api/auth/logout"),
  changePassword: (current: string, next: string) => post("/api/auth/password", { current, new: next }),
  team: () => getJson<{ users: TeamUser[]; invites: Invite[] }>("/api/team"),
  invite: () => post<{ code: string }>("/api/team/invite"),
  revokeInvite: (code: string) => post("/api/team/revoke", { code }),
  deleteUser: (username: string) => post("/api/team/delete-user", { username }),
  resetPassword: (username: string, password: string) => post("/api/team/reset-password", { username, password }),
  setRole: (username: string, role: "admin" | "user") => post("/api/team/role", { username, role }),
  renameUser: (username: string, next: string) => post<{ ok: boolean; username: string }>("/api/team/rename", { username, new: next }),
  tgConnect: (token: string) => post<{ ok: boolean; bot: string }>("/api/telegram/connect", { token }),
  tgDetect: () => post<{ ok: boolean; chat: string }>("/api/telegram/detect"),
  tgDisconnect: () => post("/api/telegram/disconnect"),
  stats: (days: number) => getJson<{ opps: PastOpp[]; hours: HourBest[]; days: number }>(`/api/history/stats?days=${days}`),
  orders: () => getJson<{ orders: Order[] }>("/api/orders"),
  exit: (asset: string, qty: number, cost: number) => post<ExitResult>("/api/exit", { asset, qty, cost }),
  addWatch: (asset: string, qty: number, cost: number, target: number, alert = true) =>
    post<{ ok: boolean; id: string }>("/api/watches", { asset, qty, cost, target, alert }),
  updateWatch: (id: string, patch: { asset?: string; qty?: number; cost?: number; target?: number; alert?: boolean }) =>
    post("/api/watches/update", { id, ...patch }),
  deleteWatch: (id: string) => post("/api/watches/delete", { id }),
  chat: () => getJson<ChatSummary>("/api/chat"),
  chatMessages: (peer: string, before = 0) =>
    getJson<{ messages: ChatMessage[] }>(`/api/chat/messages?peer=${encodeURIComponent(peer)}${before ? `&before=${before}` : ""}`),
  chatSend: (peer: string, body: string, extra: { reply_to?: number | null; image?: string | null } = {}) =>
    post<{ ok: boolean; message: ChatMessage }>("/api/chat/send", { peer, body, ...extra }),
  chatReact: (id: number, emoji: string) => post("/api/chat/react", { id, emoji }),
  addPriceAlert: (a: Pick<PriceAlert, "asset" | "side" | "target" | "mine" | "once">) => post<{ ok: boolean; id: string }>("/api/price-alerts", a),
  updatePriceAlert: (id: string, patch: Partial<Pick<PriceAlert, "asset" | "side" | "target" | "mine" | "on" | "once">>) =>
    post("/api/price-alerts/update", { id, ...patch }),
  deletePriceAlert: (id: string) => post("/api/price-alerts/delete", { id }),
  chatRead: (peer: string, id: number) => post("/api/chat/read", { peer, id }),
  chatDelete: (id: number) => post("/api/chat/delete", { id }),
};

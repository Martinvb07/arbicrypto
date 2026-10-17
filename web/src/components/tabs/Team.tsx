"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { Access, Invite, TeamInfo, TeamUser } from "@/lib/types";
import { ask, Modal, Select } from "../overlay";
import { TeamMark, TeamSpace } from "../TeamSpace";
import { Badge, Icon, PasswordInput, Skeleton, UserAvatar } from "../ui";

const ACCESS_TEXT: Record<Access, string> = { ambos: "al panel y a la wallet", panel: "solo al panel", wallet: "solo a la wallet" };

/** El administrador cambia el nombre de usuario (con el que se entra al panel). */
function RenameModal({ username, onClose, onDone }: { username: string; onClose: () => void; onDone: () => void }) {
  const { toast, refresh } = useLive();
  const [name, setName] = useState(username);
  const [busy, setBusy] = useState(false);
  const clean = name.trim().toLowerCase();
  const valid = /^[a-z0-9._-]{3,30}$/.test(clean);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (clean === username) return onClose();
    setBusy(true);
    try {
      const r = await api.renameUser(username, clean);
      toast("Usuario cambiado", `${username} ahora entra como ${r.username}. Su contraseña sigue igual.`, "good");
      onDone();
      refresh();
      onClose();
    } catch (err) {
      toast("No se pudo cambiar", (err as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Cambiar el usuario de ${username}`} onClose={onClose}>
      <form className="form" onSubmit={(e) => void save(e)} style={{ background: "none", padding: 0 }}>
        <label>Nuevo nombre de usuario
          <input type="text" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} autoCapitalize="none" spellCheck={false} autoFocus required />
        </label>
        <p className={`sub ${valid || !name ? "" : "form-err"}`} style={{ margin: "-6px 0 0" }}>
          3 a 30 caracteres: letras minúsculas, números, punto, guion o guion bajo. La contraseña no cambia y no se cierra su sesión.
        </p>
        <button className="btn btn-brand" type="submit" disabled={busy || !valid}>{busy ? "Guardando…" : "Cambiar usuario"}</button>
      </form>
    </Modal>
  );
}

/** El administrador le pone una contraseña nueva a otro usuario (y la puede ver y copiar para dársela). */
function ResetModal({ username, onClose }: { username: string; onClose: () => void }) {
  const { toast } = useLive();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const random = () => {
    const abc = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    const bytes = crypto.getRandomValues(new Uint32Array(12));
    setPw(Array.from(bytes, (b) => abc[b % abc.length]).join(""));
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.resetPassword(username, pw);
      try {
        await navigator.clipboard.writeText(pw);
      } catch {
        /* sin portapapeles: igual se cambió */
      }
      toast("Contraseña cambiada", `Copiada. Dásela a ${username}; sus sesiones abiertas se cerraron.`, "good");
      onClose();
    } catch (err) {
      toast("No se pudo cambiar", (err as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Nueva contraseña para ${username}`} onClose={onClose}>
      <form className="form" onSubmit={(e) => void save(e)} style={{ background: "none", padding: 0 }}>
        <label>Contraseña nueva (mínimo 8)
          <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} autoComplete="new-password" required autoFocus />
        </label>
        <button type="button" className="link-btn" style={{ justifySelf: "start" }} onClick={random}>Generar una segura</button>
        <button className="btn btn-brand" type="submit" disabled={busy || pw.length < 8}>{busy ? "Guardando…" : "Cambiar y copiar"}</button>
      </form>
    </Modal>
  );
}

/** Pestaña Equipo: tu equipo (todos) y, para administradores, equipos, usuarios y códigos de acceso. */
export function Team() {
  const { state } = useLive();
  if (!state) return null;
  return (
    <div className="stack">
      <TeamSpace />
      {state.user.role === "admin" && (
        <>
          <div className="tadmin-sep"><span><Icon name="shield" size={14} /> Administración</span></div>
          <AdminTeam />
        </>
      )}
    </div>
  );
}

/** Nombre nuevo para un equipo (lo usan crear y renombrar). */
function TeamNameModal({ team, onClose, onDone }: { team: TeamInfo | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useLive();
  const [name, setName] = useState(team?.name ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (team) await api.adminTeamRename(team.id, name.trim());
      else await api.adminTeamCreate(name.trim());
      toast(team ? "Nombre cambiado" : "Equipo creado", name.trim(), "good", 2500);
      onDone();
      onClose();
    } catch (err) {
      toast("No se pudo guardar", (err as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={team ? `Cambiar nombre de ${team.name}` : "Crear equipo"} onClose={onClose}>
      <form className="form" onSubmit={(e) => void save(e)} style={{ background: "none", padding: 0 }}>
        <label>Nombre del equipo
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Ej: Equipo Bogotá" autoFocus required />
        </label>
        {!team && <p className="sub" style={{ margin: "-6px 0 0" }}>Queda vacío: después pones a la gente desde la lista de usuarios.</p>}
        <button className="btn btn-brand" type="submit" disabled={busy || !name.trim()}>{busy ? "Guardando…" : team ? "Guardar" : "Crear equipo"}</button>
      </form>
    </Modal>
  );
}

function AdminTeam() {
  const { state, toast, refresh } = useLive();
  const [data, setData] = useState<{ users: TeamUser[]; invites: Invite[]; teams: TeamInfo[] } | null>(null);
  const [naming, setNaming] = useState<{ team: TeamInfo | null } | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const load = useCallback(() => api.team().then(setData).catch((e: Error) => toast("No se pudo cargar el equipo", e.message, "bad")), [toast]);
  const rev = `${state?.my_team?.id}|${state?.my_team?.waiting}|${state?.alerts?.[0]?.id ?? ""}`;
  useEffect(() => {
    void load();
  }, [load, rev]);

  if (!state) return null;
  const teamName = (id: string | null) => data?.teams.find((t) => t.id === id)?.name;
  const assign = async (u: string, team: string) => {
    try {
      await api.adminTeamAssign(u, team || null);
      toast(team ? `${u} ahora está en ${teamName(team)}` : `${u} quedó sin equipo`, undefined, "good", 2500);
    } catch (e) {
      toast("No se pudo cambiar el equipo", (e as Error).message, "bad");
    }
    void load();
    refresh();
  };
  const dropTeam = async (t: TeamInfo) => {
    if (!(await ask({
      title: `¿Borrar ${t.name}?`,
      body: <>{t.members.length ? <>Sus {t.members.length} miembros quedan <b>sin equipo</b> y </> : "Se "}borra el chat del equipo. Esto no se puede deshacer.</>,
      confirm: "Borrar equipo", tone: "danger", icon: "trash",
    }))) return;
    await api.adminTeamDelete(t.id).then(() => toast("Equipo borrado", t.name, "info")).catch((e: Error) => toast("Error", e.message, "bad"));
    void load();
    refresh();
  };
  const teamOptions = [
    { value: "", label: <span className="dim">Sin equipo</span>, search: "sin equipo", icon: <Icon name="users" size={15} /> },
    ...(data?.teams ?? []).map((t) => ({ value: t.id, label: t.name, search: t.name, icon: <TeamMark name={t.name} size={20} />, hint: `${t.members.length}` })),
  ];

  const invite = async () => {
    try {
      const { code } = await api.invite();
      setFresh(code);
      void load();
    } catch (e) {
      toast("No se pudo crear el código", (e as Error).message, "bad");
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copiado", text, "good", 2500);
    } catch {
      toast("Cópialo a mano", text, "info");
    }
  };
  const revoke = async (code: string) => {
    await api.revokeInvite(code).catch((e: Error) => toast("Error", e.message, "bad"));
    if (fresh === code) setFresh(null);
    void load();
  };
  const changeRole = async (u: string, role: "admin" | "user") => {
    const ok = role === "admin"
      ? await ask({
        title: `¿Hacer administrador a ${u}?`,
        body: <>Podrá cambiar los ajustes, invitar y borrar usuarios, y cambiar contraseñas. <b>Tu cuenta de Binance sigue siendo solo tuya</b>: no verá tus saldos, órdenes ni llaves.</>,
        confirm: "Sí, hacerlo administrador", icon: "shield",
      })
      : await ask({
        title: `¿Quitarle el rol de administrador a ${u}?`,
        body: "Seguirá entrando al panel como miembro del equipo, pero sin acceso a los ajustes ni a la gestión del equipo.",
        confirm: "Quitar rol", tone: "danger", icon: "users",
      });
    if (!ok) return;
    await api.setRole(u, role).then(() => toast("Rol actualizado", `${u} ahora es ${role === "admin" ? "administrador" : "miembro del equipo"}.`, "good"))
      .catch((e: Error) => toast("No se pudo cambiar el rol", e.message, "bad"));
    void load();
  };
  const changeAccess = async (u: string, access: Access) => {
    await api.setAccess(u, access).then(() => toast("Acceso actualizado", `${u} ahora entra ${ACCESS_TEXT[access]}.`, "good"))
      .catch((e: Error) => toast("No se pudo cambiar el acceso", e.message, "bad"));
    void load();
  };
  const remove = async (u: string) => {
    if (!(await ask({ title: `¿Borrar a ${u}?`, body: "Ya no podrá entrar al panel y se cerrarán sus sesiones. Esto no se puede deshacer.",
      confirm: "Borrar usuario", tone: "danger", icon: "trash" }))) return;
    await api.deleteUser(u).then(() => toast("Usuario borrado", u, "info")).catch((e: Error) => toast("Error", e.message, "bad"));
    void load();
  };

  const pending = data?.invites.filter((i) => i.status === "pendiente") ?? [];
  const msg = fresh ? `Te invito a ArbiCrypto. Entra a ${window.location.origin}/login, toca "Crear cuenta con código" y usa este código (sirve una sola vez): ${fresh}` : "";

  return (
    <div className="stack">
      <div className="card setup">
        <div className="card-head" style={{ marginBottom: 6 }}>
          <div>
            <h2 style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="sec-ico"><Icon name="ticket" /></span>Códigos de acceso</h2>
            <p className="sub">Para crear usuario. Sirve una sola vez y vence en 7 días. La persona entra sin equipo.</p>
          </div>
          <button className="btn btn-brand" onClick={() => void invite()}><Icon name="sparkle" size={16} /> Generar código</button>
        </div>
        {fresh && (
          <div className="invite-box">
            <div>
              <small className="sub">Código nuevo</small>
              <div className="invite-code">{fresh}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-sm" onClick={() => void copy(fresh)}><Icon name="copy" size={15} /> Copiar código</button>
              <button className="btn btn-sm" onClick={() => void copy(msg)}><Icon name="copy" size={15} /> Copiar mensaje para WhatsApp</button>
            </div>
          </div>
        )}
        {!state.team && state.local && ( // solo en el PC donde corre el panel; en el VPS todos entran por el dominio
          <p className="sub" style={{ marginTop: 10 }}>Para que tu equipo entre desde sus celulares en esta misma Wi-Fi, abre el panel en modo equipo (ver LEEME).</p>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="sec-ico"><Icon name="layers" /></span>Equipos</h2>
            <p className="sub">Cada quien solo ve y le escribe a los de su equipo. La gente nueva entra sin equipo.</p>
          </div>
          <button className="btn btn-brand" onClick={() => setNaming({ team: null })}><Icon name="plus" size={16} /> Crear equipo</button>
        </div>
        {!data ? <Skeleton rows={2} /> : data.teams.length ? (
          <div className="tgrid">
            {data.teams.map((t, i) => (
              <div key={t.id} className="tcard" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="tcard-head">
                  <TeamMark name={t.name} size={40} />
                  <div className="tcard-txt">
                    <b>{t.name}</b>
                    <small>{t.members.length} {t.members.length === 1 ? "miembro" : "miembros"}{t.owner ? ` · dueño ${t.owner}` : ""}</small>
                  </div>
                  <div className="tcard-act">
                    <button className="icon-btn" onClick={() => setNaming({ team: t })} title="Cambiar nombre" aria-label={`Cambiar nombre de ${t.name}`}><Icon name="pencil" size={15} /></button>
                    <button className="icon-btn danger" onClick={() => void dropTeam(t)} title="Borrar equipo" aria-label={`Borrar ${t.name}`}><Icon name="trash" size={15} /></button>
                  </div>
                </div>
                {t.members.length ? (
                  <div className="tcard-people">
                    {t.members.slice(0, 8).map((n) => (
                      <span key={n} className="tchip" title={n}><UserAvatar name={n} src={state.avatars?.[n]} size={20} />{n}</span>
                    ))}
                    {t.members.length > 8 && <span className="tchip more">+{t.members.length - 8}</span>}
                  </div>
                ) : <p className="sub tquiet">Vacío · pon gente desde Usuarios</p>}
              </div>
            ))}
          </div>
        ) : <p className="sub tquiet">Aún no hay equipos.</p>}
        {data && data.users.some((u) => !u.team) && (
          <p className="tfree"><Icon name="info" size={14} /> Sin equipo: {data.users.filter((u) => !u.team).map((u) => u.username).join(", ")}</p>
        )}
      </div>

      <div className="stack">
        <div className="card">
          <div className="card-head"><h2>Usuarios</h2></div>
          {!data ? <Skeleton rows={4} /> : (
            <ul className="user-list">
              {data.users.map((u) => {
                const me = u.username === state.user.name;
                return (
                  <li key={u.username} className="user-row">
                    <div className="user-main">
                      <UserAvatar name={u.username} src={state.avatars?.[u.username]} />
                      <div className="user-txt">
                        <b>{u.username}</b>
                        <span className="sub">
                          {u.team ? <span className="tuser-team">{teamName(u.team)}</span> : <span className="tuser-team none">Sin equipo</span>}
                          {u.last_login ? `entró ${dateTime(u.last_login * 1000)}` : "nunca ha entrado"}
                          {u.invited_by ? ` · invitado por ${u.invited_by}` : ""}
                        </span>
                      </div>
                    </div>
                    <div className="user-side">
                      {me && <Badge tone="brand">Administrador · tú</Badge>}
                      <div className="role-select team-select">
                        <Select label={`Equipo de ${u.username}`} value={u.team ?? ""} onChange={(v) => void assign(u.username, v)} options={teamOptions} />
                      </div>
                      <button className="icon-btn" onClick={() => setRenaming(u.username)} title="Cambiar nombre de usuario" aria-label={`Cambiar el usuario de ${u.username}`}><Icon name="pencil" size={16} /></button>
                      {!me && (
                        <>
                          <div className="role-select">
                            <Select label={`Rol de ${u.username}`} value={u.role} searchable={false} onChange={(r) => void changeRole(u.username, r as "admin" | "user")}
                              options={[
                                { value: "user", label: "Equipo", hint: "ve y opera" },
                                { value: "admin", label: "Administrador", hint: "todo" },
                              ]} />
                          </div>
                          <div className="role-select access-select">
                            <Select label={`Acceso de ${u.username}`} value={u.role === "admin" ? "ambos" : u.access} searchable={false}
                              onChange={(v) => u.role === "admin" ? toast("Los administradores entran a los dos", "Para limitar su acceso, cámbialo a Equipo primero.", "info") : void changeAccess(u.username, v as Access)}
                              options={[
                                { value: "ambos", label: "Panel y wallet", icon: <Icon name="layers" size={15} />, hint: "todo" },
                                { value: "panel", label: "Solo panel", icon: <Icon name="chart" size={15} />, hint: "sin contabilidad" },
                                { value: "wallet", label: "Solo wallet", icon: <Icon name="wallet" size={15} />, hint: "solo su contabilidad" },
                              ]} />
                          </div>
                          <button className="icon-btn" onClick={() => setResetting(u.username)} title="Cambiar contraseña" aria-label={`Cambiar contraseña de ${u.username}`}><Icon name="key" size={16} /></button>
                          <button className="icon-btn danger" onClick={() => void remove(u.username)} title="Borrar usuario" aria-label={`Borrar a ${u.username}`}><Icon name="trash" size={16} /></button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Códigos de invitación</h2><p className="sub">{pending.length} sin usar</p></div></div>
          {!data ? <Skeleton rows={4} /> : data.invites.length ? (
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Código</th><th>Estado</th><th>Detalle</th><th /></tr></thead>
                <tbody>
                  {data.invites.map((i) => (
                    <tr key={i.code}>
                      <td className="mono">{i.code}</td>
                      <td><Badge tone={i.status === "pendiente" ? "info" : i.status === "usado" ? "good" : "neutral"}>{i.status === "pendiente" ? "Sin usar" : i.status === "usado" ? "Usado" : "Vencido"}</Badge></td>
                      <td className="sub">{i.used_by ? `por ${i.used_by}` : `vence ${dateTime(i.expires * 1000)}`}</td>
                      <td className="num">
                        {i.status === "pendiente" && (
                          <>
                            <button className="btn btn-ghost btn-sm" onClick={() => void copy(i.code)} title="Copiar"><Icon name="copy" size={15} /></button>
                            <button className="btn btn-ghost btn-sm btn-danger" onClick={() => void revoke(i.code)} title="Anular"><Icon name="trash" size={15} /></button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty">Aún no has creado códigos.</div>}
        </div>
      </div>
      {resetting && <ResetModal username={resetting} onClose={() => setResetting(null)} />}
      {naming && <TeamNameModal team={naming.team} onClose={() => setNaming(null)} onDone={() => { void load(); refresh(); }} />}
      {renaming && <RenameModal username={renaming} onClose={() => setRenaming(null)} onDone={() => void load()} />}
    </div>
  );
}

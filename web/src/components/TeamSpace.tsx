"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { MyTeams, TeamRequest } from "@/lib/types";
import { ask, Modal, Select } from "./overlay";
import { Badge, Icon, Skeleton, UserAvatar } from "./ui";

/** Iniciales del equipo para su insignia ("Los Luises" → "LL"). */
export const teamInitials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "#";

/** Insignia del equipo: iniciales sobre un degradado que sale siempre igual para el mismo nombre. */
export function TeamMark({ name, size = 44 }: { name: string; size?: number }) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className="team-mark" style={{ width: size, height: size, fontSize: size * 0.36, ["--h" as string]: hue } as React.CSSProperties}>
      {teamInitials(name)}
    </span>
  );
}

function NameModal({ title, initial, cta, onSave, onClose }: { title: string; initial?: string; cta: string; onSave: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const clean = name.trim();
  return (
    <Modal title={title} onClose={onClose}>
      <form className="form" style={{ background: "none", padding: 0 }} onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave(clean);
          onClose();
        } finally {
          setBusy(false);
        }
      }}>
        <label>Nombre del equipo
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Ej: Mesa P2P Medellín" autoFocus required />
        </label>
        <button className="btn btn-brand" type="submit" disabled={busy || !clean}>{busy ? "Guardando…" : cta}</button>
      </form>
    </Modal>
  );
}

/** Una invitación o solicitud con sus dos botones. */
function RequestRow({ r, who, text, onYes, onNo, yes = "Aceptar", no = "Rechazar" }: {
  r: TeamRequest; who: string; text: React.ReactNode; onYes?: () => void; onNo: () => void; yes?: string; no?: string;
}) {
  const { state } = useLive();
  return (
    <li className="treq">
      <UserAvatar name={who} src={state?.avatars?.[who]} />
      <div className="treq-txt">
        <b>{text}</b>
        <small>{dateTime(r.t * 1000)}</small>
      </div>
      <div className="treq-act">
        {onYes && <button className="btn btn-sm btn-brand" onClick={onYes}><Icon name="check" size={15} /> {yes}</button>}
        <button className="btn btn-sm btn-ghost" onClick={onNo}>{no}</button>
      </div>
    </li>
  );
}

/** Tu equipo: si no tienes, crear uno o pedir unirte; si tienes, quiénes están y (si eres el dueño) invitar y aceptar. */
export function TeamSpace() {
  const { state, toast, refresh } = useLive();
  const [d, setD] = useState<MyTeams | null>(null);
  const [modal, setModal] = useState<"" | "create" | "rename">("");
  const [pick, setPick] = useState("");
  const rev = `${state?.my_team?.id}|${state?.my_team?.waiting}|${state?.alerts?.[0]?.id ?? ""}`;
  const load = useCallback(() => api.myTeams().then(setD).catch((e: Error) => toast("No se pudo cargar tu equipo", e.message, "bad")), [toast]);
  useEffect(() => {
    void load();
  }, [load, rev]);

  const run = async (p: Promise<unknown>, ok: string, sub?: string) => {
    try {
      await p;
      toast(ok, sub, "good", 3000);
    } catch (e) {
      toast("No se pudo", (e as Error).message, "bad");
    }
    void load();
    refresh();
  };

  if (!state) return null;
  if (!d) return <div className="card"><Skeleton rows={3} /></div>;
  const me = state.user.name;

  const invites = d.invites.length > 0 && (
    <div className="card tinv">
      <div className="card-head"><div><h2><span className="sec-ico"><Icon name="ticket" /></span>Te invitaron</h2><p className="sub">Al aceptar entras al equipo y ves su chat</p></div></div>
      <ul className="treq-list">
        {d.invites.map((r) => (
          <RequestRow key={r.id} r={r} who={r.by} text={<><span className="dim">{r.by} te invita a</span> {r.team_name}</>}
            onYes={() => void run(api.teamAnswer(r.id, true), `Ya estás en ${r.team_name}`, "Escríbeles en el chat General.")}
            onNo={() => void run(api.teamAnswer(r.id, false), "Invitación rechazada")} />
        ))}
      </ul>
    </div>
  );

  // ---------------------------------------------------------------- sin equipo
  if (!d.team) {
    return (
      <div className="stack">
        {invites}
        <div className="card tnone">
          <div className="tnone-hero">
            <span className="tnone-ico"><Icon name="users" size={26} /></span>
            <div>
              <h2>Todavía no estás en un equipo</h2>
              <p className="sub">Con equipo tienes chat General con ellos y puedes escribirles en privado. Crea el tuyo o pide unirte a uno.</p>
            </div>
          </div>
          <div className="tnone-grid">
            <div className="tnone-opt">
              <span className="sec-ico"><Icon name="plus" /></span>
              <b>Crea tu equipo</b>
              <p className="sub">Quedas de dueño: invitas y aceptas a quien quieras.</p>
              <button className="btn btn-brand" onClick={() => setModal("create")}><Icon name="sparkle" size={16} /> Crear equipo</button>
            </div>
            <div className="tnone-opt">
              <span className="sec-ico blue"><Icon name="send" /></span>
              <b>Únete a uno</b>
              <p className="sub">Le llega tu solicitud al dueño y entras cuando te acepte.</p>
              {d.teams.length ? (
                <ul className="tjoin">
                  {d.teams.map((t) => (
                    <li key={t.id}>
                      <TeamMark name={t.name} size={34} />
                      <div className="tjoin-txt"><b>{t.name}</b><small>{t.size} {t.size === 1 ? "miembro" : "miembros"}{t.owner ? ` · de ${t.owner}` : ""}</small></div>
                      {t.asked ? (
                        <button className="btn btn-sm btn-ghost" onClick={() => {
                          const r = d.asked.find((x) => x.team === t.id);
                          if (r) void run(api.teamCancel(r.id), "Solicitud cancelada");
                        }}><Icon name="clock" size={14} /> Enviada · cancelar</button>
                      ) : (
                        <button className="btn btn-sm" onClick={() => void run(api.teamRequest(t.id), "Solicitud enviada", `Le avisamos a ${t.owner ?? "un administrador"}.`)}>
                          Pedir unirme
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : <p className="sub tjoin-empty">Aún no hay equipos. ¡Crea el primero!</p>}
            </div>
          </div>
        </div>
        {modal === "create" && <NameModal title="Crear equipo" cta="Crear equipo" onClose={() => setModal("")}
          onSave={(n) => run(api.teamCreate(n), `Equipo ${n} creado`, "Ya puedes invitar gente.")} />}
      </div>
    );
  }

  // ---------------------------------------------------------------- con equipo
  const t = d.team;
  const online = t.members.filter((m) => m.online).length;
  const leave = async () => {
    const alone = t.members.length === 1;
    if (!(await ask({
      title: `¿Salir de ${t.name}?`,
      body: alone ? "Eres el único: el equipo se borra con su chat." : t.mine ? "Eres el dueño: el equipo queda en manos de quien lleva más tiempo." : "Ya no verás su chat General ni podrás escribirles en privado.",
      confirm: "Salir del equipo", tone: "danger", icon: "logout",
    }))) return;
    void run(api.teamLeave(), `Saliste de ${t.name}`);
  };
  const kick = async (n: string) => {
    if (!(await ask({ title: `¿Sacar a ${n} del equipo?`, body: "Deja de ver el chat del equipo. Puede volver a pedir unirse.", confirm: "Sacar", tone: "danger", icon: "trash" }))) return;
    void run(api.teamKick(n), `${n} salió del equipo`);
  };

  return (
    <div className="stack">
      {invites}
      <div className="card thead">
        <div className="thead-main">
          <TeamMark name={t.name} size={56} />
          <div className="thead-txt">
            <small>Tu equipo</small>
            <h2>{t.name}</h2>
            <span className="sub">
              {t.members.length} {t.members.length === 1 ? "miembro" : "miembros"}
              {online > 0 && <> · <span className="tonline"><span className="pulse" />{online} en línea</span></>}
              {t.owner && <> · {t.mine ? "eres el dueño" : `dueño: ${t.owner}`}</>}
            </span>
          </div>
        </div>
        <div className="thead-act">
          <a className="btn btn-sm" href="#chat"><Icon name="chat" size={15} /> Chat del equipo</a>
          {t.mine && <button className="btn btn-sm btn-ghost" onClick={() => setModal("rename")}><Icon name="pencil" size={15} /> Nombre</button>}
          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => void leave()}><Icon name="logout" size={15} /> Salir</button>
        </div>
      </div>

      <div className={t.mine ? "grid-2" : ""}>
        <div className="card">
          <div className="card-head"><h2>Miembros</h2></div>
          <ul className="tmembers">
            {t.members.map((m, i) => (
              <li key={m.name} style={{ animationDelay: `${i * 40}ms` }}>
                <span className="tav">
                  <UserAvatar name={m.name} src={state.avatars?.[m.name]} />
                  <span className={`chat-dot ${m.online ? "on" : ""}`} />
                </span>
                <div className="tm-txt">
                  <b>{m.name}{m.name === me && <span className="dim"> · tú</span>}</b>
                  <small>{m.online ? "En línea" : "Desconectado"}</small>
                </div>
                <div className="tm-side">
                  {m.name === t.owner && <Badge tone="brand">Dueño</Badge>}
                  {m.role === "admin" && <Badge tone="info">Admin</Badge>}
                  {t.mine && m.name !== me && (
                    <button className="icon-btn danger" onClick={() => void kick(m.name)} title={`Sacar a ${m.name}`} aria-label={`Sacar a ${m.name}`}><Icon name="x" size={15} /></button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {t.mine && (
          <div className="stack">
            <div className="card">
              <div className="card-head"><div><h2>Solicitudes</h2><p className="sub">Gente que quiere entrar a {t.name}</p></div>
                {d.requests.length > 0 && <Badge tone="warn">{d.requests.length} por responder</Badge>}</div>
              {d.requests.length ? (
                <ul className="treq-list">
                  {d.requests.map((r) => (
                    <RequestRow key={r.id} r={r} who={r.user} text={<>{r.user} <span className="dim">quiere unirse</span></>}
                      onYes={() => void run(api.teamAnswer(r.id, true), `${r.user} ya está en el equipo`)}
                      onNo={() => void run(api.teamAnswer(r.id, false), "Solicitud rechazada")} />
                  ))}
                </ul>
              ) : <p className="sub tquiet"><Icon name="check" size={14} /> Nada pendiente</p>}
            </div>
            <div className="card">
              <div className="card-head"><div><h2>Invitar</h2><p className="sub">Solo aparece quien todavía no tiene equipo</p></div></div>
              {d.free.length ? (
                <div className="tinvite">
                  <div className="tinvite-pick">
                    <Select label="Persona" value={pick} onChange={setPick}
                      options={[{ value: "", label: <span className="dim">Elige a quién invitar</span>, search: "", icon: <Icon name="users" size={16} /> },
                        ...d.free.map((n) => ({ value: n, label: n, search: n, icon: <UserAvatar name={n} src={state.avatars?.[n]} size={22} /> }))]} />
                  </div>
                  <button className="btn btn-brand" disabled={!pick} onClick={() => { void run(api.teamInvite(pick), "Invitación enviada", `${pick} la verá en su pestaña Equipo.`); setPick(""); }}>
                    <Icon name="send" size={15} /> Invitar
                  </button>
                </div>
              ) : <p className="sub tquiet">Todos ya tienen equipo. Para alguien nuevo, pídele a un administrador un código de acceso.</p>}
              {d.invited.length > 0 && (
                <ul className="treq-list">
                  {d.invited.map((r) => (
                    <RequestRow key={r.id} r={r} who={r.user} text={<>{r.user} <span className="dim">· esperando que acepte</span></>}
                      no="Cancelar" onNo={() => void run(api.teamCancel(r.id), "Invitación cancelada")} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
      {modal === "rename" && <NameModal title="Cambiar el nombre del equipo" initial={t.name} cta="Guardar" onClose={() => setModal("")}
        onSave={(n) => run(api.teamRename(n), "Nombre cambiado", n)} />}
    </div>
  );
}

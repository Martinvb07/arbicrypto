"use client";

import { useState, type FormEvent } from "react";
import { api, type GmfMode, type Profile } from "@/lib/api";
import { money } from "@/lib/format";
import { BinanceCard } from "../BinanceCard";
import { GmfChoice, methodName } from "../GmfChoice";
import { Field, Note, Switch } from "../ui";
import { useWallet } from "../wallet";

export function Settings() {
  const { me } = useWallet();
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Ajustes</h1>
          <p>Tu perfil fiscal cambia cómo se calculan las ganancias de todos los años.</p>
        </div>
      </div>
      <BinanceCard />
      <ProfileForm />
      <Note>
        Tu usuario, tu contraseña y el equipo se manejan en el <a href={me.panel}>panel</a> (menú de tu usuario).
        Esta wallet es solo tuya: tus movimientos, tu Binance y tus extractos no los ve nadie más, ni los administradores.
      </Note>
    </div>
  );
}

function ProfileForm() {
  const { me, setMe, toast, refresh } = useWallet();
  const [p, setP] = useState<Profile>(me.profile);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((x) => ({ ...x, [k]: v }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.saveProfile({ ...p, name: p.name.trim(), nit: p.nit.trim() });
      setMe({ ...me, profile: r.profile });
      toast("Perfil guardado", "Las cifras se recalcularon", "good");
      refresh();
    } catch (err) {
      toast("No se pudo guardar", (err as Error).message, "bad");
    }
    setBusy(false);
  }

  return (
    <form className="card card-pad" onSubmit={save}>
      <h2 style={{ marginBottom: 14 }}>Perfil fiscal</h2>
      <div className="form">
        <Field label="Nombre completo">
          <input type="text" value={p.name} onChange={(e) => set("name", e.target.value)} maxLength={120} autoComplete="name" />
        </Field>
        <Field label="Cédula o NIT" hint="Sin dígito de verificación, o con guion: 1234567890-1">
          <input type="text" inputMode="numeric" value={p.nit} onChange={(e) => set("nit", e.target.value.replace(/[^\d-]/g, ""))} maxLength={20} />
        </Field>
      </div>
      <div style={{ marginTop: 6 }}>
        <Switch on={p.habitual} onChange={(v) => set("habitual", v)} label="Compro y vendo de forma habitual"
          hint="Trading o arbitraje frecuente: las cripto son activos movibles y toda utilidad es renta ordinaria. Apágalo si solo inviertes y guardas." />
        <div className="switch-row" style={{ cursor: "default", display: "grid", gap: 10 }}>
          <span>
            <b>¿Tu banco te cobra el 4x1000 cuando compras?</b>
            <small>Míralo en tu extracto: si en las transferencias que haces al comprar aparece &quot;GMF&quot; o &quot;4x1000&quot;, te lo cobran.</small>
          </span>
          <GmfChoice value={p.gmf_mode} onChange={(m) => setP((x) => ({ ...x, gmf_mode: m, gmf_exempt: m === "exenta" }))} />
          {!!me.pay_methods?.length && (
            <div className="per-method">
              <small>¿Pagas desde varias cuentas? Elige para cada una (si no, se usa lo de arriba):</small>
              {me.pay_methods.map((pm) => (
                <div key={pm.method} className="per-row">
                  <span><b>{methodName(pm.method)}</b><small>{pm.n} compra{pm.n > 1 ? "s" : ""} · {money(pm.total)}</small></span>
                  <select value={p.gmf_methods?.[pm.method] ?? ""} onChange={(e) => {
                    const v = e.target.value as GmfMode | "";
                    setP((x) => {
                      const next = { ...(x.gmf_methods ?? {}) };
                      if (v) next[pm.method] = v; else delete next[pm.method];
                      return { ...x, gmf_methods: next };
                    });
                  }}>
                    <option value="">Igual que arriba</option>
                    <option value="todas">Sí me cobra 4x1000</option>
                    <option value="exenta">No me cobra (exenta)</option>
                    <option value="tope350">Exenta hasta el tope del mes</option>
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="switch-row" style={{ cursor: "default" }}>
          <span>
            <b>Método de costo</b>
            <small>{p.method === "fifo" ? "PEPS: lo primero que compraste es lo primero que vendes." : "Promedio: cada venta toma el costo promedio de lo que tienes."}</small>
          </span>
          <div className="seg">
            <button type="button" className={p.method === "fifo" ? "on" : ""} onClick={() => set("method", "fifo")}>PEPS</button>
            <button type="button" className={p.method === "promedio" ? "on" : ""} onClick={() => set("method", "promedio")}>Promedio</button>
          </div>
        </div>
      </div>
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar perfil"}</button>
      </div>
    </form>
  );
}

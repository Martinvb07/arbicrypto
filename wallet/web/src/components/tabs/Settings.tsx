"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { api, type GmfMode, type Profile } from "@/lib/api";
import { date, money, num } from "@/lib/format";
import { BinanceCard } from "../BinanceCard";
import { GmfChoice, methodName } from "../GmfChoice";
import { Select } from "../Select";
import { BankLogo, Field, Icon, Note } from "../ui";
import { useWallet } from "../wallet";

/** Valores de la DIAN que usa la app, con la norma de donde salen (revisados en octubre de 2026). */
const RULES: { label: string; value: (uvt: Record<string, number>) => string; source: string }[] = [
  { label: "UVT 2025", value: (u) => money(u["2025"]), source: "Res. DIAN 000193 de 2024 · topes de la declaración que presentas en 2026" },
  { label: "UVT 2026", value: (u) => money(u["2026"]), source: "Res. DIAN 000238 de 2025" },
  { label: "Declaras si tu patrimonio pasa de", value: (u) => `4.500 UVT · ${money(4500 * u["2025"])}`, source: "Art. 592 ET · año gravable 2025" },
  { label: "…o si tus ingresos, consignaciones, compras o consumos pasan de", value: (u) => `1.400 UVT · ${money(1400 * u["2025"])}`, source: "Arts. 592 a 594-3 ET · año gravable 2025" },
  { label: "Fechas para declarar el año 2025", value: () => "12 ago – 26 oct 2026", source: "Decreto 2229 de 2023 · según los 2 últimos dígitos del NIT" },
  { label: "Ganancia ocasional (cripto de más de 2 años)", value: () => "15 %", source: "Art. 314 ET (Ley 2277 de 2022)" },
  { label: "4x1000 que se resta en la declaración", value: () => "50 %", source: "Art. 115 ET" },
  { label: "Cuenta exenta de 4x1000", value: (u) => `350 UVT al mes · ${money(350 * u["2026"])} en 2026`, source: "Art. 879 num. 1 ET" },
  { label: "Cripto por cripto (permuta)", value: () => "Cuenta como venta", source: "Concepto DIAN 1621 de 2023" },
  { label: "Reporte de exchanges a la DIAN", value: () => "Desde 2026", source: "Res. DIAN 000240 de 2025 (estándar CARF de la OCDE)" },
];

/** Qué trae la sincronización con Binance (límites de la API oficial de Binance). */
const SYNC: { icon: string; title: string; text: string }[] = [
  { icon: "list", title: "Spot y Convert", text: "Compras, ventas y cambios entre cripto, con su comisión." },
  { icon: "bank", title: "P2P", text: "Tus órdenes de los últimos 6 meses (es lo que Binance entrega por API). Las anteriores, súbelas una vez con el archivo de Binance." },
  { icon: "trend", title: "Earn y staking", text: "Lo que te pagan como ingreso, con su valor en pesos del día." },
  { icon: "refresh", title: "Cada 30 minutos", text: "Se actualiza sola. Cada vez repasa los 2 últimos días: lo repetido no se duplica." },
];

export function Settings() {
  const { me, report } = useWallet();
  const name = me.profile.name || me.user.username;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Ajustes</h1>
          <p>Tu conexión con Binance y tu perfil fiscal. Lo que cambies aquí recalcula todos los años.</p>
        </div>
      </div>

      <div className="card set-who">
        <span className="set-avatar">{name.slice(0, 1).toUpperCase()}</span>
        <div className="set-who-txt">
          <b>{name}</b>
          <span>{me.profile.nit ? `CC / NIT ${me.profile.nit}` : "Falta tu cédula"} · {me.user.role === "admin" ? "Administrador" : "Equipo"}</span>
        </div>
        <div className="set-who-chips">
          {report?.deadline && <span className="set-chip"><Icon name="calendar" size={13} /> Declaras el {report.year} hasta el {date(Date.parse(report.deadline + "T12:00:00-05:00") / 1000)}</span>}
          <a className="set-chip link-chip" href={me.panel}><Icon name="users" size={13} /> Usuario y contraseña en el panel</a>
        </div>
      </div>

      <Section icon="link" title="Conexión con Binance" sub="La misma llave del panel (Mi Binance). La wallet no guarda llaves: solo lee.">
        <BinanceCard />
        <div className="sync-grid">
          {SYNC.map((x) => (
            <div key={x.title} className="sync-item">
              <span className="sync-ic"><Icon name={x.icon} size={16} /></span>
              <span><b>{x.title}</b><small>{x.text}</small></span>
            </div>
          ))}
        </div>
      </Section>

      <ProfileForm />

      <Section icon="scale" title="Valores de la DIAN que usa la app" sub="Revisados con las normas vigentes. Si la DIAN cambia algo, se actualiza aquí.">
        <div className="rules">
          {RULES.map((r) => (
            <div key={r.label} className="rule">
              <span><b>{r.label}</b><small>{r.source}</small></span>
              <b className="num">{r.value(me.uvt)}</b>
            </div>
          ))}
        </div>
      </Section>

      <Note>
        Esta wallet es solo tuya: tus movimientos, tu Binance y tus extractos no los ve nadie más, ni los administradores.
        Los cálculos son informativos; revísalos con un contador antes de declarar.
      </Note>
    </div>
  );
}

function Section({ icon, title, sub, children }: { icon: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="card set-sec">
      <header className="set-sec-head">
        <span className="set-sec-ic"><Icon name={icon} size={17} /></span>
        <div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
      </header>
      <div className="set-sec-body">{children}</div>
    </section>
  );
}

/** Dos opciones grandes para elegir una (habitual o no, PEPS o promedio). */
function Choice<T extends string | boolean>({ value, options, onChange }: { value: T; onChange: (v: T) => void; options: { v: T; title: string; text: string; icon: string }[] }) {
  return (
    <div className="choice" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} className={`choice-opt ${value === o.v ? "on" : ""}`} onClick={() => onChange(o.v)}>
          <span className="choice-ic"><Icon name={o.icon} size={16} /></span>
          <span><b>{o.title}</b><small>{o.text}</small></span>
          <span className="choice-dot" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function ProfileForm() {
  const { me, setMe, toast, refresh } = useWallet();
  const [p, setP] = useState<Profile>(me.profile);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(p) !== JSON.stringify(me.profile);
  const digits = p.nit.split("-")[0].replace(/\D/g, "");

  async function save(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      const r = await api.saveProfile({ ...p, name: p.name.trim(), nit: p.nit.trim() });
      setMe({ ...me, profile: r.profile });
      setP(r.profile);
      toast("Perfil guardado", "Las cifras se recalcularon", "good");
      refresh();
    } catch (err) {
      toast("No se pudo guardar", (err as Error).message, "bad");
    }
    setBusy(false);
  }

  return (
    <form className="stack" onSubmit={save}>
      <Section icon="file" title="Tus datos" sub="Salen en los libros, en el resumen para la DIAN y definen tu fecha límite.">
        <div className="form">
          <Field label="Nombre completo">
            <input type="text" value={p.name} onChange={(e) => set("name", e.target.value)} maxLength={120} autoComplete="name" placeholder="Como aparece en tu cédula" />
          </Field>
          <Field label="Cédula o NIT" hint={digits.length >= 2 ? `Tu fecha la marcan los dos últimos dígitos: ${digits.slice(-2)}` : "Sin dígito de verificación, o con guion: 1234567890-1"}>
            <input type="text" inputMode="numeric" value={p.nit} onChange={(e) => set("nit", e.target.value.replace(/[^\d-]/g, ""))} maxLength={20} />
          </Field>
        </div>
      </Section>

      <Section icon="trend" title="Cómo operas" sub="Define si tu ganancia es renta ordinaria o ganancia ocasional, y cómo se calcula el costo de lo que vendes.">
        <div className="set-q">¿Compras y vendes seguido?</div>
        <Choice value={p.habitual} onChange={(v) => set("habitual", v)} options={[
          { v: true, icon: "refresh", title: "Sí, opero seguido", text: "Trading o arbitraje: toda la ganancia es renta ordinaria (tabla del art. 241)." },
          { v: false, icon: "wallet", title: "No, compro y guardo", text: "Inversión: lo que tengas más de 2 años paga 15 % como ganancia ocasional." },
        ]} />
        <div className="set-q">¿Cómo se calcula el costo de lo que vendes?</div>
        <Choice value={p.method} onChange={(v) => set("method", v)} options={[
          { v: "fifo", icon: "list", title: "PEPS", text: "Lo primero que compraste es lo primero que vendes. Es el más usado." },
          { v: "promedio", icon: "scale", title: "Promedio ponderado", text: "Cada venta toma el costo promedio de lo que tienes." },
        ]} />
      </Section>

      <Section icon="bank" title="4x1000" sub="Si en tu extracto aparece “GMF” o “4x1000” en las transferencias con que compras, te lo cobran. La mitad se resta en la declaración.">
        <GmfChoice value={p.gmf_mode} onChange={(m) => setP((x) => ({ ...x, gmf_mode: m, gmf_exempt: m === "exenta" }))} />
        {!!me.pay_methods?.length && (
          <div className="gmf-methods">
            <div className="set-q">¿Pagas desde varias cuentas? Elige para cada una</div>
            {me.pay_methods.map((pm) => (
              <div key={pm.method} className="gmf-method">
                <BankLogo name={methodName(pm.method)} size={32} />
                <span className="gmf-method-txt"><b>{methodName(pm.method)}</b><small>{pm.n} compra{pm.n > 1 ? "s" : ""} · {money(pm.total)}</small></span>
                <div className="filter-inline">
                  <Select label={`4x1000 de ${methodName(pm.method)}`} value={p.gmf_methods?.[pm.method] ?? ""} searchable={false}
                    onChange={(v) => setP((x) => {
                      const next = { ...(x.gmf_methods ?? {}) };
                      if (v) next[pm.method] = v as GmfMode; else delete next[pm.method];
                      return { ...x, gmf_methods: next };
                    })}
                    options={[
                      { value: "", label: "Igual que arriba" },
                      { value: "todas", label: "Sí me cobra" },
                      { value: "exenta", label: "No me cobra (exenta)" },
                      { value: "tope350", label: "Exenta hasta el tope", hint: `${num(350)} UVT/mes` },
                    ]} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className={`save-bar ${dirty ? "show" : ""}`} aria-hidden={!dirty}>
        <span><Icon name="info" size={15} /> Tienes cambios sin guardar</span>
        <div className="actions">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setP(me.profile)} disabled={busy}>Descartar</button>
          <button className="btn btn-sm btn-primary" disabled={busy || !dirty}>{busy ? "Guardando…" : "Guardar cambios"}</button>
        </div>
      </div>
    </form>
  );
}

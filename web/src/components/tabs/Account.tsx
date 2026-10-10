"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { dateTime, money, num, pctPlain, qty } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { Balance, Order } from "@/lib/types";
import { ask } from "../overlay";
import { Ago, Asset, Badge, EmptyBox, Icon, PasswordInput, Skeleton, type Tone } from "../ui";

const STATUS: Record<string, [string, Tone]> = {
  COMPLETED: ["Completada", "good"],
  CANCELLED: ["Cancelada", "neutral"],
  CANCELLED_BY_SYSTEM: ["Cancelada", "neutral"],
  TRADING: ["En curso", "info"],
  PENDING: ["Pendiente", "info"],
  BUYER_PAYED: ["Pagada", "info"],
  DISTRIBUTING: ["Liberando", "info"],
  IN_APPEAL: ["En apelación", "bad"],
  APPEALING: ["En apelación", "bad"],
};

function Balances({ rows, empty, fiat }: { rows: Balance[]; empty: string; fiat: string }) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>Cripto</th><th className="num">Cantidad</th><th className="num">Valor USDT</th><th className="num">Valor {fiat}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.asset} className={(r.usdt ?? 0) < 1 ? "dim" : ""}>
              <td><Asset s={r.asset.startsWith("LD") && r.asset.length > 4 ? r.asset.slice(2) : r.asset} label={r.asset} /></td>
              <td className="num">{qty(r.qty)}</td>
              <td className="num">{r.usdt != null ? num(r.usdt, 2) : "—"}</td>
              <td className="num">{money(r.fiat, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConnectForm() {
  const { refresh, toast } = useLive();
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.connect(key, secret);
      toast("Cuenta conectada", undefined, "good");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <label>API Key<input type="text" value={key} onChange={(e) => setKey(e.target.value)} spellCheck={false} autoComplete="off" required /></label>
      <label>Secret Key<PasswordInput value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" required /></label>
      {error && <div className="form-err">{error}</div>}
      <button className="btn btn-brand" type="submit" disabled={busy}>{busy ? "Verificando con Binance…" : "Conectar cuenta"}</button>
      <div className="lock-note"><Icon name="lock" size={15} /><span>Las llaves se guardan solo en este PC (<code>backend\.env</code>) y solo se envían a Binance.</span></div>
    </form>
  );
}

/** Todas las ordenes P2P guardadas (el panel las va acumulando; Binance solo entrega las ultimas). */
function SavedOrders({ refreshKey }: { refreshKey: number }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  useEffect(() => {
    api.orders().then((r) => setOrders(r.orders)).catch(() => setOrders([]));
  }, [refreshKey]);
  const done = (orders ?? []).filter((o) => o.status === "COMPLETED");
  const bought = done.filter((o) => o.side === "BUY").reduce((a, o) => a + o.total, 0);
  const sold = done.filter((o) => o.side === "SELL").reduce((a, o) => a + o.total, 0);
  return (
    <div className="card">
      <div className="card-head">
        <h2>Órdenes P2P guardadas</h2>
        <a className="btn btn-sm" href="/api/orders.csv" download><Icon name="download" size={15} /> Exportar a Excel</a>
      </div>
      {!orders ? <Skeleton rows={4} /> : !orders.length ? (
        <div className="empty">Sin órdenes P2P todavía. Se guardan solas a medida que operas.</div>
      ) : (
        <>
          <div className="summary">
            <div><small>Completadas</small><b>{done.length}</b></div>
            <div><small>Compraste</small><b>{money(bought, 0)}</b></div>
            <div><small>Vendiste</small><b>{money(sold, 0)}</b></div>
            <div><small>Volumen total</small><b>{money(bought + sold, 0)}</b></div>
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Fecha</th><th>Tipo</th><th className="num">Cantidad</th><th className="num">Precio</th><th className="num">Total</th><th>Estado</th><th className="hide-sm">Contraparte</th></tr></thead>
              <tbody>
                {orders.slice(0, 200).map((o) => {
                  const [label, t] = STATUS[o.status] ?? [o.status, "neutral" as Tone];
                  return (
                    <tr key={o.id}>
                      <td className="dim">{dateTime(o.time)}</td>
                      <td><Asset s={o.asset} size={18} label={`${o.side === "BUY" ? "Compra" : "Venta"} ${o.asset}`} /></td>
                      <td className="num">{qty(o.amount)}</td>
                      <td className="num">{money(o.price)}</td>
                      <td className="num">{money(o.total, 0)}</td>
                      <td><Badge tone={t}>{label}</Badge></td>
                      <td className="hide-sm">{o.counterpart ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export function Account() {
  const { state, refresh, toast } = useLive();
  if (!state) return <Skeleton rows={10} />;
  const fiat = state.settings.fiat;

  if (!state.connected) {
    return (
      <div className="card connect">
        <div>
          <h2>Conecta tu cuenta de Binance</h2>
          <p>Solo <b>lee</b> tu cuenta (saldos, comisión y órdenes P2P). No puede operar ni retirar. Es <b>personal</b>: nadie más del equipo ve tus saldos, órdenes ni tu llave, y se guarda cifrada.</p>
          <ol className="num-steps">
            <li><span>En Binance entra a <b>Perfil → Gestión de API → Crear API</b> y elige <b>“Generada por el sistema”</b>. <a href="https://www.binance.com/es/my/settings/api-management" target="_blank" rel="noopener noreferrer">Abrir Gestión de API</a></span></li>
            <li><span>En permisos deja <b>solo “Habilitar lectura”</b>. Si tiene trading, retiros o transferencias, el panel la rechaza.</span></li>
            <li><span>Recomendado: en “Restringir acceso a IP” pon la IP del PC o servidor donde corre el panel.</span></li>
            <li><span>Copia la <b>API Key</b> y la <b>Secret Key</b> y pégalas aquí.</span></li>
          </ol>
        </div>
        {state.can_connect ? (
          <ConnectForm />
        ) : (
          <EmptyBox icon="lock" title="Conéctala desde el PC principal">
            Por seguridad, las llaves de Binance no viajan por el Wi-Fi sin cifrar: entra con tu usuario en el PC donde corre el panel y conéctala ahí.
          </EmptyBox>
        )}
      </div>
    );
  }

  const a = state.account;
  const disconnect = async () => {
    if (!(await ask({ title: "¿Desconectar tu cuenta de Binance?", body: "Se borran tus llaves guardadas. Dejarás de ver saldos y órdenes hasta que la conectes otra vez.",
      confirm: "Desconectar", tone: "danger", icon: "key" }))) return;
    try {
      await api.disconnect();
      toast("Cuenta desconectada", "Las llaves se borraron.", "info");
      refresh();
    } catch (e) {
      toast("No se pudo desconectar", (e as Error).message, "bad");
    }
  };

  if (!a) {
    return (
      <div className="card">
        {state.errors.account ? <EmptyBox icon="alert" title="No se pudo leer la cuenta">{state.errors.account.msg}</EmptyBox> : <Skeleton rows={6} />}
        <button className="btn btn-sm btn-danger" style={{ marginTop: 12 }} onClick={() => void disconnect()}>Desconectar</button>
      </div>
    );
  }

  const p = a.permissions;
  return (
    <div className="stack">
      {p.withdrawals && (
        <div className="banner err"><Icon name="alert" /> <span><b>Tu llave tiene los retiros habilitados.</b> El panel no los necesita: desactívalos en Binance → Gestión de API.</span></div>
      )}
      <div className="card">
        <div className="acct-head">
          <div>
            <div className="sub">Saldo total estimado</div>
            <div className="big-num">{a.total_fiat != null ? money(a.total_fiat, 0) : `${num(a.total_usdt, 2)} USDT`}</div>
            <div className="sub">≈ {num(a.total_usdt, 2)} USDT{a.usdt_fiat ? ` · USDT valorado a ${money(a.usdt_fiat)} (mejor venta P2P)` : ""}</div>
            <div className="badges">
              <Badge tone={p.reading ? "good" : "bad"}>{p.reading ? "✓" : "✕"} Lectura</Badge>
              <Badge tone={p.trading ? "warn" : "good"}>{p.trading ? "Trading activado" : "✓ Sin trading"}</Badge>
              <Badge tone={p.withdrawals ? "bad" : "good"}>{p.withdrawals ? "Retiros activados" : "✓ Sin retiros"}</Badge>
              <Badge tone={p.ip_restricted ? "good" : "warn"}>{p.ip_restricted ? "✓ Restringida a IP" : "Sin restricción de IP"}</Badge>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-sm" onClick={() => void api.refresh().then(() => toast("Actualizando…", undefined, "info", 2000))}><Icon name="refresh" size={15} /> Actualizar</button>
            <button className="btn btn-sm btn-danger" onClick={() => void disconnect()}>Desconectar</button>
          </div>
        </div>
        <div className="facts">
          <div><small>UID</small><b>{a.uid ?? "—"}</b></div>
          <div><small>API Key</small><b className="mono">{state.key_hint}</b></div>
          <div><small>Comisión maker / taker</small><b>{pctPlain(a.maker, 3)} / {pctPlain(a.taker, 3)}</b></div>
          <div><small>Actualizado</small><b><Ago t={a.t} /></b></div>
        </div>
        {a.notes.map((n) => <p key={n} className="sub" style={{ marginTop: 10 }}>{n}</p>)}
      </div>
      <div className="grid-2">
        <div className="card"><div className="card-head"><h2>Billetera Spot</h2></div><Balances rows={a.spot} empty="Sin saldo en Spot." fiat={fiat} /></div>
        <div className="card"><div className="card-head"><h2>Billetera de Fondos (P2P)</h2></div><Balances rows={a.funding} empty="Sin saldo en Fondos." fiat={fiat} /></div>
      </div>
      <SavedOrders refreshKey={a.t} />
    </div>
  );
}

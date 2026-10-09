"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { advertiserUrl, COIN_NAMES, isDollar, spotUrl } from "@/lib/calc";
import { money, num, qty, signedMoney, tone } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { ExitOption, Watch } from "@/lib/types";
import { ask, Select, Sheet } from "../overlay";
import { Asset, Coin, ExtLink, Icon } from "../ui";

/** Cantidad de cripto: acepta 0,0021 o 0.0021. */
const parseQty = (v: string) => Number(v.trim().replace(/\s/g, "").replace(",", "."));
/** Pesos: acepta 550.000, 550000 o 550.000,50. */
const parseCop = (v: string) => Number(v.trim().replace(/[\s$]/g, "").replace(/\./g, "").replace(",", "."));

const amount = (asset: string, v: number) => (isDollar(asset) ? `${num(v, 2)} dólares (${asset})` : `${qty(v)} ${asset}`);

/** Lo que el administrador tiene en Binance (Spot + Fondos), con valor de al menos $1.000. */
function useHoldings() {
  const { state } = useLive();
  return useMemo(() => {
    const acc = state?.account;
    if (!acc) return [];
    const by = new Map<string, { asset: string; qty: number; fiat: number; where: string[] }>();
    for (const [rows, where] of [[acc.spot, "Spot"], [acc.funding, "Fondos"]] as const) {
      for (const r of rows) {
        if (r.asset.startsWith("LD") || (r.fiat ?? 0) < 1000 || r.asset === state.settings.fiat) continue;
        const h = by.get(r.asset) ?? { asset: r.asset, qty: 0, fiat: 0, where: [] };
        h.qty += r.qty;
        h.fiat += r.fiat ?? 0;
        h.where.push(where);
        by.set(r.asset, h);
      }
    }
    return [...by.values()].sort((a, b) => b.fiat - a.fiat);
  }, [state]);
}

/** Paso a paso para vender, con enlaces al par de Spot y al anunciante (lo usan la búsqueda y los avisos). */
function SellSteps({ asset, qty: have, o }: { asset: string; qty: number; o: Pick<ExitOption, "to" | "path" | "hops" | "qty" | "ad" | "received"> }) {
  const hops = o.hops ?? [];
  return (
    <ol className="steps-list">
      {o.path.length > 1 && (
        <li>
          <div>
            <div className="step-main">
              Cambia {amount(asset, have)} por <Asset s={o.to} size={18} /> en Spot
            </div>
            <div className="step-sub">
              {hops.map((h, k) => (
                <span key={h.symbol}>
                  {k > 0 && " y luego "}Par <ExtLink href={spotUrl(h.pair)}>{h.symbol}</ExtLink>
                </span>
              ))}
              {hops.length > 0 && " · "}orden de <b>Mercado</b>, <b>NO Convertir</b> · te deben llegar mínimo <b>{amount(o.to, o.qty)}</b>
            </div>
          </div>
        </li>
      )}
      <li>
        <div>
          <div className="step-main">Pasa {amount(o.to, o.qty)} a <b>Fondos</b></div>
          <div className="step-sub">
            P2P vende desde Fondos · <ExtLink href="https://www.binance.com/es/my/wallet/account/main">Transferir (gratis)</ExtLink>
          </div>
        </div>
      </li>
      <li>
        <div>
          <div className="step-main">
            Vende a <ExtLink href={advertiserUrl(o.ad)}><b>{o.ad.nick}</b></ExtLink> a <b>{money(o.ad.price)}</b> {isDollar(o.to) ? "cada dólar" : `por ${o.to}`}
            <span className="muted"> · recibes {money(o.received, 0)}</span>
          </div>
          <div className="step-sub">
            <span className="muted">({num(o.ad.orders, 0)} órdenes, {num(o.ad.finish * 100, 0)} %)</span> · {o.ad.methods.slice(0, 3).join(", ")} · confirma el precio antes de vender
          </div>
        </div>
      </li>
    </ol>
  );
}

function coinOptions(choices: string[], holdings: { asset: string; qty: number }[]) {
  return choices.map((a) => {
    const held = holdings.find((h) => h.asset === a);
    return {
      value: a,
      search: `${a} ${COIN_NAMES[a] ?? ""}`,
      icon: <Coin s={a} size={22} />,
      label: <span className="opt-coin"><b>{a}</b><small>{COIN_NAMES[a] ?? ""}</small></span>,
      hint: held ? `tienes ${qty(held.qty)}` : undefined,
    };
  });
}


const ENDED: Record<string, string> = { vendida: "Ya la vendiste", vencida: "Venció", reemplazada: "Reemplazada" };
const LIVE = new Set<Watch["status"]>(["vigilando", "lista"]);

/** Switch de prender/apagar con el estilo del panel. */
function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <label className={`toggle ${on ? "on" : ""}`}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="toggle-track" aria-hidden="true" />
      {label && <span className="toggle-txt">{label}</span>}
    </label>
  );
}

/** Agregar o editar una moneda de la lista. */
function CoinForm({ edit, choices, holdings, onClose }: {
  edit: Watch | null;
  choices: string[];
  holdings: { asset: string; qty: number }[];
  onClose: () => void;
}) {
  const { state, toast, refresh } = useLive();
  const [asset, setAsset] = useState(edit?.asset ?? holdings[0]?.asset ?? "BTC");
  const [q, setQ] = useState(edit ? String(edit.qty).replace(".", ",") : "");
  const [cost, setCost] = useState(edit ? String(Math.round(edit.cost)) : "");
  const [alert, setAlert] = useState(edit?.alert ?? true);
  const [target, setTarget] = useState(edit?.target ? String(Math.round(edit.target)) : "");
  const [busy, setBusy] = useState(false);
  const held = holdings.find((h) => h.asset === asset);
  // cuánto vale hoy esa cantidad (lo que pagan en P2P), para detectar un costo mal escrito
  const px = state?.p2p?.market[asset]?.SELL?.[0]?.price;
  const nNow = parseQty(q);
  const cNow = parseCop(cost);
  const worth = px && nNow > 0 ? nNow * px : null;
  const off = !!worth && cNow > 0 && (cNow / worth > 1.5 || cNow / worth < 0.5);

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const n = parseQty(q);
    const c = parseCop(cost);
    const t = alert && target ? parseCop(target) : 0;
    if (!(n > 0)) return toast("Escribe cuánto tienes", "Por ejemplo 0,00208382", "bad");
    if (!(c > 0)) return toast("Escribe cuánto te costó", "En pesos, por ejemplo 550.000", "bad");
    if (!(t >= 0)) return toast("La ganancia mínima no es un número", undefined, "bad");
    if (off && worth && !(await ask({
      title: "¿Seguro que eso te costó?",
      body: <>Hoy {amount(asset, n)} vale unos <b>{money(worth, 0)}</b> y pusiste que te costó <b>{money(c, 0)}</b>. Si está bien, guárdalo; si no, revisa la cantidad o el costo.</>,
      confirm: "Sí, está bien", cancel: "Revisar", icon: "alert",
    }))) return;
    setBusy(true);
    try {
      if (edit) await api.updateWatch(edit.id, { asset, qty: n, cost: c, target: t, alert });
      else await api.addWatch(asset, n, c, t, alert);
      toast(edit ? "Moneda actualizada" : "Moneda agregada", alert ? "Te aviso apenas puedas venderla ganando." : "Sin aviso: solo la verás en tu lista.", "good", 3000);
      refresh();
      onClose();
    } catch (err) {
      toast("No se pudo guardar", (err as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={<span className="sheet-title"><Icon name={edit ? "pencil" : "plus"} size={18} /> {edit ? `Editar ${edit.asset}` : "Agregar moneda"}</span>} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-brand" onClick={() => void save()} disabled={busy}><Icon name="check" size={16} /> {busy ? "Guardando…" : edit ? "Guardar" : "Agregar"}</button>
      </>}>
      <form className="nw-form" onSubmit={(e) => void save(e)}>
        {!edit && holdings.length > 0 && (
          <div className="pf-quick">
            <small>De tu Binance</small>
            <div>
              {holdings.map((h) => (
                <button type="button" key={h.asset} className={`chip-toggle ${asset === h.asset ? "on" : ""}`}
                  onClick={() => { setAsset(h.asset); setQ(String(h.qty)); }}>
                  <Coin s={h.asset} size={16} /> {qty(h.qty)} {h.asset}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="form-field"><span>Moneda</span>
          <Select label="Moneda" value={asset} onChange={setAsset} options={coinOptions(choices, holdings)} />
        </div>
        <div className="pf-row">
          <label>¿Cuánto tienes?
            <input type="text" inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value)} placeholder="0,00208382" autoFocus={!edit} />
            {held && <button type="button" className="link-btn nw-max" onClick={() => setQ(String(held.qty))}>Todo: {qty(held.qty)}</button>}
          </label>
          <label><span className="lbl-t">¿Cuánto te costó? <small>en pesos</small></span><input type="text" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="550.000" /></label>
        </div>
        {worth != null && (
          <p className={`pf-worth ${off ? "warn" : ""}`}>
            <Icon name={off ? "alert" : "coins"} size={15} />
            <span>
              Hoy {amount(asset, nNow)} vale ≈ <b>{money(worth, 0)}</b>
              {off ? <> y pusiste que te costó <b>{money(cNow, 0)}</b>: revisa la cantidad o el costo.</> : cNow > 0 ? <> · {signedMoney(worth - cNow)} frente a lo que pagaste</> : null}
            </span>
          </p>
        )}
        <div className={`pf-alert ${alert ? "on" : ""}`}>
          <div>
            <b><Icon name="bellRing" size={16} /> Avisarme cuando gane</b>
            <span className="dim small">Sonido, Windows y Telegram apenas alguien te la compre sin que pierdas.</span>
          </div>
          <Toggle on={alert} onChange={setAlert} label="Avisarme cuando gane" />
        </div>
        {alert && (
          <label className="pf-target"><span className="lbl-t">Ganancia mínima <small>opcional</small></span>
            <input type="text" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0 = avisarme apenas no pierda" />
          </label>
        )}
      </form>
    </Sheet>
  );
}

/** Una moneda de la lista: lo que te dejaría venderla ya, qué tan cerca está, su aviso y el paso a paso. */
function CoinRow({ w, i, onEdit }: { w: Watch; i: number; onEdit: () => void }) {
  const { toast, refresh } = useLive();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const b = w.last?.best;
  const alert = w.alert ?? true;
  const ready = !!b?.ok;
  const unit = b && (isDollar(b.to) ? "dólar" : b.to);
  const pct = b ? Math.min(100, (b.ad.price / b.need_price) * 100) : 0;
  const missing = b ? (b.need_price / b.ad.price - 1) * 100 : 0;
  const toggle = async (on: boolean) => {
    setSaving(true);
    try {
      await api.updateWatch(w.id, { alert: on });
      refresh();
    } catch (e) {
      toast("No se pudo cambiar el aviso", (e as Error).message, "bad");
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!(await ask({ title: `¿Quitar ${w.asset} de tu lista?`, body: "Ya no la seguiré ni te avisaré por ella.", confirm: "Quitar", tone: "danger", icon: "trash" }))) return;
    try {
      await api.deleteWatch(w.id);
      refresh();
    } catch (e) {
      toast("No se pudo quitar", (e as Error).message, "bad");
    }
  };
  return (
    <div className={`crow ${ready ? "ready" : ""} ${ready && alert ? "glow" : ""}`} style={{ animationDelay: `${i * 50}ms` }}>
      <div className="crow-main">
        <div className="crow-coin">
          <span className="wcard-coin"><Coin s={w.asset} size={28} /></span>
          <div>
            <b>{amount(w.asset, w.qty)}</b>
            <small>{COIN_NAMES[w.asset] ?? w.asset}</small>
          </div>
        </div>
        <div className="crow-cell"><small>Te costó</small><b>{money(w.cost, 0)}</b></div>
        <div className="crow-cell crow-now">
          <small>Si vendes ahora</small>
          {b ? <b className={`val ${tone(b.profit)}`}>{signedMoney(b.profit)}</b> : <b className="dim">calculando…</b>}
          {b && b.profit < -0.5 * w.cost && (
            <button className="data-check" onClick={onEdit} title="Pierdes más de la mitad: ¿la cantidad y el costo están bien?">
              <Icon name="alert" size={13} /> ¿Datos bien? Revisar
            </button>
          )}
          {b && <span className="dim">{b.ad.nick} · {money(b.ad.price)}/{unit}</span>}
        </div>
        <div className="crow-cell crow-goal">
          <small>{ready ? (w.target > 0 ? `Ya ganas +${money(w.target, 0)}` : "Ya puedes vender ganando") : b ? `Falta ${num(Math.max(missing, 0), missing < 1 ? 2 : 1)} %` : "Meta"}</small>
          <div className="wprogress-bar"><span style={{ width: `${pct}%` }} /></div>
          {b && <span className="dim">meta {money(b.need_price)}/{unit}</span>}
        </div>
        <div className="crow-alert">
          <Toggle on={alert} onChange={(v) => void toggle(v)} disabled={saving} label={alert ? "Aviso" : "Sin aviso"} />
        </div>
        <div className="crow-actions">
          {b && <button className={`icon-btn ${open ? "on" : ""}`} onClick={() => setOpen(!open)} title="Cómo vender" aria-label="Cómo vender"><Icon name={open ? "chevronUp" : "listChecks"} size={16} /></button>}
          <button className="icon-btn" onClick={onEdit} title="Editar" aria-label={`Editar ${w.asset}`}><Icon name="pencil" size={16} /></button>
          <button className="icon-btn danger" onClick={() => void remove()} title="Quitar" aria-label={`Quitar ${w.asset}`}><Icon name="trash" size={16} /></button>
        </div>
      </div>
      {b && (
        <div className={`wcard-steps ${open ? "open" : ""}`}>
          <div><SellSteps asset={w.asset} qty={w.qty} o={b} /></div>
        </div>
      )}
    </div>
  );
}

export function Sell() {
  const { state } = useLive();
  const holdings = useHoldings();
  const [form, setForm] = useState<{ edit: Watch | null } | null>(null);
  const [past, setPast] = useState(false);
  if (!state) return null;
  const choices = [...new Set([...holdings.map((h) => h.asset), ...state.settings.p2p_assets, "BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "ADA", "TRX", "LTC"])];
  const rows = state.watches ?? [];
  const live = rows.filter((w) => LIVE.has(w.status));
  const ended = rows.filter((w) => !LIVE.has(w.status));
  const ready = live.filter((w) => w.last?.best?.ok).length;
  const total = live.reduce((a, w) => a + (w.last?.best?.profit ?? 0), 0);

  return (
    <div className="stack">
      <section className="card coins">
        <div className="watches-head">
          <div>
            <h2><span className="sec-ico"><Icon name="coins" size={18} /></span> Mis monedas</h2>
            <p className="sub">Lo que tienes, cuánto te costó y cuánto ganas o pierdes si vendes ya · se actualiza solo</p>
          </div>
          <div className="watches-actions">
            {live.length > 0 && (
              <span className={`wstat ${total >= 0 ? "ready" : "loss"}`}>Si vendes todo: {signedMoney(total)}</span>
            )}
            {ready > 0 && <span className="wstat ready"><span className="pulse" /> {ready} para vender ganando</span>}
            <button className="btn btn-brand" onClick={() => setForm({ edit: null })}><Icon name="plus" size={17} /> Agregar</button>
          </div>
        </div>

        {live.length ? (
          <div className="clist">
            <div className="clist-head">
              <span>Moneda</span><span>Te costó</span><span>Si vendes ahora</span><span>Meta</span><span>Aviso</span><span />
            </div>
            {live.map((w, i) => <CoinRow key={w.id} w={w} i={i} onEdit={() => setForm({ edit: w })} />)}
          </div>
        ) : (
          <div className="wempty">
            <span className="wempty-ico"><Icon name="coins" size={28} /></span>
            <b>Agrega las monedas que tienes</b>
            <span className="muted">Pon cuánto tienes y cuánto te costó: te muestro cuánto ganas o pierdes si vendes ya, y si quieres te aviso cuando puedas vender ganando.</span>
            <button className="btn btn-brand" onClick={() => setForm({ edit: null })}><Icon name="plus" size={17} /> Agregar moneda</button>
          </div>
        )}

        {ended.length > 0 && (
          <div className="wpast">
            <button className="link-btn" onClick={() => setPast(!past)}><Icon name="history" size={15} /> Terminadas ({ended.length})</button>
            {past && (
              <ul>
                {ended.map((w) => (
                  <li key={w.id}><Coin s={w.asset} size={18} /> {amount(w.asset, w.qty)} <span className="dim">· te costó {money(w.cost, 0)} · {ENDED[w.status]}</span></li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="note"><Icon name="check" size={14} /><span>Ya con comisiones, redondeo de Binance y 4x1000 sobre la ganancia. Confirma el precio en Binance antes de vender.</span></p>
      </section>
      {form && <CoinForm edit={form.edit} choices={choices} holdings={holdings} onClose={() => setForm(null)} />}
    </div>
  );
}

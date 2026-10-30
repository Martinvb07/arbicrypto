"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { advertiserUrl, COIN_NAMES, copyQty, isDollar, spotUrl } from "@/lib/calc";
import { hhmm, money, num, qty, signedMoney, tone } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { ExitOption, Watch, WatchMove } from "@/lib/types";
import { BlockAd } from "../controls";
import { ask, Select, Sheet } from "../overlay";
import { Asset, Coin, CopyButton, GoButton, Icon, Toggle } from "../ui";

/** Cantidad de cripto: acepta 0,0021 o 0.0021. */
const parseQty = (v: string) => Number(v.trim().replace(/\s/g, "").replace(",", "."));
/** Pesos: acepta 550.000, 550000 o 550.000,50. */
const parseCop = (v: string) => Number(v.trim().replace(/[\s$]/g, "").replace(/\./g, "").replace(",", "."));

const amount = (asset: string, v: number) => (isDollar(asset) ? `${num(v, 2)} dólares (${asset})` : `${qty(v)} ${asset}`);
const amountOf = (asset: string, v: number) => `${isDollar(asset) ? num(v, 2) : qty(v)} ${asset}`;

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
                  {k > 0 && " y luego "}Par <b>{h.symbol}</b>
                </span>
              ))}
              {hops.length > 0 && " · "}orden de <b>Mercado</b>, <b>NO Convertir</b> · te deben llegar mínimo <b>{amount(o.to, o.qty)}</b>
            </div>
            <div className="step-actions">
              {hops.map((h) => <GoButton key={h.symbol} href={spotUrl(h.pair)} icon="swap">Abrir <b>{h.symbol}</b> en Spot</GoButton>)}
              <CopyButton text={copyQty(have, asset)}>Copiar {isDollar(asset) ? num(have, 2) : qty(have)} {asset}</CopyButton>
            </div>
          </div>
        </li>
      )}
      <li>
        <div>
          <div className="step-main">Pasa {amount(o.to, o.qty)} a <b>Fondos</b></div>
          <div className="step-sub">P2P vende desde Fondos · la transferencia es gratis</div>
          <div className="step-actions">
            <GoButton href="https://www.binance.com/es/my/wallet/account/main" icon="wallet">Pasar a Fondos</GoButton>
            <CopyButton text={copyQty(o.qty, o.to)}>Copiar {isDollar(o.to) ? num(o.qty, 2) : qty(o.qty)} {o.to}</CopyButton>
            <BlockAd ad={o.ad} />
          </div>
        </div>
      </li>
      <li>
        <div>
          <div className="step-main">
            Vende a <b>{o.ad.nick}</b> a <b>{money(o.ad.price)}</b> {isDollar(o.to) ? "cada dólar" : `por ${o.to}`}
            <span className="muted"> · recibes {money(o.received, 0)}</span>
          </div>
          <div className="step-sub">
            <span className="muted">({num(o.ad.orders, 0)} órdenes, {num(o.ad.finish * 100, 0)} %)</span> · {o.ad.methods.slice(0, 3).join(", ")} · confirma el precio antes de vender
          </div>
          <div className="step-actions">
            <GoButton href={advertiserUrl(o.ad)} icon="handCoins" strong>Vender {o.to} a <b>{o.ad.nick}</b></GoButton>
            <CopyButton text={copyQty(o.qty, o.to)}>Copiar {isDollar(o.to) ? num(o.qty, 2) : qty(o.qty)} {o.to}</CopyButton>
            <BlockAd ad={o.ad} />
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


const LIVE = new Set<Watch["status"]>(["vigilando", "lista"]);

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
/** Movimientos de la moneda; las anotadas antes del historial muestran al menos su último ajuste. */
function historyOf(w: Watch): WatchMove[] {
  if (w.moves?.length) return w.moves;
  const y = w.synced;
  if (!y) return [];
  const moved = y.before ? Math.abs(y.before.qty - w.qty) : y.qty;
  return [{ t: y.t, kind: y.kind, qty: y.qty, price: y.price, total: y.total, moved,
    cost: y.before ? Math.abs(y.before.cost - w.cost) : undefined, left: w.qty, cost_left: w.cost }];
}

/** Historial al desplegar el ajuste: cómo empezó, cada venta o compra con lo que ganaste, y lo que te queda. */
function CoinHistory({ w, hist, gmf, others, onMove }: { w: Watch; hist: WatchMove[]; gmf: number; others: Watch[]; onMove: (o: Watch) => void }) {
  const sales = hist.filter((m) => m.kind === "vendiste");
  const gainOf = (m: WatchMove) => (m.cost != null && m.total != null ? m.total - m.cost * (1 + gmf) : null);
  // en pesos, tal cual las órdenes de Binance: lo que te entró por ventas menos lo que pagaste (con su 4x1000)
  const received = sales.reduce((a, m) => a + (m.total ?? 0), 0);
  // lo que llegó de un cambio en Spot costó lo que habías pagado por lo que diste
  const paid = ((w.start?.cost ?? 0) + hist.reduce((a, m) => a + (m.kind === "compraste" ? m.total ?? 0 : m.kind === "llego" ? m.cost ?? 0 : 0), 0)) * (1 + gmf);
  const cash = received - paid;
  const soldQty = sales.reduce((a, m) => a + (m.moved ?? m.qty ?? 0), 0);
  const startQty = w.start?.qty ?? (hist[0] && hist[0].kind !== "editaste" ? hist[0].left + (hist[0].kind === "vendiste" || hist[0].kind === "cambiaste" ? 1 : -1) * (hist[0].moved ?? 0) : null);
  const base = startQty != null ? startQty + hist.filter((m) => m.kind === "compraste" || m.kind === "llego").reduce((a, m) => a + (m.moved ?? 0), 0) : 0;
  const soldPct = base > 0 ? Math.min(100, (soldQty / base) * 100) : 0;
  return (
    <div className="chist">
      <div className="chist-head">
        <div className="chist-stat"><small>Vendido</small><b>{num(soldQty, 2)} {w.asset}</b>
          {soldPct > 0 && <span className="chist-bar"><span style={{ width: `${soldPct}%` }} /></span>}</div>
        <div className="chist-stat"><small>Te queda</small><b>{num(w.qty, 2)} {w.asset}</b><span className="dim">costo {money(w.cost * (1 + gmf), 0)}</span></div>
        <div className="chist-stat"><small>Recibiste − pagaste</small><b className={tone(cash)}>{sales.length ? signedMoney(cash) : "—"}</b>
          <span className="dim">{sales.length ? `recibiste ${money(received, 0)} · pagaste ${money(paid, 0)}` : "Aún no vendes"}</span></div>
      </div>
      <ol className="chist-list">
        {[...hist].reverse().map((m, i) => {
          const g = m.kind === "vendiste" ? gainOf(m) : null;
          return (
            <li key={`${m.id ?? ""}${m.t}${i}`} className={`chist-item ${m.kind}`} style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
              <span className="chist-dot"><Icon name={m.kind === "vendiste" ? "handCoins" : m.kind === "compraste" ? "cart" : m.kind === "cambiaste" || m.kind === "llego" ? "swap" : "book"} size={12} /></span>
              <div className="chist-txt">
                <b>{m.kind === "editaste" ? "Lo editaste a mano"
                  : m.kind === "cambiaste" ? `Cambiaste ${amountOf(w.asset, m.qty ?? 0)} por ${amountOf(m.to ?? "", m.got ?? 0)} en Spot`
                  : m.kind === "llego" ? `Te llegaron ${amountOf(w.asset, m.qty ?? 0)} por ${amountOf(m.from ?? "", m.spent ?? 0)} en Spot`
                  : `${m.kind === "vendiste" ? "Vendiste" : "Compraste"} ${num(m.qty ?? 0, 2)} ${w.asset}`}
                  {m.price ? <span className="dim"> a {money(m.price)}</span> : null}</b>
                <small>
                  {hhmm(m.t)} · {new Date(m.t * 1000).toLocaleDateString("es-CO", { day: "numeric", month: "short" }).replace(".", "")}
                  {m.total ? ` · ${m.kind === "vendiste" ? "recibiste" : "pagaste"} ${money(m.total, 0)}` : ""}
                  {(m.kind === "cambiaste" || m.kind === "llego") && m.cost != null ? ` · ${m.kind === "llego" ? "te costó" : "se lleva un costo de"} ${money(m.cost * (1 + gmf), 0)}` : ""}
                  {m.fee ? ` · comisión ${num(m.fee, 2)}` : ""}
                </small>
              </div>
              <div className="chist-right">
                {g != null && <b className={tone(g)} title="Lo que recibiste en esta venta menos lo que costó lo vendido (sin lo que te queda)">{signedMoney(g)}</b>}
                <small>quedan {num(m.left, 2)}</small>
              </div>
            </li>
          );
        })}
        {w.start && w.start.qty > 0 && (
          <li className="chist-item start" style={{ animationDelay: `${Math.min(hist.length, 10) * 40}ms` }}>
            <span className="chist-dot"><Icon name="plus" size={12} /></span>
            <div className="chist-txt">
              <b>La anotaste: {num(w.start.qty, 2)} {w.asset}</b>
              <small>{hhmm(w.start.t)} · {new Date(w.start.t * 1000).toLocaleDateString("es-CO", { day: "numeric", month: "short" }).replace(".", "")} · te costó {money(w.start.cost * (1 + gmf), 0)}</small>
            </div>
            <div className="chist-right"><small>{money(w.start.cost / w.start.qty)}/{isDollar(w.asset) ? "dólar" : w.asset}</small></div>
          </li>
        )}
      </ol>
      {others.length > 0 && (
        <div className="chist-move">
          <span className="dim">¿El último ajuste era de otra fila?</span>
          {others.map((o) => (
            <button key={o.id} className="btn btn-sm" onClick={() => onMove(o)}>
              <Icon name="arrowRight" size={14} /> Pasarlo a la de {amount(o.asset, o.qty)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Mis monedas sigue tus órdenes P2P: lo que cambias en Spot no lo ve. Si lo que tienes en Binance no cuadra, se dice aquí. */
function binanceGap(w: Watch, held: number | null, others: Watch[]) {
  if (held == null || others.length) return null;  // sin cuenta leída, o con varias filas de esa cripto no se sabe de cuál es
  const tol = isDollar(w.asset) ? 0.01 : Math.max(w.qty * 1e-4, 1e-8);
  return Math.abs(held - w.qty) > tol ? held : null;
}

function CoinRow({ w, i, onEdit, others, held }: { w: Watch; i: number; onEdit: () => void; others: Watch[]; held: number | null }) {
  const { state, toast, refresh } = useLive();
  const gmf = state?.settings.gmf ?? 0; // 4x1000 que pagaste al comprar
  const [open, setOpen] = useState(false);
  const [showHist, setShowHist] = useState(false);
  const [saving, setSaving] = useState(false);
  const hist = historyOf(w);
  const last = hist[hist.length - 1];
  const b = w.last?.best;
  const alert = w.alert ?? true;
  const ready = !!b?.ok;
  const unit = b && (isDollar(b.to) ? "dólar" : b.to);
  const pct = b ? Math.min(100, (b.ad.price / b.need_price) * 100) : 0;
  const missing = b ? (b.need_price / b.ad.price - 1) * 100 : 0;
  const move = async (to: Watch) => {
    try {
      await api.moveSync(w.id, to.id);
      toast("Ajuste movido", `Ahora está en la fila de ${amount(to.asset, to.qty)}; esta volvió a como estaba`, "good");
      refresh();
    } catch (e) {
      toast("No se pudo mover", (e as Error).message, "bad");
    }
  };
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
  const real = binanceGap(w, held, others);
  const useBinance = async () => {
    if (real == null) return;
    setSaving(true);
    try {
      await api.updateWatch(w.id, { qty: real });  // lo que pagaste se queda igual: lo que falta se fue en comisiones o cambios
      toast("Listo", `Ahora dice ${amount(w.asset, real)}, como en tu Binance`, "good");
      refresh();
    } catch (e) {
      toast("No se pudo cambiar", (e as Error).message, "bad");
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
          <div className="crow-coin-txt">
            <b>{amount(w.asset, w.qty)}</b>
            <small>{COIN_NAMES[w.asset] ?? w.asset}{w.auto && <span className="dim"> · {hist[0]?.kind === "llego" ? `anotada sola: la cambiaste desde ${hist[0].from} en Spot` : "anotada sola con tu compra"}</span>}</small>
            {(w.synced || hist.length > 0) && (
              <button className={`crow-synced ${last?.kind ?? w.synced?.kind ?? ""} as-btn ${showHist ? "on" : ""}`} onClick={() => setShowHist(!showHist)}
                aria-expanded={showHist} title="Ver el historial de esta moneda">
                <Icon name="refresh" size={10} />
                <span>{last && last.kind !== "editaste" ? `${last.kind === "vendiste" || last.kind === "cambiaste" ? "−" : "+"}${num(last.qty ?? 0, 2)} · ${hhmm(last.t)}` : `${hist.length} movimiento${hist.length === 1 ? "" : "s"}`}</span>
                <Icon name="chevronDown" size={10} className="chev" />
              </button>
            )}
            {real != null && (real > 0 && real < w.qty ? (
              <button className="data-check" onClick={() => void useBinance()} disabled={saving}
                title="En Binance (Spot + Fondos) tienes menos: lo que falta se fue en comisiones o en cambios en Spot. Lo que pagaste se queda igual">
                <Icon name="alert" size={13} /> En Binance tienes {num(real, isDollar(w.asset) ? 2 : 8)} · Usar lo de Binance
              </button>
            ) : (
              <span className="data-check" title="Puede ser de una compra que no está en esta fila: si es de esta, edítala con lo que pagaste">
                <Icon name="alert" size={13} /> {real > 0 ? `En Binance tienes ${num(real, isDollar(w.asset) ? 2 : 8)}` : "En Binance ya no la tienes"}
              </span>
            ))}
          </div>
        </div>
        <div className="crow-cell"><small>Te costó</small><b>{money(w.cost * (1 + gmf), 0)}</b>
          {gmf > 0 && <span className="crow-sub">{money(w.cost, 0)} + 4x1000</span>}</div>
        <div className="crow-cell crow-now">
          <small>Si vendes ahora</small>
          {b ? <b className={`val ${tone(b.profit)}`}>{signedMoney(b.profit)}</b> : <b className="dim">calculando…</b>}
          {b && b.profit < -0.5 * w.cost && (
            <button className="data-check" onClick={onEdit} title="Pierdes más de la mitad: ¿la cantidad y el costo están bien?">
              <Icon name="alert" size={13} /> ¿Datos bien? Revisar
            </button>
          )}
          {b && <span className="dim">{b.ad.nick} · {money(b.ad.price)}/{unit}</span>}
          {w.last?.partial?.ok && (
            <a className="crow-partial" href={advertiserUrl(w.last.partial.ad)} target="_blank" rel="noopener noreferrer"
              title={`${w.last.partial.ad.nick} compra entre ${money(w.last.partial.ad.min, 0)} y ${money(w.last.partial.ad.max, 0)}: no te recibe todo, pero una parte sí`}>
              <Icon name="sparkle" size={12} />
              <span>Parte {num(w.last.partial.qty, 2)}<span className="hide-sm"> a {money(w.last.partial.ad.price)}</span> → <b>{signedMoney(w.last.partial.profit)}</b></span>
            </a>
          )}
        </div>
        <div className="crow-cell crow-goal">
          <small>{ready ? (w.target > 0 ? `Ya ganas +${money(w.target, 0)}` : "Ya puedes vender ganando") : b ? `Falta ${num(Math.max(missing, 0), missing < 1 ? 2 : 1)} %` : "Meta"}</small>
          <div className="wprogress-bar"><span style={{ width: `${pct}%` }} /></div>
          {b && b.even_price != null && <span className="crow-even">Para no perder: vende a <b>{money(b.even_price)}</b>/{unit} o más</span>}
          {b && (w.target > 0 || b.even_price == null) && <span className="dim">meta {money(b.need_price)}/{unit}</span>}
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
      {hist.length > 0 && (
        <div className={`wcard-steps crow-hist-wrap ${showHist ? "open" : ""}`}>
          <div><CoinHistory w={w} hist={hist} gmf={gmf} others={w.synced?.before ? others : []} onMove={(o) => void move(o)} /></div>
        </div>
      )}
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
  if (!state) return null;
  const choices = [...new Set([...holdings.map((h) => h.asset), ...state.settings.p2p_assets, "BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "ADA", "TRX", "LTC"])];
  const rows = state.watches ?? [];
  const live = rows.filter((w) => LIVE.has(w.status));
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
            {live.map((w, i) => <CoinRow key={w.id} w={w} i={i} onEdit={() => setForm({ edit: w })}
              held={state.account ? holdings.find((h) => h.asset === w.asset)?.qty ?? 0 : null}
              others={live.filter((x) => x.id !== w.id && x.asset === w.asset)} />)}
          </div>
        ) : (
          <div className="wempty">
            <span className="wempty-ico"><Icon name="coins" size={28} /></span>
            <b>Agrega las monedas que tienes</b>
            <span className="muted">Pon cuánto tienes y cuánto te costó: te muestro cuánto ganas o pierdes si vendes ya, y si quieres te aviso cuando puedas vender ganando.</span>
            <button className="btn btn-brand" onClick={() => setForm({ edit: null })}><Icon name="plus" size={17} /> Agregar moneda</button>
          </div>
        )}

        <p className="note"><Icon name="check" size={14} /><span>Ya con comisiones, redondeo de Binance y el 4x1000 que pagaste al comprar (0,4 % de lo que te costó). Confirma el precio en Binance antes de vender.</span></p>
      </section>
      {form && <CoinForm edit={form.edit} choices={choices} holdings={holdings} onClose={() => setForm(null)} />}
    </div>
  );
}

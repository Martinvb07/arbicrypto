"use client";

import { useState, type CSSProperties } from "react";
import { api } from "@/lib/api";
import { advertiserUrl, COIN_NAMES, isDollar, paysWith, takesCapital } from "@/lib/calc";
import { money, num, pctPlain } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { Ad, PriceAlert, Side, State } from "@/lib/types";
import { ask, Select, Sheet } from "../overlay";
import { Ago, Coin, GoButton, Icon, Segmented, Toggle } from "../ui";

/** Pesos: acepta 3.850, 3850 o 3.850,50. */
const parseCop = (v: string) => Number(v.trim().replace(/[\s$]/g, "").replace(/\./g, "").replace(",", "."));
const unitOf = (asset: string) => (isDollar(asset) ? "por dólar" : `por ${asset}`);

/** El precio que hoy vale para la alerta: el mejor anuncio de ese lado (si mine, solo los que aceptan tu capital y medios). */
function bestFor(s: State, asset: string, side: Side, mine: boolean): Ad | undefined {
  const ads = s.p2p?.market[asset]?.[side] ?? [];
  const methods = (side === "BUY" ? s.settings.pay_methods : s.settings.recv_methods) ?? [];
  return mine ? ads.find((a) => takesCapital(a, s.settings.capital) && paysWith(a, methods)) : ads[0];
}

/** Qué tan cerca está el precio de la meta: 100 % = ya llegó. */
function progress(side: Side, now: number | undefined, target: number) {
  if (!now) return { pct: 0, gap: null as number | null, hit: false };
  const gap = side === "BUY" ? now / target - 1 : 1 - now / target; // cuánto falta (positivo) o cuánto pasó (negativo)
  return { pct: Math.max(0, Math.min(100, 100 - gap * 100 * 20)), gap, hit: gap <= 0 };
}

// ---------------------------------------------------------------- formulario

function AlertForm({ s, edit, asset0, onClose }: { s: State; edit: PriceAlert | null; asset0: string; onClose: () => void }) {
  const { toast, refresh } = useLive();
  const [asset, setAsset] = useState(edit?.asset ?? asset0);
  const [side, setSide] = useState<Side>(edit?.side ?? "BUY");
  const [mine, setMine] = useState(edit?.mine ?? true);
  const [once, setOnce] = useState(edit?.once ?? false);
  const now = bestFor(s, asset, side, mine)?.price;
  const [target, setTarget] = useState(edit ? String(edit.target).replace(".", ",") : "");
  const [busy, setBusy] = useState(false);
  const t = parseCop(target);
  const steps = [0.002, 0.005, 0.01, 0.02];
  const suggest = (k: number) => {
    if (!now) return;
    const v = side === "BUY" ? now * (1 - k) : now * (1 + k);
    setTarget(String(Math.round(v * 100) / 100).replace(".", ","));
  };
  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!(t > 0)) return toast("Escribe el precio", `Por ejemplo ${now ? money(now) : "3.850"}`, "bad");
    setBusy(true);
    try {
      if (edit) await api.updatePriceAlert(edit.id, { asset, side, target: t, mine, once });
      else await api.addPriceAlert({ asset, side, target: t, mine, once });
      toast(edit ? "Alerta actualizada" : "Alerta creada",
        `Te aviso cuando ${side === "BUY" ? "comprar" : "vender"} ${asset} ${side === "BUY" ? "cueste" : "pague"} ${money(t)} ${side === "BUY" ? "o menos" : "o más"}.`, "good", 3500);
      refresh();
      onClose();
    } catch (err) {
      toast("No se pudo guardar", (err as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const ahead = now && t > 0 ? (side === "BUY" ? t >= now : t <= now) : false;

  return (
    <Sheet title={<span className="sheet-title"><Icon name={edit ? "pencil" : "bellPlus"} size={18} /> {edit ? "Editar alerta" : "Nueva alerta de precio"}</span>} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-brand" onClick={() => void save()} disabled={busy}><Icon name="check" size={16} /> {busy ? "Guardando…" : edit ? "Guardar" : "Crear alerta"}</button>
      </>}>
      <form className="nw-form pa-form" onSubmit={(e) => void save(e)}>
        <div className="form-field"><span>Cripto</span>
          <Select label="Cripto" value={asset} onChange={setAsset} options={s.settings.p2p_assets.map((a) => ({
            value: a, search: `${a} ${COIN_NAMES[a] ?? ""}`, icon: <Coin s={a} size={22} />,
            label: <span className="opt-coin"><b>{a}</b><small>{COIN_NAMES[a] ?? ""}</small></span>,
            hint: money(bestFor(s, a, side, mine)?.price),
          }))} />
        </div>
        <div className="form-field"><span>Avísame cuando</span>
          <Segmented label="Lado" value={side} onChange={setSide}
            options={[["BUY", <span key="b" className="mkt-switch-opt"><Icon name="cart" size={15} />Comprar esté barato</span>],
              ["SELL", <span key="s" className="mkt-switch-opt"><Icon name="handCoins" size={15} />Vender pague bien</span>]] as const} />
        </div>
        <label className="form-field"><span>{side === "BUY" ? "Precio máximo para comprar" : "Precio mínimo para vender"} <small className="dim">{unitOf(asset)}</small></span>
          <span className="mc-input big"><span>$</span><input type="text" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={now ? num(now, 2) : "3.850"} autoFocus={!edit} /></span>
        </label>
        {now && (
          <div className="pa-suggest">
            <small>Hoy: <b>{money(now)}</b> · ponla</small>
            {steps.map((k) => (
              <button key={k} type="button" className="chip-toggle" onClick={() => suggest(k)}>{side === "BUY" ? "−" : "+"}{pctPlain(k, k < 0.01 ? 1 : 0)}</button>
            ))}
          </div>
        )}
        {ahead && <p className="pf-worth"><Icon name="info" size={15} /><span>Ese precio ya está disponible: te avisará apenas guardes.</span></p>}
        <div className={`pf-alert ${mine ? "on" : ""}`}>
          <div>
            <b><Icon name="wallet" size={16} /> Solo con mi capital</b>
            <span className="dim small">Solo cuentan anuncios que aceptan {money(s.settings.capital, 0)} y tus medios de pago.</span>
          </div>
          <Toggle on={mine} onChange={setMine} label="Solo con mi capital" />
        </div>
        <div className={`pf-alert ${once ? "on" : ""}`}>
          <div>
            <b><Icon name="bell" size={16} /> Avisar una sola vez</b>
            <span className="dim small">Si está apagado, avisa con cada anuncio que llegue a tu meta (también promociones).</span>
          </div>
          <Toggle on={once} onChange={setOnce} label="Avisar una sola vez" />
        </div>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------- una alerta

function AlertRow({ a, s, i, onEdit }: { a: PriceAlert; s: State; i: number; onEdit: () => void }) {
  const { toast, refresh } = useLive();
  const [saving, setSaving] = useState(false);
  const ad = bestFor(s, a.asset, a.side, a.mine);
  const now = ad?.price ?? a.last?.price ?? undefined;
  const p = progress(a.side, now, a.target);
  const buy = a.side === "BUY";
  const flip = async (on: boolean) => {
    setSaving(true);
    try {
      await api.updatePriceAlert(a.id, { on });
      refresh();
    } catch (e) {
      toast("No se pudo cambiar", (e as Error).message, "bad");
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!(await ask({ title: `¿Borrar la alerta de ${a.asset}?`, body: "Ya no te avisaré por este precio.", confirm: "Borrar", tone: "danger", icon: "trash" }))) return;
    try {
      await api.deletePriceAlert(a.id);
      refresh();
    } catch (e) {
      toast("No se pudo borrar", (e as Error).message, "bad");
    }
  };
  return (
    <div className={`pa-row ${p.hit && a.on ? "hit" : ""} ${a.on ? "" : "off"}`} style={{ ["--i" as string]: i } as CSSProperties}>
      <div className="pa-coin">
        <span className="wcard-coin"><Coin s={a.asset} size={28} /></span>
        <div>
          <b>{buy ? "Comprar" : "Vender"} {a.asset}</b>
          <small>a {money(a.target)} {buy ? "o menos" : "o más"}</small>
        </div>
      </div>
      <div className="pa-cell">
        <small>Hoy {a.mine ? "con tu capital" : "(cualquier monto)"}</small>
        <b>{now ? money(now) : "—"}</b>
        {ad && <span className="dim">{ad.nick}</span>}
      </div>
      <div className="pa-cell pa-goal">
        <small>{p.hit ? "¡Ya llegó!" : p.gap != null ? `Falta ${num(p.gap * 100, p.gap < 0.01 ? 2 : 1)} %` : "Sin anuncios"}</small>
        <div className="wprogress-bar"><span style={{ width: `${p.pct}%` }} /></div>
        <span className="dim">{a.hits ? <>avisó {a.hits} {a.hits === 1 ? "vez" : "veces"}{a.last_hit ? <> · <Ago t={a.last_hit} /></> : null}</> : a.once ? "avisa una vez" : "avisa con cada anuncio que llegue"}</span>
      </div>
      <div className="pa-tags">
        {a.mine && <span className="badge brand"><Icon name="wallet" size={12} /> Mi capital</span>}
        {p.hit && a.on && ad && (
          <GoButton href={advertiserUrl(ad)} icon={buy ? "cart" : "handCoins"} strong>{buy ? "Comprar" : "Vender"}</GoButton>
        )}
      </div>
      <div className="pa-actions">
        <Toggle on={a.on} onChange={(v) => void flip(v)} disabled={saving} label={a.on ? "Activa" : "Pausada"} />
        <button className="icon-btn" onClick={onEdit} title="Editar" aria-label={`Editar alerta de ${a.asset}`}><Icon name="pencil" size={16} /></button>
        <button className="icon-btn danger" onClick={() => void remove()} title="Borrar" aria-label={`Borrar alerta de ${a.asset}`}><Icon name="trash" size={16} /></button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- lista

export function PriceAlerts({ s, asset }: { s: State; asset: string }) {
  const [form, setForm] = useState<{ edit: PriceAlert | null } | null>(null);
  const rows = s.price_alerts ?? [];
  const live = rows.filter((a) => a.on);
  const hits = live.filter((a) => progress(a.side, bestFor(s, a.asset, a.side, a.mine)?.price, a.target).hit).length;
  const buyNow = bestFor(s, asset, "BUY", true)?.price;
  const sellNow = bestFor(s, asset, "SELL", true)?.price;

  return (
    <section className="card pa">
      <div className="watches-head">
        <div>
          <h2><span className="sec-ico"><Icon name="bellRing" size={18} /></span> Alertas de precio</h2>
          <p className="sub">Te aviso con sonido, notificación y Telegram cuando comprar esté barato o vender pague bien</p>
        </div>
        <div className="watches-actions">
          {hits > 0 && <span className="wstat ready"><span className="pulse" /> {hits} {hits === 1 ? "llegó" : "llegaron"} a tu precio</span>}
          {live.length > 0 && <span className="wstat">{live.length} {live.length === 1 ? "activa" : "activas"}</span>}
          <button className="btn btn-brand" onClick={() => setForm({ edit: null })}><Icon name="plus" size={17} /> Nueva alerta</button>
        </div>
      </div>

      <div className="pa-now">
        <Coin s={asset} size={22} />
        <span>{asset} hoy con tu capital:</span>
        <span className="pa-now-p buy"><Icon name="cart" size={14} /> comprar <b>{money(buyNow)}</b></span>
        <span className="pa-now-p sell"><Icon name="handCoins" size={14} /> vender <b>{money(sellNow)}</b></span>
      </div>

      {rows.length ? (
        <div className="pa-list">
          {rows.map((a, i) => <AlertRow key={a.id} a={a} s={s} i={i} onEdit={() => setForm({ edit: a })} />)}
        </div>
      ) : (
        <div className="wempty">
          <span className="wempty-ico"><Icon name="bellRing" size={28} /></span>
          <b>Pon tu primera alerta</b>
          <span className="muted">Por ejemplo: avísame cuando comprar USDT con mi capital cueste {buyNow ? money(Math.floor(buyNow * 0.995)) : "$3.850"} o menos.</span>
          <button className="btn btn-brand" onClick={() => setForm({ edit: null })}><Icon name="bellPlus" size={17} /> Crear alerta</button>
        </div>
      )}
      <p className="note"><Icon name="info" size={14} /><span>Se revisa en cada escaneo de P2P. Suena con cada anunciante que llegue a tu meta o la mejore, también si sale una promoción mientras el precio ya estaba ahí. Confirma el precio en Binance antes de pagar.</span></p>
      {form && <AlertForm s={s} edit={form.edit} asset0={asset} onClose={() => setForm(null)} />}
    </section>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { advertiserUrl, bestDeal, COIN_NAMES, dayStats, effBuy, GOOD_FINISH, GOOD_ORDERS, isDollar, paysWith, perDollar, roundTrip, series, takesCapital } from "@/lib/calc";
import { money, num, pct, pctPlain, perUsd, qty, signedMoney, tone } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { Ad, P2PStep, Route, Side, State } from "@/lib/types";
import { DealSteps, p2pRow, RouteStatus, Steps } from "./Home";
import { PriceAlerts } from "./PriceAlerts";
import { PriceChart } from "../PriceChart";
import { Sheet } from "../overlay";
import { Ago, Coin, EmptyBox, ExtLink, GoButton, Icon, Segmented, Skeleton, Toggle, Usd, type IconName } from "../ui";
import { CapitalField } from "../controls";

// Verde: precio casi igual al mejor y anunciante confiable. Rojo: lo contrario.
const NEAR_BEST = 0.001; // hasta 0,1 % peor que el mejor precio (unos $3 por dólar)

function judge(ad: Ad, best: number, side: Side, s: State) {
  const gap = Math.max(0, side === "BUY" ? ad.price / best - 1 : 1 - ad.price / best);
  const usd = perDollar(gap, s);
  const ordersOk = ad.orders >= GOOD_ORDERS;
  const finishOk = ad.finish >= GOOD_FINISH;
  const priceOk = gap <= NEAR_BEST;
  let label: string;
  if (gap === 0) label = "Mejor precio";
  else label = `${side === "BUY" ? "Pagas" : "Recibes"} ${perUsd(usd).replace(/^[+−]/, "")} ${side === "BUY" ? "más" : "menos"} por dólar`;
  if (priceOk && !finishOk) label = "Cancela seguido";
  else if (priceOk && !ordersOk) label = "Pocas órdenes";
  return { good: priceOk && ordersOk && finishOk, priceOk, ordersOk, finishOk, label };
}

/** Cada cuánto se revisa el P2P, en palabras. */
const every = (sec: number) => (sec >= 60 ? `${num(sec / 60, sec % 60 ? 1 : 0)} min` : `${sec} s`);

/** Medios de un lado: los de pago al comprar, los de recibir al vender. */
const methodsFor = (s: State, side: Side) => (side === "BUY" ? s.settings.pay_methods : s.settings.recv_methods) ?? [];

/** ¿Este anuncio sirve con MI capital y MIS medios? */
const forMe = (ad: Ad, s: State, side: Side) => takesCapital(ad, s.settings.capital) && paysWith(ad, methodsFor(s, side));

type View = "mine" | "all" | "alerts";

// ---------------------------------------------------------------- selector de moneda

/** Fichas de monedas que se deslizan de lado en celular; los bordes se difuminan cuando hay más. */
export function CoinPicker({ assets, value, onChange, badge }: { assets: string[]; value: string; onChange: (a: string) => void; badge?: (a: string) => ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ l: false, r: false });

  const measure = () => {
    const el = box.current;
    if (!el) return;
    setFade({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // la moneda elegida siempre a la vista
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(".mkt-coin.on");
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [value]);

  return (
    <div className={`mkt-coins ${fade.l ? "fade-l" : ""} ${fade.r ? "fade-r" : ""}`}>
      <div className="mkt-coins-in" ref={box} onScroll={measure} role="radiogroup" aria-label="Moneda">
        {assets.map((a) => (
          <button key={a} type="button" role="radio" aria-checked={a === value} className={`mkt-coin ${a === value ? "on" : ""}`}
            onClick={() => onChange(a)} title={COIN_NAMES[a] ?? a}>
            <Coin s={a} size={26} />
            <span className="mkt-coin-txt">
              <b>{a}</b>
              <small>{COIN_NAMES[a] ?? "Cripto"}</small>
            </span>
            {badge?.(a)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- indicadores

function Kpi({ icon, kind, label, value, hint, i }: { icon: IconName; kind: string; label: string; value: ReactNode; hint?: ReactNode; i: number }) {
  return (
    <div className={`mkt-kpi ${kind}`} style={{ ["--i" as string]: i } as CSSProperties}>
      <div className="mkt-kpi-top">
        <span className="mkt-kpi-ico"><Icon name={icon} size={17} /></span>
        <small>{label}</small>
      </div>
      <div className="mkt-kpi-val">{value}</div>
      {hint && <div className="mkt-kpi-hint">{hint}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- mis costos y mis medios

const TAX_STEPS = [0, 0.19, 0.28, 0.33, 0.35, 0.37, 0.39];
const parseNum = (v: string) => Number(v.trim().replace(/[\s$%]/g, "").replace(/\./g, "").replace(",", "."));
const parsePct = (v: string) => Number(v.trim().replace(/[\s%]/g, "").replace(",", ".")) / 100;

/** Comisión P2P, transferencia del banco y renta: lo que no sale en el anuncio pero sí de tu bolsillo. */
function CostsSheet({ s, onClose }: { s: State; onClose: () => void }) {
  const { saveSettings, toast } = useLive();
  const st = s.settings;
  const [auto, setAuto] = useState(st.taker_fee < 0);
  const [fee, setFee] = useState(st.taker_fee >= 0 ? num(st.taker_fee * 100, 2) : "");
  const [bank, setBank] = useState(st.bank_fee ? String(Math.round(st.bank_fee)) : "");
  const [tax, setTax] = useState(st.tax);
  const [gmf, setGmf] = useState(st.gmf > 0);
  const [busy, setBusy] = useState(false);
  const feeNow = auto ? s.p2p_fee_auto ?? 0 : parsePct(fee || "0");
  const bankNow = parseNum(bank || "0");
  // ejemplo en vivo con tu capital: comprar y vender ya la misma cripto con 0,8 % de diferencia
  const cap = st.capital;
  const sample = (() => {
    const gross = cap * 1.008 * (1 - feeNow) ** 2;
    const g = gmf ? cap * 0.004 : 0;
    const before = gross - cap - g - (bankNow || 0);
    const t = Math.max(before, 0) * tax;
    return { feeCost: cap * 1.008 - gross, g, bank: bankNow || 0, t, net: before - t };
  })();

  const save = async () => {
    if (!auto && !(feeNow >= 0 && feeNow <= 0.02)) return toast("Revisa la comisión", "Entre 0 % y 2 %.", "bad");
    if (!(bankNow >= 0 && bankNow <= 100000)) return toast("Revisa la transferencia", "Entre $0 y $100.000.", "bad");
    setBusy(true);
    const ok = await saveSettings({ taker_fee: auto ? -1 : feeNow, bank_fee: bankNow || 0, tax, gmf: gmf ? 0.004 : 0 });
    setBusy(false);
    if (ok) {
      toast("Costos guardados", "Rutas, avisos y precios ya se calculan con tus costos reales.", "good", 3000);
      onClose();
    }
  };

  return (
    <Sheet title={<span className="sheet-title"><Icon name="receipt" size={18} /> Mis costos</span>} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-brand" onClick={() => void save()} disabled={busy}><Icon name="check" size={16} /> {busy ? "Guardando…" : "Guardar"}</button>
      </>}>
      <div className="mc-form">
        <section className="mc-block">
          <header><span className="mc-ico"><Icon name="percent" size={16} /></span><div><b>Comisión P2P de Binance</b><small>Al tomar el anuncio de otro, al comprar y al vender</small></div></header>
          <Segmented label="Comisión P2P" value={auto ? "auto" : "manual"} onChange={(v) => setAuto(v === "auto")}
            options={[["auto", `Automática · ${pctPlain(s.p2p_fee_auto ?? 0, 2)}`], ["manual", "La pongo yo"]] as const} />
          {auto ? (
            <p className="dim small">Sale de las órdenes de las cuentas conectadas en Mi Binance. Si nadie ha conectado, es 0 %.</p>
          ) : (
            <label className="mc-input"><input type="text" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0,1" autoFocus /><span>%</span></label>
          )}
        </section>

        <section className="mc-block">
          <header><span className="mc-ico"><Icon name="bank" size={16} /></span><div><b>Transferencia de tu banco</b><small>Lo que te cobran por cada pago al vendedor (vacío = gratis)</small></div></header>
          <label className="mc-input"><span>$</span><input type="text" inputMode="numeric" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="0" /></label>
          <div className="mc-chips">
            {[0, 2000, 4500, 7500].map((v) => (
              <button key={v} type="button" className={`chip-toggle ${bankNow === v ? "on" : ""}`} onClick={() => setBank(v ? String(v) : "")}>{v ? money(v, 0) : "Gratis"}</button>
            ))}
          </div>
        </section>

        <section className="mc-block">
          <header><span className="mc-ico"><Icon name="receipt" size={16} /></span><div><b>Impuesto de renta</b><small>Sobre lo que ganas (si pierdes, no se cobra)</small></div></header>
          <div className="mc-chips">
            {TAX_STEPS.map((t) => (
              <button key={t} type="button" className={`chip-toggle ${Math.abs(tax - t) < 1e-6 ? "on" : ""}`} onClick={() => setTax(t)}>{pctPlain(t, 0)}</button>
            ))}
          </div>
        </section>

        <section className="mc-block row">
          <header><span className="mc-ico"><Icon name="card" size={16} /></span><div><b>4x1000</b><small>0,4 % de cada pago al vendedor</small></div></header>
          <Toggle on={gmf} onChange={setGmf} label={gmf ? "Lo pago" : "Exento"} />
        </section>

        <div className="mc-sample">
          <small>Ejemplo con {money(cap, 0)} y una diferencia de 0,8 % entre compra y venta</small>
          <div className="breakdown">
            <div><small>Antes de costos</small><b>{signedMoney(cap * 0.008)}</b></div>
            {sample.feeCost >= 0.5 && <div className="cost"><small>Comisión P2P</small><b>−{money(sample.feeCost, 0)}</b></div>}
            {sample.g >= 0.5 && <div className="cost"><small>4x1000</small><b>−{money(sample.g, 0)}</b></div>}
            {sample.bank >= 0.5 && <div className="cost"><small>Transferencia</small><b>−{money(sample.bank, 0)}</b></div>}
            {sample.t >= 0.5 && <div className="cost"><small>Renta</small><b>−{money(sample.t, 0)}</b></div>}
            <div className="net"><small>Te queda</small><b className={`val ${tone(sample.net)}`}>{signedMoney(sample.net)}</b></div>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/** Todos los medios de pago que aparecen hoy en los anuncios, más los que ya elegiste. */
function allMethods(s: State) {
  const seen = new Map<string, number>();
  for (const m of Object.values(s.p2p?.market ?? {})) {
    for (const ad of [...m.BUY, ...m.SELL]) for (const x of ad.methods) seen.set(x, (seen.get(x) ?? 0) + 1);
  }
  for (const x of [...(s.settings.pay_methods ?? []), ...(s.settings.recv_methods ?? [])]) if (!seen.has(x)) seen.set(x, 0);
  return [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([x]) => x);
}

function MethodPick({ title, sub, icon, all, value, onChange }: { title: string; sub: string; icon: IconName; all: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const flip = (m: string) => onChange(value.includes(m) ? value.filter((x) => x !== m) : [...value, m]);
  return (
    <section className="mc-block">
      <header>
        <span className="mc-ico"><Icon name={icon} size={16} /></span>
        <div><b>{title}</b><small>{sub}</small></div>
        <button type="button" className={`chip-toggle mc-all ${value.length ? "" : "on"}`} onClick={() => onChange([])}>Todos</button>
      </header>
      <div className="mc-chips">
        {all.map((m) => (
          <button key={m} type="button" className={`chip-toggle ${value.includes(m) ? "on" : ""}`} onClick={() => flip(m)} aria-pressed={value.includes(m)}>
            {value.includes(m) && <Icon name="check" size={13} />}{m}
          </button>
        ))}
        {!all.length && <span className="dim small">Aún no hay anuncios cargados.</span>}
      </div>
    </section>
  );
}

/** Con qué pagas al comprar y por dónde recibes al vender: solo se usan anuncios con esos medios. */
function MethodsSheet({ s, onClose }: { s: State; onClose: () => void }) {
  const { saveSettings, toast } = useLive();
  const all = useMemo(() => allMethods(s), [s]);
  const [pay, setPay] = useState<string[]>(s.settings.pay_methods ?? []);
  const [recv, setRecv] = useState<string[]>(s.settings.recv_methods ?? []);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const ok = await saveSettings({ pay_methods: pay, recv_methods: recv });
    setBusy(false);
    if (ok) {
      toast("Medios guardados", pay.length || recv.length ? "Solo verás rutas y avisos con anuncios que aceptan tus medios." : "Se usan anuncios con cualquier medio.", "good", 3000);
      onClose();
    }
  };
  return (
    <Sheet title={<span className="sheet-title"><Icon name="card" size={18} /> Mis medios de pago</span>} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-brand" onClick={() => void save()} disabled={busy}><Icon name="check" size={16} /> {busy ? "Guardando…" : "Guardar"}</button>
      </>}>
      <div className="mc-form">
        <MethodPick title="Pago con" sub="Al comprar: cómo le pagas al vendedor" icon="cart" all={all} value={pay} onChange={setPay} />
        <MethodPick title="Recibo en" sub="Al vender: dónde te pueden pagar" icon="handCoins" all={all} value={recv} onChange={setRecv} />
        <p className="dim small"><Icon name="info" size={13} /> Sin elegir ninguno se usan todos. Las rutas de Inicio y los avisos también usan estos medios.</p>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- libro: dividido o un lado a la vez

/** Cómo se ve el libro: comprar a la izquierda y vender a la derecha, o un lado a la vez. Se recuerda en este navegador. */
function LayoutPick() {
  const { prefs, setPrefs } = useLive();
  return (
    <Segmented label="Vista del libro" value={prefs.split ? "split" : "one"} onChange={(v) => setPrefs({ split: v === "split" })}
      options={[["split", <span key="d" className="mkt-switch-opt" title="Comprar a la izquierda, vender a la derecha"><Icon name="columns" size={15} />Dividido</span>],
        ["one", <span key="u" className="mkt-switch-opt" title="Un lado a la vez"><Icon name="square" size={15} />Uno a la vez</span>]] as const} />
  );
}

/** Las dos columnas del libro (comprar y vender). Dividido: lado a lado en cualquier pantalla; si no, solo el lado elegido. */
function Book({ s, asset, ads, empty, extra }: {
  s: State; asset: string; ads: Record<Side, Ad[]>; empty: (k: Side) => ReactNode; extra?: ReactNode;
}) {
  const { prefs } = useLive();
  const [view, setView] = useState<Side>("BUY");
  const m = s.p2p?.market[asset];
  const split = prefs.split;
  return (
    <>
      <div className="mkt-book-tools">
        <LayoutPick />
        {!split && (
          <Segmented label="Lado del libro" value={view} onChange={setView}
            options={[["BUY", <span key="b" className="mkt-switch-opt"><Icon name="cart" size={15} />Comprar · {ads.BUY.length}</span>],
              ["SELL", <span key="s" className="mkt-switch-opt"><Icon name="handCoins" size={15} />Vender · {ads.SELL.length}</span>]] as const} />
        )}
        {extra}
      </div>
      <div className={`book ${split ? "split" : "one"}`}>
        {(["BUY", "SELL"] as const).filter((k) => split || k === view).map((k) => {
          const best = m?.[k][0]?.price;
          const list = ads[k];
          return (
            <div key={k} className={`mkt-col ${k}`}>
              <header className="mkt-col-head">
                <span className={`mkt-col-ico ${k}`}><Icon name={k === "BUY" ? "cart" : "handCoins"} /></span>
                <div>
                  <h3>{k === "BUY" ? `Comprar ${asset}` : `Vender ${asset}`}</h3>
                  <p className="sub">{k === "BUY" ? "Te venden · más bajo es mejor" : "Te compran · más alto es mejor"}</p>
                </div>
                <span className="mkt-count">{list.length} {list.length === 1 ? "anuncio" : "anuncios"}</span>
              </header>
              <div className="mkt-ads" key={`${asset}-${k}-${list.length}`}>
                {list.length && best ? list.map((ad, i) => <AdRow key={`${ad.nick}-${i}`} ad={ad} asset={asset} best={best} side={k} s={s} i={i} />) : empty(k)}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- con mi capital

/** Ruta directa de tu capital: comprar y vender la misma cripto en P2P (la calcula el servidor con tus costos y medios). */
const directRoute = (s: State, asset: string) => s.p2p?.routes?.find((r) => r.id === `${asset}>${asset}`);

/** Desglose de lo que pagas, en qué se va y cuánto te queda con tu capital. */
function Breakdown({ r }: { r: Route }) {
  const c = r.costs;
  const parts: [string, number | undefined][] = [["Comisión P2P", c.p2p_fee], ["4x1000", c.gmf], ["Transferencia", c.bank], ["Renta", c.tax]];
  return (
    <div className="breakdown mine-break">
      <div><small>Pagas</small><b>{money(r.paid, 0)}</b></div>
      <div><small>Recibes</small><b>{money(r.received, 0)}</b></div>
      {parts.filter(([, v]) => (v ?? 0) >= 0.5).map(([k, v]) => <div key={k} className="cost"><small>{k}</small><b>−{money(v, 0)}</b></div>)}
      <div className="net"><small>Te queda</small><b className={`val ${tone(r.profit_fiat)}`}>{signedMoney(r.profit_fiat)}</b></div>
    </div>
  );
}

/** El mejor anuncio de un lado para mí, en una tarjeta compacta. */
function MineSide({ side, ad, asset, s, qtyHint }: { side: Side; ad: Ad | undefined; asset: string; s: State; qtyHint?: number }) {
  const buy = side === "BUY";
  const unit = isDollar(asset) ? "por dólar" : `por ${asset}`;
  return (
    <div className={`mine-side ${side}`}>
      <div className="mine-side-top">
        <span className={`mkt-col-ico ${side}`}><Icon name={buy ? "cart" : "handCoins"} size={17} /></span>
        <div>
          <small>{buy ? "Le compras a" : "Le vendes a"}</small>
          <b>{ad ? <ExtLink href={advertiserUrl(ad)}>{ad.nick}</ExtLink> : "Nadie acepta tu capital"}</b>
        </div>
      </div>
      {ad ? (
        <>
          <div className="mine-side-price">{money(ad.price)} <small>{unit}</small></div>
          <div className="mine-side-meta">
            <span>{num(ad.orders, 0)} órdenes · {num(ad.finish * 100, 0)} %</span>
            <span>{money(ad.min, 0)} – {money(ad.max, 0)}</span>
          </div>
          <div className="ad-methods">{ad.methods.slice(0, 4).map((m) => <span key={m} className={`tag ${methodsFor(s, side).includes(m) ? "mine" : ""}`}>{m}</span>)}</div>
          <GoButton href={advertiserUrl(ad)} icon={buy ? "cart" : "handCoins"} strong
            title={`Abre el perfil de ${ad.nick} en Binance P2P`}>
            {buy ? `Comprar${qtyHint ? ` ${isDollar(asset) ? num(qtyHint, 2) : qty(qtyHint)}` : ""}` : "Vender"} {asset}
          </GoButton>
        </>
      ) : (
        <p className="dim small">Prueba con otro capital o agrega más medios de pago.</p>
      )}
    </div>
  );
}

/** Lo que de verdad pasa con TU capital y TUS medios: el mejor par, el desglose y las demás criptos. */
function MineView({ s, asset, onCoin }: { s: State; asset: string; onCoin: (a: string) => void }) {
  const m = s.p2p?.market[asset];
  const r = directRoute(s, asset);
  const [bStep, sStep] = (r?.steps ?? []) as P2PStep[];
  const buyAd = bStep?.ad ?? m?.BUY.find((a) => forMe(a, s, "BUY"));
  const sellAd = sStep?.ad ?? m?.SELL.find((a) => forMe(a, s, "SELL"));
  const row = r && p2pRow(s, r);
  const wins = !!r && r.profit_fiat > 0;
  const cap = money(s.settings.capital, 0);
  const coins = s.settings.p2p_assets
    .map((a) => ({ a, r: directRoute(s, a) }))
    .sort((x, y) => (y.r?.profit_fiat ?? -Infinity) - (x.r?.profit_fiat ?? -Infinity));
  const mineAds = (side: Side) => (m?.[side] ?? []).filter((a) => forMe(a, s, side));
  const nPay = s.settings.pay_methods?.length ?? 0;
  const nRecv = s.settings.recv_methods?.length ?? 0;

  return (
    <>
      <section className={`card mine-card ${wins ? "on" : ""}`} key={asset}>
        <div className="mkt-sec-head">
          <div className="mkt-sec-title">
            <span className={`sec-ico ${wins ? "green" : ""}`}><Icon name={wins ? "trend" : "wallet"} /></span>
            <div>
              <h2>{wins ? <>Gana ya con {asset}: <span className="up">{signedMoney(r.profit_fiat)}</span></> : <>Con tu capital en {asset}</>}</h2>
              <p className="sub">Solo anuncios que aceptan {cap}{(s.settings.pay_methods?.length || s.settings.recv_methods?.length) ? " y tus medios" : ""} · con todos tus costos</p>
            </div>
          </div>
          {row && wins ? <RouteStatus r={row} /> : r && <span className="badge bad">Hoy pierdes {money(-r.profit_fiat, 0)}</span>}
        </div>

        <div className="mine-pair">
          <MineSide side="BUY" ad={buyAd} asset={asset} s={s} qtyHint={bStep?.qty} />
          <span className="mine-arrow" aria-hidden="true"><Icon name="arrowRight" size={18} /></span>
          <MineSide side="SELL" ad={sellAd} asset={asset} s={s} />
        </div>
        {r ? <Breakdown r={r} /> : <p className="dim small mine-none"><Icon name="info" size={14} /> No hay un par de anuncios que acepte {cap} con tus medios.</p>}
        {wins && row && <details className="mine-steps"><summary><Icon name="listChecks" size={15} /> Paso a paso con botones a Binance</summary><Steps row={row} s={s} /></details>}
      </section>

      <section className="card mine-coins">
        <div className="mkt-sec-head">
          <div className="mkt-sec-title">
            <span className="sec-ico blue"><Icon name="coins" /></span>
            <div>
              <h2>Todas las criptos con {cap}</h2>
              <p className="sub">Comprar y vender ya la misma cripto · lo que te queda después de costos</p>
            </div>
          </div>
        </div>
        <div className="mine-grid">
          {coins.map(({ a, r: x }, i) => (
            <button key={a} type="button" className={`mine-coin ${a === asset ? "on" : ""} ${x ? tone(x.profit_fiat) : "flat"}`} onClick={() => onCoin(a)}
              style={{ ["--i" as string]: i } as CSSProperties}>
              <Coin s={a} size={24} />
              <span className="mine-coin-txt"><b>{a}</b><small>{x ? `${perUsd(x.per_usd)} por dólar` : "sin anuncios para ti"}</small></span>
              <b className={`val ${x ? tone(x.profit_fiat) : "flat"}`}>{x ? signedMoney(x.profit_fiat) : "—"}</b>
            </button>
          ))}
        </div>
      </section>

      <section className="card mkt-book mine-book">
        <div className="mkt-sec-head">
          <div className="mkt-sec-title">
            <span className="sec-ico"><Icon name="filter" /></span>
            <div>
              <h2>Anuncios para ti</h2>
              <p className="sub">Aceptan {cap}{nPay || nRecv ? " y tus medios de pago" : ""}</p>
            </div>
          </div>
        </div>
        <Book s={s} asset={asset} ads={{ BUY: mineAds("BUY"), SELL: mineAds("SELL") }}
          empty={(k) => <EmptyBox icon="filter" title={`Ningún anuncio para ${k === "BUY" ? "comprar" : "vender"} acepta ${cap}${methodsFor(s, k).length ? " con tus medios" : ""}.`}>Mira <b>Todos los anuncios</b> o cambia tu capital.</EmptyBox>} />
      </section>
    </>
  );
}

// ---------------------------------------------------------------- otro monto (todos los anuncios)

/** Ganancias que NO son con tu capital: anunciantes recomendables que piden otro monto. Separado para no confundir. */
function OtherAmount({ s, asset }: { s: State; asset: string }) {
  const r = directRoute(s, asset);
  const found = r && r.profit_fiat > 0 ? null : bestDeal(s, asset);
  const deal = found && !found.fitsCapital ? found : null;
  if (!deal) return null;
  return (
    <section className="card mkt-win other">
      <div className="mkt-sec-head">
        <div className="mkt-sec-title">
          <span className="sec-ico blue"><Icon name="layers" /></span>
          <div>
            <h2>Con otro monto en {asset}: <span className="up">{perUsd(deal.per_usd)}</span> por dólar</h2>
            <p className="sub">
              <b>No es con tu capital</b> ({money(s.settings.capital, 0)}): aceptan entre {money(deal.lo, 0)} y {money(deal.hi, 0)} · ya con todos tus costos
            </p>
          </div>
        </div>
        {deal.ratio < s.settings.safe_p2p && <span className="badge warn" title="Gana poco: si un precio cambia mientras operas, puede volverse pérdida">Justa · actúa rápido</span>}
      </div>
      <DealSteps d={deal} s={s} />
    </section>
  );
}

// ---------------------------------------------------------------- anuncio P2P

function AdRow({ ad, asset, best, side, s, i }: { ad: Ad; asset: string; best: number; side: Side; s: State; i: number }) {
  const j = judge(ad, best, side, s);
  const top = ad.price === best;
  const capital = s.settings.capital;
  const fits = takesCapital(ad, capital);
  const mineM = methodsFor(s, side);
  const unit = isDollar(asset) ? "por dólar" : `por ${asset}`;
  const url = advertiserUrl(ad);
  return (
    <article className={`ad ${j.good ? "good" : "bad"} ${top ? "top" : ""}`} style={{ ["--i" as string]: Math.min(i, 12) } as CSSProperties}>
      <header className="ad-head">
        <span className="ad-avatar" aria-hidden="true">
          {ad.nick.slice(0, 1).toUpperCase()}
          {ad.merchant && <span className="ad-avatar-badge"><Icon name="badgeCheck" size={13} /></span>}
        </span>
        <div className="ad-who">
          <ExtLink href={url}>{ad.nick}</ExtLink>
          {ad.merchant && <span className="ad-merchant" title="Comerciante verificado por Binance"><Icon name="shield" size={13} /> Comerciante</span>}
        </div>
        <span className={`verdict ${j.good ? "good" : "bad"}`}>
          <Icon name={j.good ? "check" : "x"} size={12} /> {j.label}
        </span>
      </header>

      <div className="ad-price-row">
        <span className="ad-price">{money(ad.price)}</span>
        <span className="ad-unit">{unit}</span>
        {side === "BUY" && s.settings.gmf > 0 && <span className="ad-gmf">con 4x1000: <b>{money(effBuy(ad.price, s))}</b></span>}
      </div>

      <dl className="ad-stats">
        <div className={j.ordersOk ? "" : "warn"}><dt><Icon name="listChecks" size={13} />Órdenes (30 d)</dt><dd>{num(ad.orders, 0)}</dd></div>
        <div className={j.finishOk ? "" : "warn"}><dt><Icon name="checkCircle" size={13} />Completadas</dt><dd>{num(ad.finish * 100, 0)} %</dd></div>
        <div><dt><Icon name="timer" size={13} />Para pagar</dt><dd>{ad.minutes ? `${ad.minutes} min` : "—"}</dd></div>
        <div><dt><Icon name="layers" size={13} />Disponible</dt><dd>{isDollar(asset) ? num(ad.available, 2) : qty(ad.available)} {asset}</dd></div>
      </dl>

      <footer className="ad-foot">
        <span className={`ad-limit ${fits ? "ok" : "no"}`} title={fits ? "Acepta tu capital" : "Tu capital está fuera de su límite"}>
          <Icon name={fits ? "checkCircle" : "alert"} size={15} />
          <span className="ad-limit-txt">
            <small>{fits ? "Acepta tu capital" : "Fuera de tu capital"}</small>
            {money(ad.min, 0)} – {money(ad.max, 0)}
          </span>
        </span>
        <div className="ad-methods" aria-label="Medios de pago">
          <Icon name="card" size={14} />
          {ad.methods.map((m) => <span key={m} className={`tag ${mineM.includes(m) ? "mine" : ""}`}>{m}</span>)}
        </div>
      </footer>

      {url && (
        <GoButton className="ad-go" href={url} icon={side === "BUY" ? "cart" : "handCoins"} strong={j.good}
          title={`Abre el perfil de ${ad.nick} en Binance P2P para ${side === "BUY" ? "comprarle" : "venderle"} ${asset}`}>
          {side === "BUY" ? "Comprar" : "Vender"}<span className="go-more"> {asset} a <b>{ad.nick}</b></span>
        </GoButton>
      )}
    </article>
  );
}

// ---------------------------------------------------------------- gráfico

function CoinChart({ asset, s }: { asset: string; s: State }) {
  const { hist, prefs, setPrefs } = useLive();
  const all = useMemo(() => series(hist, asset), [hist, asset]);
  const day = useMemo(() => dayStats(all, s.now), [all, s.now]);
  const pts = useMemo(() => all.filter((p) => p.t >= s.now - prefs.range), [all, s.now, prefs.range]);
  return (
    <section className="card mkt-chart">
      <div className="mkt-sec-head">
        <div className="mkt-sec-title">
          <span className="sec-ico blue"><Icon name="chart" /></span>
          <div>
            <h2>Precio de {asset}</h2>
            <p className="sub">El mejor anuncio de cada lado, de cualquier monto (antes de costos)</p>
          </div>
        </div>
        <Segmented label="Rango del gráfico" value={prefs.range} onChange={(r) => setPrefs({ range: r })}
          options={[[3600, "1 h"], [21600, "6 h"], [86400, "24 h"]] as const} />
      </div>
      <div className="mkt-series">
        <span className="mkt-serie" style={{ ["--c" as string]: "var(--s1)" } as CSSProperties}>
          <i className="key" />
          <b>Compra</b>
          {day && <small>hoy {money(day.buyMin)} a {money(day.buyMax)}</small>}
        </span>
        <span className="mkt-serie" style={{ ["--c" as string]: "var(--s2)" } as CSSProperties}>
          <i className="key" />
          <b>Venta</b>
          {day && <small>hoy {money(day.sellMin)} a {money(day.sellMax)}</small>}
        </span>
      </div>
      <PriceChart points={pts} gapSeconds={Math.max(120, 3 * s.settings.p2p_interval)} label={asset} />
    </section>
  );
}

// ---------------------------------------------------------------- todos los anuncios

function AllView({ s, asset }: { s: State; asset: string }) {
  const m = s.p2p!.market[asset];
  const [onlyMine, setOnlyMine] = useState(false);
  const has = (s.settings.pay_methods?.length ?? 0) + (s.settings.recv_methods?.length ?? 0) > 0;
  const pick = (k: Side) => (onlyMine ? m[k].filter((a) => paysWith(a, methodsFor(s, k))) : m[k]);
  return (
    <>
      <OtherAmount s={s} asset={asset} />
      <CoinChart asset={asset} s={s} />
      <section className="card mkt-book">
        <div className="mkt-legend">
          <span><i className="sw good" /><span><b>Verde</b>: buen precio y anunciante confiable</span></span>
          <span><i className="sw bad" /><span><b>Rojo</b>: precio peor que el mejor, o anunciante con pocas órdenes o que cancela</span></span>
        </div>
        <Book s={s} asset={asset} ads={{ BUY: pick("BUY"), SELL: pick("SELL") }}
          empty={() => <EmptyBox icon="filter" title="Ningún anuncio cumple tus filtros." />}
          extra={has ? <Toggle on={onlyMine} onChange={setOnlyMine} label="Solo mis medios" /> : undefined} />
      </section>
    </>
  );
}

// ---------------------------------------------------------------- pestaña

function readView(): View {
  try {
    const v = localStorage.getItem("cj-mkt-view");
    return v === "all" || v === "alerts" ? v : "mine";
  } catch {
    return "mine";
  }
}

export function Market() {
  const { state, prefs, setPrefs } = useLive();
  const [tab, setTab] = useState<View>("mine");
  const [sheet, setSheet] = useState<"costs" | "methods" | null>(null);
  useEffect(() => setTab(readView()), []);
  const pick = (v: View) => {
    setTab(v);
    try {
      localStorage.setItem("cj-mkt-view", v);
    } catch {
      /* sin almacenamiento */
    }
  };
  if (!state) return <div className="card"><Skeleton rows={10} /></div>;
  const st = state.settings;
  const asset = st.p2p_assets.includes(prefs.asset) ? prefs.asset : "USDT";
  const m = state.p2p?.market[asset];
  const buyAd = m?.BUY[0];
  const sellAd = m?.SELL[0];
  const buy = buyAd?.price;
  const sell = sellAd?.price;
  // precios netos con tu capital: lo que de verdad pagas y recibes por cada unidad (comisión P2P incluida)
  const route: Route | undefined = directRoute(state, asset);
  const [bStep, sStep] = (route?.steps ?? []) as P2PStep[];
  const netBuy = route && bStep ? (route.paid + route.costs.gmf + (route.costs.bank ?? 0)) / bStep.qty : effBuy(buy, state); // con 4x1000 y transferencia
  const netSell = route && sStep ? route.received / sStep.qty : sell;
  const rt = route ? route.per_usd : roundTrip(state, asset);
  const cap = money(st.capital, 0);
  const alerts = state.price_alerts ?? [];
  const hits = alerts.filter((a) => a.on && a.last?.hit).length;
  const nMethods = (st.pay_methods?.length ?? 0) + (st.recv_methods?.length ?? 0);
  const costTxt = [
    `comisión P2P ${pctPlain(state.p2p_fee ?? 0, 2)}${st.taker_fee < 0 ? " (auto)" : ""}`,
    st.gmf > 0 ? "4x1000" : "sin 4x1000",
    st.bank_fee ? `transferencia ${money(st.bank_fee, 0)}` : "transferencia gratis",
    `renta ${pctPlain(st.tax ?? 0, 0)}`,
  ].join(" · ");
  const winsWith = (a: string) => {
    const r = directRoute(state, a);
    return r && r.profit_fiat > 0 ? <span className="mkt-coin-dot" title="Gana con tu capital" /> : null;
  };

  return (
    <div className="mkt">
      <section className="card mkt-top">
        <div className="mkt-top-row">
          <div className="mkt-sec-title">
            <span className="sec-ico"><Icon name="coins" /></span>
            <div>
              <h2>Precios P2P</h2>
              <p className="sub">Los anuncios de Binance P2P en pesos, en vivo</p>
            </div>
          </div>
          <div className="toolbar mkt-tools">
            <CapitalField />
            <button className="btn mkt-tool-btn" onClick={() => setSheet("costs")} title="Comisión P2P, transferencia, renta y 4x1000">
              <Icon name="receipt" size={16} /> Mis costos
            </button>
            <button className={`btn mkt-tool-btn ${nMethods ? "set" : ""}`} onClick={() => setSheet("methods")} title="Con qué pagas y dónde recibes">
              <Icon name="card" size={16} /> Mis medios{nMethods > 0 && <span className="mkt-tool-n">{nMethods}</span>}
            </button>
          </div>
        </div>
        <CoinPicker assets={st.p2p_assets} value={asset} onChange={(a) => setPrefs({ asset: a })} badge={winsWith} />
        <div className="mkt-tabs">
          <Segmented label="Vista" value={tab} onChange={pick}
            options={[
              ["mine", <span key="m" className="mkt-switch-opt"><Icon name="wallet" size={15} />Con mi capital</span>],
              ["all", <span key="a" className="mkt-switch-opt"><Icon name="layers" size={15} />Todos los anuncios</span>],
              ["alerts", <span key="l" className="mkt-switch-opt"><Icon name="bellRing" size={15} />Alertas{alerts.length > 0 && <span className={`mkt-tab-n ${hits ? "hit" : ""}`}>{hits || alerts.length}</span>}</span>],
            ] as const} />
          <button type="button" className="mkt-costs-line" onClick={() => setSheet("costs")} title="Cambiar mis costos">
            <Icon name="check" size={13} /> {costTxt}
          </button>
        </div>
      </section>

      {!m ? (
        <div className="card"><Skeleton rows={8} /></div>
      ) : (
        <>
          {tab !== "alerts" && (
            <div className="mkt-kpis" key={asset}>
              <Kpi i={0} icon="cart" kind="buy" label="Te cuesta comprar" value={money(netBuy)}
                hint={bStep ? <>Te vende <b>{bStep.ad.nick}</b>{netBuy !== bStep.price && <> · anuncio {money(bStep.price)}</>}</>
                  : buyAd ? <>Ninguno acepta {cap} · mejor: <b>{buyAd.nick}</b></> : "Sin anuncios"} />
              <Kpi i={1} icon="handCoins" kind="sell" label="Recibes al vender" value={money(netSell)}
                hint={sStep ? <>Te compra <b>{sStep.ad.nick}</b>{netSell !== sStep.price && <> · anuncio {money(sStep.price)}</>}</>
                  : sellAd ? <>Ninguno acepta {cap} · mejor: <b>{sellAd.nick}</b></> : "Sin anuncios"} />
              <Kpi i={2} icon="swap" kind={`rt ${tone(rt)}`} label="Comprar y vender ya" value={<Usd v={rt} suffix="por dólar" />}
                hint={route ? <>Con {cap}: <b className={tone(route.profit_fiat) === "up" ? "up" : "down"}>{signedMoney(route.profit_fiat)}</b> neto</>
                  : buy && sell ? <>Comprar y vender: <b className={sell > buy ? "up" : sell < buy ? "down" : ""}>{pct(sell / buy - 1)}</b> (antes de costos)</> : undefined} />
              <Kpi i={3} icon="clock" kind="ago" label="Actualizado" value={<span className="mkt-ago"><span className="pulse" /><Ago t={state.p2p?.t} /></span>}
                hint={`Se revisa cada ${every(st.p2p_interval)}`} />
            </div>
          )}

          <div className="mkt-view" key={tab}>
            {tab === "mine" && <MineView s={state} asset={asset} onCoin={(a) => setPrefs({ asset: a })} />}
            {tab === "all" && <AllView s={state} asset={asset} />}
            {tab === "alerts" && <PriceAlerts s={state} asset={asset} />}
          </div>
          {tab !== "alerts" && (
            <p className="note"><Icon name="check" size={14} /> Precios netos con tu capital: ya descuentan {costTxt}. Confirma el precio en Binance antes de pagar.</p>
          )}
        </>
      )}
      {sheet === "costs" && <CostsSheet s={state} onClose={() => setSheet(null)} />}
      {sheet === "methods" && <MethodsSheet s={state} onClose={() => setSheet(null)} />}
    </div>
  );
}

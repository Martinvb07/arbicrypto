"use client";

import { useEffect, useState } from "react";
import { api, type LiveRow, type Movement, type Report, type Saldos } from "@/lib/api";
import { cashValue, currentYear, date, dateTime, KIND_LABEL, money, num, qty, signedMoney, tone } from "@/lib/format";
import type { TabId } from "../App";
import { BinanceCard } from "../BinanceCard";
import { CajaCard } from "../CajaCard";
import { useTodos } from "../DeclarationParts";
import { methodName } from "../GmfChoice";
import { GmfQuestion } from "../GmfQuestion";
import { ImportModal } from "../ImportModal";
import { MoveModal } from "../MoveModal";
import { Asset, Badge, Coin, Empty, Icon, Note, Skeleton } from "../ui";
import { useWallet } from "../wallet";
import { KIND_BADGE } from "./Movements";

/** useTodos necesita un reporte; mientras carga no hay pendientes que mostrar. */
const EMPTY_REPORT = { warnings_total: 0, unvalued: 0, cuadre: null, profile: { nit: "x", name: "x" } } as unknown as Report;
const WALLET: Record<string, string> = { spot: "Spot", funding: "Fondos", earn: "Earn" };

/** Una moneda en Binance, venga del panel (en vivo) o de la última sincronización de la wallet. */
interface Holding {
  asset: string; qty: number; value: number | null; usdt: number | null; cost: number; wallets: Record<string, number>; ok: boolean; app_qty: number;
  /** Ganancia o pérdida si la vendes ya, igual que Mis monedas en el panel: lo que recibes − (lo que te costó + 4x1000). */
  pnl: number | null;
  /** A quién y a cuánto le venderías (si el panel lo calculó). */
  sell: LiveRow["sell"];
}

/** Ganancia si vendes ya: con lo que de verdad recibes (panel) o, si no hay, con el valor a precio de mercado. */
const pnlOf = (received: number | null | undefined, cost: number, gmf: number) => (received != null && cost > 0 ? received - cost * (1 + gmf) : null);

/** Lo de Binance: los mismos saldos del panel (Mi Binance). Si el panel no responde, los de la última sincronización. */
function binanceCoins(s: Saldos | null): { coins: Holding[]; total: number | null; usdt: number | null; live: boolean; t: number | null } {
  const b = s?.binance;
  if (!b) return { coins: [], total: null, usdt: null, live: false, t: null };
  const p = b.panel;
  if (p) {
    return {
      coins: p.rows.filter((r) => (r.usdt ?? 1) >= 0.01).map((r) => ({
        asset: r.asset, qty: r.qty, value: r.fiat, usdt: r.usdt, cost: r.cost, wallets: r.wallets as Record<string, number>, ok: r.ok, app_qty: r.app_qty,
        pnl: pnlOf(r.sell ? r.sell.received : r.fiat, r.cost, p.gmf ?? 0), sell: r.sell,
      })),
      total: p.total_fiat, usdt: p.total_usdt, live: true, t: p.t,
    };
  }
  return {
    coins: b.rows.map((r) => ({ asset: r.asset, qty: r.qty, value: r.cop, usdt: r.usd, cost: r.cost, wallets: r.wallets, ok: r.ok, app_qty: r.app_qty,
      pnl: pnlOf(r.cop, r.cost, 0), sell: null })),
    total: b.total_cop, usdt: b.total_usd, live: false, t: b.synced,
  };
}

function ago(t: number | null | undefined): string {
  if (!t) return "nunca";
  const m = Math.max(0, Math.round((Date.now() / 1000 - t) / 60));
  return m < 1 ? "hace un momento" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`;
}

/** Inicio: todos tus saldos (Binance y bancos), el resultado y lo último que pasó. */
export function Home({ onTab }: { onTab: (t: TabId) => void }) {
  const { me, binance, setBinance, version, report, year, toast } = useWallet();
  const [s, setS] = useState<Saldos | null>(null);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<Movement[] | null>(null);
  const [modal, setModal] = useState<"" | "add" | "import">("");
  const lastOk = binance?.last_ok;
  const todoList = useTodos(report ?? EMPTY_REPORT, onTab, () => setModal("import"));

  useEffect(() => {
    let alive = true;
    const load = () => api.saldos().then((d) => { if (alive) { setS(d); setError(""); } }, (e: Error) => alive && setError(e.message));
    load();
    // el panel actualiza Binance cada minuto: la wallet lo sigue igual para mostrar siempre lo mismo
    const timer = setInterval(load, 60000);
    api.movements(currentYear()).then((r) => alive && setRecent(r.movements.slice(-6).reverse()), () => alive && setRecent([]));
    return () => { alive = false; clearInterval(timer); };
  }, [version, lastOk]);

  async function sync() {
    try {
      setBinance(await api.binanceSync());
    } catch (e) {
      toast("No se pudo actualizar", (e as Error).message, "bad");
    }
  }

  const running = binance?.job.state === "running";
  const bn = binanceCoins(s);
  const banks = s?.banks;
  const pnl = report?.books.pnl;
  const live = year >= currentYear();
  const pesos = Math.max(0, banks?.books ?? 0);
  const crypto = bn.total ?? 0;
  const total = crypto + pesos;
  const bad = bn.coins.filter((c) => !c.ok);
  const cryptoShare = total > 0 ? Math.max(0, Math.min(100, (crypto / total) * 100)) : 0;
  const nowMonth = Number(new Intl.DateTimeFormat("en", { timeZone: "America/Bogota", month: "numeric" }).format(new Date())) - 1;
  const month = live ? report?.books.months[nowMonth] : undefined;
  const unreal = bn.coins.reduce((a, c) => a + (c.pnl ?? 0), 0);
  const todos = report ? todoList : [];
  const pending = todos.filter((t) => !t.optional).length;
  const hour = Number(new Intl.DateTimeFormat("en", { timeZone: "America/Bogota", hour: "numeric", hour12: false }).format(new Date()));
  const hello = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";

  return (
    <div className="stack">
      {binance && !binance.connected && <BinanceCard />}
      {binance?.connected && <BinanceCard alertsOnly />}
      {pnl && live && <GmfQuestion operations={pnl.gross_profit + pnl.income} gmf={pnl.gmf} onSettings={() => onTab("ajustes")} />}
      {error && <Note kind="bad">{error}</Note>}

      {/* ---------- lo principal ---------- */}
      <div className="card home-hero">
        <div className="home-hero-main">
          <span className="home-hello">{hello}{me.profile.name ? `, ${me.profile.name.split(" ")[0]}` : ""} · {date(Date.now() / 1000)}</span>
          <small>Total de tu negocio</small>
          <b className="home-total">{s ? money(total) : "…"}</b>
          {s && (
            <>
              <div className="home-split" role="img" aria-label={`Binance ${Math.round(cryptoShare)} %, pesos ${Math.round(100 - cryptoShare)} %`}>
                <i className="c" style={{ width: `${cryptoShare}%` }} />
                <i className="p" style={{ width: `${100 - cryptoShare}%` }} />
              </div>
              <div className="home-legend">
                <span><i className="c" /> Binance <b>{money(crypto)}</b>{bn.usdt != null ? <small> · ≈ {num(bn.usdt, 2)} USDT</small> : null}</span>
                <span><i className="p" /> Pesos en tus cuentas <b>{money(pesos)}</b><small> · Nequi, banco…</small></span>
              </div>
            </>
          )}
        </div>
        <div className="home-hero-side">
          <div className="home-stat">
            <small>Resultado {year}</small>
            <b className={pnl ? tone(pnl.net) : ""}>{pnl ? signedMoney(pnl.net) : "…"}</b>
            <span>{pnl ? `Operaciones ${signedMoney(pnl.gross_profit + pnl.income)}${pnl.gmf ? ` · 4x1000 −${money(pnl.gmf)}` : ""}` : " "}</span>
          </div>
          {month && (
            <div className="home-stat">
              <small>Este mes</small>
              <b className={tone(month.net)}>{signedMoney(month.net)}</b>
              <span>{num(month.ops)} operaciones · compraste {money(month.bought)}</span>
            </div>
          )}
          {bn.coins.some((c) => c.cost > 0) && (
            <div className="home-stat">
              <small>Si vendieras hoy tus cripto</small>
              <b className={tone(unreal)}>{signedMoney(unreal)}</b>
              <span>{bn.live ? "Igual que Mis monedas: con comisión y 4x1000" : "Contra lo que te costaron"}</span>
            </div>
          )}
        </div>
      </div>

      {/* ---------- accesos rápidos ---------- */}
      <div className="quick">
        <button className="quick-btn" onClick={() => setModal("add")}><span className="quick-ic brand"><Icon name="plus" size={18} /></span><span><b>Agregar movimiento</b><small>Compra, venta, gasto…</small></span></button>
        <button className="quick-btn" onClick={() => setModal("import")}><span className="quick-ic"><Icon name="upload" size={18} /></span><span><b>Subir archivo</b><small>Historial de Binance o CSV</small></span></button>
        <button className="quick-btn" onClick={() => onTab("cuentas")}><span className="quick-ic"><Icon name="bank" size={18} /></span><span><b>Subir extracto</b><small>Bancos y billeteras</small></span></button>
        <button className="quick-btn" onClick={() => onTab("declaracion")}><span className="quick-ic"><Icon name="file" size={18} /></span><span><b>Declaración</b><small>{pending === 0 ? "Ver cómo vas" : pending === 1 ? "Falta 1 cosa" : `Faltan ${pending} cosas`}</small></span></button>
      </div>

      {todos.filter((t) => !t.optional).length > 0 && (
        <div className="card home-todos">
          <span className="home-todos-ic"><Icon name="alert" size={16} /></span>
          <div><b>Para que tus cifras queden bien</b><span>{todos.filter((t) => !t.optional).map((t) => t.text).join(" · ")}</span></div>
          <button className="btn btn-sm" onClick={() => onTab("declaracion")}>Revisar</button>
        </div>
      )}

      <div className="home-grid">
        {/* ---------- Binance ---------- */}
        <div className="card">
          <div className="card-head">
            <div className="bn-title">
              <span className="bn-logo"><Coin asset="BNB" size={22} /></span>
              <div>
                <h2>Tus cripto en Binance {bad.length > 0 && <Badge kind="warn">No cuadra</Badge>}{!bad.length && bn.coins.length > 0 && <Badge kind="good"><Icon name="check" size={11} /> Cuadra</Badge>}</h2>
                <span className="sub">
                  {!binance?.connected ? "Sin conectar" : running ? binance.job.step : bn.live ? `Igual que en el panel · ${ago(bn.t)}` : `Última lectura ${ago(bn.t)}`}
                </span>
              </div>
            </div>
            {binance?.connected && (
              <button className="btn btn-sm" onClick={sync} disabled={running}>
                {running ? <span className="spinner" /> : <Icon name="refresh" size={14} />} Actualizar
              </button>
            )}
          </div>
          {!s ? <div className="card-body"><Skeleton rows={2} /></div> : !bn.coins.length ? (
            <Empty icon="wallet" title="No tienes cripto en Binance ahora">
              {binance?.connected ? "Todo está en pesos. Cuando compres, aparece aquí." : "Conecta tu Binance para ver tus saldos."}
            </Empty>
          ) : (
            <div className="hold-list">
              {bn.coins.map((c) => {
                const share = crypto > 0 && c.value != null ? (c.value / crypto) * 100 : 0;
                const diff = c.pnl;
                const where = Object.entries(c.wallets).filter(([, v]) => v > 0).map(([w]) => WALLET[w] ?? w).join(" · ");
                const unit = c.value != null && c.qty > 0 ? c.value / c.qty : null;
                return (
                  <div key={c.asset} className="hold">
                    <Coin asset={c.asset} size={34} />
                    <div className="hold-main">
                      <div className="hold-top">
                        <b>{c.asset}</b>
                        <span className="muted">{qty(c.qty)}{where ? ` · ${where}` : ""}</span>
                        {!c.ok && <span className="warn hold-flag" title={`Según tus movimientos: ${qty(c.app_qty)}`}>Revisar</span>}
                      </div>
                      <div className="hold-bar"><i style={{ width: `${Math.max(share, 1.5)}%` }} /></div>
                      <small>{unit != null ? `1 ${c.asset} = ${money(unit)}` : "Sin precio"} · {num(share, 1)} % de tu Binance</small>
                    </div>
                    <div className="hold-val">
                      <b>{c.value != null ? money(c.value) : "—"}</b>
                      {diff != null ? <small className={tone(diff)} title={c.sell ? `Si vendes ya a ${c.sell.nick} a ${money(c.sell.price)}: recibes ${money(c.sell.received)}` : undefined}>{signedMoney(diff)}</small> : <small className="muted">{c.usdt != null ? `≈ ${num(c.usdt, 2)} USDT` : ""}</small>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {bad.length > 0 && (
            <div className="card-body" style={{ paddingTop: 12 }}>
              <Note kind="warn">
                <b>Tu Binance no cuadra con tus movimientos.</b> Te avisamos en el panel cada vez que cambia.
                <ul className="cuadre-list">
                  {bad.map((c) => {
                    const d = c.qty - (c.app_qty ?? 0);
                    return (
                      <li key={c.asset}>
                        <b>{c.asset}</b>: en Binance {qty(c.qty)} · según tus movimientos {qty(c.app_qty ?? 0)} ·{" "}
                        {d > 0 ? <>tienes <b>{qty(d)} más</b>: falta una compra o algo que te llegó</> : <>tienes <b>{qty(-d)} menos</b>: falta una venta o algo que salió</>}
                      </li>
                    );
                  })}
                </ul>
                <button className="link" onClick={() => onTab("movimientos")}>Ir a Movimientos</button>
              </Note>
            </div>
          )}
          {s && bn.coins.length > 0 && (
            <div className="card-body small-print">
              {bn.live && s.binance.panel?.usdt_fiat
                ? `Mismos saldos y precios que Mi Binance: USDT a ${money(s.binance.panel.usdt_fiat)} (mejor venta P2P).`
                : s.binance.trm ? `Precio de Binance × TRM ${money(s.binance.trm)}.` : ""}
              {" "}En la declaración va lo que te costó, no este valor.
            </div>
          )}
        </div>

        {/* ---------- caja en pesos ---------- */}
        <CajaCard onTab={onTab} />
      </div>

      <div className="grid-2">
        {/* ---------- actividad reciente ---------- */}
        <div className="card">
          <div className="card-head">
            <h2>Actividad reciente</h2>
            <button className="btn btn-sm btn-ghost" onClick={() => onTab("movimientos")}>Ver todo <Icon name="chevron" size={14} /></button>
          </div>
          {!recent ? <div className="card-body"><Skeleton rows={2} /></div> : !recent.length ? (
            <Empty icon="list" title="Sin movimientos este año" />
          ) : (
            <div className="feed">
              {recent.map((m) => {
                const asset = m.kind === "compra" || m.kind === "ingreso" || m.kind === "airdrop" ? m.in_asset : m.out_asset;
                return (
                  <div key={m.id} className="feed-row">
                    {asset && asset !== "COP" ? <Coin asset={asset} size={30} /> : <span className="feed-ic"><Icon name="bank" size={15} /></span>}
                    <span className="feed-txt">
                      <span className="feed-line"><Badge kind={KIND_BADGE[m.kind]}>{KIND_LABEL[m.kind]}</Badge>
                        {m.kind === "compra" ? `${qty(m.in_qty)} ${m.in_asset}` : m.kind === "venta" ? `${qty(m.out_qty)} ${m.out_asset}`
                          : m.kind === "permuta" ? `${m.out_asset} → ${m.in_asset}` : m.note || ""}</span>
                      <small>{dateTime(m.t)}{m.pay_method ? ` · ${methodName(m.pay_method)}` : ""}</small>
                    </span>
                    <b className="num">{money(cashValue(m))}</b>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ---------- rondas recientes ---------- */}
        <div className="card">
          <div className="card-head">
            <h2>Últimas rondas</h2>
            <button className="btn btn-sm btn-ghost" onClick={() => onTab("resultados")}>Ver resultados <Icon name="chevron" size={14} /></button>
          </div>
          {!report ? <div className="card-body"><Skeleton rows={2} /></div> : !report.books.rounds.length ? (
            <Empty icon="trend" title={`Sin rondas en ${year}`}>Una ronda es cada vuelta de pesos a cripto y de vuelta a pesos.</Empty>
          ) : (
            <div className="feed">
              {report.books.rounds.slice(-5).reverse().map((r) => (
                <div key={r.start} className="feed-row">
                  <span className="route">{["COP", ...r.assets, ...(r.open ? [] : ["COP"])].map((a, i) => <Coin key={i} asset={a} size={18} />)}</span>
                  <span className="feed-txt">
                    {r.open ? "En curso" : `Pagaste ${money(r.paid)} · recibiste ${money(r.received)}`}
                    <small>{dateTime(r.start)}{r.gmf ? ` · 4x1000 ${money(r.gmf)}` : ""}{r.binance_fees ? ` · Binance ${money(r.binance_fees)}` : ""}</small>
                  </span>
                  {r.open ? <Badge kind="info">En curso</Badge> : <b className={`num ${tone(r.result)}`}>{signedMoney(r.result)}</b>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {modal === "add" && <MoveModal onClose={() => setModal("")} />}
      {modal === "import" && <ImportModal onClose={() => setModal("")} />}
    </div>
  );
}

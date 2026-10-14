"use client";

import { useEffect, useState } from "react";
import { api, type Movement, type Saldos } from "@/lib/api";
import { cashValue, currentYear, date, dateTime, KIND_LABEL, money, num, qty, signedMoney, tone } from "@/lib/format";
import type { TabId } from "../App";
import { BinanceCard } from "../BinanceCard";
import { CajaCard } from "../CajaCard";
import { methodName } from "../GmfChoice";
import { GmfQuestion } from "../GmfQuestion";
import { ImportModal } from "../ImportModal";
import { MoveModal } from "../MoveModal";
import { Asset, Badge, Empty, Icon, Note, Skeleton } from "../ui";
import { useWallet } from "../wallet";
import { KIND_BADGE } from "./Movements";

const WALLET: Record<string, string> = { spot: "Spot", funding: "Fondos", earn: "Earn" };

/** Una moneda en Binance, venga del panel (en vivo) o de la última sincronización de la wallet. */
interface Coin { asset: string; qty: number; value: number | null; usdt: number | null; wallets: Record<string, number>; ok: boolean; app_qty: number }

function ago(t: number | null | undefined): string {
  if (!t) return "nunca";
  const m = Math.max(0, Math.round((Date.now() / 1000 - t) / 60));
  return m < 1 ? "hace un momento" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`;
}

/** Lo de Binance: los mismos saldos del panel (Mi Binance). Si el panel no responde, los de la última sincronización. */
function binanceCoins(s: Saldos | null): { coins: Coin[]; total: number | null; usdt: number | null; live: boolean; t: number | null } {
  const b = s?.binance;
  if (!b) return { coins: [], total: null, usdt: null, live: false, t: null };
  const p = b.panel;
  if (p) {
    return {
      coins: p.rows.filter((r) => (r.usdt ?? 1) >= 0.01).map((r) => ({
        asset: r.asset, qty: r.qty, value: r.fiat, usdt: r.usdt, wallets: r.wallets as Record<string, number>, ok: r.ok, app_qty: r.app_qty,
      })),
      total: p.total_fiat, usdt: p.total_usdt, live: true, t: p.t,
    };
  }
  return {
    coins: b.rows.map((r) => ({ asset: r.asset, qty: r.qty, value: r.cop, usdt: r.usd, wallets: r.wallets, ok: r.ok, app_qty: r.app_qty })),
    total: b.total_cop, usdt: b.total_usd, live: false, t: b.synced,
  };
}

/** Inicio: cuánto tienes hoy, dónde está y lo último que pasó. Nada más. */
export function Home({ onTab }: { onTab: (t: TabId) => void }) {
  const { me, binance, setBinance, version, report, year, toast } = useWallet();
  const [s, setS] = useState<Saldos | null>(null);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<Movement[] | null>(null);
  const [modal, setModal] = useState<"" | "add" | "import">("");
  const lastOk = binance?.last_ok;

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
  const pesos = banks?.books ?? null;
  const total = bn.total != null || pesos != null ? (bn.total ?? 0) + Math.max(0, pesos ?? 0) : null;
  const bad = bn.coins.filter((c) => !c.ok);
  const first = me.profile.name ? me.profile.name.split(" ")[0] : me.user.username;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Hola, {first}</h1>
          <p>Así está tu plata hoy, {date(Date.now() / 1000)}.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setModal("import")}><Icon name="upload" size={16} /> Subir archivo</button>
          <button className="btn btn-primary" onClick={() => setModal("add")}><Icon name="plus" size={16} /> Agregar movimiento</button>
        </div>
      </div>

      {binance && !binance.connected && <BinanceCard />}
      {binance?.connected && <BinanceCard alertsOnly />}
      {pnl && year === currentYear() && <GmfQuestion operations={pnl.gross_profit + pnl.income} gmf={pnl.gmf} onSettings={() => onTab("ajustes")} />}
      {error && <Note kind="bad">{error}</Note>}

      {/* ---------- los 4 números que importan ---------- */}
      <div className="kpis">
        <div className="kpi accent">
          <small>Tienes en total</small>
          <b>{total != null ? money(total) : "…"}</b>
          <span>Binance + pesos</span>
        </div>
        <div className="kpi">
          <small>En Binance</small>
          <b>{bn.total != null ? money(bn.total) : "…"}</b>
          <span>{bn.usdt != null ? `≈ ${num(bn.usdt, 2)} USDT` : " "}</span>
        </div>
        <div className="kpi">
          <small>En pesos</small>
          <b className={pesos != null && pesos < 0 ? "warn" : ""}>{pesos != null ? money(pesos) : "…"}</b>
          <span>En tus cuentas (Nequi, banco…)</span>
        </div>
        <div className="kpi">
          <small>Ganancia {year}</small>
          <b className={pnl ? tone(pnl.net) : ""}>{pnl ? signedMoney(pnl.net) : "…"}</b>
          <span>Ya con comisiones y 4x1000</span>
        </div>
      </div>

      <div className="home-grid">
        {/* ---------- Binance: lo mismo que Mi Binance en el panel ---------- */}
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Tu Binance</h2>
              <span className="sub">
                {!binance?.connected ? "Sin conectar"
                  : running ? binance.job.step
                  : bn.live ? <>Igual que en el panel · {ago(bn.t)}</>
                  : <>Última lectura {ago(bn.t)}</>}
              </span>
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
            <div className="coin-list">
              {bn.coins.map((c) => (
                <div key={c.asset} className="coin-row">
                  <Asset asset={c.asset} />
                  <span className="coin-where">
                    {Object.entries(c.wallets).filter(([, v]) => v > 0).map(([w]) => WALLET[w] ?? w).join(" · ")}
                  </span>
                  <span className="coin-val">
                    <b className="num">{c.value != null ? money(c.value) : "—"}</b>
                    <small className="num">{qty(c.qty)} {c.asset}</small>
                  </span>
                </div>
              ))}
            </div>
          )}
          {bad.length > 0 && (
            <div className="card-body" style={{ paddingTop: 12 }}>
              <Note kind="warn">
                <b>{bad.map((c) => c.asset).join(", ")}</b> no coincide con tus movimientos
                {bad.length === 1 ? ` (según ellos tienes ${qty(bad[0].app_qty)})` : ""}. Falta anotar alguna entrada o salida.{" "}
                <button className="link" onClick={() => onTab("movimientos")}>Ir a Movimientos</button>
              </Note>
            </div>
          )}
          {s && bn.coins.length > 0 && (
            <div className="card-body small-print">
              {bn.live && s.binance.panel?.usdt_fiat
                ? `Mismos saldos y precios que Mi Binance: USDT a ${money(s.binance.panel.usdt_fiat)} (mejor venta P2P).`
                : s.binance.trm ? `Precio de Binance × TRM ${money(s.binance.trm)}.` : ""}
              {" "}Para la DIAN cuenta lo que te costó, no este valor.
            </div>
          )}
        </div>

        {/* ---------- pesos ---------- */}
        <CajaCard onTab={onTab} />
      </div>

      {/* ---------- últimos movimientos ---------- */}
      <div className="card">
        <div className="card-head">
          <h2>Últimos movimientos</h2>
          <button className="btn btn-sm btn-ghost" onClick={() => onTab("movimientos")}>Ver todos <Icon name="chevron" size={14} /></button>
        </div>
        {!recent ? <div className="card-body"><Skeleton rows={2} /></div> : !recent.length ? (
          <Empty icon="list" title="Sin movimientos este año" />
        ) : (
          <div className="feed">
            {recent.map((m) => (
              <div key={m.id} className="feed-row">
                <Badge kind={KIND_BADGE[m.kind]}>{KIND_LABEL[m.kind]}</Badge>
                <span className="feed-txt">
                  {m.kind === "compra" ? `${qty(m.in_qty)} ${m.in_asset}` : m.kind === "venta" ? `${qty(m.out_qty)} ${m.out_asset}`
                    : m.kind === "permuta" ? `${m.out_asset} → ${m.in_asset}` : m.note || KIND_LABEL[m.kind]}
                  <small>{dateTime(m.t)}{m.pay_method ? ` · ${methodName(m.pay_method)}` : ""}</small>
                </span>
                <b className="num">{money(cashValue(m))}</b>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal === "add" && <MoveModal onClose={() => setModal("")} />}
      {modal === "import" && <ImportModal onClose={() => setModal("")} />}
    </div>
  );
}
